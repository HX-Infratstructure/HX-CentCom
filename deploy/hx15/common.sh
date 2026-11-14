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

sync_installed() { [[ -e $UNIT_DIR/$SYNC_SERVICE || -e $UNIT_DIR/$SYNC_TIMER ]]; }
