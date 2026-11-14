#!/usr/bin/env bash
# Checks a running HX-CentCom through URL: the app unit and the user's linger setting on this host, the dashboard page,
# the workspace API, and the MCP tool list that a caller without a key sees. It sends no key and changes nothing.
# Prints PASS or FAIL per check. Exits 0 when every check passes, 1 when any check fails, 2 on a usage error.
# Usage: deploy/hx15/verify.sh [URL]   (URL defaults to http://192.168.50.215:5420)
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source-path=SCRIPTDIR source=common.sh
. "$here/common.sh"

usage() { echo "usage: deploy/hx15/verify.sh [URL]   (URL defaults to $APP_URL)"; }

url=
for arg in "$@"; do
	case $arg in
	-h | --help)
		usage
		exit 0
		;;
	-*)
		usage >&2
		exit 2
		;;
	*)
		if [[ -n $url ]]; then
			usage >&2
			exit 2
		fi
		url=$arg
		;;
	esac
done
url=${url:-$APP_URL}
url=${url%/}
failures=0

pass() { printf 'PASS %s\n' "$1"; }
fail() {
	printf 'FAIL %s\n' "$1"
	failures=$((failures + 1))
}

JSON_KEYS=$(
	cat <<'PY'
import json, sys
try:
    d = json.load(sys.stdin)
except ValueError as e:
    sys.exit(f"not JSON ({e})")
if not isinstance(d, dict):
    sys.exit(f"a JSON {type(d).__name__}, not an object")
print(" ".join(d))
PY
)

MCP_READ=$(
	cat <<'PY'
import json, sys
mode, want = sys.argv[1], int(sys.argv[2])
head, _, body = sys.stdin.buffer.read().decode("utf-8", "replace").partition("\r\n\r\n")
lines = head.split("\r\n")
status = lines[0].split(" ")[1] if lines[0].startswith("HTTP/") else "none"
headers = {k.strip().lower(): v.strip() for k, _, v in (line.partition(":") for line in lines[1:])}
if not status.startswith("2"):
    sys.exit(f"HTTP status {status}")
try:
    if headers.get("content-type", "").startswith("text/event-stream"):
        messages = []
        for event in body.replace("\r\n", "\n").split("\n\n"):
            data = "\n".join(l[5:].removeprefix(" ") for l in event.split("\n") if l.startswith("data:"))
            if data.strip():
                messages.append(json.loads(data))
    else:
        messages = [json.loads(body)] if body.strip() else []
except ValueError as e:
    sys.exit(f"HTTP {status}, body is not JSON ({e})")
reply = next((m for m in messages if isinstance(m, dict) and m.get("id") == want), None)
if reply is None:
    sys.exit(f"HTTP {status}, no JSON-RPC response with id {want}")
if "error" in reply:
    sys.exit(f"JSON-RPC error {json.dumps(reply['error'])}")
result = reply.get("result") or {}
if mode == "init":
    print(headers.get("mcp-session-id", ""))
    print(result.get("protocolVersion", ""))
else:
    for tool in result.get("tools", []):
        print(tool.get("name", ""))
PY
)

state=$(systemctl --user is-active "$APP_UNIT")
if [[ $state == active ]]; then pass "$APP_UNIT is active"; else fail "$APP_UNIT is ${state:-unknown}, expected active"; fi

user=$(id -un)
linger=$(loginctl show-user "$user" -p Linger --value 2>&1)
if [[ $linger == yes ]]; then
	pass "$user has Linger=yes, so its units start at boot and keep running after logout"
else
	fail "loginctl show-user $user -p Linger is ${linger:-empty}, expected yes. GO-2 runs sudo loginctl enable-linger $user"
fi

code=$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' "$url/")
if [[ $code == 200 ]]; then pass "GET $url/ answered 200"; else fail "GET $url/ answered ${code:-nothing}, expected 200"; fi

workspace=$(curl -s --max-time 10 -w '\n%{http_code} %{content_type}' "$url/api/v1/workspace")
meta=${workspace##*$'\n'}
code=${meta%% *}
ctype=${meta#* }
if [[ $code != 200 ]]; then
	fail "GET /api/v1/workspace answered $code, expected 200"
elif [[ $ctype != application/json* ]]; then
	fail "GET /api/v1/workspace content type is ${ctype:-missing}, expected application/json"
elif keys=$(python3 -I -c "$JSON_KEYS" <<<"${workspace%$'\n'*}" 2>&1); then
	pass "GET /api/v1/workspace is a JSON object with keys: $keys"
else
	fail "GET /api/v1/workspace body is $keys"
fi

mcp_post() {
	local body=$1
	shift
	curl -s --max-time 15 -D - -X POST -H 'Content-Type: application/json' \
		-H 'Accept: application/json, text/event-stream' "$@" --data-binary "$body" "$url/mcp"
}

check_mcp() {
	local raw out session version code names name missing=() writes=()
	raw=$(mcp_post '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"hx-centcom-verify","version":"1.0.0"}}}')
	if ! out=$(python3 -I -c "$MCP_READ" init 1 <<<"$raw" 2>&1); then
		fail "MCP initialize: $out"
		return
	fi
	{
		read -r session
		read -r version
	} <<<"$out"
	if [[ -z $version ]]; then
		fail "MCP initialize returned no protocolVersion"
		return
	fi
	local headers=(-H "MCP-Protocol-Version: $version")
	if [[ -n $session ]]; then headers+=(-H "Mcp-Session-Id: $session"); fi

	code=$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
		-H 'Accept: application/json, text/event-stream' "${headers[@]}" \
		--data-binary '{"jsonrpc":"2.0","method":"notifications/initialized"}' "$url/mcp")
	if [[ $code != 2* ]]; then
		fail "MCP notifications/initialized answered $code, expected 2xx"
		return
	fi

	raw=$(mcp_post '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' "${headers[@]}")
	if ! names=$(python3 -I -c "$MCP_READ" tools 2 <<<"$raw" 2>&1); then
		fail "MCP tools/list: $names"
		return
	fi
	for name in list_tasks get_task list_decisions my_work; do
		grep -qxF "$name" <<<"$names" || missing+=("$name")
	done
	for name in post_progress set_requirement request_decision add_raid_item update_raid_item add_lesson; do
		if grep -qxF "$name" <<<"$names"; then writes+=("$name"); fi
	done
	local listed
	listed=$(tr '\n' ' ' <<<"$names")
	if [[ -z $names ]]; then
		fail "MCP tools/list without a key returned no tools"
	elif ((${#missing[@]} > 0)); then
		fail "MCP tools/list without a key lacks ${missing[*]}; tools: $listed"
	elif ((${#writes[@]} > 0)); then
		fail "MCP tools/list without a key offers write tools ${writes[*]}; tools: $listed"
	else
		pass "MCP $version tools/list without a key has read tools only: $listed"
	fi
}
check_mcp

if ((failures > 0)); then
	echo "verify: $failures check(s) failed"
	exit 1
fi
echo "verify: all checks passed"
