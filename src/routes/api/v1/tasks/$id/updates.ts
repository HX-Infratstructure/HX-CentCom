import { createFileRoute } from "@tanstack/react-router";
import { endpoint, unparsed } from "@/server/http/endpoint";

export const Route = createFileRoute("/api/v1/tasks/$id/updates")({
  server: {
    handlers: {
      ANY: (ctx) =>
        endpoint(ctx, {
          POST: async (req) => {
            const result = await req.services.postProgress(
              await req.actor(),
              ctx.params.id,
              unparsed(await req.json()),
              req.opts,
            );
            return { result, body: result.value.update };
          },
        }),
    },
  },
});
