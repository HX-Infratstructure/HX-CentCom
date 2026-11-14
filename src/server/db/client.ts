import postgres from "postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";

export type Db = PgDatabase<PgQueryResultHKT>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** `isoTimestamp` (schema.ts) reads timestamptz text as `... +00` only under these settings. */
export const SESSION_SETTINGS = { TimeZone: "UTC", DateStyle: "ISO, MDY" } as const;

export interface DbHandle {
  readonly db: PostgresJsDatabase;
  close(): Promise<void>;
}

export function connectDb(url: string, options: { readonly max?: number } = {}): DbHandle {
  const client = postgres(url, {
    ...(options.max === undefined ? {} : { max: options.max }),
    connection: { ...SESSION_SETTINGS, application_name: "hx-centcom" },
    onnotice: () => {},
  });
  return { db: drizzle(client), close: () => client.end() };
}

export function requireEnv(name: "DATABASE_URL"): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set. The app and the db scripts read it from the environment.`);
  return value;
}
