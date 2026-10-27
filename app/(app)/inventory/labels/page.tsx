import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { assetReportPath, locationReportPath, qrSvg, siteOrigin } from "@/lib/inventory/qr";
import { PrintButton } from "../../finances/expenses/report/print-button";
import { getAssets, getLocations } from "../data";

// Printable QR labels: one for each vehicle and storage (stick it inside),
// one for each piece of equipment. Scanning opens the report form.
async function Labels({ searchParams }: Pick<PageProps<"/inventory/labels">, "searchParams">) {
  const sp = await searchParams;
  const only = typeof sp.location === "string" ? Number(sp.location) : null;
  const [origin, locations, assets] = await Promise.all([siteOrigin(), getLocations(), getAssets()]);
  const places = locations.filter((l) => l.isActive && (!only || l.id === only));
  const equipment = assets.filter((a) => a.asset.status !== "retired" && a.asset.status !== "lost" && (!only || a.asset.locationId === only));
  const labels = [
    ...(await Promise.all(places.map(async (l) => ({ key: `l${l.id}`, title: l.name, sub: "Running low? Broken? Scan to tell the office.", svg: await qrSvg(origin + locationReportPath(l.reportToken)) })))),
    ...(await Promise.all(equipment.map(async (a) => ({ key: `a${a.asset.id}`, title: `${a.asset.assetTag} · ${a.itemName}`, sub: "Broken or missing? Scan to report.", svg: await qrSvg(origin + assetReportPath(a.asset.reportToken)) })))),
  ];
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/inventory?tab=locations" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Locations
        </Link>
        <PrintButton />
      </div>
      <h1 className="mb-1 text-2xl font-bold print:hidden">QR labels</h1>
      <p className="mb-6 text-sm text-muted-foreground print:hidden">Print on sticker paper. Each code only lets someone report a problem for that place or item; make a new one from its page if a label is lost.</p>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3 print:gap-3">
        {labels.map((l) => (
          <li key={l.key} className="grid break-inside-avoid justify-items-center gap-1 rounded-lg border border-dashed bg-white p-3 text-center text-black">
            {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG made on the server */}
            <img src={`data:image/svg+xml;utf8,${encodeURIComponent(l.svg)}`} alt={`QR code: ${l.title}`} className="size-32" />
            <span className="text-sm font-semibold">{l.title}</span>
            <span className="text-[0.7rem]">{l.sub}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function LabelsPage(props: PageProps<"/inventory/labels">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Labels searchParams={props.searchParams} />
    </Suspense>
  );
}
