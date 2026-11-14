# shellcheck shell=bash
# The steps that change this host. Only install.sh and rollback.sh source this file, after common.sh. verify.sh never
# sources it, so the read-only checks cannot reach these functions.

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
