import Link from "next/link";
import { Suspense } from "react";
import { Megaphone, PackagePlus, Plus, Truck } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { today } from "@/lib/today";
import { getLocations } from "./data";
import { Equipment } from "./equipment";
import { LocationsTab } from "./locations-tab";
import { Overview } from "./overview";
import { Supplies } from "./supplies";
import { Usage } from "./usage";

const tabs = { overview: "Overview", supplies: "Supplies", equipment: "Equipment", usage: "Usage", locations: "Locations" } as const;
type Tab = keyof typeof tabs;
const notices: Record<string, string> = { received: "Delivery received: stock and the expense are saved." };

async function Inventory({ searchParams }: Pick<PageProps<"/inventory">, "searchParams">) {
  const [params, user, day] = await Promise.all([searchParams, getCurrentUser(), today()]);
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const tab: Tab = (one("tab") ?? "") in tabs ? (one("tab") as Tab) : "overview";
  const manage = can(user, "inventory.manage");
  // costs and values come from expenses
  const seeCosts = can(user, "expenses.view");
  const locations = await getLocations();

  return (
    <>
      {one("saved") && notices[one("saved")!] && (
        <p role="status" className="mb-4 rounded-lg border border-brand-green/40 bg-success px-4 py-2.5 text-sm font-medium text-success-foreground">
          {notices[one("saved")!]}
        </p>
      )}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Inventory</h1>
          <p className="mt-1 text-sm text-muted-foreground">Supplies, equipment, vehicle load-outs and what&apos;s being used.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/inventory/report" className={buttonVariants({ variant: "outline" })}>
            <Megaphone aria-hidden="true" />
            Report a problem
          </Link>
          {manage && (
            <>
              <Link href="/inventory/receive" className={buttonVariants({ variant: "outline" })}>
                <Truck aria-hidden="true" />
                Receive stock
              </Link>
              <Link href="/inventory/assets/new" className={buttonVariants({ variant: "outline" })}>
                <PackagePlus aria-hidden="true" />
                Add equipment
              </Link>
              <Link href="/inventory/items/new" className={buttonVariants()}>
                <Plus aria-hidden="true" />
                Add item
              </Link>
            </>
          )}
        </div>
      </div>
      <nav aria-label="Inventory views" className="mb-6 flex gap-1 overflow-x-auto border-b">
        {(Object.keys(tabs) as Tab[]).map((t) => (
          <Link
            key={t}
            href={t === "overview" ? "/inventory" : `/inventory?tab=${t}`}
            aria-current={tab === t ? "page" : undefined}
            className={cn(
              "relative flex shrink-0 items-center px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground",
              "after:absolute after:inset-x-2 after:-bottom-px after:h-[3px] after:rounded-full",
              tab === t && "text-foreground after:bg-brand-green",
            )}
          >
            {tabs[t]}
          </Link>
        ))}
      </nav>
      {tab === "overview" && <Overview today={day} locations={locations} manage={manage} seeCosts={seeCosts} />}
      {tab === "supplies" && <Supplies today={day} locations={locations} category={one("category")} show={one("show")} seeCosts={seeCosts} />}
      {tab === "equipment" && <Equipment today={day} seeCosts={seeCosts} showRetired={one("retired") === "1"} />}
      {tab === "usage" && <Usage today={day} days={one("days") === "90" ? 90 : one("days") === "365" ? 365 : 30} locations={locations} seeCosts={seeCosts} />}
      {tab === "locations" && <LocationsTab locations={locations} manage={manage} />}
    </>
  );
}

export default function InventoryPage(props: PageProps<"/inventory">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Inventory searchParams={props.searchParams} />
    </Suspense>
  );
}
