import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { AppShell } from "@/components/shell";

/** Everything under (app) requires a session. The API enforces the same rule on its own; this is navigation only. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await getUser();
  if (!u) redirect("/login");
  return <AppShell csrfToken={u.csrfToken} me={{ id: u.userId, email: u.email, displayName: u.displayName, role: u.role, isOwner: u.isOwner, locale: u.locale, accent: u.accent }}>{children}</AppShell>;
}
