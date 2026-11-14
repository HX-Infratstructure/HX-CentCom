import { createServerFn } from "@tanstack/react-start";
import {
  isServiceError,
  type ActivityQueryInput,
  type DecisionQueryInput,
  type GithubPrQueryInput,
  type UpdateQueryInput,
} from "@/server/services";

/** The service parses the query; this only gives the server function its input type. */
const typesOnly =
  <T>() =>
  (input: T): T =>
    input;

export const listWorkspace = createServerFn({ method: "GET" }).handler(({ context }) =>
  context.services.listWorkspace(),
);

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
export const getDecision = createServerFn({ method: "GET" })
  .validator(typesOnly<{ readonly id: string }>())
  .handler(async ({ context, data }) => {
    try {
      return await context.services.getDecision(data.id);
    } catch (error) {
      if (isServiceError(error) && error.code === "not_found") return null;
      throw error;
    }
  });
