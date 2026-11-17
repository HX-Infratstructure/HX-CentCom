# Rules for agents in HX-CentCom

These rules apply to every agent that works in this repository: CC1, CC2, Codex, OpenCode, and the subagents they start. Claude Code reads them through `CLAUDE.md`.

## Who writes what

- CC1 owns all development (R6). Only CC1 commits, pushes, and opens pull requests. Another agent changes only the files its brief names, never commits, and reports back to CC1.
- One writer per file. Two agents never edit the same file at the same time.
- Every pull request opens as a draft. Only the owner marks it ready and merges it.
- Every host step on HX-7, HX-9, or HX-15 needs the owner's GO for that exact step, and a deploy GO names the exact commit. [docs/OPERATIONS.md](docs/OPERATIONS.md) lists the GOs.
- Post progress to your own task with `bin/centcom` or the MCP tool `post_progress`. [docs/AGENT-POSTING.md](docs/AGENT-POSTING.md) has the setup.

## Environment

- This is DEV/TEST. The app runs as native systemd user units on HX-15. Do not use Docker, Podman, or Kubernetes. The HX-7 route has no TLS and no authentication.
- Use Node 22 and npm with the committed `package-lock.json`. A change to the dependencies or the lockfile needs npm 11 ([docs/OPERATIONS.md](docs/OPERATIONS.md#change-the-dependencies)).
- Production data is in PostgreSQL on HX-9. Tests use PGlite and need no server.
- Do not edit `src/routeTree.gen.ts` by hand. The build writes it.
- Keep `drizzle/migrations/meta/_journal.json` consistent with the SQL migrations in `drizzle/migrations/`. `npm run db:generate` writes the journal for migrations it generates. Hand edits are allowed and reviewed, as for the hand-written `0002_raid_lessons.sql`.

## Object-oriented boundaries

These rules apply HX's object-oriented design policy to this repository. The policy comes from [HX-Intelligent-Request-Routing PR #33](https://github.com/HX-Infratstructure/HX-Intelligent-Request-Routing/pull/33), merged as `fe6f0a6` at program revision 2.2, and covers all HX engineering and operations.

- **One owner per component.** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the responsibility map. A change that adds a component or a public interface adds its row there in the same pull request. A routine fix needs no map.
- **The public surface is small.** It is the exports of `src/server/services/index.ts`, plus the versioned REST contract `/api/v1` and the MCP contract `/mcp` ([docs/API.md](docs/API.md)). The UI, the REST and MCP adapters, and the scripts use the services only through that index. No code outside `src/server/services/` imports another of its modules. Code that opens the database, such as `src/start.ts` and `scripts/issue-key.ts`, also imports `src/server/db/client.ts` to build the database it injects. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#boundary-exceptions) lists where the code breaks these rules today.
- **Business rules live in the services.** Identity, authorization, validation, versions, idempotency, and the activity log are in `src/server/services/`. A route handler or an MCP tool parses its transport and makes one service call.
- **Inject dependencies.** The database, the clock, `fetch`, and secret files come in as arguments. A constructor or a module import never contacts a host.
- **Whatever admits work releases it.** `src/start.ts` opens the database pool and closes it on SIGTERM. A test checks that the resource actually ends, not only that the caller returned.
- **Operational scripts keep four jobs apart.** Configuration is `deploy/hx15/common.sh`, the units' `Environment=` lines, and `app.env`. Observation is `deploy/hx15/verify.sh` and `scripts/live-check/` (the page checks), which only read. Authorized execution is `install.sh`, `rollback.sh`, `scripts/issue-key`, and `deploy/hx9/make-db-secret.mjs`, each behind its GO. Evidence is the output of those scripts, which the operator records in the pull request.
- **Tests go through public contracts.** They call the services index, the HTTP routes, the MCP tools, or the CLI executables. They never call another component's private helpers.
- **CC1 runs the author self-check before each pull request.** Each responsibility has one owner, callers avoid private internals, failure and resource lifetimes match the contract, and unrelated behavior is unchanged. This check is the author's. CC1 does not give it to reviewers, whose briefs name only the target.

## Secrets and data

- Never put a secret in the repository, a brief, an issue, or a report. Name the file and line instead. On HX-15, the database URL is in `~/.config/hx-centcom/app.env`, agent keys are in `~/.config/hx-centcom/keys/`, and the GitHub token is in the file that `GITHUB_TOKEN_FILE` names. `.env.example` lists variable names only.
- Never invent data. A value that no source gives stays null, and seed rows cite their sources (`src/server/db/seed.ts`).
- Keep migrations additive, so that a rollback to the previous release still works. A pull request with a destructive migration names the first release that a rollback cannot return to.

## Done is a claim

- Report requirement coverage apart from test counts. [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) maps each requirement to its feature and its tests. A green test run does not show that a requirement is met.
- Report each check as PASS, FAIL, BLOCKED, NOT_RUN, or LIVE_NOT_EXECUTED, with the commit it ran against. A PASS at one commit does not carry over to another.
- Back every claim with a `path:line`, a command and its exit code, or a link.
- Before you hand work back, run `npm test` and `npx tsc --noEmit`, and read your own diff. [docs/OPERATIONS.md](docs/OPERATIONS.md#check-types-lint-and-format) lists the lint and format commands.
