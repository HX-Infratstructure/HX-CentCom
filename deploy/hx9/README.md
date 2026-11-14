# Create the HX-CentCom database on HX-9 (GO-1)

HX-CentCom stores its data in the database `centcom` on HX-9 (`192.168.50.209:5432`), owned by the login role `centcom_app`. The shape is the same as `agent_lab` and `agent_lab_app`, which HX-PostgreSQL records in `docs/AS-BUILT.md`, section "Databases and roles", at commit `378de32`.

Every step below needs the owner's GO-1. Any connection to HX-9 needs the owner's authorization for that exact connection (HX-PostgreSQL `CLAUDE.md`). The GO also names how the commands reach HX-9: the owner runs them on HX-9, or the owner authorizes CC1 to run those exact commands over SSH (DEPLOY-RECON open question 6). The pull request records the method.

| File                 | Purpose                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `make-db-secret.mjs` | Runs on HX-15. Writes `app.env` with the database URL and `create-role.sql` with the DDL for HX-9 |

## Know where the password goes

`make-db-secret.mjs` generates the password on HX-15 and writes it only into `~/.config/hx-centcom/app.env`. `create-role.sql` holds a SCRAM-SHA-256 verifier of the password, never the password. The clear password never reaches HX-9.

A rerun converges. If `app.env` exists, the script reads the password back from it. It then writes a new `create-role.sql` with a new salt for the same password.

No `pg_hba.conf` rule is added. From `192.168.50.215`, `centcom_app` matches line 128, `host all all 192.168.50.0/24 scram-sha-256`, as `agent_lab_app` does. So `pg_hba.conf` does not change, HX-9 is not reloaded, and HX-PostgreSQL's `scripts/verify.sh` is not needed.

## List the names on HX-9 (GO-1)

Run this read-only listing on HX-9:

```sh
sudo -n -u postgres /srv/postgresql/bin/psql -d postgres -At \
	-c 'SELECT datname FROM pg_database ORDER BY 1' -c 'SELECT rolname FROM pg_roles ORDER BY 1'
```

No name may begin with `centcom`. If one does, stop and report.

## Write the secret and the SQL on HX-15 (GO-1)

Fetch `S` first, as in [Fetch the commit](../hx15/README.md#fetch-the-commit). The clone's working tree can hold any commit, so copy the script from `S` and run the copy. Run these commands on HX-15 as `hxsa`:

```sh
d=$(mktemp -d)
git -C ~/HX-CentCom show <S>:deploy/hx9/make-db-secret.mjs >"$d/make-db-secret.mjs"
~/.local/bin/node "$d/make-db-secret.mjs"
rm -r "$d"
stat -c '%a %n' ~/.config/hx-centcom
```

The script prints two lines, `/home/hxsa/.config/hx-centcom/app.env 600` and `/home/hxsa/.config/hx-centcom/create-role.sql 600`. `stat` prints `700`. The script creates `~/.config/hx-centcom/` with mode 700 if it is missing, and changes no other folder. It never prints the password or the verifier.

## Create the role and the database on HX-9 (GO-1)

1. Copy `~/.config/hx-centcom/create-role.sql` to HX-9 by the method that the GO names. Keep its mode 600.
2. On HX-9, in the folder that holds the copy, run the file:

   ```sh
   sudo -n -u postgres /srv/postgresql/bin/psql -v ON_ERROR_STOP=1 -d postgres -f - < create-role.sql
   ```

   The shell opens the file as your login user and passes it on standard input, so `postgres` does not need to read your mode-600 copy.

   The file runs `CREATE ROLE centcom_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '<verifier>'`, `CREATE DATABASE centcom OWNER centcom_app`, `REVOKE ALL ON DATABASE centcom FROM PUBLIC` and a `COMMENT ON DATABASE`. Then it reads back the result. Expect these values:

   - The database `centcom` has the owner `centcom_app` and the ACL `{centcom_app=CTc/centcom_app}`.
   - The role `centcom_app` has `rolcanlogin` set to `t`, and `rolsuper`, `rolcreatedb`, `rolcreaterole` and `rolreplication` set to `f`.
   - `scram_verifier` is `t`.

   `CREATE DATABASE` cannot run in a transaction, so the file has none. If it stops partway, run step 2 of [R4](#remove-the-database-r4), which drops only what exists, before you run it again.

3. Delete the copy on HX-9: `rm create-role.sql`.
4. On HX-15, delete the file too: `rm ~/.config/hx-centcom/create-role.sql`. A rerun of `make-db-secret.mjs` writes it again from `app.env`.

## Test the login from HX-15 (GO-1, after GO-2)

HX-15 has no `psql`, so the test uses the `postgres` package in the current release. Run it after GO-2 has built the release:

```sh
cd ~/.local/share/hx-centcom/current
(set -a; . ~/.config/hx-centcom/app.env; set +a; ~/.local/bin/node --input-type=module -e '
import postgres from "postgres";
const right = postgres(process.env.DATABASE_URL, { max: 1 });
const [row] = await right`select current_user, current_database()`;
console.log("login", row.current_user, row.current_database);
await right.end();
const url = new URL(process.env.DATABASE_URL);
url.password = "wrong-password";
const wrong = postgres(url.href, { max: 1 });
try {
	await wrong`select 1`;
	console.log("FAIL a wrong password was accepted");
} catch (error) {
	console.log(error.code === "28P01" ? "a wrong password was refused (28P01)" : `FAIL unexpected error ${error.code}`);
} finally {
	await wrong.end();
}
')
```

Expect `login centcom_app centcom`, then `a wrong password was refused (28P01)`. The test prints no URL and no password.

## Record the change

Open an HX-PostgreSQL pull request, as PR #11 did for `agent_lab`. It changes documents only:

- `docs/AS-BUILT.md` gets a row in "Databases and roles" for `centcom`, a row in "Secrets" for `DATABASE_URL` in `~/.config/hx-centcom/app.env` on `192.168.50.215`, and the history and acceptance entries.
- `docs/FAQ.md` gets the matching answers.

## Remove the database (R4)

R4 destroys the database and its data. It needs the owner's GO. Run R3 in [`../hx15/README.md`](../hx15/README.md#stop-the-app-on-hx-15-r3) first, so that no consumer holds a connection.

1. On HX-9, confirm that no session is connected. The command must print `0`:

   ```sh
   sudo -n -u postgres /srv/postgresql/bin/psql -d postgres -At \
   	-c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'centcom'"
   ```

2. On HX-9, drop the database, then the role. Each drop skips a name that does not exist:

   ```sh
   sudo -n -u postgres /srv/postgresql/bin/psql -v ON_ERROR_STOP=1 -d postgres \
   	-c 'DROP DATABASE IF EXISTS centcom' -c 'DROP ROLE IF EXISTS centcom_app'
   ```

3. On HX-15, delete the env file, which holds the dead password: `rm ~/.config/hx-centcom/app.env`.
