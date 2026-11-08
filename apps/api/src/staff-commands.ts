import { parseArgs } from "node:util";
import {
  createUser,
  endAllSessions,
  findUserId,
  grantRole,
  isRole,
  listStaff,
  normalizeEmail,
  removeRole,
  ROLES,
  setPassword,
  StaffError,
  clearLoginFailures,
  venueId,
} from "./auth/staff.js";
import type { Pool } from "./db.js";

/**
 * The staff command line: the only way to create the first account, and to manage staff until
 * the staff panel exists. Passwords are typed when asked, never passed as arguments, so they
 * stay out of the shell history and the list of running processes.
 */

export const USAGE = `Usage: npm run staff -- <command> [options]

  add --venue <slug> --email <address> --role <owner|staff>
      Gives the address that role at the venue. Creates the account first if there is
      none, asking for its password twice.
  password --email <address>
      Sets a new password (asked twice), signs the account out everywhere and
      unlocks it.
  remove --venue <slug> --email <address>
      Takes the account off the venue. It keeps its access to other venues.
  sign-out --email <address>
      Ends every session of the account.
  unlock --email <address>
      Lets the address sign in again after too many failed attempts.
  list --venue <slug>
      Shows who may run the venue, and their role.`;

export interface StaffCommandIo {
  /** Asks for a password without showing what is typed. */
  readPassword: (prompt: string) => Promise<string>;
  print: (line: string) => void;
}

function option(values: Record<string, unknown>, name: string): string {
  const value = values[name];
  if (typeof value !== "string" || !value.trim()) throw new StaffError(`--${name} is missing.`);
  return value.trim();
}

function emailOption(values: Record<string, unknown>): string {
  const email = normalizeEmail(option(values, "email"));
  if (!email) throw new StaffError("--email is not an e-mail address.");
  return email;
}

async function existingUser(pool: Pool, email: string): Promise<string> {
  const id = await findUserId(pool, email);
  if (!id) throw new StaffError(`${email} has no account.`);
  return id;
}

async function newPassword(io: StaffCommandIo): Promise<string> {
  const password = await io.readPassword("New password: ");
  const again = await io.readPassword("Same password again: ");
  if (password !== again) throw new StaffError("The two passwords are not the same.");
  return password;
}

/** Runs one command and returns the exit code: 0 when it worked, 1 when it did not. */
export async function runStaffCommand(
  pool: Pool,
  args: string[],
  io: StaffCommandIo,
): Promise<number> {
  try {
    const { positionals, values } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        venue: { type: "string" },
        email: { type: "string" },
        role: { type: "string" },
      },
    });
    const [command, ...extra] = positionals;
    if (extra.length > 0) throw new StaffError(`Unexpected: ${extra.join(" ")}`);

    switch (command) {
      case "add": {
        const venue = option(values, "venue");
        const email = emailOption(values);
        const role = option(values, "role");
        if (!isRole(role)) throw new StaffError(`--role must be one of: ${ROLES.join(", ")}.`);
        // Checked first, so a mistyped venue does not leave an account behind.
        await venueId(pool, venue);
        let userId = await findUserId(pool, email);
        if (!userId) {
          io.print(`${email} has no account yet. Choose its password.`);
          userId = await createUser(pool, email, await newPassword(io));
          io.print(`Account created for ${email}.`);
        }
        await grantRole(pool, userId, venue, role);
        io.print(`${email} is now ${role} at ${venue}.`);
        return 0;
      }
      case "password": {
        const userId = await existingUser(pool, emailOption(values));
        await setPassword(pool, userId, await newPassword(io));
        io.print("Password changed. The account was signed out everywhere.");
        return 0;
      }
      case "remove": {
        const venue = option(values, "venue");
        const email = emailOption(values);
        const removed = await removeRole(pool, await existingUser(pool, email), venue);
        io.print(removed ? `${email} no longer runs ${venue}.` : `${email} was not on ${venue}.`);
        return 0;
      }
      case "sign-out": {
        const ended = await endAllSessions(pool, await existingUser(pool, emailOption(values)));
        io.print(`Ended ${String(ended)} session(s).`);
        return 0;
      }
      case "unlock": {
        const email = emailOption(values);
        const lifted = await clearLoginFailures(pool, email);
        io.print(lifted ? `${email} can sign in again.` : `${email} was not locked.`);
        return 0;
      }
      case "list": {
        const staff = await listStaff(pool, option(values, "venue"));
        if (staff.length === 0) io.print("Nobody runs this venue yet.");
        for (const member of staff) io.print(`${member.role}\t${member.email}`);
        return 0;
      }
      default:
        io.print(USAGE);
        return command === undefined || command === "help" ? 0 : 1;
    }
  } catch (error) {
    // Mistakes in the arguments or the input; anything else is a real failure.
    if (
      error instanceof StaffError ||
      (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")
    ) {
      io.print((error as Error).message);
      return 1;
    }
    throw error;
  }
}
