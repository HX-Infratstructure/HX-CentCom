#!/usr/bin/env bash
# Builds one exact commit of HX-CentCom into its own release folder on HX-15, migrates the database, makes the release
# current, restarts the app unit and deletes all but three releases. With --sync it also runs the GitHub sync once and
# enables its timer; without --sync the timer is never enabled. Run it as the normal user from the clone that holds
# it, with that clone clean. SHA must be reachable from origin/main. The build comes from `git archive`, so the
# clone's HEAD never moves. A rerun converges. deploy/hx15/README.md names the owner GO that each run needs.
# Usage: deploy/hx15/install.sh [--sync] <40-hex SHA>
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source-path=SCRIPTDIR source=common.sh
. "$here/common.sh"
# shellcheck source-path=SCRIPTDIR source=mutate.sh
. "$here/mutate.sh"

usage() { echo "usage: deploy/hx15/install.sh [--sync] <40-hex SHA>"; }

refuse_root
sync=0
sha=
for arg in "$@"; do
	case $arg in
	--sync) sync=1 ;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		if [[ -n $sha ]]; then
			usage >&2
			exit 2
		fi
		sha=$arg
		;;
	esac
done
if [[ ! $sha =~ ^[0-9a-f]{40}$ ]]; then
	usage >&2
	exit 2
fi

repo=$(git -C "$here" rev-parse --show-toplevel)
sha12=${sha:0:12}
rel=releases/$sha12
R=$DATA_DIR/$rel

step preflight "clone $repo, $sha on origin/main, $APP_ENV, $NODE_BIN/node"
dirty=$(git -C "$repo" status --porcelain --untracked-files=all)
[[ -z $dirty ]] || die "$repo has uncommitted or untracked files"
git -C "$repo" cat-file -e "$sha^{commit}" || die "$repo has no commit $sha. Run git -C $repo fetch origin first"
git -C "$repo" merge-base --is-ancestor "$sha" origin/main ||
	die "$sha is not reachable from origin/main in $repo. Run git -C $repo fetch origin first"
[[ -f $APP_ENV ]] || die "$APP_ENV is missing. GO-1 in deploy/hx9/README.md creates it"
[[ $(stat -c %a "$APP_ENV") == 600 ]] || die "$APP_ENV must have mode 600"
[[ $(stat -c %a "$CONFIG_DIR") == 700 ]] || die "$CONFIG_DIR must have mode 700"
grep -q '^DATABASE_URL=' "$APP_ENV" || die "$APP_ENV has no DATABASE_URL= line"
[[ -x $NODE_BIN/node ]] || die "$NODE_BIN/node is missing, and both units run it"
export PATH=$NODE_BIN:$PATH
unset NODE_ENV

step build "$R"
mkdir -p "$RELEASES_DIR"
if [[ -e $R ]]; then
	release_ok "$R" "$sha" || die "$R exists but is not a finished build of $sha. It was left in place for inspection"
	echo "reusing $R, a finished build of $sha"
else
	build=$RELEASES_DIR/.build-$sha12
	rm -rf -- "$build"
	mkdir "$build"
	git -C "$repo" archive "$sha" | tar -x -C "$build"
	(cd "$build" && npm ci --include=dev --ignore-scripts --no-audit --no-fund && npm run build)
	[[ -f $build/.output/server/index.mjs ]] || die "the build wrote no .output/server/index.mjs"
	printf '%s\n' "$sha" >"$build/RELEASE"
	mv -T "$build" "$R"
fi

step migrate "npm run db:migrate in $R with $APP_ENV loaded, not printed"
(
	cd "$R"
	set -a
	# shellcheck source=/dev/null
	. "$APP_ENV"
	set +a
	npm run db:migrate
)

activate_release "$rel" "$sync"

step prune "keep current, previous and the newest other release in $RELEASES_DIR"
prune_releases

if ((sync)); then
	step sync "run $SYNC_SERVICE once, then enable $SYNC_TIMER"
	systemctl --user start "$SYNC_SERVICE" || die "$SYNC_SERVICE failed. See journalctl --user -u $SYNC_SERVICE -n 50"
	systemctl --user enable --now "$SYNC_TIMER"
fi

echo "PASS install $sha"
echo "next: $R/deploy/hx15/verify.sh $APP_URL"
