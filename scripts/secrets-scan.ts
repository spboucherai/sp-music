import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Fails if a tracked (or about-to-be-tracked) file looks like it contains a credential. */
const files = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" }).split("\n").filter(Boolean);
const patterns: [string, RegExp][] = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["postgres URL with password", /postgres(?:ql)?:\/\/[^:\s/]+:(?!CHANGE_ME|password\b)[^@\s]{6,}@/],
  ["APP_SECRET value", /^APP_SECRET=[A-Za-z0-9+/=_-]{32,}\s*$/m],
  ["generic API key", /\b(?:sk|pk)-[A-Za-z0-9_-]{24,}\b/],
];
let bad = 0;
for (const f of files) {
  if (/\.(png|ico|jpg|webp|lock)$|pnpm-lock\.yaml$/.test(f) || f === ".env") continue;
  let text: string;
  try { text = readFileSync(f, "utf8"); } catch { continue; }
  for (const [name, re] of patterns) if (re.test(text)) { console.error(`SECRET? ${name} in ${f}`); bad++; }
}
if (files.includes(".env") && execSync("git ls-files .env", { encoding: "utf8" }).trim()) { console.error(".env is tracked by git"); bad++; }
if (bad) process.exit(1);
console.log(`secrets scan ok (${files.length} files)`);
