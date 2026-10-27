import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import { today } from "@/lib/today";
import { addDays } from "../../../appointments/options";
import { NoAccess } from "../../../finances/no-access";
import { assignVisits } from "../../actions";
import { getContractor, parseContractorId, visitsToAssign } from "../../data";
import { AssignForm } from "./assign-form";

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Completed visits from before contractors were tracked, to say who worked them.
async function AssignVisits({ params, searchParams }: Pick<PageProps<"/contractors/[id]/visits">, "params" | "searchParams">) {
  if (!can(await getCurrentUser(), "contractors.manage")) return <NoAccess what="this page" />;
  const id = parseContractorId((await params).id);
  const c = id === null ? null : await getContractor(id);
  if (!c) notFound();
  const [sp, day, { fmt }] = await Promise.all([searchParams, today(), getI18n()]);
  const from = isDay(sp.from) ? sp.from : addDays(day, -30);
  const to = isDay(sp.to) ? sp.to : day;
  const visits = await visitsToAssign(c.id, { from, to });
  return (
    <>
      <Link href={`/contractors/${c.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {c.firstName} {c.lastName}
      </Link>
      <h1 className="text-3xl font-bold">Add past visits</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Tick the completed visits {c.firstName} worked. Their days worked and pay update to match. New appointments already ask who&apos;s cleaning.
      </p>
      <form method="get" className="my-5 flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={from} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={to} />
        </div>
        <button type="submit" className={buttonVariants({ variant: "outline" })}>
          Show visits
        </button>
      </form>
      {visits.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No completed visits without {c.firstName} in these dates.</p>
      ) : (
        <AssignForm
          action={assignVisits.bind(null, c.id)}
          visits={visits.map((v) => ({
            id: v.id,
            dayLabel: fmt.calendarDate(v.day),
            time: fmt.timeRange(v.start, v.end),
            customerName: v.customerName,
            address: v.address,
            price: v.priceCents ? fmt.money(v.priceCents) : "Not invoiced",
            crew: v.crew,
          }))}
        />
      )}
    </>
  );
}

export default function AssignVisitsPage(props: PageProps<"/contractors/[id]/visits">) {
  return (
    <div className="max-w-4xl">
      <Suspense fallback={<PageLoading />}>
        <AssignVisits params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
