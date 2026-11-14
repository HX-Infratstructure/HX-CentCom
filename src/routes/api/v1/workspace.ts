import { createFileRoute } from "@tanstack/react-router";
import { endpoint } from "@/server/http/endpoint";
import { callerView } from "@/server/http/views";

export const Route = createFileRoute("/api/v1/workspace")({
  server: {
    handlers: {
      ANY: (ctx) =>
        endpoint(ctx, {
          GET: async (req) => {
            const [workspace, actor] = await Promise.all([
              req.services.listWorkspace(),
              req.actor(),
            ]);
            return Response.json({ ...workspace, actor: callerView(actor) });
          },
        }),
    },
  },
});
