import { createFileRoute } from "@tanstack/react-router";
import { endpoint } from "@/server/http/endpoint";
import { taskDetail } from "@/server/http/views";

export const Route = createFileRoute("/api/v1/tasks/$id")({
  server: {
    handlers: {
      ANY: (ctx) =>
        endpoint(ctx, {
          GET: async (req) =>
            Response.json(taskDetail(await req.services.listWorkspace(), ctx.params.id)),
        }),
    },
  },
});
