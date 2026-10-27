import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ClipboardCheck, Printer, RefreshCw, Warehouse } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { RecordType, linkClass } from "@/components/record";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "cn";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { assetStatuses, locationKinds, movementKinds, plural, type AssetStatus, type MovementKind } from "@/lib/inventory/options";
import { locationReportPath, qrSvg, siteOrigin } from "@/lib/inventory/qr";
import { getI18n } from "@/lib/i18n/server";
import { updateLocation } from "../../actions";
import { ActionForm, Submit } from "../../action-form";
import { getAssets, getItems, getLocation, getReports, movementsFor, parseId, parsFor, stockLevels } from "../../data";
import { ReportsInbox } from "../../reports-inbox";

const saved: Record<string, string> = { restocked: "Restocked. What was gone is recorded as used.", counted: "Count saved." };

async function LocationRecord({ params, searchParams }: Pick<PageProps<"/inventory/locations/[id]">, "params" | "searchParams">) {
  const id = parseId((await params).id);
  const location = id === null ? null : await getLocation(id);
  if (!location) notFound();
  const [sp, user, { fmt }, items, levels, pars, assets, reports, movements, origin] = await Promise.all([
    searchParams,
    getCurrentUser(),
    getI18n(),
    getItems(),
    stockLevels(),
    parsFor(location),
    getAssets(),
    getReports(),
    movementsFor({ locationId: location.id }, 40),
    siteOrigin(),
  ]);
  const manage = can(user, "inventory.manage");
  const counted = items.filter((r) => r.item.kind !== "equipment");
  const here = counted
    .map(({ item }) => ({ item, have: levels.get(item.id)?.get(location.id) ?? 0, par: pars.get(item.id) ?? 0 }))
    .filter((r) => r.have !== 0 || r.par > 0);
  const equipment = assets.filter((a) => a.asset.locationId === location.id && a.asset.status !== "retired" && a.asset.status !== "lost");
  const mine = reports.filter((r) => r.report.locationId === location.id);
  const qr = await qrSvg(origin + locationReportPath(location.reportToken));
  const short = here.filter((r) => r.par > 0 && r.have < r.par).length;

  return (
    <>
      {typeof sp.saved === "string" && saved[sp.saved] && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-brand-green/40 bg-success px-4 py-2.5 text-sm font-medium text-success-foreground"
        >
          {saved[sp.saved]}
          {typeof sp.short === "string" && ` Storage didn't have enough: ${sp.short}.`}
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <RecordType icon={Warehouse}>{locationKinds[location.kind]}</RecordType>
          <h1 className="mt-1.5 flex flex-wrap items-center gap-3 text-3xl font-bold">
            {location.name}
            {location.kind !== "storage" &&
              (short ? (
                <Badge variant="warning">{short} short of kit</Badge>
              ) : here.some((r) => r.par) ? (
                <Badge variant="success">Stocked</Badge>
              ) : null)}
            {!location.isActive && <Badge variant="muted">Inactive</Badge>}
          </h1>
          {manage && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/inventory/locations/${location.id}/count`} className={buttonVariants()}>
                <ClipboardCheck aria-hidden="true" />
                {location.kind === "storage" ? "Count stock" : "Restock"}
              </Link>
              <Link href={`/inventory/labels?location=${location.id}`} className={buttonVariants({ variant: "outline" })}>
                <Printer aria-hidden="true" />
                Print labels
              </Link>
            </div>
          )}
        </div>
        <figure className="grid justify-items-center gap-1 rounded-lg border bg-white p-3 text-center text-black">
          {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG made on the server */}
          <img
            src={`data:image/svg+xml;utf8,${encodeURIComponent(qr)}`}
            alt={`QR code to report a problem in ${location.name}`}
            className="size-32"
          />
          <figcaption className="max-w-40 text-[0.75rem]">
            Cleaners scan this to report something low, out, broken or missing. No sign-in needed.
          </figcaption>
        </figure>
      </div>

      {mine.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Reported here</h2>
          <ReportsInbox reports={mine} fmt={fmt} manage={manage} />
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Supplies here</h2>
        {here.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing here yet.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {here.map(({ item, have, par }) => (
              <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                <Link href={`/inventory/items/${item.id}`} className="hover:text-link">
                  {item.name}
                </Link>
                <span
                  className={cn(
                    "tabular-nums",
                    par > 0 && have < par && (have <= 0 ? "text-destructive" : "text-amber-700 dark:text-amber-400"),
                  )}
                >
                  {plural(have, item.unit)}
                  {par > 0 && <span className="text-muted-foreground"> / {par}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Equipment here ({equipment.length})</h2>
        {equipment.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {equipment.map((a) => (
              <li key={a.asset.id} className="flex flex-wrap items-center gap-x-3 px-4 py-2">
                <Link href={`/inventory/assets/${a.asset.id}`} className={linkClass}>
                  {a.asset.assetTag}
                </Link>
                <span>{a.itemName}</span>
                <Badge variant={assetStatuses[a.asset.status as AssetStatus].variant}>
                  {assetStatuses[a.asset.status as AssetStatus].label}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {manage && (
        <section className="mt-8">
          <h2 className="mb-1 text-lg font-semibold">Kit</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            How many of each should be here.{" "}
            {location.kind === "vehicle" ? "Blank uses the item's “per vehicle” amount." : "Blank means it isn't kept here."}
          </p>
          <ActionForm action={updateLocation.bind(null, location.id)} className="rounded-lg border p-4">
            <input type="hidden" name="action" value="pars" />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {counted.map(({ item }) => (
                <label key={item.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{item.name}</span>
                  <Input
                    name={`par-${item.id}`}
                    inputMode="numeric"
                    defaultValue={
                      pars.has(item.id) && !(location.kind === "vehicle" && pars.get(item.id) === item.vehiclePar) ? pars.get(item.id) : ""
                    }
                    placeholder={location.kind === "vehicle" ? String(item.vehiclePar) : "—"}
                    className="h-8 w-20 tabular-nums"
                  />
                </label>
              ))}
            </div>
            <div>
              <Submit size="sm">Save kit</Submit>
            </div>
          </ActionForm>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Recent activity</h2>
        {movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {movements.map(({ movement: m, itemName, unit, fromName, toName, byName }) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2">
                <span className="w-36 text-muted-foreground">{fmt.stamp(m.createdAt)}</span>
                <span className="font-medium">{movementKinds[m.kind as MovementKind]}</span>
                <span>
                  {plural(m.quantity, unit)} {itemName}
                </span>
                {m.kind === "transfer" && (
                  <span className="text-muted-foreground">{m.fromLocationId === location.id ? `to ${toName}` : `from ${fromName}`}</span>
                )}
                <span className="ml-auto text-[0.75rem] text-muted-foreground">{byName ?? ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {manage && (
        <section className="mt-8 grid gap-4 sm:grid-cols-2">
          {location.kind !== "vehicle" && (
            <ActionForm action={updateLocation.bind(null, location.id)} className="rounded-lg border p-4">
              <input type="hidden" name="action" value="rename" />
              <div className="flex flex-wrap gap-2">
                <Input name="name" defaultValue={location.name} aria-label="Name" className="w-56" />
                <NativeSelect name="isActive" defaultValue={String(location.isActive)} aria-label="Status">
                  <NativeSelectOption value="true">Active</NativeSelectOption>
                  <NativeSelectOption value="false">Inactive</NativeSelectOption>
                </NativeSelect>
                <Submit size="sm" variant="outline">
                  Save
                </Submit>
              </div>
            </ActionForm>
          )}
          <ActionForm action={updateLocation.bind(null, location.id)} className="rounded-lg border p-4">
            <input type="hidden" name="action" value="token" />
            <p className="text-sm text-muted-foreground">
              If a label is lost or the link got out, make a new code. The old one stops working.
            </p>
            <div>
              <Submit size="sm" variant="outline">
                <RefreshCw aria-hidden="true" />
                New QR code
              </Submit>
            </div>
          </ActionForm>
        </section>
      )}
    </>
  );
}

export default function LocationPage(props: PageProps<"/inventory/locations/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <LocationRecord params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}
