import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Staff passwords are stored as scrypt hashes, each with its own random salt:
 * `scrypt$N$r$p$salt$key`, with salt and key in base64. scrypt is slow on purpose and needs
 * 32 MiB per guess with these settings, which makes guessing from a stolen copy expensive.
 */

const COST = 2 ** 15;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 16;
// scrypt needs 128 × N × r bytes. A little above that, so the current settings fit.
const MAX_MEMORY = 64 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFC"), salt, KEY_BYTES, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** Why a new password is refused, or null when it is fine. */
export function passwordProblem(password: string): string | null {
  const length = Array.from(password.normalize("NFC")).length;
  if (length < MIN_PASSWORD_LENGTH) {
    return `The password must have at least ${String(MIN_PASSWORD_LENGTH)} characters.`;
  }
  if (length > MAX_PASSWORD_LENGTH) {
    return `The password must have at most ${String(MAX_PASSWORD_LENGTH)} characters.`;
  }
  if (!password.trim()) return "The password must not be only spaces.";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: MAX_MEMORY,
  });
  return [
    "scrypt",
    String(COST),
    String(BLOCK_SIZE),
    String(PARALLELISM),
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

interface ParsedHash {
  options: ScryptOptions;
  salt: Buffer;
  key: Buffer;
}

function parse(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [cost, blockSize, parallelism] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4] ?? "", "base64");
  const key = Buffer.from(parts[5] ?? "", "base64");
  if (cost === undefined || blockSize === undefined || parallelism === undefined) return null;
  // Settings no hash of ours uses would only let a damaged row use up memory or time.
  const sane =
    Number.isInteger(Math.log2(cost)) &&
    cost >= 2 ** 10 &&
    cost <= 2 ** 17 &&
    Number.isInteger(blockSize) &&
    blockSize >= 1 &&
    blockSize <= 16 &&
    Number.isInteger(parallelism) &&
    parallelism >= 1 &&
    parallelism <= 4 &&
    salt.length >= SALT_BYTES &&
    key.length === KEY_BYTES;
  if (!sane) return null;
  return {
    options: { N: cost, r: blockSize, p: parallelism, maxmem: 256 * 1024 * 1024 },
    salt,
    key,
  };
}

/**
 * True when `password` matches `stored`. The keys are compared in constant time, so how long
 * the answer takes says nothing about how close a guess was.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;
  const key = await derive(password, parsed.salt, parsed.options);
  return timingSafeEqual(key, parsed.key);
}

/**
 * A hash nobody's password matches. Sign-ins for unknown addresses check against it, so they
 * take as long as real ones and the timing does not tell which addresses have an account. The
 * app makes one when it starts, so even the first unknown address takes no longer than others.
 */
export function makeDummyHash(): Promise<string> {
  return hashPassword(randomBytes(32).toString("base64"));
}
