# Deploy HX-CentCom on HX-15

This folder runs HX-CentCom on HX-15 as systemd user units of `hxsa`. HX-7 NGINX proxies `http://192.168.50.207:8420` to the app, and the database is on HX-9. The plan, with its precedents and citations, is `DEPLOY-RECON.md` in the WU1 work-unit folder `docs/wu1-monday-reference/`.

| File                             | Purpose                                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `hx-centcom.service`             | Runs `node .output/server/index.mjs` from the `current` release on `192.168.50.215:5420`                              |
| `hx-centcom-github-sync.service` | Runs `node --import tsx scripts/github-sync.ts` once from the `current` release. It sends only GET requests to GitHub |
| `hx-centcom-github-sync.timer`   | Starts the sync service every 5 minutes                                                                               |
| `common.sh`                      | The names, the paths and the shared steps of the three scripts below                                                  |
| `install.sh`                     | Builds one exact commit into a release folder, migrates, makes it current, restarts the app and deletes old releases  |
| `rollback.sh`                    | Makes an earlier release current and restarts the app, with no npm and no database access                             |
| `verify.sh`                      | Read-only checks of a running app through a URL                                                                       |

Every step that writes to a host needs the owner's GO for that exact step. For the app, the GO also names the exact commit. Run the GOs in this order:

