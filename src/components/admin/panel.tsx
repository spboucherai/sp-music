"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useT } from "@/i18n";
import type { Key } from "@/i18n/messages";
import { PageHeader } from "@/components/ui";
import { ImportPanel } from "./import";
import { LibraryPanel } from "./library";
import { UsersPanel } from "./users";
import { AuditPanel, HealthPanel } from "./health";

const TABS = ["import", "library", "users", "health", "audit"] as const;
type Tab = (typeof TABS)[number];

function Panel() {
  const t = useT(); const router = useRouter(); const params = useSearchParams();
  const raw = params.get("tab") as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : "import";
  return (
    <>
      <PageHeader title={t("admin.title")} />
      <div className="scroll-x mb-6 !gap-1 border-b border-line" role="tablist" aria-label={t("admin.title")}>
        {TABS.map((k) => <button key={k} role="tab" id={`atab-${k}`} aria-selected={tab === k} aria-controls="admin-panel" onClick={() => router.replace(`/admin?tab=${k}`, { scroll: false })}
          className={`-mb-px border-b-2 px-3.5 py-2.5 text-sm font-bold ${tab === k ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink"}`}>{t(`admin.tab.${k}` as Key)}</button>)}
      </div>
      <div id="admin-panel" role="tabpanel" aria-labelledby={`atab-${tab}`}>
        {tab === "import" ? <ImportPanel /> : tab === "library" ? <LibraryPanel focusAlbum={params.get("album")} /> : tab === "users" ? <UsersPanel /> : tab === "health" ? <HealthPanel /> : <AuditPanel />}
      </div>
    </>
  );
}
export function AdminPanel() { return <Suspense><Panel /></Suspense>; }
