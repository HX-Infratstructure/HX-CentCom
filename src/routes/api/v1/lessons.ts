import { createFileRoute } from "@tanstack/react-router";
import { endpoint, unparsed } from "@/server/http/endpoint";

export const Route = createFileRoute("/api/v1/lessons")({
  server: {
    handlers: {
      ANY: (ctx) =>
        endpoint(ctx, {
          GET: async (req) => Response.json(await req.services.listLessons(unparsed(req.query))),
          POST: async (req) =>
            req.services.createLesson(await req.actor(), unparsed(await req.json()), {
              idempotencyKey: req.opts.idempotencyKey,
            }),
        }),
    },
  },
});
