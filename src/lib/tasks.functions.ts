import { createServerFn } from "@tanstack/react-start";
import {
  isServiceError,
  type ActivityQueryInput,
  type DecisionQueryInput,
  type GithubPrQueryInput,
  type TaskQueryInput,
  type UpdateQueryInput,
} from "@/server/services";

/** The service parses the query; this only gives the server function its input type. */
const typesOnly =
  <T>() =>
  (input: T): T =>
    input;

export const listWorkspaceShell = createServerFn({ method: "GET" }).handler(({ context }) =>
  context.services.listWorkspaceShell(),
);

export const listTasks = createServerFn({ method: "GET" })
  .validator(typesOnly<TaskQueryInput>())
  .handler(({ context, data }) => context.services.listTasks(data));

export const listUpdates = createServerFn({ method: "GET" })
  .validator(typesOnly<UpdateQueryInput>())
  .handler(({ context, data }) => context.services.listUpdates(data));

export const listActivity = createServerFn({ method: "GET" })
  .validator(typesOnly<ActivityQueryInput>())
  .handler(({ context, data }) => context.services.listActivity(data));

export const listDecisions = createServerFn({ method: "GET" })
  .validator(typesOnly<DecisionQueryInput>())
  .handler(({ context, data }) => context.services.listDecisions(data));

export const listGithubPrs = createServerFn({ method: "GET" })
  .validator(typesOnly<GithubPrQueryInput>())
  .handler(({ context, data }) => context.services.listGithubPrs(data));

/**
 * A miss is null, never a thrown not_found: a server function's error reaches the browser as its message alone, and
 * the sheet would show a failure instead of "missing". Any other error still throws.
 */
const missAsNull = async <T>(read: () => Promise<T>): Promise<T | null> => {
  try {
    return await read();
  } catch (error) {
    if (isServiceError(error) && error.code === "not_found") return null;
    throw error;
  }
};

export const getDecision = createServerFn({ method: "GET" })
  .validator(typesOnly<{ readonly id: string }>())
  .handler(({ context, data }) => missAsNull(() => context.services.getDecision(data.id)));

export const getTask = createServerFn({ method: "GET" })
  .validator(typesOnly<{ readonly id: string }>())
  .handler(({ context, data }) => missAsNull(() => context.services.getTask(data.id)));

export const getRaidItem = createServerFn({ method: "GET" })
  .validator(typesOnly<{ readonly id: string }>())
  .handler(({ context, data }) => missAsNull(() => context.services.getRaidItem(data.id)));

export const getLesson = createServerFn({ method: "GET" })
  .validator(typesOnly<{ readonly id: string }>())
  .handler(({ context, data }) => missAsNull(() => context.services.getLesson(data.id)));
