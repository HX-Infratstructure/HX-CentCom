# shellcheck shell=bash disable=SC2034

APP_UNIT=hx-centcom.service
SYNC_SERVICE=hx-centcom-github-sync.service
SYNC_TIMER=hx-centcom-github-sync.timer
APP_URL=http://192.168.50.215:5420
NODE_BIN=$HOME/.local/bin
CONFIG_DIR=$HOME/.config/hx-centcom
APP_ENV=$CONFIG_DIR/app.env
UNIT_DIR=$HOME/.config/systemd/user
DATA_DIR=$HOME/.local/share/hx-centcom
RELEASES_DIR=$DATA_DIR/releases
CURRENT_LINK=$DATA_DIR/current
PREVIOUS_LINK=$DATA_DIR/previous

step() { printf '== %s: %s (%s)\n' "$1" "$2" "$(date -u +%FT%TZ)"; }

die() {
	printf 'FAIL %s\n' "$*" >&2
	exit 1
}

refuse_root() {
	[[ $(id -u) != 0 ]] || die "run as the normal user, because the units are systemd user units of that user"
}

release_ok() {
	[[ -f $1/RELEASE && -f $1/.output/server/index.mjs ]] || return 1
	[[ -z ${2:-} || $(<"$1/RELEASE") == "$2" ]]
}

link_target() {
	if [[ -L $1 ]]; then readlink "$1"; fi
}

switch_current() {
	local old
	old=$(link_target "$CURRENT_LINK")
	if [[ -n $old ]]; then
		ln -sfn "$old" "$DATA_DIR/.previous.new"
		mv -T "$DATA_DIR/.previous.new" "$PREVIOUS_LINK"
	fi
	ln -sfn "$1" "$DATA_DIR/.current.new"
	mv -T "$DATA_DIR/.current.new" "$CURRENT_LINK"
	echo "current -> $1, previous -> ${old:-none}"
}

sync_installed() { [[ -e $UNIT_DIR/$SYNC_SERVICE || -e $UNIT_DIR/$SYNC_TIMER ]]; }

install_units() {
	local units=("$APP_UNIT") sources=() unit
	if [[ $2 == 1 ]] || sync_installed; then units+=("$SYNC_SERVICE" "$SYNC_TIMER"); fi
	for unit in "${units[@]}"; do sources+=("$1/deploy/hx15/$unit"); done
	systemd-analyze --user verify "${sources[@]}" || die "systemd-analyze rejected a unit in $1/deploy/hx15. No unit was copied"
	mkdir -p "$UNIT_DIR"
	for unit in "${units[@]}"; do install -m 644 "$1/deploy/hx15/$unit" "$UNIT_DIR/$unit"; done
	systemctl --user daemon-reload
	echo "installed ${units[*]}"
}

# One poll is not enough: a unit that crashes at start reports active until the process exits.
restart_app() {
	local i streak=0
	systemctl --user enable "$APP_UNIT"
	systemctl --user restart "$APP_UNIT"
	for ((i = 0; i < 20; i++)); do
		if systemctl --user is-active --quiet "$APP_UNIT"; then streak=$((streak + 1)); else streak=0; fi
		if ((streak == 3)); then
			echo "$APP_UNIT is active"
			return 0
		fi
		sleep 1
	done
	die "$APP_UNIT is not active after 20 s. See journalctl --user -u $APP_UNIT -n 50"
}

activate_release() {
	step units "verify and install from $DATA_DIR/$1/deploy/hx15 into $UNIT_DIR"
	install_units "$DATA_DIR/$1" "$2"
	step switch "make $1 current"
	if [[ $(link_target "$CURRENT_LINK") == "$1" ]]; then echo "current already points at $1"; else switch_current "$1"; fi
	step start "enable and restart $APP_UNIT"
	restart_app
}

# install.sh leaves an unfinished releases/<sha12> in place for inspection, so only folders that pass release_ok go.
prune_releases() {
	local dir spare='' others=()
	for dir in "$RELEASES_DIR"/*; do
		if [[ ! ${dir##*/} =~ ^[0-9a-f]{12}$ || -L $dir ]] || ! release_ok "$dir"; then continue; fi
		if [[ $dir -ef $CURRENT_LINK || $dir -ef $PREVIOUS_LINK ]]; then
			echo "keep $dir"
			continue
		fi
		others+=("$dir")
		if [[ -z $spare || $dir/RELEASE -nt $spare/RELEASE ]]; then spare=$dir; fi
	done
	for dir in "${others[@]}"; do
		if [[ $dir == "$spare" ]]; then
			echo "keep $dir"
		else
			echo "delete $dir"
			rm -rf -- "$dir"
		fi
	done
}
