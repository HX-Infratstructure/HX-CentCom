import { createFileRoute } from "@tanstack/react-router";
import { endpoint, unparsed } from "@/server/http/endpoint";

export const Route = createFileRoute("/api/v1/activity")({
  server: {
    handlers: {
      ANY: (ctx) =>
        endpoint(ctx, {
          GET: async (req) => Response.json(await req.services.listActivity(unparsed(req.query))),
        }),
    },
  },
});
