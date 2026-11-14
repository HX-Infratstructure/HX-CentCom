import { createFileRoute } from "@tanstack/react-router";
import { endpoint } from "@/server/http/endpoint";

/** No body: the activity id is the whole request, so an empty POST is valid. */
export const Route = createFileRoute("/api/v1/activity/$id/revert")({
  server: {
    handlers: {
      ANY: (ctx) =>
        endpoint(ctx, {
          POST: async (req) =>
            req.services.revertActivity(await req.actor(), ctx.params.id, {
              idempotencyKey: req.opts.idempotencyKey,
            }),
        }),
    },
  },
});
