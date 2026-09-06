// scrypt password hashing (Node only). Format: scrypt$<saltHex>$<hashHex>.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const PARAMS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, PARAMS);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, PARAMS);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
