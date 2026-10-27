import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Pencil, RefreshCw, Wrench } from "lucide-react";
import { ConfirmButton } from "@/components/confirm-button";
import { PageLoading } from "@/components/page-loading";
import { Field, FieldColumn, FieldGroup, RecordType, linkClass } from "@/components/record";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { assetStatuses, itemCategories, type AssetStatus, type ItemCategory } from "@/lib/inventory/options";
import { assetReportPath, qrSvg, siteOrigin } from "@/lib/inventory/qr";
import { bookValue, serviceDue } from "@/lib/inventory/stock";
import { getI18n } from "@/lib/i18n/server";
import { today } from "@/lib/today";
import { assetAction, regenerateAssetToken } from "../../actions";
import { getAsset, getLocations, getReports, parseId } from "../../data";
import { ReportsInbox } from "../../reports-inbox";
import { AssetActions } from "./asset-actions";

const saved: Record<string, string> = { created: "Equipment added.", updated: "Changes saved." };
const eventLabel = { added: "Added", moved: "Moved", status: "Status changed", serviced: "Serviced", note: "Note" } as const;

async function AssetRecord({ params, searchParams }: Pick<PageProps<"/inventory/assets/[id]">, "params" | "searchParams">) {
  const id = parseId((await params).id);
  const a = id === null ? null : await getAsset(id);
  if (!a) notFound();
  const [sp, user, day, { fmt }, locations, reports, origin] = await Promise.all([searchParams, getCurrentUser(), today(), getI18n(), getLocations(), getReports(), siteOrigin()]);
  const manage = can(user, "inventory.manage");
  const seeCosts = can(user, "expenses.view");
  const st = assetStatuses[a.asset.status as AssetStatus];
  const due = serviceDue(a.asset, a.serviceIntervalDays, day);
  const qr = await qrSvg(origin + assetReportPath(a.asset.reportToken));
  const mine = reports.filter((r) => r.report.assetId === a.asset.id);

  return (
    <>
      {typeof sp.saved === "string" && saved[sp.saved] && (
        <p role="status" className="mb-4 rounded-lg border border-brand-green/40 bg-success px-4 py-2.5 text-sm font-medium text-success-foreground">
          {saved[sp.saved]}
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <RecordType icon={Wrench}>Equipment</RecordType>
          <h1 className="mt-1.5 flex flex-wrap items-center gap-3 text-3xl font-bold">
            <span>
              <span className="text-muted-foreground">{a.asset.assetTag}</span> {a.itemName}
            </span>
            <Badge variant={st.variant} className="h-7 px-3 text-[0.8rem]">
              {st.label}
            </Badge>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            In {a.locationName}
            {a.asset.serialNumber && ` · serial ${a.asset.serialNumber}`}
          </p>
          {manage && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/inventory/assets/${a.asset.id}/edit`} className={buttonVariants()}>
                <Pencil aria-hidden="true" />
                Edit
              </Link>
            </div>
          )}
        </div>
        <figure className="grid justify-items-center gap-1 rounded-lg border bg-white p-3 text-center text-black">
          {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG made on the server */}
          <img src={`data:image/svg+xml;utf8,${encodeURIComponent(qr)}`} alt={`QR code to report a problem with ${a.asset.assetTag}`} className="size-32" />
          <figcaption className="text-[0.75rem]">
            Scan to report a problem
            {manage && (
              <span className="mt-1 block">
                <ConfirmButton
                  label="New code"
                  icon={<RefreshCw aria-hidden="true" />}
                  size="sm"
                  variant="ghost"
                  title="Make a new QR code?"
                  description="The old label stops working. Print the new one from Locations → Print QR labels."
                  confirmLabel="Make new code"
                  action={regenerateAssetToken.bind(null, a.asset.id)}
                />
              </span>
            )}
          </figcaption>
        </figure>
      </div>

      <div className="mt-6">
        <FieldGroup title="Details">
          <FieldColumn>
            <Field label="Kind">
              <Link href={`/inventory/items/${a.asset.itemId}`} className={linkClass}>
                {a.itemName}
              </Link>
              <div className="text-[0.8rem] text-muted-foreground">{itemCategories[a.category as ItemCategory]}</div>
            </Field>
          </FieldColumn>
          <FieldColumn>
            <Field label="Bought">
              {fmt.calendarDate(a.asset.purchasedOn)}
              {a.purchase && (
                <div className="text-[0.8rem]">
                  from {a.purchase.vendorName}
                  {seeCosts && (
                    <>
                      {" "}
                      ·{" "}
                      <Link href={`/finances/expenses/${a.purchase.id}`} className={linkClass}>
                        see the expense
                      </Link>
                    </>
                  )}
                </div>
              )}
            </Field>
          </FieldColumn>
          <FieldColumn>
            {seeCosts && (
              <Field label="Cost / worth now">
                {fmt.money(a.asset.purchaseCostCents)}
                {a.usefulLifeMonths && <div className="text-[0.8rem] text-muted-foreground">about {fmt.money(bookValue(a.asset.purchaseCostCents, a.asset.purchasedOn, a.usefulLifeMonths, day))} now</div>}
              </Field>
            )}
            <Field label="Warranty">{a.asset.warrantyUntil ? <span className={a.asset.warrantyUntil < day ? "text-muted-foreground" : ""}>until {fmt.calendarDate(a.asset.warrantyUntil)}{a.asset.warrantyUntil < day && " (expired)"}</span> : null}</Field>
          </FieldColumn>
          <FieldColumn>
            <Field label="Service">
              {!due ? (
                "No routine service set"
              ) : (
                <>
                  {due.overdue ? <Badge variant="destructive">Overdue</Badge> : due.soon ? <Badge variant="warning">Due soon</Badge> : null} due {fmt.calendarDate(due.dueOn)}
                  <div className="text-[0.8rem] text-muted-foreground">every {a.serviceIntervalDays} days{a.asset.lastServicedOn && `, last ${fmt.calendarDate(a.asset.lastServicedOn)}`}</div>
                </>
              )}
            </Field>
          </FieldColumn>
        </FieldGroup>
      </div>

      {mine.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Reported</h2>
          <ReportsInbox reports={mine} fmt={fmt} manage={manage} />
        </section>
      )}

      {manage && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Update</h2>
          <AssetActions action={assetAction.bind(null, a.asset.id)} locations={locations.filter((l) => l.isActive)} currentLocation={a.asset.locationId} status={a.asset.status} today={day} />
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">History</h2>
        <ul className="divide-y rounded-lg border text-sm">
          {a.events.map(({ event: e, fromName, toName, byName }) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2">
              <span className="w-36 text-muted-foreground">{fmt.stamp(e.createdAt)}</span>
              <span className="font-medium">{eventLabel[e.kind]}</span>
              {e.kind === "moved" && <span>{fromName} → {toName}</span>}
              {e.kind === "added" && toName && <span>to {toName}</span>}
              {e.kind === "status" && e.status && <span>{assetStatuses[e.status as AssetStatus]?.label}</span>}
              {e.costCents != null && seeCosts && <span className="tabular-nums">{fmt.money(e.costCents)}</span>}
              {e.note && <span className="text-muted-foreground">· {e.note}</span>}
              <span className="ml-auto text-[0.75rem] text-muted-foreground">{byName ?? ""}</span>
            </li>
          ))}
        </ul>
      </section>
      {a.asset.notes && <p className="mt-8 rounded-lg border bg-secondary/30 px-4 py-3 text-sm whitespace-pre-wrap">{a.asset.notes}</p>}
    </>
  );
}

export default function AssetPage(props: PageProps<"/inventory/assets/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <AssetRecord params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}
