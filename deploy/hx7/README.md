# Open the HX-CentCom route on HX-7 (GO-3)

`hx-centcom.conf` is the HX-7 NGINX server block that passes `http://192.168.50.207:8420` to the app on HX-15 at `192.168.50.215:5420`. HX-Nginx owns HX-7's configuration, so this file goes to HX-Nginx as `config/nginx/conf.d/hx-centcom.conf` in its own pull request, like HX-Nginx PR #10. This repository never installs it.

Every host step below needs the owner's GO-3. Run GO-3 after GO-2 in [`../hx15/README.md`](../hx15/README.md), so that the route has an upstream.

## Know what the file changes

The file is HX-Nginx's `config/nginx/conf.d/hx-agent-lab.conf` at commit `59c06b5`, with four lines changed:

- Line 1 names the route HX-CentCom.
- Line 2 links the owner's deploy authorization, [HX-CentCom issue 1](https://github.com/HX-Infratstructure/HX-CentCom/issues/1#issuecomment-6875640539).
- `listen 8420;` replaces `listen 8410;`.
- `proxy_pass http://192.168.50.215:5420;` replaces port 5410.

`proxy_buffering off` and `proxy_read_timeout 300s` stay, so MCP's streamable HTTP and server-sent events stream through. The route has no TLS and no authentication (DEV/TEST). To confirm that no other line differs, run this on HX-15. It reads the file at `S`, so the clone's working tree can hold any commit:

```sh
diff <(git -C ~/HX-Nginx show 59c06b5:config/nginx/conf.d/hx-agent-lab.conf) <(git -C ~/HX-CentCom show <S>:deploy/hx7/hx-centcom.conf)
```

The output shows exactly the lines 1, 2, 4 and 8.

## Prepare the HX-Nginx pull request

The pull request adds `config/nginx/conf.d/hx-centcom.conf` and changes these lines of `scripts/verify.sh` (line numbers at commit `59c06b5`):

- `LISTENS` (line 27) gains `0.0.0.0:8420`.
- `PAIRS` (line 31) gains `/srv/nginx/conf.d/hx-centcom.conf:config/nginx/conf.d/hx-centcom.conf`.
- `CONFD_FILES` (line 33) gains `/srv/nginx/conf.d/hx-centcom.conf`.

It also updates these documents:

- `CLAUDE.md` lines 27 and 28, the server blocks and the listeners.
- `README.md` lines 3, 8, 10, 13 and 27.
- `docs/AS-BUILT.md`: the listeners, the configuration, the server blocks, the dependencies, the acceptance and the history.
- `docs/FAQ.md` lines 32, 46 and 88.

`scripts/verify.sh` on `main` fails once a second `conf.d` file is live (lines 120 to 131). So run it from the pull request's branch, and merge the pull request right after the host change.

## Install the route (GO-3)

Run these steps on HX-7, from the HX-Nginx pull request's branch:

1. Check that port 8420 is free and that `conf.d` holds only the Agent Lab route. These commands are read-only:

   ```sh
   ss -ltn | grep ':8420 '
   ls /srv/nginx/conf.d/
   ```

   `ss` must print nothing, and `ls` must list only `hx-agent-lab.conf`. If not, stop and report.

2. Install the file:

   ```sh
   sudo install -o root -g root -m 644 config/nginx/conf.d/hx-centcom.conf /srv/nginx/conf.d/hx-centcom.conf
   ```

3. Test the configuration:

   ```sh
   sudo /usr/local/sbin/nginx -t
   ```

   If it fails, stop and run [R2](#remove-the-route-r2). The new file is live but not loaded (HX-Nginx `docs/OPERATIONS.md`).

4. Reload nginx. The command must exit 0:

   ```sh
   sudo systemctl reload hx-nginx.service
   ```

5. Run `scripts/verify.sh` from the pull request's branch. Expect `RESULT PASS`, and record the output in the pull request's `docs/AS-BUILT.md`.

6. Run checks V-B.

### Checks V-B

V-B needs GO-3. Run V-B1 to V-B5 on HX-15 and V-B6 on HX-7.

| ID   | Command                                                                                    | Expected                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| V-B1 | `curl -s -o /dev/null -w '%{http_code}\n' http://192.168.50.207:8420/`                     | `200`                                                                                                            |
| V-B1 | `curl -s http://192.168.50.207:8420/api/v1/workspace`                                      | The same JSON as V-A5 in [`../hx15/README.md`](../hx15/README.md#checks-v-a)                                     |
| V-B2 | `~/.local/share/hx-centcom/current/deploy/hx15/verify.sh http://192.168.50.207:8420`       | Exit 0                                                                                                           |
| V-B3 | The `centcom progress` command below this table, with CC1's key                            | `201`, `agent_id` is `CC1`, and one new `activity_log` row. This proves that `Authorization` crosses nginx       |
| V-B4 | MCP `initialize` and `tools/list` through `http://192.168.50.207:8420/mcp`. V-B2 runs them | They succeed through `proxy_buffering off`                                                                       |
| V-B5 | `curl -s http://192.168.50.207/ \| grep -m1 -o 'Welcome to nginx!'`                        | `Welcome to nginx!`. The port-80 site is unchanged                                                               |
| V-B5 | `curl -s -o /dev/null -w '%{http_code}\n' http://192.168.50.207:8410/api/health`           | `200`. The Agent Lab route is unchanged                                                                          |
| V-B6 | HX-Nginx `scripts/verify.sh` on HX-7, from the pull request's branch                       | `RESULT PASS`, including `nginx holds 0.0.0.0:8420`, no drift for the new file, and `conf.d` matching both files |

V-B3 is a real write, not test data. CC1 posts the deploy record of `S` to one of its own tasks with the CLI from the `current` release, which is the CLI at `S`. The CLI and its flags are in `docs/AGENT-POSTING.md`:

```sh
CENTCOM_URL=http://192.168.50.207:8420 CENTCOM_KEY_FILE=~/.config/hx-centcom/keys/CC1.key \
	~/.local/share/hx-centcom/current/bin/centcom progress --task <a CC1 task id> --note "Deployed <S> to HX-15" --sha <S>
```

## Remove the route (R2)

R2 is a host change, so it needs the owner's GO, with the same scope as GO-3.

1. On HX-7, remove the file, test the configuration and reload nginx:

   ```sh
   sudo rm /srv/nginx/conf.d/hx-centcom.conf
   sudo /usr/local/sbin/nginx -t
   sudo systemctl reload hx-nginx.service
   ```

2. Run `scripts/verify.sh` from HX-Nginx `main`, which lists one `conf.d` file. Expect `RESULT PASS`, with ports 80 and 8410 unchanged.
3. Close or revert the HX-Nginx pull request.
