import { createFileRoute } from "@tanstack/react-router";
import { endpoint, rejectIdempotencyKey, unparsed } from "@/server/http/endpoint";

export const Route = createFileRoute("/api/v1/keys")({
  server: {
    handlers: {
      ANY: (ctx) =>
        endpoint(ctx, {
          POST: async (req) => {
            rejectIdempotencyKey(req);
            const body = await req.json();
            const issued = await req.services.issueKey(
              await req.actor(),
              unparsed(body["agentId"]),
              unparsed(body["label"]),
            );
            return Response.json(issued, { status: 201 });
          },
        }),
    },
  },
});
