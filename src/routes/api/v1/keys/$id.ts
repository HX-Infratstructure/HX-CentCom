import { createFileRoute } from "@tanstack/react-router";
import { endpoint, rejectIdempotencyKey } from "@/server/http/endpoint";

export const Route = createFileRoute("/api/v1/keys/$id")({
  server: {
    handlers: {
      ANY: (ctx) =>
        endpoint(ctx, {
          DELETE: async (req) => {
            rejectIdempotencyKey(req);
            return Response.json(await req.services.revokeKey(await req.actor(), ctx.params.id));
          },
        }),
    },
  },
});
