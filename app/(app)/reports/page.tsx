import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChartColumn } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { cn } from "cn";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import { presetLabels, resolveRange } from "@/lib/reports/range";
import { today as getToday } from "@/lib/today";
import { Customers } from "./customers-tab";
import { Estimates } from "./estimates-tab";
import { Fleet } from "./fleet-tab";
import { Money } from "./money";
import { Operations } from "./operations";
import { Overview } from "./overview";
import { Pricing } from "./pricing";
import { RangePicker, rangeQuery, tabLabels, tabs, type Tab } from "./shared";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function ReportsPage({ searchParams }: Pick<PageProps<"/reports">, "searchParams">) {
  const user = await requireUser();
  // as if the page didn't exist for anyone who can't see reports
  if (!can(user, "reports.view")) notFound();
  const [params, today, { fmt, tr }] = await Promise.all([searchParams, getToday(), getI18n()]);
  const raw = one(params.tab) as Tab;
  const tab: Tab = tabs.includes(raw) ? raw : "overview";
  const range = resolveRange({ range: one(params.range), from: one(params.from), to: one(params.to) }, today);
  const rq = rangeQuery(range);

  return (
    <>
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <ChartColumn className="size-7 text-brand-blue" aria-hidden="true" />
          {tr("Reports")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tr(presetLabels[range.preset])}: {fmt.calendarDate(range.from)} – {fmt.calendarDate(range.to)}. {tr("Changes are compared with the same number of days before.")}
        </p>
      </div>
      <div className="mb-4">
        <RangePicker tab={tab} range={range} />
      </div>
      <nav aria-label={tr("Report sections")} className="mb-5 flex gap-1 overflow-x-auto border-b">
        {tabs.map((t) => (
          <Link
            key={t}
            href={`/reports?tab=${t}&${rq}`}
            aria-current={tab === t ? "page" : undefined}
            className={cn(
              "relative flex shrink-0 items-center px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground",
              "after:absolute after:inset-x-2 after:-bottom-px after:h-[3px] after:rounded-full",
              tab === t && "text-foreground after:bg-brand-green",
            )}
          >
            {tr(tabLabels[t])}
          </Link>
        ))}
      </nav>
      {tab === "overview" && <Overview range={range} />}
      {tab === "money" && <Money range={range} />}
      {tab === "customers" && <Customers range={range} />}
      {tab === "estimates" && <Estimates range={range} />}
      {tab === "operations" && <Operations range={range} fmt={fmt} />}
      {tab === "pricing" && <Pricing range={range} />}
      {tab === "fleet" && <Fleet range={range} />}
    </>
  );
}

export default function Page(props: PageProps<"/reports">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ReportsPage searchParams={props.searchParams} />
    </Suspense>
  );
}
