import dns from "node:dns";
import net from "node:net";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// The cluster nodes have no IPv6 route: prefer IPv4 and give each attempt time to connect.
dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamilyAttemptTimeout(3000);

/** Minimal .env loader for scripts and the worker (Next.js loads .env itself). */
const file = path.join(process.cwd(), ".env");
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
