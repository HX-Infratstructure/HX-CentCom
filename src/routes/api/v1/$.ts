import { createFileRoute } from "@tanstack/react-router";
import { ServiceError } from "@/server/services";
import { errorResponse } from "@/server/http/errors";

export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      ANY: ({ request }) =>
        errorResponse(ServiceError.notFound("Endpoint", new URL(request.url).pathname)),
    },
  },
});