1. GO-1 creates the database and its role on HX-9. See [`../hx9/README.md`](../hx9/README.md).
2. GO-2 installs the app on HX-15 for commit `S`. See [Install the app](#install-the-app-go-2).
3. GO-3 opens the HX-7 route. See [`../hx7/README.md`](../hx7/README.md).
4. GO-4 starts the GitHub sync timer. See [Start the GitHub sync](#start-the-github-sync-go-4).

## Know the paths and names

| Item            | Value                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Clone           | `/home/hxsa/HX-CentCom`                                                                                                           |
| Node            | `~/.local/bin/node`, v22.23.3. Both units run it. The sync unit loads `tsx` from the release's `node_modules` with `--import tsx` |
| Env file        | `~/.config/hx-centcom/app.env`, mode 600, in `~/.config/hx-centcom/`, mode 700                                                    |
| Releases        | `~/.local/share/hx-centcom/releases/<first 12 characters of the SHA>/`                                                            |
| Release links   | `~/.local/share/hx-centcom/current` and `~/.local/share/hx-centcom/previous`, beside `releases/`                                  |
| Installed units | `~/.config/systemd/user/`, copied from the release with `install -m 644`                                                          |
| App listener    | `192.168.50.215:5420`                                                                                                             |
| Public URL      | `http://192.168.50.207:8420` (HX-7)                                                                                               |
| Database        | `centcom` on `192.168.50.209:5432`, role `centcom_app`                                                                            |

Each release folder holds a `git archive` of its commit, its `node_modules`, its build in `.output/`, and a `RELEASE` file with the full SHA. `install.sh` writes `RELEASE` last, so a folder without it is an unfinished build. The sync script and `npm run db:migrate` run from the release through `tsx`, so `node_modules` stays in it. After each install, three releases stay: the two that `current` and `previous` point at, and the newest other one.

## Know the environment names

The table names each variable and where it is set. It holds no value.

| Name                          | Set in                                             | Read by                                                                        | Secret                                | Holds                                                                                                                                |
| ----------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                | `~/.config/hx-centcom/app.env`                     | both services, `npm run db:migrate`, `npm run db:seed` and `scripts/issue-key` | yes                                   | The `centcom_app` connection URL with its password                                                                                   |
| `NODE_ENV`                    | `Environment=` of both services                    | both services                                                                  | no                                    | The Node runtime mode                                                                                                                |
| `NITRO_HOST`                  | `Environment=` of `hx-centcom.service`             | the app server                                                                 | no                                    | The listen address                                                                                                                   |
| `NITRO_PORT`                  | `Environment=` of `hx-centcom.service`             | the app server                                                                 | no                                    | The listen port                                                                                                                      |
| `GITHUB_TOKEN_FILE`           | `Environment=` of `hx-centcom-github-sync.service` | `scripts/github-sync.ts`                                                       | The path is not. The file it names is | The path of the owner's GitHub token file (SPEC R8). The file holds one token of printable ASCII, with no space or line break inside |
| `CENTCOM_OWNER_KEY_FILE`      | The `scripts/issue-key` command line               | `scripts/issue-key`                                                            | The path is not. The file it names is | The path of the owner key that authorizes the agent keys                                                                             |
| `CENTCOM_WEBHOOK_URLS`        | `~/.config/hx-centcom/app.env`                     | the app server                                                                 | no                                    | Comma-separated http or https URLs that receive the decision webhook. Optional. The app logs only each URL's origin and path         |
| `CENTCOM_WEBHOOK_SECRET_FILE` | `~/.config/hx-centcom/app.env`                     | the app server                                                                 | The path is not. The file it names is | The absolute path of a mode-600 file that holds the webhook's HMAC-SHA256 secret, one token of printable ASCII. Optional             |

Set both webhook variables or neither. With both unset, the app sends no webhook. With only one set, or with an invalid URL or secret file, the app's first request fails and names the variable. [API.md](../../docs/API.md#decision-webhook) describes the event.

Never print `app.env` or the token file. To load `app.env` into a command, use `(set -a; . ~/.config/hx-centcom/app.env; set +a; <command>)`.

## Fetch the commit

`S` is the full 40-character merge SHA that the owner's GO names. Before GO-1 and before each later install, run these commands on HX-15 as `hxsa`:

```sh
git -C ~/HX-CentCom fetch origin
git -C ~/HX-CentCom merge-base --is-ancestor <S> origin/main && echo "S is on origin/main"
```

The second command must print `S is on origin/main`. `git fetch` updates only the remote-tracking branches, so the clone's `HEAD` and working tree stay as they are. `install.sh` accepts any SHA that is reachable from `origin/main`. It builds the release from `git archive <S>` and never moves `HEAD`.

## Install the app (GO-2)

Finish GO-1 first, so that `app.env` exists and the database answers.

1. Run the install from the clone:

   ```sh
   ~/HX-CentCom/deploy/hx15/install.sh <S>
   ```

   `install.sh` and `common.sh` run from the clone's working tree. That tree must already hold `deploy/hx15` at a commit on `origin/main`. `install.sh` never moves `HEAD` and never checks out a commit. The release that it builds, with its units and its migrations, comes from `S`. The script prints a `== <step>: <what>` line with the UTC time before each step, and stops at the first failure. It does these steps:

   - It refuses root, a SHA that is not 40 lowercase hex characters, and a clone with uncommitted or untracked files.
   - It refuses a SHA that the clone does not have, and a SHA that is not reachable from `origin/main`. Both messages say to run `git -C <clone> fetch origin` first.
   - It checks the modes of `app.env` (600) and its folder (700), checks that `app.env` has a `DATABASE_URL=` line, and checks that `~/.local/bin/node` exists.
   - It builds `releases/<sha12>` from `git archive <S>`, with `npm ci --include=dev --ignore-scripts --no-audit --no-fund` and `npm run build`. The clone's `HEAD` does not move. If a finished build of `S` is already there, it reuses it. If the folder holds anything else, it stops and deletes nothing.
   - It runs `npm run db:migrate` from the release with `app.env` loaded.
   - It runs `systemd-analyze --user verify` on the release's `hx-centcom.service`, copies the unit into `~/.config/systemd/user/` and runs `systemctl --user daemon-reload`. If the check fails, it copies nothing and `current` does not move.
   - It points `previous` at the old `current`, then `current` at the new release. Each link changes in one rename.
   - It enables the unit, restarts it, and waits up to 20 seconds for it to stay active.
   - It deletes old releases. It keeps the releases that `current` and `previous` point at, and the newest other finished release by the modification time of its `RELEASE` file. It deletes every other finished release. For each finished release it prints `keep <path>` or `delete <path>`, with the full path of the folder. It never touches a `.build-*` folder, the two links, a folder whose name is not 12 hex characters, or a folder that lacks `RELEASE` or `.output/server/index.mjs`.

   The unit runs the app from the `current` link, so the running app keeps its old code until the restart. A rerun with the same SHA converges. It reuses the build, reinstalls the units, skips the link switch, restarts the app and keeps the same three releases. The new listener `192.168.50.215:5420` is a new LAN exposure.

2. Load the seed. `npm run db:seed` runs `src/server/db/cli.ts seed` from the release with `app.env` loaded:

   ```sh
   cd ~/.local/share/hx-centcom/current
   (set -a; . ~/.config/hx-centcom/app.env; set +a; npm run db:seed)
   ```

   The command prints `seeded` and the number of rows that each table received. A rerun inserts nothing and prints zeros.

3. Issue the keys. `scripts/issue-key` runs from the release with `app.env` loaded. Every run needs `--agent` and `--label`, and the label is 1 to 100 characters. First, issue the owner key for Agent Zero. This run needs no owner key, and it works only while no owner key is active:

   ```sh
   cd ~/.local/share/hx-centcom/current
   (set -a; . ~/.config/hx-centcom/app.env; set +a; scripts/issue-key --agent "Agent Zero" --label owner)
   ```

   Then issue one key each for CC1, CC2, Codex and OpenCode. These runs read the owner key from the file that `CENTCOM_OWNER_KEY_FILE` names:

   ```sh
   cd ~/.local/share/hx-centcom/current
   (set -a; . ~/.config/hx-centcom/app.env; set +a
   	export CENTCOM_OWNER_KEY_FILE="$HOME/.config/hx-centcom/keys/Agent Zero.key"
   	scripts/issue-key --agent CC1 --label GO-2
   	scripts/issue-key --agent CC2 --label GO-2
   	scripts/issue-key --agent Codex --label GO-2
   	scripts/issue-key --agent OpenCode --label GO-2)
   ```

   Each run prints one line, `issued <key id> <file>`, and never prints a key. The key goes to `~/.config/hx-centcom/keys/<agent>.key`, and its key id goes to `~/.config/hx-centcom/keys/<agent>.key.id`. The `keys` folder has mode 700, and both files have mode 600. A run without `--rotate` refuses an agent whose key file exists.

   To replace a key, add `--rotate` to the agent's command in the same subshell. The script reads the old key id from `<agent>.key.id`. It issues the new key first, replaces both files, and prints `issued <key id> <file>`. Then it revokes the old key and prints `revoked <id>`. If the old key is no longer active, it prints `revoked nothing: key <id> is not active` instead:

   ```sh
   cd ~/.local/share/hx-centcom/current
   (set -a; . ~/.config/hx-centcom/app.env; set +a
   	export CENTCOM_OWNER_KEY_FILE="$HOME/.config/hx-centcom/keys/Agent Zero.key"
   	scripts/issue-key --agent CC1 --label rotated --rotate)
   ```

   A run that fails before the revoke leaves the old key active, so the agent always has a working key. If the revoke fails, the new key stays saved. The script prints one `issue-key failed:` line that names the new key id and the old key id, and exits with code 1. To finish the rotation, revoke the old key as the owner with `DELETE /api/v1/keys/<old key id>`.

   If `<agent>.key.id` is missing, `--rotate` stops before it issues or revokes a key. To replace that key, do these steps:

   1. Revoke the old key as the owner with `DELETE /api/v1/keys/<id>`. The key id is in the `issued` line of the run that issued the key.
   2. Remove `~/.config/hx-centcom/keys/<agent>.key`.
   3. Run the agent's command again without `--rotate`.

4. Run the login test in [`../hx9/README.md`](../hx9/README.md#test-the-login-from-hx-15-go-1-after-go-2).

5. Run checks V-A.

### Checks V-A

| ID   | Command on HX-15                                                                                                 | Expected                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| V-A1 | `ss -ltnp \| grep ':5420 '`                                                                                      | Exactly one listener, `192.168.50.215:5420`, held by `node`                        |
| V-A2 | `systemctl --user show hx-centcom -p ActiveState,SubState,NRestarts,FragmentPath`                                | `active`, `running`, `0`, and `/home/hxsa/.config/systemd/user/hx-centcom.service` |
| V-A2 | `cmp ~/.config/systemd/user/hx-centcom.service ~/.local/share/hx-centcom/current/deploy/hx15/hx-centcom.service` | No output, exit 0                                                                  |
| V-A3 | `stat -c '%a %n' ~/.config/hx-centcom ~/.config/hx-centcom/app.env`                                              | `700` and `600`                                                                    |
| V-A4 | `curl -s -o /dev/null -w '%{http_code}\n' http://192.168.50.215:5420/`                                           | `200`                                                                              |
| V-A5 | `curl -s http://192.168.50.215:5420/api/v1/workspace`                                                            | JSON whose counts match the seed (SPEC section 3), with no `recommended_by` set    |
| V-A6 | The two `curl` commands below this table                                                                         | `401` both times (SPEC T1)                                                         |
| V-A7 | MCP `tools/list` with no key. `verify.sh` runs it                                                                | No write tool (SPEC T9)                                                            |
| V-A8 | `~/.local/share/hx-centcom/current/deploy/hx15/verify.sh http://192.168.50.215:5420`                             | Exit 0                                                                             |

V-A6 posts to a seeded task, once with no key and once with an unknown key:

```sh
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
	-d '{"note":"V-A6"}' http://192.168.50.215:5420/api/v1/tasks/<seeded task id>/updates
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
	-H 'Authorization: Bearer hxc_unknown_v-a6' \
	-d '{"note":"V-A6"}' http://192.168.50.215:5420/api/v1/tasks/<seeded task id>/updates
```

## Verify a running app

`verify.sh` takes one optional URL. The default is `http://192.168.50.215:5420`.

```sh
~/.local/share/hx-centcom/current/deploy/hx15/verify.sh
~/.local/share/hx-centcom/current/deploy/hx15/verify.sh http://192.168.50.207:8420
```

It prints one `PASS` or `FAIL` line per check:

- `systemctl --user is-active hx-centcom.service` is `active`. This check reads the unit on the host that runs the script, so run the script on HX-15.
- `GET /` answers 200.
- `GET /api/v1/workspace` answers 200 with a JSON content type and a JSON object. The script prints its top-level keys.
- MCP over streamable HTTP at `/mcp` sends `initialize`, `notifications/initialized` and `tools/list`, with no `Authorization` header. The tool list must hold `list_tasks`, `get_task`, `list_decisions` and `my_work`, and none of `post_progress`, `set_requirement`, `request_decision`, `add_raid_item`, `update_raid_item` and `add_lesson`. The script prints the tool names.

The script sends no key and changes nothing. It exits 0 when every check passes, 1 when a check fails, and 2 on a usage error.

## Open the HX-7 route (GO-3)

See [`../hx7/README.md`](../hx7/README.md). Run it after GO-2, so that the route has an upstream.

## Start the GitHub sync (GO-4)

The sync sends the owner's token to GitHub in GET requests every 5 minutes. Use one of these two ways.

- To reuse the install script, run it with `--sync` for the commit that is current:

  ```sh
  ~/HX-CentCom/deploy/hx15/install.sh --sync <S>
  ```

  It reuses the release, installs the sync units, restarts the app, runs the sync once, and enables the timer. A failed sync run stops the script before the timer is enabled.

- To leave the app running, run the commands instead:

  ```sh
  R=~/.local/share/hx-centcom/current
  systemd-analyze --user verify "$R"/deploy/hx15/hx-centcom-github-sync.{service,timer}
  install -m 644 "$R"/deploy/hx15/hx-centcom-github-sync.{service,timer} ~/.config/systemd/user/
  systemctl --user daemon-reload
  systemctl --user start hx-centcom-github-sync.service
  systemctl --user enable --now hx-centcom-github-sync.timer
  ```

  If `systemd-analyze` reports an error, stop before `install`. If `systemctl --user start` fails, stop. Do not enable the timer.

Once the sync units are installed, every later `install.sh` and `rollback.sh` reinstalls them from the release it makes current. Without `--sync`, `install.sh` never enables the timer.

Each run also fetches every PR that the database holds as `open` and that GitHub's open list no longer has. This covers a PR whose repository is archived or no longer in the organization's list. If GitHub answers 404 or a redirect for that PR, the sync sets its state to `gone` and prints `github-sync gone repo=<repo> number=<n> id=<id>` before its `github-sync ok` line. GitHub sends a redirect for a repository transferred out of the organization, and the sync never follows one. Any other error status fails the run, and so does a redirect on any other request.

### Checks V-C

| ID   | Command on HX-15                                                                                                                  | Expected                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| V-C1 | `systemctl --user show hx-centcom-github-sync -p Result,ExecMainStatus` after the first run                                       | `Result=success`, `ExecMainStatus=0`                       |
| V-C2 | `curl -s http://192.168.50.215:5420/api/v1/workspace \| python3 -c 'import json, sys; print(len(json.load(sys.stdin)["repos"]))'` | Equal to the next command's count. It was 38 on 2026-11-14 |
| V-C2 | `gh api --paginate 'orgs/HX-Infratstructure/repos?per_page=100' --jq '.[] \| select(.archived \| not) \| .name' \| wc -l`         | The number of non-archived repositories                    |
| V-C3 | `systemctl --user list-timers hx-centcom-github-sync.timer`                                                                       | A next run is listed                                       |
| V-C3 | `journalctl --user -u hx-centcom-github-sync -n 40 --no-pager` after two more runs                                                | Both runs end in success                                   |
| V-C4 | `journalctl --user -u hx-centcom-github-sync --no-pager \| grep -cF -f ~/caio-notes/love-t.md`                                    | `0`. The journal holds counts and errors, never the token  |

## Deploy a later commit (GO for that SHA)

Each later commit needs its own GO. Fetch it as in [Fetch the commit](#fetch-the-commit), then run:

```sh
~/HX-CentCom/deploy/hx15/install.sh <new S>
```

The previous release stays, and `previous` points at it. The script keeps one more release and deletes the older ones. If the sync units are installed, the script reinstalls them from the new release. Then run V-A8, and `verify.sh` through `http://192.168.50.207:8420` (V-B2 in [`../hx7/README.md`](../hx7/README.md#checks-v-b)).

## Roll back to the previous release (R1)

A rollback is a host change, so it needs the owner's GO.

```sh
~/.local/share/hx-centcom/current/deploy/hx15/rollback.sh
```

Without an argument, the target is the release that `previous` points at. To pick another release, give its folder name: `rollback.sh <sha12>`. `install.sh` keeps three releases, so `ls ~/.local/share/hx-centcom/releases` lists every target. The script does these steps:

- It refuses root, a target without `RELEASE` or `.output/server/index.mjs`, and a target that is already `current`.
- It runs `systemd-analyze --user verify` on the target's units, and on its sync units only if they are already installed. Then it copies them into `~/.config/systemd/user/` and reloads systemd. If the check fails, it copies nothing and `current` does not move.
- It points `previous` at the old `current`, then `current` at the target.
- It restarts the app and waits for it to stay active.

It deletes no release. It never runs npm or a migration and never connects to the database. Migrations only go forward, so the older release runs against the newer schema. That works only while every migration is additive. A pull request with a destructive migration must name the first release that R1 cannot return to. After R1, run V-A and V-B.

## Stop the app on HX-15 (R3)

R3 needs the owner's GO. For a full removal, run R2 in [`../hx7/README.md`](../hx7/README.md#remove-the-route-r2), then R3, then R4 in [`../hx9/README.md`](../hx9/README.md#remove-the-database-r4).

Skip the first line if GO-4 never installed the timer.

```sh
systemctl --user disable --now hx-centcom-github-sync.timer
systemctl --user disable --now hx-centcom.service
rm -f ~/.config/systemd/user/hx-centcom.service ~/.config/systemd/user/hx-centcom-github-sync.service \
	~/.config/systemd/user/hx-centcom-github-sync.timer
systemctl --user daemon-reload
ss -ltn | grep ':5420 '
```

`ss` must print nothing. Keep the releases and `app.env` until the owner decides R4.
