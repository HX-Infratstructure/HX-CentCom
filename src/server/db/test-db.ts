import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  createServices,
  serviceDeps,
  type Actor,
  type ServiceDeps,
  type Services,
} from "@/server/services";
import { SESSION_SETTINGS, type Db } from "./client";
import { MIGRATIONS_FOLDER } from "./migrations";
import { agentKeys } from "./schema";
import { seedDb } from "./seed";

export interface TestDb {
  readonly db: Db;
  readonly services: Services;
  readonly deps: ServiceDeps;
  keyFor(agentId: string): Promise<string>;
  actorFor(agentId: string): Promise<Actor>;
  close(): Promise<void>;
}

const SESSION_SQL = Object.entries(SESSION_SETTINGS)
  .map(([name, value]) => `SET ${name} = '${value}';`)
  .join(" ");

let template: Promise<PGlite> | undefined;

async function seededTemplate(): Promise<PGlite> {
  const pg = await PGlite.create();
  await pg.exec(SESSION_SQL);
  const db = drizzle({ client: pg });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  await seedDb(db);
  return pg;
}

export async function createTestDb(deps: Partial<ServiceDeps> = {}): Promise<TestDb> {
  template ??= seededTemplate();
  const pg = (await (await template).clone()) as PGlite;
  await pg.exec(SESSION_SQL);
  const db: Db = drizzle({ client: pg });
  const resolved = serviceDeps(deps);
  const services = createServices(db, resolved);
  const keyFor = async (agentId: string): Promise<string> => {
    const { plaintext, keyHash } = resolved.mintKey(agentId);
    await db.insert(agentKeys).values({
      agent_id: agentId,
      key_hash: keyHash,
      label: "test fixture",
      created_at: resolved.now().toISOString(),
    });
    return plaintext;
  };
  const actorFor = async (agentId: string): Promise<Actor> => {
    const actor = await services.resolveActor(`Bearer ${await keyFor(agentId)}`);
    if (!actor) throw new Error(`no active agent ${agentId}`);
    return actor;
  };
  return { db, services, deps: resolved, keyFor, actorFor, close: () => pg.close() };
}
