import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  createLessonInput,
  createRaidItemInput,
  decisionQueryInput,
  lessonQueryInput,
  postProgressInput,
  raidQueryInput,
  updateRaidItemInput,
  requestDecisionInput,
  ServiceError,
  setRequirementInput,
  updateQueryInput,
  type Actor,
  type Services,
  type Task,
  type WriteResult,
} from "@/server/services";
import { MAX_BODY_BYTES } from "./endpoint";
import { errorResponse, HttpError, toErrorBody } from "./errors";
import { filterTasks } from "./views";

const SERVER_NAME = "hx-centcom";
const SERVER_VERSION = "1.0.0";

type ToolContext = { readonly services: Services; readonly actor: Actor | null };

type ToolOutput = { readonly value: Record<string, unknown>; readonly replayed: boolean };

type Access = { readonly write: false } | { readonly write: true; readonly destructive: boolean };

type ToolSpec<S extends z.AnyZodObject> = Access & {
  readonly name: string;
  readonly description: string;
  readonly input: S;
  run(args: z.output<S>, ctx: ToolContext): Promise<ToolOutput>;
};

type McpTool = {
  readonly name: string;
  readonly write: boolean;
  register(server: McpServer, ctx: ToolContext): void;
};

// A direct registerTool call with a zod object input fails tsc 5.9 with TS2589 ("excessively deep") on the SDK
// 1.32.2 callback type. The narrowing is sound: the SDK parses the arguments with the schema before the callback.
type RegisterStrictTool = (
  name: string,
  config: {
    readonly description: string;
    readonly inputSchema: z.AnyZodObject;
    readonly annotations: ToolAnnotations;
  },
  callback: (args: Record<string, unknown>) => Promise<CallToolResult>,
) => unknown;

function annotations(access: Access): ToolAnnotations {
  return access.write
    ? {
        readOnlyHint: false,
        destructiveHint: access.destructive,
        idempotentHint: false,
        openWorldHint: false,
      }
    : { readOnlyHint: true, openWorldHint: false };
}

function tool<S extends z.AnyZodObject>(spec: ToolSpec<S>): McpTool {
  return {
    name: spec.name,
    write: spec.write,
    register(server, ctx) {
      const register = server.registerTool.bind(server) as unknown as RegisterStrictTool;
      register(
        spec.name,
        { description: spec.description, inputSchema: spec.input, annotations: annotations(spec) },
        (args) => toolResult(() => spec.run(args as z.output<S>, ctx)),
      );
    },
  };
}

function read(value: Record<string, unknown>): ToolOutput {
  return { value, replayed: false };
}

function fromWrite<T>(result: WriteResult<T>, value: Record<string, unknown>): ToolOutput {
  return { value, replayed: result.replayed };
}

const TASK_GROUPS: Readonly<Record<Task["group"], true>> = {
  backlog: true,
  in_progress: true,
  ready_for_owner: true,
  done: true,
};
const taskGroup = z.enum(Object.keys(TASK_GROUPS) as [Task["group"], ...Task["group"][]]);

const taskIdArg = z.string().min(1).describe("Task id, for example CC-01.");

const writeArgs = {
  idempotencyKey: z
    .string()
    .optional()
    .describe(
      "A unique string per logical write. A retry with the same key and arguments returns the stored result.",
    ),
  expectedVersion: z
    .number()
    .int()
    .optional()
    .describe(
      "The version you last read (get_task task.version). A stale value fails with version_conflict and the current version.",
    ),
};

const raidIdArg = z.string().min(1).describe("RAID item id, for example RAID-05.");

