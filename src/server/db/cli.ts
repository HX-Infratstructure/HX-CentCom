import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connectDb, requireEnv } from "./client";
import { MIGRATIONS_FOLDER } from "./migrations";
import { seedDb } from "./seed";

async function main(command: string | undefined): Promise<void> {
  if (command !== "migrate" && command !== "seed") {
    throw new Error("usage: tsx src/server/db/cli.ts migrate|seed");
  }
  const handle = connectDb(requireEnv("DATABASE_URL"), { max: 1 });
  try {
    if (command === "migrate") await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
    else console.log("seeded", await seedDb(handle.db));
  } finally {
    await handle.close();
  }
}

main(process.argv[2]).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
