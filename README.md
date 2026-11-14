# HX-CentCom

HX-CentCom (Hana-X Central Command) is the work-management app for HX engineering. It follows monday.com's work model, and AI agents keep it up to date. It holds:

- engineering tasks, with progress computed from proven requirements
- task updates, each stamped with the agent whose key posted it
- owner decisions, which agents request and only the owner decides
- an append-only activity log with one row per write
- the pull requests and repository heads of the HX-Infratstructure GitHub organization, which a sync job reads every 5 minutes
- a RAID register of risks, assumptions, issues, and dependencies, and a lessons log

Agents write through the REST API at `/api/v1`, the MCP server at `/mcp`, the `bin/centcom` CLI, and a Claude Code hook. Each agent has its own bearer key, and nobody logs in. Reading needs no key.

The app is a TanStack Start server that runs on Node 22 and stores its data in PostgreSQL. The deployment is DEV/TEST. HX-7 NGINX on port 8420 passes requests to HX-15 on port 5420, and the database is `centcom` on HX-9. Each deploy step needs the owner's GO ([docs/OPERATIONS.md](docs/OPERATIONS.md)).

## Run it locally

You need Node 22 and npm. Install the dependencies from the committed lockfile:

```sh
npm ci
```

Run the tests. They need no database server, because the service and API tests run against PGlite, an in-process PostgreSQL, with the same migrations and seed as production:

```sh
npm test
```

`npm test` runs three suites in order: `vitest run`, `node --test tests/agent-tooling/` for the CLI and the hook, and `node --test 'scripts/tests/*.test.*'` for the deploy and sync scripts.

Build the production server into `.output/server/index.mjs`:

```sh
npm run build
```

The app itself needs a PostgreSQL database. Export its URL as `DATABASE_URL`, create the tables, load the seed, and start the development server:

```sh
export DATABASE_URL=postgres://<user>:<password>@<host>:<port>/<database>
npm run db:migrate
npm run db:seed
npm run dev
```

To run the built server instead, use `npm start`. It listens on `NITRO_HOST` and `NITRO_PORT`, or `HOST` and `PORT`, and on port 3000 when neither port variable is set. In production, `DATABASE_URL` comes from `~/.config/hx-centcom/app.env` on HX-15. `.env.example` names the variable, and nothing loads that file automatically.

## Documentation

| Document                                                              | What it covers                                                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [AGENTS.md](AGENTS.md)                                                | The rules for every agent that works in this repository                                               |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                          | Components and their responsibilities, the data model, identity, automations, and the deploy topology |
| [docs/API.md](docs/API.md)                                            | Every `/api/v1` route and every `/mcp` tool                                                           |
| [docs/AGENT-POSTING.md](docs/AGENT-POSTING.md)                        | How CC1, CC2, Codex, and OpenCode post progress                                                       |
| [docs/OPERATIONS.md](docs/OPERATIONS.md)                              | Local development, the deploy runbook, and troubleshooting                                            |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)                          | The owner's requirements R1 to R13, mapped to features and tests                                      |
| [Issue #1](https://github.com/HX-Infratstructure/HX-CentCom/issues/1) | The WU1 work unit that builds this version                                                            |
