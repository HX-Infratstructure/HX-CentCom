import { createFileRoute } from "@tanstack/react-router";
import { endpoint, unparsed } from "@/server/http/endpoint";

export const Route = createFileRoute("/api/v1/tasks/$id/requirements")({
  server: {
    handlers: {
      ANY: (ctx) =>
        endpoint(ctx, {
          PUT: async (req) =>
            req.services.setRequirement(
              await req.actor(),
              ctx.params.id,
              unparsed(await req.json()),
              req.opts,
            ),
        }),
    },
  },
});
