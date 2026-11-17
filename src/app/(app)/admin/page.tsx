import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { AdminPanel } from "@/components/admin/panel";

export const metadata: Metadata = { title: "Administration" };
/** A listener who types /admin is sent back; the admin API refuses them independently of this page (403). */
export default async function AdminPage() {
  const u = await getUser();
  if (!u) redirect("/login");
  if (u.role !== "admin") redirect("/");
  return <AdminPanel />;
}
