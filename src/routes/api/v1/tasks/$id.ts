import { createFileRoute } from "@tanstack/react-router";
import { endpoint } from "@/server/http/endpoint";

export const Route = createFileRoute("/api/v1/tasks/$id")({
  server: {
    handlers: {
      ANY: (ctx) =>
        endpoint(ctx, {
          GET: async (req) => Response.json(await req.services.getTask(ctx.params.id)),
        }),
    },
  },
});
