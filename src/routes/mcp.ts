import { createFileRoute } from "@tanstack/react-router";
import { handleMcp } from "@/server/http/mcp";

/** Every method, so a GET gets handleMcp's 405 instead of Start's SSR fallback. */
export const Route = createFileRoute("/mcp")({
  server: { handlers: { ANY: ({ request, context }) => handleMcp(request, context.services) } },
});
