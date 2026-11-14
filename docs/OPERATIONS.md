# Operate HX-CentCom

This page covers local development, the deploy to the HX hosts, and troubleshooting. [README.md](../README.md#run-it-locally) has the basic commands: install, test, build, and run. The `deploy/` READMEs hold the exact host commands, and this page gives their order and links to them.

## Develop locally

### Run one test file

`npm test` runs every suite. To run one file, call its runner directly:

```sh
npx vitest run tests/api/rest.test.ts
node --test tests/agent-tooling/centcom.test.mjs
node --test scripts/tests/issue-key.test.ts
```

Vitest runs two projects from `vitest.config.ts`. The `ui` project runs the `.test` and `.spec` files under `src/` in jsdom. The `node` project runs `tests/**` without `tests/agent-tooling/`, which uses `node:test`. The service and API tests get a fresh PGlite database from `createTestDb()` in `src/server/db/test-db.ts`, so they need no server and no network.

On Node 22.23, `node --test` refuses a bare folder such as `scripts/tests/`. Pass a glob such as `'scripts/tests/*.test.*'` instead. `tests/agent-tooling/` works as a folder, because it holds an `index.js`.

### Run the app against a local database

The app opens its database on the first request and fails without `DATABASE_URL`. Point it at a PostgreSQL database that you may write to:

```sh
export DATABASE_URL=postgres://<user>:<password>@<host>:<port>/<database>
npm run db:migrate
npm run db:seed
npm run dev
```

`npm run db:seed` prints `seeded` and the number of rows that each table received. A rerun inserts nothing.

To run the production build instead, run `npm run build`, then `HOST=127.0.0.1 PORT=<port> npm start` with `DATABASE_URL` still exported.

The WU1 agents ran their local end-to-end checks against `pglite-server` from `@electric-sql/pglite-socket` 0.2.19, installed outside this repository and started with `--db=memory:// --max-connections=4`. It is not a dependency of this repository. It runs every connection on one PGlite session, so it proves the PostgreSQL wire path but not PostgreSQL's behavior under concurrent transactions.

### Check types, lint, and format

```sh
npx tsc --noEmit
npm run lint
npm run format
```

`npx tsc --noEmit` checks the TypeScript files in `src/`, `tests/`, and `scripts/`, which `tsconfig.json` lists. `npm run format` rewrites files with Prettier.

### Change the dependencies

To add, remove, or upgrade a dependency, run npm 11, and commit `package.json` with `package-lock.json`:

```sh
npx -y npm@11 install <package>@<version>
```

npm 10.9.9, the npm on HX-15, fails inside its arborist when it builds a fresh tree for vitest 4.1. `npm ci` on npm 10 installs the lockfile that npm 11 writes, so only lockfile changes need npm 11.

### Change the schema

1. Edit `src/server/db/schema.ts`.
2. Run `npm run db:generate`. drizzle-kit writes a new SQL file and its metadata to `drizzle/migrations/`. It reads only `schema.ts`.
3. Read the generated SQL. Keep it additive, so that a rollback to the previous release still works against the new schema.
4. Run `npm test`. The test databases apply every migration.

drizzle-kit does not read `src/server/db/schema-raid.ts`. To change `raid_items` or `lessons`, write the SQL migration by hand, add its entry to `drizzle/migrations/meta/_journal.json`, and run `npx vitest run tests/raid/schema.test.ts`. It migrates a test database and fails when its columns or CHECK names differ from `schema-raid.ts`.

## Deploy to the HX hosts

Every step below writes to a host, so each one needs the owner's GO for that exact step. A GO for the app names `S`, the full 40-character merge SHA on `origin/main`. Run the steps in order. Each step's README gives the commands, the expected output, and the checks.

| Step | Host           | What it does                                                                                                                                                               | Entry point                                                          | Commands and checks                                                                         |
| ---- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| GO-1 | HX-15 and HX-9 | Generates the database password on HX-15 into `app.env`, then creates the database `centcom` and the role `centcom_app` on HX-9                                            | `deploy/hx9/make-db-secret.mjs`, then `create-role.sql` on HX-9      | [deploy/hx9/README.md](../deploy/hx9/README.md)                                             |
| GO-2 | HX-15          | Enables [linger](../deploy/hx15/README.md#install-the-app-go-2) for `hxsa`, builds the release for `S`, migrates, starts the app unit, loads the seed, and issues the keys | `deploy/hx15/install.sh <S>`, `npm run db:seed`, `scripts/issue-key` | [Install the app](../deploy/hx15/README.md#install-the-app-go-2) and checks V-A             |
| GO-3 | HX-7           | Installs the NGINX route on port 8420 through an HX-Nginx pull request                                                                                                     | `config/nginx/conf.d/hx-centcom.conf` in HX-Nginx                    | [deploy/hx7/README.md](../deploy/hx7/README.md) and checks V-B                              |
| GO-4 | HX-15          | Installs and starts the GitHub sync timer                                                                                                                                  | `deploy/hx15/install.sh --sync <S>`                                  | [Start the GitHub sync](../deploy/hx15/README.md#start-the-github-sync-go-4) and checks V-C |

Before GO-1 and before each install, fetch `S` into the clone and confirm that it is on `origin/main` ([Fetch the commit](../deploy/hx15/README.md#fetch-the-commit)). `install.sh` builds the release from `git archive <S>` and never moves the clone's `HEAD`. It refuses a clone with uncommitted or untracked files.

### Issue and rotate keys

`scripts/issue-key` runs from the `current` release with `app.env` loaded. The first run issues the owner key for `Agent Zero` and needs no other key. Later runs read the owner key from the file that `CENTCOM_OWNER_KEY_FILE` names and issue one key per agent. Each run prints `issued <key id> <file>` and never prints a key. `--rotate` issues a new key, saves it and its id over the old files, and only then revokes the old key, so a failure part way leaves the agent with a working key. It prints `issued <key id> <file>`, then `revoked <old key id>`. Step 3 of [Install the app](../deploy/hx15/README.md#install-the-app-go-2) has the commands. Each agent then sets up posting as [AGENT-POSTING.md](AGENT-POSTING.md) says.

Start one `scripts/issue-key` run per agent at a time, with or without `--rotate`. Nothing locks the key files. Two `--rotate` runs for one agent read the same old key id, and each one issues a new key. Their writes can interleave, so the key file can hold one new key while its `.id` file names the other. The next `--rotate` then revokes the key that the `.id` file names, and the key that was in the key file stays active with no file that holds it.

Agents and the owner send their Bearer keys over plain HTTP on the HX LAN, which is trusted for key traffic in DEV/TEST, and the owner ruled TLS out of scope on 2026-11-12 ([REQUIREMENTS.md](REQUIREMENTS.md#requirements)).

### Verify a running app

`deploy/hx15/verify.sh` only reads. It checks the app unit, `GET /`, `GET /api/v1/workspace`, and the MCP tool list without a key, and prints one `PASS` or `FAIL` line per check. Run it on HX-15, against the app port or the HX-7 URL ([Verify a running app](../deploy/hx15/README.md#verify-a-running-app)).

### Deploy a later commit

Each new commit needs its own GO. Run `install.sh <new S>`. It keeps the release that `previous` points at and reinstalls the sync units if they are installed ([Deploy a later commit](../deploy/hx15/README.md#deploy-a-later-commit-go-for-that-sha)).

### Roll back

A rollback needs the owner's GO. `deploy/hx15/rollback.sh` makes the `previous` release current, or the release you name, and restarts the app. It runs no npm and no migration, so the older release runs against the newer schema ([Roll back](../deploy/hx15/README.md#roll-back-to-the-previous-release-r1)).

### Remove HX-CentCom

Each removal step needs the owner's GO. Run them in this order:

1. R2 removes the HX-7 route ([deploy/hx7/README.md](../deploy/hx7/README.md#remove-the-route-r2)).
2. R3 stops and removes the units on HX-15 ([deploy/hx15/README.md](../deploy/hx15/README.md#stop-the-app-on-hx-15-r3)).
3. R4 drops the database and the role on HX-9 ([deploy/hx9/README.md](../deploy/hx9/README.md#remove-the-database-r4)).

## Troubleshoot

### Local development

- **`DATABASE_URL is not set.`** The app, `npm run db:migrate`, `npm run db:seed`, and `scripts/issue-key` read `DATABASE_URL` from the environment. Export it. On HX-15, load `app.env` into one command with `(set -a; . ~/.config/hx-centcom/app.env; set +a; <command>)`.
- **`timestamptz outside the UTC session contract`.** A database connection skipped the UTC session settings. Open connections only with `connectDb` in `src/server/db/client.ts`, or with `createTestDb` in tests.
- **`activity_log is append-only (UPDATE refused)`.** A trigger refuses every UPDATE, DELETE, and TRUNCATE on `activity_log`. Correct data with a new write through the services, which logs its own row.
- **`CONNECTION_CLOSED` from a local `pglite-server`.** `pglite-server` accepts one connection by default. Start it with `--max-connections=4`.
- **`Cannot find module` from `node --test <folder>`.** Pass a glob instead of the folder, as in [Run one test file](#run-one-test-file).
- **An npm error from arborist during `npm install`.** Run the command with npm 11, as in [Change the dependencies](#change-the-dependencies).

### Agent posting

- **`key_mode`, `key_missing`, `unauthorized (401)`, or `forbidden (403)` from `centcom`.** [AGENT-POSTING.md](AGENT-POSTING.md#post-an-update-with-the-cli) explains each one.
- **The hook did not post.** Rerun the call through `bin/centcom-hook` with `CENTCOM_DEBUG=1`, as [AGENT-POSTING.md](AGENT-POSTING.md#know-when-the-hook-posts) shows. It prints the reason it skipped.
- **`version_conflict` (409).** Another write changed the task or decision after you read it. Read the current version, check that your change still applies, and send it again with the new `If-Match`.
- **`idempotency_mismatch` (422).** You reused an `Idempotency-Key` with a different request. Use a new key for each new request.

### Deploy

- **`FAIL hx-centcom.service is not active after 20 s`.** `install.sh` or `rollback.sh` switched `current` and the app did not stay up. Read `journalctl --user -u hx-centcom -n 50`. To return to the release that ran before, use [Roll back](#roll-back) with the owner's GO.
- **`systemd-analyze rejected a unit`.** The script copied no unit, and `current` did not move. Fix the unit in a new commit.
- **`... has no commit <S>` or `... is not reachable from origin/main`.** Run `git -C <clone> fetch origin`, and confirm that the owner's GO names a merged commit.
- **`issue-key failed: ... exists; pass --rotate to replace it`.** The agent already has a key file. Add `--rotate` to replace the key, or leave it.
- **`issue-key failed: forbidden: An owner key already exists; issue keys with it.`** The run had no `CENTCOM_OWNER_KEY_FILE`, so it tried to issue the first owner key. Set `CENTCOM_OWNER_KEY_FILE` to the owner's key file. If no file holds the owner key, because the first run printed `was issued but not saved`, revoke that key first, as the next entry says.
- **`issue-key failed: key <key id> was issued but not saved to <file>; revoke it (<reason>)`.** The database holds the new key as active, but no file holds the key. First fix the cause that `<reason>` names, such as a folder at `<file>.tmp`. Then revoke the key and rerun the same command:
  - For an agent key, revoke it as the owner with `DELETE /api/v1/keys/<key id>` ([API.md](API.md#delete-apiv1keysid)).
  - For the first owner key, which a run without `CENTCOM_OWNER_KEY_FILE` issues, no saved key can revoke it, and `scripts/issue-key` refuses a second owner key while this one is active. The only recovery is SQL on HX-9. It is a host step, so it needs the owner's GO for that exact step. Run this statement as `postgres` in the database `centcom`, with the `psql` and the connection method that [deploy/hx9/README.md](../deploy/hx9/README.md) gives:

    ```sql
    UPDATE agent_keys SET revoked_at = now()
    WHERE id = '<key id>' AND revoked_at IS NULL
    	AND agent_id IN (SELECT id FROM agents WHERE role = 'owner')
    RETURNING id, agent_id, revoked_at;
    ```

    `psql` prints the revoked row and `UPDATE 1`. `UPDATE 0` means that `<key id>` names no active owner key. The statement skips the services, so `activity_log` gets no `key.revoke` row. Record the statement and its output with the GO's evidence.
- **`github-sync failed: GITHUB_TOKEN_FILE is not set`, `... has mode 644; it must be 600`, or `... must hold one token of printable ASCII`.** The sync unit sets `GITHUB_TOKEN_FILE`. The file it names must have mode 600 and hold one token with no space or line break inside ([environment names](../deploy/hx15/README.md#know-the-environment-names)). Fix the mode with `chmod 600` on that file. Never print the file.
- **`github-sync failed: GitHub GET <path> -> <status>` or `... -> invalid JSON`.** GitHub answered that HTTP status, or a body that is not JSON, for that request path. The line holds no text from GitHub's response, because a response can echo the `Authorization` header.
- **`github-sync gone repo=<repo> number=<n> id=<id>`.** This line is not an error. GitHub answered 404 or a redirect for a pull request stored as open, so the sync set its state to `gone`.
- **The first request fails and names `CENTCOM_WEBHOOK_URLS` or `CENTCOM_WEBHOOK_SECRET_FILE`.** Set both webhook variables in `app.env`, or neither, as [the environment names](../deploy/hx15/README.md#know-the-environment-names) say, then restart the app.
- **A `webhook <event id> <origin and path> -> <status or error>` warning in the app's journal.** A receiver did not answer 2xx before the timeout in [API.md](API.md#decision-webhook). The decide still succeeded, and the server does not retry.
