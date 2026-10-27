import { Lock } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import type { NoAccessSubject } from "./no-access-subjects";

// Shown instead of a page someone's role doesn't allow.
export async function NoAccess({ what }: { what: NoAccessSubject }) {
  const { tr } = await getI18n();
  return (
    <div className="mx-auto mt-10 max-w-md rounded-lg border bg-card p-6 text-center">
      <Lock className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
      <h1 className="mt-3 text-lg font-semibold">{tr("You can't see {what}", { what: tr(what) })}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{tr("Ask the owner if you need access.")}</p>
    </div>
  );
}
