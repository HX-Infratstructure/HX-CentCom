import { createFileRoute } from "@tanstack/react-router";
import { endpoint, unparsed } from "@/server/http/endpoint";

export const Route = createFileRoute("/api/v1/updates")({
  server: {
    handlers: {
      ANY: (ctx) =>
        endpoint(ctx, {
          GET: async (req) => {
            // A query string carries the task set as one comma-separated parameter; the service takes a list.
            const { taskIds, ...query } = req.query;
            const parsed =
              taskIds === undefined ? query : { ...query, taskIds: taskIds.split(",") };
            return Response.json(await req.services.listUpdates(unparsed(parsed)));
          },
        }),
    },
  },
});
