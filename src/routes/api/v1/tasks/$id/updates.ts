import { createFileRoute } from "@tanstack/react-router";
import { endpoint, unparsed } from "@/server/http/endpoint";
import { ServiceError } from "@/server/services";

export const Route = createFileRoute("/api/v1/tasks/$id/updates")({
  server: {
    handlers: {
      ANY: (ctx) =>
        endpoint(ctx, {
          POST: async (req) => {
            const body = await req.json();
            if (body["source"] === "mcp") {
              throw ServiceError.invalid("Only the /mcp endpoint records source mcp.", [
                { path: "source", message: "mcp is recorded only by the /mcp endpoint" },
              ]);
            }
            const result = await req.services.postProgress(
              await req.actor(),
              ctx.params.id,
              unparsed(body),
              req.opts,
            );
            return { result, body: result.value.update };
          },
        }),
    },
  },
});
