import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { NoAccess } from "../../../../finances/no-access";
import { submitCount } from "../../../actions";
import { getItems, getLocation, getLocations, parseId, parsFor, stockLevels } from "../../../data";
import { CountForm } from "./count-form";

async function Count({ params }: Pick<PageProps<"/inventory/locations/[id]/count">, "params">) {
  if (!can(await getCurrentUser(), "inventory.manage")) return <NoAccess what="this page" />;
  const id = parseId((await params).id);
  const location = id === null ? null : await getLocation(id);
  if (!location) notFound();
  const [items, levels, pars, locations] = await Promise.all([getItems(), stockLevels(), parsFor(location), getLocations()]);
  const restock = location.kind !== "storage";
  const sources = locations.filter((l) => l.kind === "storage" && l.isActive);
  // the kit first, then anything else that's there
  const rows = items
    .filter((r) => r.item.kind !== "equipment")
    .map(({ item }) => ({
      id: item.id,
      name: item.name,
      unit: item.unit,
      kind: item.kind,
      expected: levels.get(item.id)?.get(location.id) ?? 0,
      par: pars.get(item.id) ?? 0,
      inSource: Object.fromEntries(sources.map((s) => [s.id, levels.get(item.id)?.get(s.id) ?? 0])),
    }))
    .filter((r) => !restock || r.par > 0 || r.expected !== 0)
    .sort((a, b) => Number(b.par > 0) - Number(a.par > 0) || a.name.localeCompare(b.name));
  return (
    <>
      <Link href={`/inventory/locations/${location.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {location.name}
      </Link>
      <h1 className="text-3xl font-bold">{restock ? `Restock ${location.name}` : `Count ${location.name}`}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {restock ? "Count what's in it now, then load it back up to its kit. What's gone since last time is recorded as used." : "Count what's on the shelves. Differences are recorded so the numbers match reality."}
      </p>
      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {restock ? (
            <>
              No kit set for this {location.kind === "vehicle" ? "vehicle" : "site"} yet. Set &ldquo;Per vehicle&rdquo; on items, or the kit on{" "}
              <Link href={`/inventory/locations/${location.id}`} className="text-link hover:underline">
                its page
              </Link>
              .
            </>
          ) : (
            "No supplies yet."
          )}
        </p>
      ) : (
        <CountForm action={submitCount.bind(null, location.id)} rows={rows} restock={restock} sources={sources} cancelHref={`/inventory/locations/${location.id}`} />
      )}
    </>
  );
}

export default function CountPage(props: PageProps<"/inventory/locations/[id]/count">) {
  return (
    <div className="max-w-4xl">
      <Suspense fallback={<PageLoading />}>
        <Count params={props.params} />
      </Suspense>
    </div>
  );
}
