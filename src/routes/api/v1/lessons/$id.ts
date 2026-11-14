import { createFileRoute } from "@tanstack/react-router";
import { endpoint, unparsed } from "@/server/http/endpoint";

/** A PUT body is a partial update: an absent field stays, null clears it. */
export const Route = createFileRoute("/api/v1/lessons/$id")({
  server: {
    handlers: {
      ANY: (ctx) =>
        endpoint(ctx, {
          PUT: async (req) =>
            req.services.updateLesson(
              await req.actor(),
              ctx.params.id,
              unparsed(await req.json()),
              req.opts,
            ),
        }),
    },
  },
});
