import { createFileRoute } from "@tanstack/react-router";
import { endpoint, unparsed } from "@/server/http/endpoint";

export const Route = createFileRoute("/api/v1/tasks")({
  server: {
    handlers: {
      ANY: (ctx) =>
        endpoint(ctx, {
          POST: async (req) =>
            req.services.createTask(await req.actor(), unparsed(await req.json()), {
              idempotencyKey: req.opts.idempotencyKey,
            }),
        }),
    },
  },
});
