// @vitest-environment node
// T1 (R9): agents are identified by a bearer key, with no login. SPEC §2 Identity, §4 resolveActor/issueKey/revokeKey.
// Key prefix hxc_ (owner rename to HX-CentCom; SPEC rename block, 2026-11-14 ~06:05Z).
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDS, count, expectServiceError, setup, type Harness } from "./support";

let h: Harness;
beforeEach(async () => {
  h = await setup();
});
afterEach(async () => {
  await h.close();
});

describe("T1 (R9): a bearer key identifies its agent without a login", () => {
  it("resolves an issued key to exactly the agent it was issued for, with that agent's role", async () => {
    // Catches: a key that resolves to nobody, to the wrong agent, or to the wrong role.
    const { plaintext } = await h.svc.issueKey(h.as.OWNER, IDS.CC1, "t1 resolve");
    expect(plaintext).toMatch(/^hxc_cc1_[A-Za-z0-9_-]{32}$/i);

    const actor = await h.svc.resolveActor(`Bearer ${plaintext}`);
    expect(actor).toEqual({ agentId: IDS.CC1, role: "agent" });
  });

  it("resolves the owner's key to role owner, and an agent's key never to owner", async () => {
    // Catches: role taken from the wrong place, which would hand owner rights to an agent or deny them to the owner.
    const owner = await h.svc.issueKey(h.as.OWNER, IDS.OWNER, "t1 owner");
    const agent = await h.svc.issueKey(h.as.OWNER, IDS.CC2, "t1 agent");
    expect(await h.svc.resolveActor(`Bearer ${owner.plaintext}`)).toEqual({
      agentId: IDS.OWNER,
      role: "owner",
    });
    expect(await h.svc.resolveActor(`Bearer ${agent.plaintext}`)).toEqual({
      agentId: IDS.CC2,
      role: "agent",
    });
  });

  it("resolves no actor for an unknown key, a missing header, or a header that is not Bearer", async () => {
    // Catches: a fallback that accepts any well-formed key, an empty header, or the raw key without the scheme.
    const { plaintext } = await h.svc.issueKey(h.as.OWNER, IDS.CC1, "t1 unknown");
    // Same prefix and agent part as a real key, different random part: well formed, never issued.
    const random = plaintext.slice(-32);
    const neverIssued = `${plaintext.slice(0, -32)}${random === "A".repeat(32) ? "B" : "A"}${"A".repeat(31)}`;
    expect(await h.svc.resolveActor(`Bearer ${neverIssued}`)).toBeNull();
    expect(await h.svc.resolveActor(null)).toBeNull();
    expect(await h.svc.resolveActor("")).toBeNull();
    expect(await h.svc.resolveActor("Bearer ")).toBeNull();
    expect(await h.svc.resolveActor(`Basic ${plaintext}`)).toBeNull();
    expect(await h.svc.resolveActor(`Bearer ${plaintext}x`)).toBeNull();
  });

  it("resolves no actor for a revoked key, while the agent's other keys keep working", async () => {
    // Catches: revocation that is recorded but never checked, or that revokes every key of the agent.
    const revoked = await h.svc.issueKey(h.as.OWNER, IDS.CC1, "t1 revoked");
    const kept = await h.svc.issueKey(h.as.OWNER, IDS.CC1, "t1 kept");
    expect(await h.svc.resolveActor(`Bearer ${revoked.plaintext}`)).toEqual({
      agentId: IDS.CC1,
      role: "agent",
    });

    await h.svc.revokeKey(h.as.OWNER, revoked.keyId);

    expect(await h.svc.resolveActor(`Bearer ${revoked.plaintext}`)).toBeNull();
    expect(await h.svc.resolveActor(`Bearer ${kept.plaintext}`)).toEqual({
      agentId: IDS.CC1,
      role: "agent",
    });
    const row = await h.one<{ revoked_at: unknown }>(
      "select revoked_at from agent_keys where id = $1",
      [revoked.keyId],
    );
    expect(row.revoked_at).not.toBeNull();
  });

  it("stores only sha256(key) in hex; no stored row holds the plaintext", async () => {
    // Catches: storing the key itself, a different digest, or leaking the plaintext into the audit trail.
    const { keyId, plaintext } = await h.svc.issueKey(h.as.OWNER, IDS.CC1, "t1 hash");
    const row = await h.one<{ key_hash: string }>("select * from agent_keys where id = $1", [
      keyId,
    ]);
    expect(row.key_hash).toBe(createHash("sha256").update(plaintext).digest("hex"));
    expect(row.key_hash).not.toBe(plaintext);
    expect(JSON.stringify(row)).not.toContain(plaintext);

    const audit = await h.q("select * from activity_log");
    expect(JSON.stringify(audit)).not.toContain(plaintext);
  });

  it("issues a different key each time", async () => {
    // Catches: a deterministic or constant "random" part, which would let one agent's key be guessed from another's.
    const a = await h.svc.issueKey(h.as.OWNER, IDS.CC1, "t1 a");
    const b = await h.svc.issueKey(h.as.OWNER, IDS.CC1, "t1 b");
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.keyId).not.toBe(b.keyId);
  });

  it("lets only the owner issue or revoke keys", async () => {
    // Catches: an agent minting itself (or another agent) a key, or revoking someone else's.
    const before = await count(h, "agent_keys");
    await expectServiceError(h.svc.issueKey(h.as.CC1, IDS.CC1, "self-issued"), "forbidden", 403);
    await expectServiceError(h.svc.issueKey(h.as.CC1, IDS.CC2, "for another"), "forbidden", 403);
    expect(await count(h, "agent_keys")).toBe(before);

    const { keyId, plaintext } = await h.svc.issueKey(h.as.OWNER, IDS.CC2, "t1 keep");
    await expectServiceError(h.svc.revokeKey(h.as.CC1, keyId), "forbidden", 403);
    expect(await h.svc.resolveActor(`Bearer ${plaintext}`)).toEqual({
      agentId: IDS.CC2,
      role: "agent",
    });
  });

  it("rejects a write with no resolved actor as unauthorized (401)", async () => {
    // Catches: a write path that runs when resolveActor found nobody (unknown or revoked key).
    const before = await count(h, "task_updates");
    await expectServiceError(
      h.svc.postProgress(null, "IRP-05", { note: "no actor", source: "api" }, {}),
      "unauthorized",
      401,
    );
    expect(await count(h, "task_updates")).toBe(before);
  });
});
