import { createFileRoute } from "@tanstack/react-router";
import { endpoint } from "@/server/http/endpoint";
import { callerView } from "@/server/http/views";

export const Route = createFileRoute("/api/v1/workspace")({
  server: {
    handlers: {
      ANY: (ctx) =>
        endpoint(ctx, {
          GET: async (req) => {
            // In sequence: on a single-session server a parallel query lands inside the snapshot transaction.
            const actor = await req.actor();
            const workspace = await req.services.listWorkspace();
            return Response.json({ ...workspace, actor: callerView(actor) });
          },
        }),
    },
  },
});
