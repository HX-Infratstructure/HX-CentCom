# HX-CentCom API reference

HX-CentCom has two agent interfaces: a REST API under `/api/v1` and an MCP server at `/mcp`. Both call the same services, so a write through either one stores a row of the same shape. This page covers tasks, updates, decisions, activity and its revert, keys, the RAID register, the lessons log, the mirrored GitHub pull requests, and the webhook that announces a decision.

On the DEV/TEST deployment the base URL is `http://192.168.50.207:8420`. Requests and responses are JSON. Fields of stored rows use the database column names in `src/server/db/schema.ts`, such as `task_id` and `created_at`. Request bodies and query parameters use camelCase, such as `taskId` and `commitSha`. Every timestamp is an ISO 8601 UTC string, such as `2026-11-14T09:00:00.123Z`.

## Authentication

Send the agent's key in the `Authorization` header: `Authorization: Bearer hxc_<agent>_<32 characters>`. Reads need no key. Every write needs a valid key, or it fails with `unauthorized` (401). The server records the agent that the key belongs to as the author, and ignores any author field in the body. [ARCHITECTURE.md](ARCHITECTURE.md#identity) describes the key format, storage, and permissions.

## Headers

| Header                 | Direction | Meaning                                                                                |
| ---------------------- | --------- | -------------------------------------------------------------------------------------- |
| `Authorization`        | Request   | `Bearer <key>`. Required for writes                                                    |
| `Idempotency-Key`      | Request   | 1 to 255 visible ASCII characters. Makes a write safe to retry                         |
| `If-Match`             | Request   | The version you last read, as `4` or `"4"`. Guards a write against a concurrent change |
| `Idempotency-Replayed` | Response  | `true` when the response is a stored replay                                            |
| `Allow`                | Response  | On a 405, the methods the route accepts                                                |

### Idempotency-Key

Every write except the two key routes accepts `Idempotency-Key`: posting an update, setting a requirement, requesting and deciding a decision, adding or changing a RAID item or a lesson, and reverting an activity row.

- A key belongs to the agent that sent it. Two agents can use the same key without conflict.
- The same key with the same request within 24 hours returns the stored status and body, with `Idempotency-Replayed: true`, and writes nothing.
- The same key with a different request fails with `idempotency_mismatch` (422). The server compares the parsed request, so a field that it ignores does not count as a difference.
- A write that fails stores nothing, so a retry after an error runs the write again.

The key routes refuse an `Idempotency-Key` with 400, because a replay would have to store the plaintext key.

### If-Match

