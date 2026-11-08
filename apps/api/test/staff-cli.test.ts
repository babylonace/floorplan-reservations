import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { verifyPassword } from "../src/auth/passwords.js";
import { createSession } from "../src/auth/sessions.js";
import { createUser, grantRole, listStaff } from "../src/auth/staff.js";
import { createPool } from "../src/db.js";
import { runStaffCommand, USAGE } from "../src/staff-commands.js";
import { createVenue, deleteVenue, TEST_NOW, TEST_PASSWORD, testDatabaseUrl } from "./helpers.js";

const pool = createPool(testDatabaseUrl());
const slugs: string[] = [];

afterEach(async () => {
  for (const slug of slugs.splice(0)) await deleteVenue(pool, slug);
  await pool.query("delete from staff_users where email like 'cli-%'");
});

afterAll(async () => {
  await pool.end();
});

/** A venue nobody runs yet: the test owner that createVenue adds is taken off again. */
async function venue(slug: string) {
  slugs.push(slug);
  const { venueId } = await createVenue(pool, slug, []);
  await pool.query("delete from venue_staff where venue_id = $1", [venueId]);
}

/** Runs a command with these answers to its password questions; returns code and output. */
async function run(args: string[], answers: string[] = []) {
  const lines: string[] = [];
  const prompts: string[] = [];
  const code = await runStaffCommand(pool, args, {
    readPassword: (prompt) => {
      prompts.push(prompt);
      const answer = answers.shift();
      return answer === undefined
        ? Promise.reject(new Error("No answer left"))
        : Promise.resolve(answer);
    },
    print: (line) => lines.push(line),
  });
  return { code, output: lines.join("\n"), prompts };
}

async function storedHash(email: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ password_hash: string }>(
    "select password_hash from staff_users where email = $1",
    [email],
  );
  return rows[0]?.password_hash;
}

