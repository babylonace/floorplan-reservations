import { createInterface } from "node:readline";
import { StaffError } from "./auth/staff.js";
import { loadConfig, loadDotEnvIfPresent } from "./config.js";
import { createPool } from "./db.js";
import { runStaffCommand } from "./staff-commands.js";

/**
 * In a terminal, passwords are typed without being shown. Otherwise each password is read as
 * one line of standard input, which lets a script pass it without it ever being an argument.
 */

function readHidden(prompt: string): Promise<string> {
  const input = process.stdin;
  process.stdout.write(prompt);
  input.setRawMode(true);
  input.setEncoding("utf8");
  input.resume();
  let typed = "";
  return new Promise((resolve, reject) => {
    const finish = () => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          finish();
          resolve(typed);
          return;
        }
        if (char === "\u0003" || char === "\u0004") {
          finish();
          reject(new StaffError("Cancelled."));
          return;
        }
        if (char === "\u007f" || char === "\b") typed = Array.from(typed).slice(0, -1).join("");
        else typed += char;
      }
    };
    input.on("data", onData);
  });
}

function lineReader(): (prompt: string) => Promise<string> {
  const lines = createInterface({ input: process.stdin, terminal: false })[Symbol.asyncIterator]();
  return async () => {
    const next = await lines.next();
    if (next.done) throw new StaffError("No password was given on standard input.");
    return next.value;
  };
}

loadDotEnvIfPresent();
const pool = createPool(loadConfig().databaseUrl, { max: 2 });

try {
  process.exitCode = await runStaffCommand(pool, process.argv.slice(2), {
    readPassword: process.stdin.isTTY ? readHidden : lineReader(),
    print: (line) => {
      console.log(line);
    },
  });
} finally {
  await pool.end();
}
// The line reader keeps standard input open; nothing else is left to do.
process.exit();
