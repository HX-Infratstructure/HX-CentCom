#!/usr/bin/env bash
# Makes an earlier HX-CentCom release current on HX-15 and restarts the app unit from it (R1 in deploy/hx15/README.md).
# The target is releases/<sha12> when given, else the release that `previous` points at. It never runs npm or a
# migration and never connects to the database. The older release then runs against the newer schema, which works
# while every migration is additive.
# Usage: deploy/hx15/rollback.sh [<sha12>]
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source-path=SCRIPTDIR source=common.sh
. "$here/common.sh"

usage() { echo "usage: deploy/hx15/rollback.sh [<sha12>]"; }

refuse_root
case $# in
0)
	rel=$(link_target "$PREVIOUS_LINK")
	[[ -n $rel ]] || die "$PREVIOUS_LINK does not exist. Name the release with rollback.sh <sha12>"
	;;
1)
	if [[ $1 == -h || $1 == --help ]]; then
		usage
		exit 0
	fi
	if [[ ! $1 =~ ^[0-9a-f]{12}$ ]]; then
		usage >&2
		exit 2
	fi
	rel=releases/$1
	;;
*)
	usage >&2
	exit 2
	;;
esac
T=$DATA_DIR/$rel

step check "target $T"
release_ok "$T" || die "$T lacks RELEASE or .output/server/index.mjs"
[[ $(link_target "$CURRENT_LINK") != "$rel" ]] || die "$rel is already current"
echo "target is a build of $(<"$T/RELEASE")"

activate_release "$rel" 0

echo "PASS rollback to $rel"
echo "next: $T/deploy/hx15/verify.sh $APP_URL"