describe("the staff command line", () => {
  it("creates the first owner, asking for the password twice", async () => {
    await venue("cli-first");
    const result = await run(
      ["add", "--venue", "cli-first", "--email", " CLI-Owner@Example.com ", "--role", "owner"],
      ["a made-up test password", "a made-up test password"],
    );

    expect(result.code).toBe(0);
    expect(result.prompts).toEqual(["New password: ", "Same password again: "]);
    expect(result.output).toContain("cli-owner@example.com is now owner at cli-first.");
    // Neither the password nor its hash is ever printed.
    expect(result.output).not.toContain("a made-up test password");
    expect(result.output).not.toContain("scrypt");

    const hash = await storedHash("cli-owner@example.com");
    expect(hash).toBeDefined();
    await expect(verifyPassword("a made-up test password", hash ?? "")).resolves.toBe(true);
    expect(await listStaff(pool, "cli-first")).toEqual([
      { email: "cli-owner@example.com", role: "owner" },
    ]);
  });

  it("refuses passwords that differ or are too short, and creates nothing", async () => {
    await venue("cli-weak");
    const args = [
      "add",
      "--venue",
      "cli-weak",
      "--email",
      "cli-weak@example.com",
      "--role",
      "staff",
    ];

    const different = await run(args, ["a made-up test password", "another test password"]);
    expect(different.code).toBe(1);
    expect(different.output).toMatch(/not the same/);

    const short = await run(args, ["too short", "too short"]);
    expect(short.code).toBe(1);
    expect(short.output).toMatch(/at least 12/);

    expect(await storedHash("cli-weak@example.com")).toBeUndefined();
    expect(await listStaff(pool, "cli-weak")).toEqual([]);
  });

  it("adds an existing account to another venue without asking for a password", async () => {
    await venue("cli-one");
    await venue("cli-two");
    const id = await createUser(pool, "cli-both@example.com", TEST_PASSWORD);
    await grantRole(pool, id, "cli-one", "owner");

    const result = await run([
      "add",
      "--venue",
      "cli-two",
      "--email",
      "cli-both@example.com",
      "--role",
      "staff",
    ]);
    expect(result.code).toBe(0);
    expect(result.prompts).toEqual([]);
    expect(await listStaff(pool, "cli-two")).toEqual([
      { email: "cli-both@example.com", role: "staff" },
    ]);

    // Running it again with another role changes the role.
    await run(["add", "--venue", "cli-two", "--email", "cli-both@example.com", "--role", "owner"]);
    expect(await listStaff(pool, "cli-two")).toEqual([
      { email: "cli-both@example.com", role: "owner" },
    ]);
  });

  it("changes a password and signs the account out everywhere", async () => {
    const id = await createUser(pool, "cli-reset@example.com", TEST_PASSWORD);
    await createSession(pool, id, TEST_NOW);
    await createSession(pool, id, TEST_NOW);

    const result = await run(
      ["password", "--email", "cli-reset@example.com"],
      ["another made-up password", "another made-up password"],
    );
    expect(result.code).toBe(0);
    const hash = await storedHash("cli-reset@example.com");
    await expect(verifyPassword("another made-up password", hash ?? "")).resolves.toBe(true);
    const { rows } = await pool.query("select 1 from staff_sessions where user_id = $1", [id]);
    expect(rows).toHaveLength(0);
  });

  it("takes an account off a venue, ends sessions and lists staff", async () => {
    await venue("cli-list");
    const id = await createUser(pool, "cli-leaver@example.com", TEST_PASSWORD);
    await grantRole(pool, id, "cli-list", "staff");
    await createSession(pool, id, TEST_NOW);

    expect((await run(["list", "--venue", "cli-list"])).output).toBe(
      "staff\tcli-leaver@example.com",
    );
    expect((await run(["sign-out", "--email", "cli-leaver@example.com"])).output).toBe(
      "Ended 1 session(s).",
    );
    const removed = await run([
      "remove",
      "--venue",
      "cli-list",
      "--email",
      "cli-leaver@example.com",
    ]);
    expect(removed.output).toBe("cli-leaver@example.com no longer runs cli-list.");
    expect((await run(["list", "--venue", "cli-list"])).output).toBe("Nobody runs this venue yet.");
  });

  it("explains what is wrong with the arguments", async () => {
    await venue("cli-args");
    const cases: [string[], RegExp][] = [
      [["add", "--venue", "cli-args", "--email", "cli-x@example.com"], /--role is missing/],
      [
        ["add", "--venue", "cli-args", "--email", "cli-x@example.com", "--role", "chef"],
        /--role must be one of: owner, staff/,
      ],
      [["add", "--venue", "cli-args", "--email", "nope", "--role", "owner"], /not an e-mail/],
      [
        ["add", "--venue", "cli-nowhere", "--email", "cli-x@example.com", "--role", "owner"],
        /no venue called "cli-nowhere"/,
      ],
      [["password", "--email", "cli-nobody@example.com"], /has no account/],
      [["add", "--password", "secret"], /Unknown option '--password'/],
      [["list", "--venue", "cli-args", "extra"], /Unexpected: extra/],
    ];
    for (const [args, message] of cases) {
      const result = await run(args, ["a made-up test password", "a made-up test password"]);
      expect({ args, code: result.code }).toEqual({ args, code: 1 });
      expect(result.output).toMatch(message);
    }
    // A failed creation on an unknown venue leaves no account behind.
    expect(await storedHash("cli-x@example.com")).toBeUndefined();

    expect(await run([])).toEqual({ code: 0, output: USAGE, prompts: [] });
    expect((await run(["frobnicate"])).code).toBe(1);
  });

  it("reads passwords from standard input when it is not a terminal", async () => {
    await venue("cli-stdin");
    const script = fileURLToPath(new URL("../src/staff-cli.ts", import.meta.url));
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        script,
        "add",
        "--venue",
        "cli-stdin",
        "--email",
        "cli-stdin@example.com",
        "--role",
        "owner",
      ],
      { env: { ...process.env, DATABASE_URL: testDatabaseUrl() } },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stdin.end("a piped test password\na piped test password\n");
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));

    expect(output).toContain("cli-stdin@example.com is now owner at cli-stdin.");
    expect(code).toBe(0);
    const hash = await storedHash("cli-stdin@example.com");
    await expect(verifyPassword("a piped test password", hash ?? "")).resolves.toBe(true);
  }, 30_000);
});