const TOOLS: readonly McpTool[] = [
  tool({
    name: "list_tasks",
    description:
      "Tasks with their computed progress and version. Filter by assigned agentId or kanban group.",
    write: false,
    input: z
      .object({ agentId: z.string().min(1).optional(), group: taskGroup.optional() })
      .strict(),
    run: async (args, { services }) =>
      read({ tasks: filterTasks((await services.listWorkspace()).tasks, args) }),
  }),
  tool({
    name: "get_task",
    description:
      "One task with its version and progress, its requirements and the decisions that block it. Page its updates with list_updates.",
    write: false,
    input: z.object({ taskId: taskIdArg }).strict(),
    run: async ({ taskId }, { services }) => read(await services.getTask(taskId)),
  }),
  tool({
    name: "list_decisions",
    description:
      "Owner decisions with full descriptions, pending first, with filter counts. Filters: status, gateType. status not_pending returns every decision that is not Pending; not_pending, Decided, Deferred and Superseded list the newest decision first. limit 1-100 (default 20); pass nextCursor back as cursor.",
    write: false,
    input: decisionQueryInput.removeDefault().strict(),
    run: async (args, { services }) => read(await services.listDecisions(args)),
  }),
  tool({
    name: "my_work",
    description:
      "An agent's open tasks, their open requirements and the pending decisions that concern it. Pass agentId, or omit it to use the agent of your key.",
    write: false,
    input: z.object({ agentId: z.string().min(1).optional() }).strict(),
    run: async ({ agentId }, { services, actor }) => read(await services.myWork(actor, agentId)),
  }),
  tool({
    name: "list_updates",
    description:
      "Task updates, newest first, with filter counts. Filters: agentId, taskId, taskIds, attention, source, since, until. taskIds is 1-100 task ids; it cannot be combined with taskId. attention is blocked, owner or stale: the updates of the open tasks whose attention lists that reason; it cannot be combined with taskId or taskIds. limit 1-100 (default 20); pass nextCursor back as cursor.",
    write: false,
    input: updateQueryInput.removeDefault().strict(),
    run: async (args, { services }) => read(await services.listUpdates(args)),
  }),
  tool({
    name: "post_progress",
    description:
      "Post an update to a task assigned to you (the owner may post to any task). You are recorded as the author. kind is progress (default), note or link.",
    write: true,
    destructive: false,
    input: postProgressInput
      .omit({ source: true, progress: true })
      .extend({ taskId: taskIdArg, ...writeArgs })
      .strict(),
    run: async ({ taskId, idempotencyKey, expectedVersion, ...input }, { services, actor }) => {
      const result = await services.postProgress(
        actor,
        taskId,
        { ...input, source: "mcp" },
        { idempotencyKey, expectedVersion, via: "mcp" },
      );
      return fromWrite(result, result.value.update);
    },
  }),
  tool({
    name: "set_requirement",
    description:
      "Set a requirement's state on a task assigned to you. Give exactly one of requirementId or requirement text; PASS needs proofUrl.",
    write: true,
    destructive: true,
    input: setRequirementInput
      .innerType()
      .innerType()
      .omit({ progress: true })
      .extend({ taskId: taskIdArg, ...writeArgs })
      .strict(),
    run: async ({ taskId, idempotencyKey, expectedVersion, ...input }, { services, actor }) => {
      const result = await services.setRequirement(actor, taskId, input, {
        idempotencyKey,
        expectedVersion,
      });
      return fromWrite(result, result.value);
    },
  }),
  tool({
    name: "request_decision",
    description:
      "Ask the owner for a decision. summary is the one-line view, description the full text; blocks lists the task ids it blocks. sourceUrl is required: an http(s) URL, or hx15:<absolute path> for a record only on HX-15.",
    write: true,
    destructive: false,
    input: requestDecisionInput.extend({ idempotencyKey: writeArgs.idempotencyKey }).strict(),
    run: async ({ idempotencyKey, ...input }, { services, actor }) => {
      const result = await services.requestDecision(actor, input, { idempotencyKey });
      return fromWrite(result, result.value);
    },
  }),
  tool({
    name: "list_raid",
    description:
      "The RAID register (risks, assumptions, issues, dependencies), newest first, with filter counts. Filters: type, severity, status, owner (agent id), task (task id). limit 1-100 (default 20); pass nextCursor back as cursor.",
    write: false,
    input: raidQueryInput.removeDefault().strict(),
    run: async (args, { services }) => read(await services.listRaid(args)),
  }),
  tool({
    name: "add_raid_item",
    description:
      "Add a RAID item. sourceUrl is required: an http(s) URL, or hx15:<absolute path> for a record only on HX-15. Give only your type's fields; a dependency needs blockedTaskId, a task assigned to you, and blockingRef. A high or critical issue without decisionId opens a pending policy decision.",
    write: true,
    destructive: false,
    input: createRaidItemInput
      .innerType()
      .extend({ idempotencyKey: writeArgs.idempotencyKey })
      .strict(),
    run: async ({ idempotencyKey, ...input }, { services, actor }) => {
      const result = await services.createRaidItem(actor, input, { idempotencyKey });
      return fromWrite(result, result.value);
    },
  }),
  tool({
    name: "update_raid_item",
    description:
      "Change fields of a RAID item you own or created, or of a dependency that blocks a task assigned to you (the owner may change any). An absent field stays and null clears it; type cannot change. A dependency is moved onto, or closed on, only a task assigned to you; closing it unblocks that task once no other open dependency blocks it.",
    write: true,
    destructive: true,
    input: updateRaidItemInput
      .innerType()
      .omit({ type: true })
      .extend({
        id: raidIdArg,
        ...writeArgs,
        expectedVersion: writeArgs.expectedVersion.describe(
          "The item's version you last read (list_raid). A stale value fails with version_conflict and the current version.",
        ),
      })
      .strict(),
    run: async ({ id, idempotencyKey, expectedVersion, ...input }, { services, actor }) => {
      const result = await services.updateRaidItem(actor, id, input, {
        idempotencyKey,
        expectedVersion,
      });
      return fromWrite(result, result.value);
    },
  }),
  tool({
    name: "list_lessons",
    description:
      "The lessons log, newest first, with filter counts. Filters: status, tag. limit 1-100 (default 20); pass nextCursor back as cursor.",
    write: false,
    input: lessonQueryInput.removeDefault().strict(),
    run: async (args, { services }) => read(await services.listLessons(args)),
  }),
  tool({
    name: "add_lesson",
    description:
      "Record a lesson with its source (an http(s) URL or hx15:<absolute path>). status is proposed by default; adopted needs enforcedByUrl, the rule, test or memory entry that enforces it.",
    write: true,
    destructive: false,
    input: createLessonInput
      .innerType()
      .extend({ idempotencyKey: writeArgs.idempotencyKey })
      .strict(),
    run: async ({ idempotencyKey, ...input }, { services, actor }) => {
      const result = await services.createLesson(actor, input, { idempotencyKey });
      return fromWrite(result, result.value);
    },
  }),
];

