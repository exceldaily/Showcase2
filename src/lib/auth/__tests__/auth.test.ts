import { describe, expect, it } from "vitest";
import { normalizeUsername, signSession, validateCredentials, verifySession, type SessionPayload } from "../session";
import { hashPassword, verifyPassword } from "../password";

const secret = "test-secret";
const payload: SessionPayload = { uid: "u1", name: "brad", role: "owner", v: 1, exp: Math.floor(Date.now() / 1000) + 60 };

describe("session cookie", () => {
  it("round-trips a signed payload", async () => {
    const token = await signSession(payload, secret);
    expect(await verifySession(token, secret)).toEqual(payload);
  });
  it("rejects tampering, wrong secret, expiry and garbage", async () => {
    const token = await signSession(payload, secret);
    const [body, sig] = token.split(".");
    expect(await verifySession(`${body}x.${sig}`, secret)).toBeNull();
    expect(await verifySession(token, "other")).toBeNull();
    expect(await verifySession(token, secret, (payload.exp + 1) * 1000)).toBeNull();
    expect(await verifySession("nope", secret)).toBeNull();
    expect(await verifySession(undefined, secret)).toBeNull();
    const forged = await signSession({ ...payload, role: "admin" as unknown as "owner" }, secret);
    expect(await verifySession(forged, secret)).toBeNull();
  });
});

describe("credentials", () => {
  it("normalizes and validates usernames, allows short simple passwords", () => {
    expect(normalizeUsername("  Brad.H ")).toBe("brad.h");
    expect(validateCredentials("brad", "abcd")).toBeNull();
    expect(validateCredentials("b", "abcd")).toMatch(/Username/);
    expect(validateCredentials("_brad", "abcd")).toMatch(/Username/);
    expect(validateCredentials("brad", "abc")).toMatch(/Password/);
    expect(validateCredentials("has space", "abcd")).toMatch(/Username/);
  });
  it("hashes with a random salt and verifies", () => {
    const h1 = hashPassword("hunter2");
    const h2 = hashPassword("hunter2");
    expect(h1).not.toBe(h2);
    expect(verifyPassword("hunter2", h1)).toBe(true);
    expect(verifyPassword("hunter3", h1)).toBe(false);
    expect(verifyPassword("hunter2", "garbage")).toBe(false);
  });
});
