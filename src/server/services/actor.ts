/**
 * Identity (SPEC §2, R9): bearer key to Actor. The only module that can make an `Actor`: the brand symbol is not
 * exported, so `{ agentId: body.agent, role: "owner" }` does not type-check as one anywhere else.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { agentKeys, agents, type AgentRole } from "@/server/db/schema";
import { ServiceError } from "./errors";
import type { MintedKey } from "./types";

declare const actorBrand: unique symbol;

export type Actor = {
  readonly agentId: string;
  readonly role: AgentRole;
  readonly [actorBrand]: true;
};

function mintActor(agentId: string, role: AgentRole): Actor {
  return { agentId, role } as Actor;
}

export const KEY_PATTERN = /^hxc_[a-z0-9]+(?:-[a-z0-9]+)*_[A-Za-z0-9_-]{32}$/;

export function keySlug(agentId: string): string {
  return agentId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/** 24 random bytes are exactly 32 base64url characters. */
export function mintKey(agentId: string): MintedKey {
  const plaintext = `hxc_${keySlug(agentId)}_${randomBytes(24).toString("base64url")}`;
  return { plaintext, keyHash: hashKey(plaintext) };
}

export async function resolveActor(db: Db, authHeader: string | null): Promise<Actor | null> {
  const token = /^Bearer\s+(\S+)\s*$/i.exec(authHeader ?? "")?.[1];
  if (!token || !KEY_PATTERN.test(token)) return null;
  const [row] = await db
    .select({ agentId: agents.id, role: agents.role })
    .from(agentKeys)
    .innerJoin(agents, eq(agents.id, agentKeys.agent_id))
    .where(
      and(
        eq(agentKeys.key_hash, hashKey(token)),
        isNull(agentKeys.revoked_at),
        eq(agents.active, true),
      ),
    )
    .limit(1);
  return row ? mintActor(row.agentId, row.role) : null;
}

export function authenticated(actor: Actor | null): Actor {
  if (actor === null) throw ServiceError.unauthorized();
  return actor;
}