/**
 * Only POST reaches the SDK: a GET would open an SSE stream, and the client treats 405 on its post-initialize GET as
 * "no stream".
 */
export async function handleMcp(request: Request, services: Services): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse(HttpError.methodNotAllowed(request.method, ["POST"]), { Allow: "POST" });
  }
  try {
    const authorization = request.headers.get("authorization");
    const actor = await services.resolveActor(authorization);
    if (authorization !== null && actor === null) return errorResponse(ServiceError.unauthorized());
    const server = new McpServer(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { instructions: instructions(actor) },
    );
    for (const t of TOOLS.filter((t) => !t.write || actor !== null))
      t.register(server, { services, actor });
    // JSON responses make close() below safe.
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      maxRequestBodySize: MAX_BODY_BYTES,
    });
    try {
      await server.connect(transport);
      return await transport.handleRequest(request);
    } finally {
      await server.close();
    }
  } catch (error) {
    return errorResponse(error);
  }
}

function instructions(actor: Actor | null): string {
  if (actor) {
    return `HX-CentCom (Hana-X Central Command) as ${actor.agentId} (${actor.role}). Writes record you as the author. Pass expectedVersion to guard against concurrent writes and idempotencyKey to retry safely.`;
  }
  const writes = TOOLS.filter((t) => t.write)
    .map((t) => t.name)
    .join(", ");
  return `HX-CentCom (Hana-X Central Command), read-only: no bearer key was sent. Send Authorization: Bearer hxc_<agent>_<key> to use ${writes}.`;
}

async function toolResult(run: () => Promise<ToolOutput>): Promise<CallToolResult> {
  try {
    const { value, replayed } = await run();
    return {
      content: [{ type: "text", text: JSON.stringify(value) }],
      structuredContent: value,
      ...(replayed ? { _meta: { replayed: true } } : {}),
    };
  } catch (error) {
    const body = { error: toErrorBody(error) };
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(body) }],
      structuredContent: body,
    };
  }
}
