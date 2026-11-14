import { createFileRoute } from "@tanstack/react-router";
import { endpoint, unparsed } from "@/server/http/endpoint";

export const Route = createFileRoute("/api/v1/decisions/$id/decide")({
  server: {
    handlers: {
      ANY: (ctx) =>
        endpoint(ctx, {
          POST: async (req) =>
            req.services.decide(
              await req.actor(),
              ctx.params.id,
              unparsed(await req.json()),
              req.opts,
            ),
        }),
    },
  },
});