Five writes accept `If-Match`: posting an update and setting a requirement (the task's version), deciding a decision (the decision's version), and changing a RAID item or a lesson (that row's version). Every write adds 1 to the version of the task, decision, RAID item, or lesson it addresses.

- A version that does not match fails with `version_conflict` (409), and `error.currentVersion` holds the current version.
- A value that is not a positive whole number, such as `W/"1"` or `abc`, fails with `invalid` (400) at the path `If-Match`.
- Without `If-Match`, the write does not check the version.

## Errors

Every response with a status outside 2xx has this body:

<!-- prettier-ignore -->
```json
{
	"error": {
		"code": "version_conflict",
		"status": 409,
		"message": "The resource is at version 4.",
		"currentVersion": 4
	}
}
```

`error.status` repeats the HTTP status. `error.currentVersion` appears only on `version_conflict`. `error.issues` appears only on `invalid`, as a list of `{path, message}`:

<!-- prettier-ignore -->
```json
{
	"error": {
		"code": "invalid",
		"status": 400,
		"message": "The request body is invalid.",
		"issues": [{ "path": "proofUrl", "message": "PASS needs a proofUrl" }]
	}
}
```

| Code                   | Status | Cause                                                                                                                                                                                         |
| ---------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid`              | 400    | The body, a query parameter, a header, or a cursor is invalid                                                                                                                                 |
| `unauthorized`         | 401    | A write with no key, or with a key that is unknown or revoked                                                                                                                                 |
| `forbidden`            | 403    | An agent writing another agent's task, changing a RAID item or lesson it may not edit, adding, moving, closing, or reopening a dependency on another agent's task, or calling an owner action |
| `not_found`            | 404    | The task, decision, requirement, agent, key, RAID item, lesson, activity row, or `/api/v1` path does not exist                                                                                |
| `method_not_allowed`   | 405    | The route does not accept the method. The `Allow` header lists the methods that it accepts                                                                                                    |
| `version_conflict`     | 409    | The `If-Match` version is not the current version, or a revert's entity changed after the action it reverts                                                                                   |
| `not_revertible`       | 409    | The activity row records a create, a decide, a key action, or a write with automation effects, which a revert does not undo                                                                   |
| `payload_too_large`    | 413    | The body is larger than 1 MiB                                                                                                                                                                 |
| `idempotency_mismatch` | 422    | The `Idempotency-Key` was used before with a different request                                                                                                                                |
| `internal`             | 500    | An unexpected error. The server logs it                                                                                                                                                       |

A write checks its request in this order, and the first failure answers:

1. The key (401). Every write checks it before it reads the body.
2. The body: invalid JSON, a body that is not an object, or a body over 1 MiB. The key routes refuse an `Idempotency-Key` here.
3. An owner-only action by an agent (403).
4. The body fields (400). On `POST /api/v1/tasks/:id/updates`, `source: "mcp"` is one of these field issues.
5. The `Idempotency-Key` and `If-Match` formats (400).
6. The idempotency replay, or `idempotency_mismatch` (422).
7. The addressed task, decision, RAID item, or lesson (404).
8. The task's agent, or the edit scope of a RAID item or lesson, for an agent that is not the owner (403).
9. The `If-Match` version (409).
10. Rules that need the database, such as an unknown status, an unknown task in `blocks` or `taskIds`, an unknown agent in `ownerAgent`, or a missing source for the decision that Ready for owner opens (400).

When the body is invalid and the `If-Match` is malformed too, the one 400 lists both, on every write that accepts `If-Match`. A revert checks its request in its own order, given in [POST /api/v1/activity/:id/revert](#post-apiv1activityidrevert).

Every 401 response, from REST or from `/mcp`, carries the header `WWW-Authenticate: Bearer realm="hx-centcom"`.

## Lists and pagination

`GET /api/v1/updates`, `GET /api/v1/activity`, `GET /api/v1/decisions`, `GET /api/v1/raid`, `GET /api/v1/lessons`, and `GET /api/v1/github/prs` return one page at a time:

- `limit` is 1 to 100, and 20 by default. A value outside that range fails with 400.
- `nextCursor` is an opaque string, and null on the last page. Pass it back as `cursor` with the same filters to get the next page. A cursor from anywhere else fails with 400 at the path `cursor`.
- Every list returns `counts`, the totals for filter chips. Each facet count applies every filter except its own, and no count depends on the cursor.
- The server ignores unknown query parameters.
- A time filter, such as `since`, takes an ISO 8601 time with a time zone. A time outside the years 0001 to 9999 in UTC, or with an offset beyond ±15:59, fails with 400.

## Routes

| Method and path                      | Key                                   | Purpose                                                         |
| ------------------------------------ | ------------------------------------- | --------------------------------------------------------------- |
| `GET /api/v1/workspace`              | None                                  | The whole workspace in one snapshot                             |
| `GET /api/v1/tasks/:id`              | None                                  | One task with its requirements and blocking decisions           |
| `POST /api/v1/tasks/:id/updates`     | Task's agent or owner                 | Post an update to a task                                        |
| `PUT /api/v1/tasks/:id/requirements` | Task's agent or owner                 | Add or set a requirement                                        |
| `GET /api/v1/updates`                | None                                  | Updates, newest first, filtered and paged                       |
| `GET /api/v1/activity`               | None                                  | Activity log rows, newest first, filtered and paged             |
| `POST /api/v1/activity/:id/revert`   | Owner                                 | Revert one logged change                                        |
| `GET /api/v1/decisions`              | None                                  | Owner decisions, filtered and paged                             |
| `POST /api/v1/decisions`             | Any                                   | Request an owner decision                                       |
| `POST /api/v1/decisions/:id/decide`  | Owner                                 | Decide a decision                                               |
| `POST /api/v1/keys`                  | Owner                                 | Issue a key                                                     |
| `DELETE /api/v1/keys/:id`            | Owner                                 | Revoke a key                                                    |
| `GET /api/v1/raid`                   | None                                  | RAID items, newest first, filtered and paged                    |
| `POST /api/v1/raid`                  | Any                                   | Add a RAID item                                                 |
| `PUT /api/v1/raid/:id`               | Item's owner or creator, or the owner | Change a RAID item                                              |
| `GET /api/v1/lessons`                | None                                  | Lessons, newest first, filtered and paged                       |
| `POST /api/v1/lessons`               | Any                                   | Add a lesson                                                    |
| `PUT /api/v1/lessons/:id`            | Lesson's creator or the owner         | Change a lesson                                                 |
| `GET /api/v1/github/prs`             | None                                  | Mirrored GitHub pull requests, newest first, filtered and paged |

Each GET route also answers HEAD. A method that a route does not list fails with 405. Any other path under `/api/v1` fails with `not_found` (404) for every method.

### GET /api/v1/workspace

Returns one consistent snapshot:

| Field           | Value                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------- |
| `tasks`         | Every task, with `progress: {proven, total, percent}`, `open`, `stale`, and `attention`      |
| `updates`       | The latest 20 updates                                                                        |
| `updatesCursor` | The cursor for the next page of updates, as `GET /api/v1/updates` takes it                   |
| `requirements`  | Every requirement                                                                            |
| `decisions`     | Every pending decision, and every decision whose `blocks` list holds an open task            |
| `agents`        | Every agent: `id`, `display_name`, `role`, `color`, `active`                                 |
| `statusLabels`  | Every status label: `id`, `label`, `is_done`, `color`                                        |
| `repos`         | The repository heads from the GitHub sync. The pull requests are in `GET /api/v1/github/prs` |
| `counts`        | `{updates, decisions}`, the same counts as the two list routes return without filters        |
| `actor`         | `{agentId, role}` when the `Authorization` header holds a valid key, or null                 |

`centcom whoami` reads `actor` to show which agent a key belongs to.

Each task's `open` is `true` or `false`. Its `stale` is `true`, `false`, or null. Its `attention` is the list of reasons it needs attention, from `blocked`, `owner`, and `stale`, and is empty when it needs none. [ARCHITECTURE.md](ARCHITECTURE.md#computed-values) defines an open task and describes how the server computes all three fields.

### GET /api/v1/tasks/:id

Returns `{task, requirements, decisions}`: the task with its `version`, `progress`, `open`, `stale`, and `attention`, its requirements, and every decision whose `blocks` list holds it. An unknown task fails with 404.

### POST /api/v1/tasks/:id/updates

Posts an update to a task. An agent may post only to a task whose `agent` is itself. The owner may post to any task. Accepts `Idempotency-Key` and `If-Match`.

| Field       | Required | Rule                                                                                                                                             |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `kind`      | No       | `progress` (default), `note`, or `link`. Only the server writes `system`                                                                         |
| `note`      | Yes      | 1 to 2000 characters                                                                                                                             |
| `status`    | No       | The id of a status label, one of the labels in `GET /api/v1/workspace` `statusLabels`. It also sets the task's status and group                  |
| `links`     | No       | Up to 20 items of `{label, url}`. `label` is 1 to 200 characters, and `url` is an http or https URL                                              |
| `commitSha` | No       | 7 to 40 hex characters. The server stores it in lowercase, and also sets it as the task's `commit_sha`                                           |
| `prUrl`     | No       | An http or https URL                                                                                                                             |
| `source`    | Yes      | `api`, `cli`, `hook`, or `ui`. `mcp` is a field issue, because only `/mcp` records `mcp`                                                         |
| `runId`     | No       | 1 to 200 characters                                                                                                                              |
| `decision`  | No       | `{question?, gateType?}` for the decision that a move into Ready for owner opens. `question` is 1 to 500 characters. Any other update ignores it |

A `progress` field fails with 400, because progress is computed from requirements. The server drops any other unknown field, including an author field.

<!-- prettier-ignore -->
```json
{
	"kind": "progress",
	"note": "Router tests pass",
	"links": [{ "label": "CI", "url": "https://github.com/OWNER/REPO/actions/runs/1" }],
	"commitSha": "3e39a5c",
	"source": "api"
}
```

When the update moves the task into the `ready_for_owner` group from another group, the same transaction opens one Pending decision that blocks the task, requested by the key's agent:

- The question is `decision.question`, or else `Accept <task id>: <title>?`. The gate type is `decision.gateType`, or else `merge` when the update has a `prUrl` and `scope` when it has none.
- The summary is `Ready for owner: <title>`, cut to 140 characters. The description is the update's note and its links.
- The source is the `prUrl`, or else the first link, or else the task's `source_url` when it is a valid `sourceUrl` for [POST /api/v1/decisions](#post-apiv1decisions). Every task has a `source_url`, so the update fails with 400 at `prUrl` when it has no `prUrl` and no links, and the task's `source_url` is not a valid `sourceUrl`.
- If a Pending decision already blocks the task, no decision opens, and a `system` update on the task names the pending one.

The response holds only the update. The opened decision appears in `GET /api/v1/tasks/:id`.

Returns 201 with the created update at the top level:

<!-- prettier-ignore -->
```json
{
	"id": "5f0c2a8e-0000-4000-8000-000000000000",
	"task_id": "CC-01",
	"agent_id": "CC1",
	"kind": "progress",
	"status": null,
	"note": "Router tests pass",
	"links": [{ "label": "CI", "url": "https://github.com/OWNER/REPO/actions/runs/1" }],
	"commit_sha": "3e39a5c",
	"pr_url": null,
	"source": "api",
	"run_id": null,
	"created_at": "2026-11-14T09:00:00.123Z"
}
```

### PUT /api/v1/tasks/:id/requirements

Adds a requirement to a task or sets an existing one. The same task rule applies as for updates. Accepts `Idempotency-Key` and `If-Match`, both against the task.

| Field           | Required       | Rule                                                                                                                                   |
| --------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `requirementId` | One of the two | The UUID of an existing requirement of this task. An unknown id fails with 404                                                         |
| `requirement`   | One of the two | The requirement text, 1 to 500 characters. If the task has a requirement with that text, the call sets it. Otherwise the call adds one |
| `state`         | Yes            | `PASS`, `FAIL`, `NOT_RUN`, or `BLOCKED`                                                                                                |
| `proofUrl`      | For `PASS`     | An http or https URL. Leaving it out stores null, which clears an earlier proof                                                        |

Returns 201 when it adds a requirement and 200 when it sets one. The body is `{requirement, task: {id, version, progress}}`, with the task's progress after the write.

### GET /api/v1/updates

| Parameter         | Rule                                                                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentId`         | Only updates by this agent                                                                                                                                                                                                                                                                              |
| `taskId`          | Only updates on this task                                                                                                                                                                                                                                                                               |
| `taskIds`         | Only updates on any of these tasks: 1 to 100 task ids, separated by commas, as in `taskIds=CC-01,IRP-04`. Sending it with `taskId` fails with 400 at `taskIds`                                                                                                                                          |
| `attention`       | Only updates on the open tasks that need attention for this reason: `blocked`, `owner`, or `stale`. The server selects those tasks, however many there are. [ARCHITECTURE.md](ARCHITECTURE.md#computed-values) defines each reason. Sending it with `taskId` or `taskIds` fails with 400 at `attention` |
| `source`          | Only updates with this source: `api`, `mcp`, `cli`, `hook`, or `ui`                                                                                                                                                                                                                                     |
| `since`           | Only updates at or after this time. See the time rule in [Lists and pagination](#lists-and-pagination)                                                                                                                                                                                                  |
| `until`           | Only updates before this time                                                                                                                                                                                                                                                                           |
| `limit`, `cursor` | See [Lists and pagination](#lists-and-pagination)                                                                                                                                                                                                                                                       |

Returns `{items, nextCursor, counts}`. `items` are updates, newest first. `counts` is `{total, byAgent, byTask, bySource}`. `taskId`, `taskIds`, and `attention` are all the task facet, so `byTask` leaves them out. A `system` update has no source, so it counts in `total` but not in `bySource`, and no `source` filter selects it.

### GET /api/v1/activity

| Parameter         | Rule                                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actor`           | Only rows written by this agent                                                                                                                                              |
| `entity`          | Only rows about this kind of record: `task`, `requirement`, `decision`, `agent_key`, `raid_item`, or `lesson`. Any other value fails with 400, and the issue names these six |
| `entityId`        | Only rows about this record                                                                                                                                                  |
| `since`           | Only rows at or after this time                                                                                                                                              |
| `limit`, `cursor` | See [Lists and pagination](#lists-and-pagination)                                                                                                                            |

Returns `{items, nextCursor, counts}`, newest first. `counts` is `{total, byActor, byEntity}`. `entityId` and `since` apply to every count. Each item has `id`, `actor`, `action`, `entity`, `entity_id`, `before`, `after`, `run_id`, `commit_sha`, `created_at`, and `revertible`. `revertible` is true when a [revert](#post-apiv1activityidrevert) would not refuse the row with `not_revertible`. The revert still checks the entity's version, so a revertible row can get `version_conflict` (409).

### GET /api/v1/decisions

| Parameter         | Rule                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateType`        | `merge`, `deploy`, `live_run`, `host`, `scope`, `assignment`, or `policy`                                                                      |
| `status`          | `Pending`, `Decided`, `Deferred`, or `Superseded`. `not_pending` returns the decided history: `Decided`, `Deferred`, and `Superseded` together |
| `limit`, `cursor` | See [Lists and pagination](#lists-and-pagination)                                                                                              |

Returns `{items, nextCursor, counts}`. Without a status filter, or with `Pending`, `items` lists pending decisions first, then the latest request first, and a decision with no recorded request time comes last. With any other status, `items` lists the newest `decided_at` first, a decision with no recorded decision time last, then the highest id. A cursor from one order fails with 400 in the other. `counts` is `{total, byGateType, byStatus}`. Each item has the full `description` beside the short `summary`.

### POST /api/v1/decisions

Asks the owner for a decision. Any valid key may request one. Accepts `Idempotency-Key`. `If-Match` has no effect here.

| Field         | Required | Rule                                                                                                                                                                           |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `question`    | Yes      | 1 to 500 characters                                                                                                                                                            |
| `summary`     | Yes      | 1 to 140 characters. The list view shows it                                                                                                                                    |
| `description` | Yes      | 1 to 20000 characters. The detail view shows it in full                                                                                                                        |
| `subject`     | Yes      | 1 to 500 characters                                                                                                                                                            |
| `gateType`    | Yes      | One of the `gateType` values above                                                                                                                                             |
| `options`     | Yes      | Up to 10 items of `{label, description?, recommended}`. `label` is 1 to 200 characters, `description` is 1 to 2000, and `recommended` defaults to false. The list may be empty |
| `blocks`      | Yes      | Up to 20 ids of existing tasks that wait on the decision. The list may be empty                                                                                                |
| `sourceUrl`   | Yes      | The request's source: an http or https URL, or `hx15:<absolute path>` for a record that exists only on HX-15                                                                   |

The server sets `id` (the next `D-` number), `requested_by` (the key's agent), `requested_at`, and `status: "Pending"`. When an option is recommended, the server records the key's agent as `recommended_by`, and otherwise null. REST drops a `recommendedBy` field like any unknown field. Returns 201 with `{decision}`.

### POST /api/v1/decisions/:id/decide

Records the owner's decision. Only the owner may call it. Accepts `Idempotency-Key` and `If-Match`.

| Field          | Required | Rule                                                                     |
| -------------- | -------- | ------------------------------------------------------------------------ |
| `status`       | Yes      | `Decided`, `Deferred`, or `Superseded`                                   |
| `decisionText` | Yes      | The owner's words, 1 to 4000 characters                                  |
| `sourceUrl`    | Yes      | Where the owner decided: an http or https URL, or `hx15:<absolute path>` |

The server sets `decision_text`, `decision_source_url`, and `decided_at`, and posts one `system` update on each existing task in the decision's `blocks` list. Returns 200 with `{decision, systemUpdates}`. The owner can decide the same decision again, and each call replaces those fields. The API never sets `superseded_by`. After the decide commits, the server sends the [decision webhook](#decision-webhook) when it is configured.

### POST /api/v1/keys

Issues a key for an agent. Only the owner may call it. An `Idempotency-Key` fails with 400.

| Field     | Required | Rule                                                                      |
| --------- | -------- | ------------------------------------------------------------------------- |
| `agentId` | Yes      | The id of an active agent, such as `CC1`. An unknown agent fails with 404 |
| `label`   | Yes      | 1 to 100 characters                                                       |

Returns 201 with `{keyId, plaintext}`. The response shows the plaintext key once. The server stores only its SHA-256 hash and cannot show the key again. `scripts/issue-key` is the usual way to issue keys, because it also writes the key file ([OPERATIONS.md](OPERATIONS.md#issue-and-rotate-keys)).

### DELETE /api/v1/keys/:id

Revokes a key. Only the owner may call it. An `Idempotency-Key` fails with 400. `:id` is the key's UUID, from `keyId` or from the `issued` line of `scripts/issue-key`. An id that is not a UUID fails with 400, and an id that names no active key fails with 404. Returns 200 with `{keyId, revokedAt}`. From then on the key resolves to no agent.

### GET /api/v1/raid

| Parameter         | Rule                                              |
| ----------------- | ------------------------------------------------- |
| `type`            | `risk`, `assumption`, `issue`, or `dependency`    |
| `severity`        | `low`, `medium`, `high`, or `critical`            |
| `status`          | `open`, `monitoring`, or `closed`                 |
| `owner`           | Only items whose `owner_agent` is this agent      |
| `task`            | Only items whose `task_ids` hold this task        |
| `limit`, `cursor` | See [Lists and pagination](#lists-and-pagination) |

Returns `{items, nextCursor, counts}`. `items` are RAID items, newest first. `counts` is `{total, byType, bySeverity, byStatus, byOwner, byTask}`. An item with no severity counts in `total` but not in `bySeverity`, and an item with no owner counts in `total` but not in `byOwner`.

### POST /api/v1/raid

Adds a RAID item. Any valid key may add one, and the server records it as `created_by`. Accepts `Idempotency-Key`.

| Field                       | Required        | Rule                                                                                                               |
| --------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `type`                      | Yes             | `risk`, `assumption`, `issue`, or `dependency`. It cannot change later                                             |
| `title`                     | Yes             | 1 to 200 characters                                                                                                |
| `summary`                   | Yes             | 1 to 140 characters. The list view shows it                                                                        |
| `description`               | Yes             | 1 to 20000 characters                                                                                              |
| `sourceUrl`                 | Yes             | Where the item is recorded: an http or https URL, or `hx15:<absolute path>` for a record that exists only on HX-15 |
| `ownerAgent`                | No              | The id of an existing agent, or null                                                                               |
| `status`                    | No              | `open` (default), `monitoring`, or `closed`                                                                        |
| `severity`                  | No              | `low`, `medium`, `high`, `critical`, or null. Setting it records the caller as `severity_rated_by`                 |
| `reviewAt`                  | No              | An ISO 8601 time with a time zone, or null. The time rule in [Lists and pagination](#lists-and-pagination) applies |
| `taskIds`                   | No              | Up to 20 ids of existing tasks. The server adds `blockedTaskId` to it                                              |
| `decisionId`                | No              | The id of an existing decision, or null                                                                            |
| `probability`, `mitigation` | No              | Risk only. 1 to 2000 characters, or null                                                                           |
| `impact`                    | No              | Risk or issue only. 1 to 2000 characters, or null                                                                  |
| `validationMethod`          | No              | Assumption only. 1 to 2000 characters, or null                                                                     |
| `validationState`           | Assumption only | `unverified` (the default for an assumption), `validated`, or `invalidated`                                        |
| `resolution`                | No              | Issue only. 1 to 2000 characters, or null                                                                          |
| `escalated`                 | No              | Issue only. A boolean, false by default                                                                            |
| `blockedTaskId`             | Dependency only | The id of the existing task that the dependency blocks                                                             |
| `blockingRef`               | Dependency only | What blocks the task: `task:<id>`, `decision:D-NN` for an existing task or decision, or an http or https URL       |

A value other than null in a field that belongs to another type fails with 400 at that field, except `escalated: false`. The server drops unknown fields. An agent that is not the owner may add a dependency only on a task whose `agent` is itself, and otherwise gets 403. Returns 201 with `{item, decision, systemUpdates}`. `decision` is the decision that this write opened for a high or critical issue, or null, and `systemUpdates` is empty ([ARCHITECTURE.md](ARCHITECTURE.md#automations)).

### PUT /api/v1/raid/:id

Changes a RAID item. The owner may change any item. An agent may change an item whose `owner_agent` or `created_by` is itself, or a dependency whose blocked task's `agent` is itself. Accepts `Idempotency-Key` and `If-Match`, against the item's version.

A dependency change writes every task it affects, so an agent that is not the owner must be the `agent` of each one. Otherwise the change fails with 403, and the message names the task:

- A move to another `blockedTaskId` affects the old task and the new one, whether the dependency is open or closed.
- A close or a reopen affects the task that the dependency blocks.

A close releases the task that the dependency blocks, and a move of an open dependency releases the task that it leaves. [ARCHITECTURE.md](ARCHITECTURE.md#automations) gives the rule that a release follows. That move posts one `system` update on the task that it leaves, `<RAID id> moved to <new task id>.` followed by the outcome. A reopen does not block the task again.

The activity row's `after.effects` records each task that a release unblocked, as `{id, version}`: `unblockedTask` for the task of a close, and `unblockedPreviousTask` for the task that a move leaves. A move of an open dependency always posts a `system` update, so a [revert](#post-apiv1activityidrevert) refuses its activity row with `not_revertible` (409).

The body takes the fields of `POST /api/v1/raid` except `type`, and needs at least one of them. A field that the body leaves out keeps its value, and null clears a field that may be empty. A `type` field fails with 400, because the type cannot change. The type rules above apply to the item after the change.

Returns 200 with `{item, decision, systemUpdates}`. `decision` is the decision that this write opened for a high or critical issue, or null. `systemUpdates` holds the `system` updates that a close or a move of a dependency posts, or is empty.

### GET /api/v1/lessons

| Parameter         | Rule                                              |
| ----------------- | ------------------------------------------------- |
| `status`          | `proposed`, `adopted`, or `retired`               |
| `tag`             | Only lessons whose `tags` hold this tag           |
| `limit`, `cursor` | See [Lists and pagination](#lists-and-pagination) |

Returns `{items, nextCursor, counts}`. `items` are lessons, newest first. `counts` is `{total, byStatus, byTag}`.

### POST /api/v1/lessons

Adds a lesson. Any valid key may add one, and the server records it as `created_by`. Accepts `Idempotency-Key`.

| Field                                              | Required      | Rule                                                                                                      |
| -------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------- |
| `title`                                            | Yes           | 1 to 200 characters                                                                                       |
| `summary`                                          | Yes           | 1 to 140 characters                                                                                       |
| `situation`, `action`, `outcome`, `recommendation` | No            | 1 to 4000 characters each, or null                                                                        |
| `sourceUrl`                                        | Yes           | Where the lesson is recorded: an http or https URL, or `hx15:<absolute path>`                             |
| `tags`                                             | No            | Up to 20 tags of 1 to 50 characters. Empty by default                                                     |
| `appliesTo`                                        | No            | Who or what the lesson applies to, 1 to 500 characters, or null                                           |
| `status`                                           | No            | `proposed` (default), `adopted`, or `retired`                                                             |
| `enforcedByUrl`                                    | For `adopted` | The rule, test, or memory entry that enforces the lesson: an http or https URL, or `hx15:<absolute path>` |

Returns 201 with `{lesson}`.

### PUT /api/v1/lessons/:id

Changes a lesson. The owner may change any lesson, and an agent may change a lesson it created. Accepts `Idempotency-Key` and `If-Match`, against the lesson's version.

The body takes the fields of `POST /api/v1/lessons` and needs at least one of them. A field that the body leaves out keeps its value, and null clears a field that may be empty. A lesson that would end up `adopted` without an `enforcedByUrl` fails with 400 at `enforcedByUrl`. Returns 200 with `{lesson}`.

### POST /api/v1/activity/:id/revert

Reverts one logged change by its activity id. Only the owner may call it. The request has no body. Accepts `Idempotency-Key`. `If-Match` has no effect here.

The server restores the `before` values of the activity row on the task, requirement, RAID item, or lesson that it names, except the row's id, version, creator, and timestamps. For a task update that carried `commitSha`, the restore includes the task's previous `commit_sha`. It writes its own activity row, with action `activity.revert`, so a revert can be reverted in turn. A reverted task change also posts one `system` update on the task. A revert runs no automation. For example, a revert that sets a dependency back to `closed` does not unblock its task.

The revert checks its request in this order:

1. The key (401), and the owner role (403).
2. The activity id, which must be a UUID (400 at `activityId`).
3. The activity row (404).
4. Whether a revert undoes it (409 `not_revertible`). A create, a decide, a key action, and a write whose automations had effects are not revertible.
5. The `Idempotency-Key` format (400), then the replay or `idempotency_mismatch` (422).
6. The entity's version (409 `version_conflict`). Any later write that changed the entity's version, or the version of the task that a requirement belongs to, stops the revert.

Returns 200 with `{reverted, entity, entityId, version, systemUpdates}`: the reverted activity id, the kind of record, its id, its new version, and the `system` updates posted.

### GET /api/v1/github/prs

| Parameter         | Rule                                              |
| ----------------- | ------------------------------------------------- |
| `repo`            | Only pull requests of this repository             |
| `state`           | `open`, `closed`, `merged`, or `gone`             |
| `limit`, `cursor` | See [Lists and pagination](#lists-and-pagination) |

Returns `{items, nextCursor, counts}`. `items` are pull requests, the highest GitHub id first. Each item has `id`, `repo`, `number`, `title`, `state`, `draft`, `head_sha`, `merge_commit_sha`, `url`, and `fetched_at`. `counts` is `{total, byRepo, byState}`. The GitHub sync writes these rows ([ARCHITECTURE.md](ARCHITECTURE.md#automations)).

## Decision webhook

When the webhook is configured, the server posts one event to each configured URL after a decide commits. [deploy/hx15/README.md](../deploy/hx15/README.md#know-the-environment-names) names the two variables that configure it. With both unset, the server sends nothing.

The body is JSON:

<!-- prettier-ignore -->
```json
{
	"id": "<activity row id of the decide>",
	"type": "decision.decided",
	"occurredAt": "2026-11-14T09:00:00.123Z",
	"actor": "Agent Zero",
	"decision": { "id": "D-01", "status": "Decided" }
}
```

`decision` is the whole decided row, shortened here. Each request carries these headers:

| Header                | Value                                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| `Content-Type`        | `application/json`                                                       |
| `X-CentCom-Event-Id`  | The event's `id`, the activity row id of the decide                      |
| `X-CentCom-Signature` | `sha256=` and the hex HMAC-SHA256 of the raw body, keyed with the secret |

- **Verify an event.** Compute the HMAC-SHA256 of the raw body with the shared secret, and compare it with the signature header.
- **Skip your own events.** A receiver skips an event whose `actor` is itself.
- **Delivery.** The server sends to every URL at once, waits up to 3 seconds for each, and does not retry. The decide's response waits for the deliveries. A failed delivery never fails the decide, and the server logs each outcome with the event id and the URL's origin and path, never the secret. An event is lost if the process stops between the commit and the delivery.

## MCP server

The MCP server `hx-centcom`, version `1.0.0`, uses the streamable HTTP transport at `/mcp`, answers with JSON and never opens a server-sent event stream. It accepts only POST. GET and DELETE fail with 405 and `Allow: POST`. The request body limit is 1 MiB.

Access depends on the `Authorization` header:

- **No header.** The session is read-only. `tools/list` shows only the read tools.
- **A valid key.** The session shows every tool. The key's agent is the author of every write, and the same permissions apply as in REST.
- **A header that resolves to no agent**, such as an unknown or revoked key. The request fails before MCP starts, with HTTP 401 and the error body from [Errors](#errors).

### Tools

| Tool               | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
| ------------------ | -------------- | ----------------- | ---------------- | --------------- |
| `list_tasks`       | true           | not set           | not set          | false           |
| `get_task`         | true           | not set           | not set          | false           |
| `list_decisions`   | true           | not set           | not set          | false           |
| `my_work`          | true           | not set           | not set          | false           |
| `list_updates`     | true           | not set           | not set          | false           |
| `post_progress`    | false          | false             | false            | false           |
| `set_requirement`  | false          | true              | false            | false           |
| `request_decision` | false          | false             | false            | false           |
| `list_raid`        | true           | not set           | not set          | false           |
| `add_raid_item`    | false          | false             | false            | false           |
| `update_raid_item` | false          | true              | false            | false           |
| `list_lessons`     | true           | not set           | not set          | false           |
| `add_lesson`       | false          | false             | false            | false           |

`set_requirement` and `update_raid_item` are the destructive tools, because each replaces stored values. There is no tool to decide a decision, to manage keys, to change a lesson, to revert an activity row, or to list GitHub pull requests. Use REST for those.

| Tool               | Arguments                                                                                                                                              | Result                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_tasks`       | `agentId?`, `group?` (`backlog`, `in_progress`, `ready_for_owner`, or `done`)                                                                          | `{tasks}`, with progress and version                                                                                                                                                                                                                                   |
| `get_task`         | `taskId`                                                                                                                                               | `{task, requirements, decisions}`, as `GET /api/v1/tasks/:id` returns                                                                                                                                                                                                  |
| `list_decisions`   | `gateType?`, `status?`, `limit?`, `cursor?`                                                                                                            | As `GET /api/v1/decisions` returns                                                                                                                                                                                                                                     |
| `my_work`          | `agentId?`, which defaults to the key's agent and is required without a key                                                                            | `{agentId, tasks, openRequirements, pendingDecisions}`: the agent's open tasks, as [ARCHITECTURE.md](ARCHITECTURE.md#computed-values) defines them, their requirements that are not `PASS`, and the pending decisions that the agent requested or that block its tasks |
| `list_updates`     | `agentId?`, `taskId?`, `taskIds?` (an array), `attention?`, `source?`, `since?`, `until?`, `limit?`, `cursor?`                                         | As `GET /api/v1/updates` returns                                                                                                                                                                                                                                       |
| `post_progress`    | `taskId`, then the body fields of `POST /api/v1/tasks/:id/updates` except `source`, `decision` included, plus `idempotencyKey?` and `expectedVersion?` | The created update. The server records `source: "mcp"`                                                                                                                                                                                                                 |
| `set_requirement`  | `taskId`, then the body fields of `PUT /api/v1/tasks/:id/requirements`, plus `idempotencyKey?` and `expectedVersion?`                                  | `{requirement, task}`                                                                                                                                                                                                                                                  |
| `request_decision` | The body fields of `POST /api/v1/decisions`, plus `idempotencyKey?`. A `recommendedBy` argument is refused as unknown                                  | `{decision}`                                                                                                                                                                                                                                                           |
| `list_raid`        | `type?`, `severity?`, `status?`, `owner?`, `task?`, `limit?`, `cursor?`                                                                                | As `GET /api/v1/raid` returns                                                                                                                                                                                                                                          |
| `add_raid_item`    | The body fields of `POST /api/v1/raid`, plus `idempotencyKey?`                                                                                         | `{item, decision, systemUpdates}`                                                                                                                                                                                                                                      |
| `update_raid_item` | `id`, then the body fields of `PUT /api/v1/raid/:id`, plus `idempotencyKey?` and `expectedVersion?`                                                    | `{item, decision, systemUpdates}`                                                                                                                                                                                                                                      |
| `list_lessons`     | `status?`, `tag?`, `limit?`, `cursor?`                                                                                                                 | As `GET /api/v1/lessons` returns                                                                                                                                                                                                                                       |
| `add_lesson`       | The body fields of `POST /api/v1/lessons`, plus `idempotencyKey?`                                                                                      | `{lesson}`                                                                                                                                                                                                                                                             |

`idempotencyKey` and `expectedVersion` do what the `Idempotency-Key` and `If-Match` headers do in REST.

### Tool results

- **Success.** The result has the value as JSON text in `content` and as an object in `structuredContent`. A replay also carries `_meta: {replayed: true}`.
- **A service error.** The result has `isError: true`, and `structuredContent` holds `{error: {...}}`, the same body as a REST error, also as JSON text in `content`.
- **A schema error.** Every tool refuses an unknown argument, and the SDK checks each argument's type, length, and allowed values before the tool runs. These errors come back with `isError: true` as plain text from the MCP SDK, such as `Unrecognized key(s) in object: 'foo'`, without the `{error}` body. This is a known limit: SDK 1.32.2 runs that check inside its own handler, where the server cannot rewrite the message. Rules that span fields, such as "PASS needs a proofUrl", come from the services and use the `{error}` body.
