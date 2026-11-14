import { createServerFn } from "@tanstack/react-start";
import type { ActivityQueryInput, DecisionQueryInput, UpdateQueryInput } from "@/server/services";

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
