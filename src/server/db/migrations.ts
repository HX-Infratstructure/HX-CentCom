import { fileURLToPath } from "node:url";

export const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../../drizzle/migrations", import.meta.url),
);
