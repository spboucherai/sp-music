import "./_env";
import { sql } from "../src/lib/db";
import { env } from "../src/lib/env";
import { issueSetupToken } from "../src/lib/auth";

/**
 * Recovery from the server's shell (the only recovery path besides the printed recovery codes).
 *   tsx scripts/setup-token.ts                      → owner: add a passkey (existing ones kept)
 *   tsx scripts/setup-token.ts --recovery           → owner: replace every passkey, sign out every device
 *   tsx scripts/setup-token.ts --user a@b.c [...]   → same for another account
 * The link is printed on the terminal only; run it interactively, never from a job whose output is logged.
 */
async function main() {
  const recovery = process.argv.includes("--recovery");
  const i = process.argv.indexOf("--user");
  const email = i > 0 ? process.argv[i + 1] : null;
  const [u] = email ? await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}` : await sql<{ id: string }[]>`SELECT id FROM users WHERE is_owner`;
  if (!u) throw new Error(email ? `No account ${email}` : "No owner account: run scripts/bootstrap.ts first");
  const token = await issueSetupToken(u.id, recovery ? "recovery" : "setup", 30);
  console.log(`${env.appUrl}/setup#${token}`);
  console.log(recovery ? "Valid 30 minutes, one use. Enrolling with it REMOVES the other passkeys and signs out every device." : "Valid 30 minutes, one use.");
  await sql.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
