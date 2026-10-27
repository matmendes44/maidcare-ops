import Link from "next/link";
import { Camera, Check, QrCode } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { reportKinds, type ReportKind } from "@/lib/inventory/options";
import type { Formatters } from "@/lib/i18n/format";
import { resolveReport } from "./actions";
import { ActionForm, Submit } from "./action-form";
import type { ReportRow } from "./data";

const kindVariant: Record<ReportKind, "warning" | "destructive" | "info" | "secondary"> = { low: "warning", out: "destructive", broken: "destructive", missing: "destructive", other: "secondary" };

// What cleaners have reported, newest first, each with a way to mark it done.
export function ReportsInbox({ reports, fmt, manage }: { reports: ReportRow[]; fmt: Formatters; manage: boolean }) {
  if (!reports.length) return <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Nothing reported. Cleaners can report problems from the QR code in each vehicle.</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {reports.map(({ report: r, itemName, assetTag, locationName, reporterUser, contractorName }) => (
        <li key={r.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={kindVariant[r.kind]}>{reportKinds[r.kind]}</Badge>
              <span className="font-medium">
                {r.itemId ? <Link href={`/inventory/items/${r.itemId}`} className="hover:text-link hover:underline">{itemName}</Link> : r.assetId ? <Link href={`/inventory/assets/${r.assetId}`} className="hover:text-link hover:underline">{assetTag}</Link> : "General"}
              </span>
              {locationName && <span className="text-sm text-muted-foreground">· {locationName}</span>}
              {r.source === "qr" && <QrCode className="size-3.5 text-muted-foreground" aria-label="From a QR code" />}
              {r.hasPhoto && (
                <a href={`/api/inventory-reports/${r.id}/photo`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-[0.8rem] text-link hover:underline">
                  <Camera className="size-3.5" aria-hidden="true" />
                  Photo
                </a>
              )}
            </div>
            {r.note && <p className="mt-1 text-sm">{r.note}</p>}
            <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
              {contractorName ?? reporterUser ?? r.reporterName ?? "Someone"} · {fmt.stamp(r.createdAt)}
              {r.status === "resolved" && ` · done: ${r.resolution}`}
            </p>
          </div>
          {manage && r.status === "open" && (
            <ActionForm action={resolveReport.bind(null, r.id)} className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Input name="resolution" placeholder="What was done (optional)" aria-label="What was done" className="h-8 w-48 text-sm" />
              <Submit size="sm" variant="outline">
                <Check aria-hidden="true" />
                Done
              </Submit>
            </ActionForm>
          )}
        </li>
      ))}
    </ul>
  );
}
