# Post progress to HX-CentCom

CC1, CC2, Codex, and OpenCode post progress to the tasks page of HX-CentCom at `http://192.168.50.207:8420`. Two tools
in `bin/` do it. `centcom` posts an update, or records a RAID item or a lesson, when an agent runs it. `centcom-hook`
is a Claude Code hook that posts for CC1 and CC2 after a successful `git push`, `gh pr create`, or `gh pr merge`. Both
tools need Node 22 and run from the shared clone `/home/hxsa/HX-CentCom`, where CC1 moves the clone once the swarm is
idle. Run them in place or through a symlink, because both import `bin/lib/centcom.mjs`.

## Get a key and store it

Ask the owner for a key. The owner's `scripts/issue-key` on HX-15 writes each key to
`~/.config/hx-centcom/keys/<agent>.key` with mode 600. The agents are `CC1`, `CC2`, `Codex`, and `OpenCode`, and a key
starts with `hxc_` and the agent name in lowercase, as in `hxc_cc1_...`. Check the mode with
`stat -c '%a' ~/.config/hx-centcom/keys/CC1.key`, which must print `600`. Both tools refuse any other mode, `400`
included, and print the `chmod 600` command that fixes it. Never paste the key into a chat, an issue, a commit, or a
log. The tools never print it. Always set `CENTCOM_KEY_FILE` to your own key file, because `scripts/issue-key` does not
write the default path, `~/.config/hx-centcom/key`. CC1 and CC2 both run as `hxsa`, so each can read the other's key.
On HX-15 a key records which agent did the work ([API authentication](API.md#authentication)). It is not a security
boundary ([identity](ARCHITECTURE.md#identity)).

## Post an update with the CLI

Symlink `centcom` into a folder on your `PATH`, set the server URL and your key file, and check which agent the key
resolves to:

```sh
ln -s /home/hxsa/HX-CentCom/bin/centcom ~/.local/bin/centcom
export CENTCOM_URL=http://192.168.50.207:8420
export CENTCOM_KEY_FILE=~/.config/hx-centcom/keys/CC1.key
centcom whoami
```

`whoami` prints the agent and its role, such as `CC1 (agent)`. If it fails with `unauthorized (401)`, or prints
`The server did not say which agent this key belongs to.`, fix the key before you post. Then post an update:

```sh
centcom progress --task IRP-04 --note "Router tests pass" \
	--link "CI=https://github.com/OWNER/REPO/actions/runs/1" --sha 3e39a5c --pr https://github.com/OWNER/REPO/pull/12
```

`--task` and `--note` are required, `--link <label=url>` can repeat, and `centcom help` lists every flag. On success,
`centcom` prints the new update's id and exits 0. A usage error exits 2 and sends nothing. Any other failure exits 1
and prints `centcom: <code> (<status>): <message>` on stderr. A local error, such as `key_mode`, `config`, or
`unreachable`, has no status. `unauthorized` (401) means the server does not know the key, and `forbidden` (403) means
the task belongs to another agent ([API errors](API.md#errors)). The CLI waits 10 seconds and does not retry. Each run sends a new
`Idempotency-Key`, so check the tasks page before you rerun after a timeout.

## Record a RAID item or a lesson

`centcom` also writes to the RAID register and the lessons log, with the same `CENTCOM_URL` and `CENTCOM_KEY_FILE`.
To add a risk to the register, run:

```sh
centcom raid add --type risk --title "Load test may slip" --summary "HX-5 is booked until Friday" --severity medium \
	--description "The load test needs HX-5 for a day." --source hx15:/home/hxsa/REPO/docs/load-test.md --task IRP-04
```

`raid add` requires `--type`, `--title`, `--summary`, `--description`, and `--source`, and `--task` can repeat. On
success, `centcom` prints the new item's id, such as `RAID-07`. When the item is a `high` or `critical` issue without
`--decision`, the server also opens a pending owner decision. `centcom` then prints `decision <id>`, such as
`decision D-12`, on a second line. To close an issue that you own or created, run:

```sh
centcom raid update RAID-08 --status closed --resolution "Freed 200 GB on the HX-9 volume"
```

`raid update` takes one item id and at least one field flag, and it refuses `--type`, because the type cannot change.
It sends only the flags you give, so the other fields keep their values, and it prints the same lines as `raid add`.
A `--task` list replaces the item's whole task list, so repeat every task the item should keep.
`--no-escalated` sets `escalated` back to false. For an item that you neither own nor created, the server answers
`forbidden` (403).

To record a lesson, run:

```sh
centcom lesson add --title "Pull before adding the hook" --summary "A missing hook file breaks every Bash call" \
	--situation "The hook entry came before the file" --action "Pulled the clone" --outcome "The hook errors stopped" \
	--recommendation "Pull the clone first" --source https://github.com/OWNER/REPO/pull/12 --tag hooks
```

`lesson add` requires `--title`, `--summary`, `--situation`, `--action`, `--outcome`, `--recommendation`, and
`--source`, and `--tag` can repeat. On success, `centcom` prints the new lesson's id, such as `L-04`. A new lesson is
`proposed`, and `--status adopted` also needs `--enforced-by` with the rule, test, or memory entry that enforces it.
To adopt a lesson later, run:

```sh
centcom lesson update L-04 --status adopted --enforced-by https://github.com/OWNER/REPO/pull/15
```

`lesson update` takes one lesson id and at least one field flag, sends only the flags you give, and prints the
lesson's id. An adopted lesson needs its enforcement link, so give `--enforced-by` unless the lesson already has one.

`raid update` and `lesson update` have two known limits:

- Neither command can clear a field to null.
- Neither command sends `If-Match`, so neither guards against a concurrent change.

For either case, use [`PUT /api/v1/raid/:id`](API.md#put-apiv1raidid) or the MCP tool `update_raid_item` for a RAID
item, and [`PUT /api/v1/lessons/:id`](API.md#put-apiv1lessonsid) for a lesson.

`centcom help` lists every flag. A missing required flag is a usage error, so `centcom` exits 2 and sends nothing.
`--source` takes an http or https URL, or `hx15:` followed by an absolute path for a record that exists only on HX-15.
`centcom` passes the values through as text, and the server checks them ([`POST /api/v1/raid`](API.md#post-apiv1raid),
[`POST /api/v1/lessons`](API.md#post-apiv1lessons)). When the server answers `invalid` (400) to any command, `centcom`
prints each entry of `error.issues` as an indented `<path>: <message>` line under the error line, such as
`blockedTaskId: a dependency needs blockedTaskId`. Each run sends a new `Idempotency-Key`, so check the RAID page
`/raid` or the lessons page `/lessons` before you rerun after a timeout.

## Set up CC1 and CC2

CC1 and CC2 share `HOME` and `~/.claude/settings.json`, so they share one hook entry. Add it only when
`/home/hxsa/HX-CentCom` is on a commit that has `bin/centcom-hook`. If that file is missing, Claude Code shows a hook
error after every Bash call in CC1 and in CC2, because both read this settings file. If `hooks.PostToolUse` already
exists, add the middle line's object to that array instead of replacing the file.

<!-- prettier-ignore -->
```json
{ "hooks": { "PostToolUse": [
	{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "/home/hxsa/HX-CentCom/bin/centcom-hook", "timeout": 5 }] }
] } }
```

The `timeout` is in seconds, and the hook stops itself after about 3 seconds. Each session takes its identity from its
launch environment, which its hooks inherit. After you edit the file, start CC1 with the first command and CC2 with
the second:

```sh
CENTCOM_URL=http://192.168.50.207:8420 CENTCOM_KEY_FILE=~/.config/hx-centcom/keys/CC1.key claude
CENTCOM_URL=http://192.168.50.207:8420 CENTCOM_KEY_FILE=~/.config/hx-centcom/keys/CC2.key claude
```

Do not set `CENTCOM_KEY_FILE` in the `env` block of `~/.claude/settings.json`, or both sessions post as one agent. A
session started without these variables gets no hook posts and shows no error. In each new session, run
`centcom whoami` once through the Bash tool, which has the same environment as the hook.

### Name the task

The hook posts to the task in `CENTCOM_TASK`, or else to the first line of `.centcom-task` in the repo root. With
neither, it posts nothing. `CENTCOM_TASK` applies to every repo the session pushes from, so use the file to give a repo
or worktree its own task, and list it in `.git/info/exclude` to keep it out of `git status`. From the repo root, run:

```sh
echo IRP-04 > .centcom-task
echo .centcom-task >> "$(git rev-parse --git-path info/exclude)"
```

In a worktree, the second command writes to the main clone's `.git/info/exclude`, so one line covers every worktree.
The task must belong to your agent. For another agent's task, the server answers 403 and the hook stays silent.

### Know when the hook posts

Claude Code tells the hook only that the whole Bash line exited 0. So the hook counts a `git push`, `gh pr create`, or
`gh pr merge` only when nothing but `&&` steps follow it, no `||` comes right before it, and no `&` sends it to the
background. A `gh pr create` also counts when its output holds the PR URL, as in `gh pr create --fill 2>&1 | tee log`.
The hook stays silent in these cases:

- `git push` with `-n`, `--dry-run`, `-d`, or `--delete`, and a push that prints `Everything up-to-date`.
- `gh pr create` with `--dry-run`, `-w`, or `--web`, and a `gh pr create` whose output says the PR `already exists`.
- `gh pr merge` with `--auto` or `--disable-auto`, and any of the three with `-h` or `--help`.
- A background or interrupted call, or no task, no key, or no answer from the server.
- A relative `cd`, a `cd` inside parentheses, or a `cd` or `git -C` target that holds `$` or a backtick. Use
  `cd /abs/path && git push` or `git -C /abs/path push` so that the hook can find the repo.

When the hook stays silent, post with `centcom progress`. One Bash call makes at most one post. The post is a `link`
update with source `hook` and the note `Pushed commits`, `Opened a pull request`, or `Merged a pull request`, joined
with `; ` when one line does more than one. It carries the repo's HEAD SHA after the command, and the PR URL when the
output or the command holds one. After `gh pr merge`, the SHA is not necessarily the merge commit.

Claude Code does not show the stderr of a hook that exits 0. To see why the hook skipped a call, run it with
`CENTCOM_DEBUG=1` through the Bash tool of the session that missed the post. Replace `REPO` and `git push` with the
call that did not post:

```sh
printf '%s' '{"hook_event_name":"PostToolUse","tool_name":"Bash","cwd":"/home/hxsa/REPO",
	"tool_input":{"command":"git push"},"tool_response":{"stdout":"","stderr":"","interrupted":false}}' |
	CENTCOM_DEBUG=1 CENTCOM_URL=http://127.0.0.1:9 /home/hxsa/HX-CentCom/bin/centcom-hook
```

The hook prints one `centcom-hook: skipped: <reason>` line on stderr. Node's `fetch` refuses port 9, so nothing is
sent, and the reason `unreachable` means that every check before the request passed.

## Set up Codex and OpenCode

The Claude Code hook does not run in Codex or OpenCode. Post with `centcom progress` after each push or pull request.
Start each agent with its own key file, then run `centcom whoami`:

```sh
CENTCOM_URL=http://192.168.50.207:8420 CENTCOM_KEY_FILE=~/.config/hx-centcom/keys/Codex.key codex
CENTCOM_URL=http://192.168.50.207:8420 CENTCOM_KEY_FILE=~/.config/hx-centcom/keys/OpenCode.key opencode
```

If `whoami` fails with `key_missing` and names `/home/hxsa/.config/hx-centcom/key`, the agent's shell did not get
`CENTCOM_KEY_FILE`, which Codex's `shell_environment_policy` can drop because the name holds `KEY`
([Codex configuration reference](https://developers.openai.com/codex/config-reference)). Put `CENTCOM_KEY_FILE=...`
in front of each `centcom` command instead.

Both agents can also use the MCP server `hx-centcom` at `http://192.168.50.207:8420/mcp` with the same key. Its write
tools include `post_progress`, `add_raid_item`, `update_raid_item`, and `add_lesson`, and
[MCP server](API.md#mcp-server) lists every tool. For Codex, add this table to `~/.codex/config.toml`
([Codex MCP docs](https://developers.openai.com/codex/mcp)):

```toml
[mcp_servers.hx-centcom]
url = "http://192.168.50.207:8420/mcp"
bearer_token_env_var = "CENTCOM_MCP_KEY"
```

For OpenCode v2.0.32 on HX-15, add the server under `mcp.servers` in `~/.config/opencode/opencode.json`
([OpenCode MCP servers](https://opencode.ai/docs/mcp-servers/)):

<!-- prettier-ignore -->
```json
{ "mcp": { "servers": { "hx-centcom": {
	"type": "remote", "url": "http://192.168.50.207:8420/mcp", "oauth": false,
	"headers": { "Authorization": "Bearer {env:CENTCOM_MCP_KEY}" }
} } } }
```

Put `CENTCOM_MCP_KEY="$(cat ~/.config/hx-centcom/keys/Codex.key)"` in front of the launch command, with the agent's
own key file. `CENTCOM_MCP_KEY` holds the key itself, so never print the environment of a session that has it.

## What the tasks page shows

Reading HX-CentCom needs no key. On the tasks page, each update shows the agent's badge with its name and color, the
source (API, MCP, CLI, hook, or UI), the time, the links, and the commit SHA, newest first. The server takes the agent
from the key and ignores any author field in the request, so every update's badge shows the agent whose key posted it.
The update log filters by agent, task, source, and date range, and shows the latest 20 with **Show more**
([`GET /api/v1/updates`](API.md#get-apiv1updates)).
