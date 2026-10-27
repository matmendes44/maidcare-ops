import Link from "next/link";
import { after } from "next/server";
import { Suspense } from "react";
import { AlertTriangle, CalendarClock, CalendarX, Car, CheckCircle2, ChevronRight, ClipboardCheck, FileText, HandCoins, Package, ReceiptText, Send, UserPlus, Users, Wrench } from "lucide-react";
import { Kpi } from "@/components/charts";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { missedVisits } from "@/lib/appointments/missed";
import { runScheduleAlerts } from "@/lib/recurring/alerts";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import type { Formatters } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { plural, type Tr } from "@/lib/i18n/tr";
import { followUp, isOpen, quoteState } from "@/lib/quotes/status";
import * as q from "@/lib/reports/queries";
import { change } from "@/lib/reports/range";
import { today as getToday } from "@/lib/today";
import { cn } from "cn";
import { addDays } from "./appointments/options";
import { getContractors } from "./contractors/data";
import { operationsChecks, regularsUnbooked, toFinalizeCount, todayVisits, weekAhead, type TodayVisit } from "./dashboard-data";
import { ExpectedActions } from "./appointments/expected-actions";
import { expectedVisits } from "@/lib/recurring/expected";
import { PROMPT_DAYS } from "@/lib/recurring/schedule";
import { getQuotes, quotesToSchedule } from "./finances/estimates/data";
import { getSchedules, spendTotal } from "./finances/expenses/data";
import { getLocations, openReportCount, stockOverview } from "./inventory/data";
import { MiniCalendar, MiniCalendarFallback } from "./mini-calendar";
import { DashboardGrid, type Widget } from "./dashboard-grid";
import { normalizeLayout } from "@/lib/dashboard/layout";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";


// the moment the page is made (live states depend on it)
const currentTime = () => Date.now();

type Attention = { icon: React.ElementType; text: string; sub?: string; href: string; tone: "bad" | "warn" | "info" };

// Where a visit stands right now, from its status and GPS.
function liveState(v: TodayVisit, now: number, tr: Tr, fmt: Formatters) {
  const start = new Date(v.start).getTime();
  const end = new Date(v.end).getTime();
  if (v.status === "completed" || v.departed)
    return { label: v.arrived && v.departed ? tr("Done · {from}–{to}", { from: fmt.time(v.arrived), to: fmt.time(v.departed) }) : tr("Done"), variant: "success" as const };
  if (v.arrived) return { label: tr("On site since {time}", { time: fmt.time(v.arrived) }), variant: "info" as const };
  if (now > end + 3600_000) return { label: tr("Missed"), variant: "destructive" as const };
  if (now > start + 15 * 60_000) return { label: tr("Running late"), variant: "warning" as const };
  return { label: tr("Coming up"), variant: "muted" as const };
}

async function Dashboard() {
  const [user, today, { fmt, tr }] = await Promise.all([getCurrentUser(), getToday(), getI18n()]);
  const money = fmt.moneyWhole;
  // tell staff about visits that were missed (once each), after the page is sent
  // missed visits, recurring visits to book, invoices to finalize: alerts (once each)
  after(() => runScheduleAlerts(today));
  const now = currentTime();
  const monthStart = `${today.slice(0, 7)}-01`;
  const mtd = { from: monthStart, to: today };
  // the same stretch of last month, for comparison
  const lastMonthStart = addDays(monthStart, -1).slice(0, 7) + "-01";
  const lastMtd = { from: lastMonthStart, to: addDays(lastMonthStart, Number(today.slice(8)) - 1) };
  const seeMoney = can(user, "reports.view");
  const seeExpenses = can(user, "expenses.view");
  const seeQuotes = can(user, "quotes.manage");
  const seeInventory = can(user, "inventory.manage");
  const seeContractors = can(user, "contractors.view");

  const [visits, week, checks, missed, vehicles, customers, money1] = await Promise.all([
    todayVisits(today),
    weekAhead(today),
    operationsChecks(),
    missedVisits(20),
    q.maintenanceDue(),
    q.customerCounts(mtd),
    seeMoney
      ? Promise.all([q.collectedTotal(mtd), q.collectedTotal(lastMtd), q.invoicedTotal(mtd), q.outstanding(), q.drafts(), q.recurringRevenue()])
      : Promise.resolve(null),
  ]);
  const [saved] = user ? await db.select({ layout: users.dashboardLayout }).from(users).where(eq(users.id, user.id)) : [];
  const layout = normalizeLayout(saved?.layout);
  const seeFinalize = can(user, "invoices.finalize");
  const [recurringSoon, finalizeCount] = await Promise.all([expectedVisits(today, addDays(today, PROMPT_DAYS)), seeFinalize ? toFinalizeCount() : 0]);
  const [rebook, spent, schedules, quotes, toSchedule, stock, inventoryReports, crew] = await Promise.all([
    checks.regularsUnbooked ? regularsUnbooked(5) : [],
    seeExpenses ? spendTotal(mtd) : null,
    // recurring bills are the owner's (staff only add one-time expenses)
    can(user, "expenses.manage") ? getSchedules(today) : null,
    seeQuotes ? getQuotes() : null,
    seeQuotes ? quotesToSchedule() : null,
    seeInventory ? getLocations().then((l) => stockOverview(today, l)) : null,
    seeInventory ? openReportCount() : null,
    seeContractors ? getContractors(today) : null,
  ]);

  // ---- needs attention ----
  const attention: Attention[] = [];
  if (missed.length) attention.push({ icon: CalendarX, text: plural(tr, missed.length, "{n} missed visit to reschedule", "{n} missed visits to reschedule"), sub: missed.slice(0, 2).map((m) => m.name).join(", "), href: missed.length === 1 ? `/appointments/${missed[0].id}` : "/appointments", tone: "bad" });
  if (checks.lateNow) attention.push({ icon: CalendarClock, text: plural(tr, checks.lateNow, "{n} visit running late right now", "{n} visits running late right now"), href: "/fleet", tone: "warn" });
  if (checks.toComplete && can(user, "appointments.complete")) attention.push({ icon: ClipboardCheck, text: plural(tr, checks.toComplete, "{n} visit done but not marked completed", "{n} visits done but not marked completed"), sub: tr("The crew was there (GPS); mark them completed"), href: "/appointments", tone: "warn" });
  if (recurringSoon.length)
    attention.push({
      icon: CalendarClock,
      text: plural(tr, recurringSoon.length, "{n} recurring visit this week to invoice and book", "{n} recurring visits this week to invoice and book"),
      sub: recurringSoon.slice(0, 3).map((e) => e.name).join(", "),
      href: "#w-recurring",
      tone: recurringSoon.some((e) => e.day <= addDays(today, 2)) ? "bad" : "warn",
    });
  if (finalizeCount) attention.push({ icon: FileText, text: plural(tr, finalizeCount, "{n} completed visit with an invoice to finalize", "{n} completed visits with an invoice to finalize"), sub: tr("Still a draft, or no invoice yet"), href: "/finances?tab=to_finalize", tone: "warn" });
  if (checks.unbookedInvoices) attention.push({ icon: ReceiptText, text: plural(tr, checks.unbookedInvoices, "{n} open invoice with no visit booked", "{n} open invoices with no visit booked"), sub: seeMoney ? tr("{amount} invoiced, waiting to be scheduled", { amount: money(checks.unbookedCents) }) : tr("Waiting to be scheduled"), href: "/finances?tab=open", tone: "info" });
  if (toSchedule) attention.push({ icon: FileText, text: plural(tr, toSchedule, "{n} accepted estimate to schedule", "{n} accepted estimates to schedule"), href: "/finances/estimates?tab=accepted", tone: "info" });
  const followUps = quotes?.filter((x) => followUp(x, today, now)).length ?? 0;
  if (followUps) attention.push({ icon: Send, text: plural(tr, followUps, "{n} estimate to follow up on", "{n} estimates to follow up on"), sub: tr("Not opened, no answer, or expiring soon"), href: "/finances/estimates?tab=sent", tone: "info" });
  if (checks.leadsWaiting) attention.push({ icon: UserPlus, text: plural(tr, checks.leadsWaiting, "{n} new lead without an estimate", "{n} new leads without an estimate"), href: "/leads", tone: "info" });
  if (checks.regularsUnbooked) attention.push({ icon: Users, text: plural(tr, checks.regularsUnbooked, "{n} regular customer with nothing booked", "{n} regular customers with nothing booked"), sub: tr("Cleaned in the last 60 days, nothing in the next 30"), href: "#w-rebook", tone: "info" });
  if (money1 && money1[3].pastDueInvoices) attention.push({ icon: HandCoins, text: plural(tr, money1[3].pastDueInvoices, "{n} past-due invoice", "{n} past-due invoices"), sub: tr("{amount} overdue", { amount: money(money1[3].pastDue) }), href: "/finances?tab=past_due", tone: "bad" });
  if (money1 && money1[4].count) attention.push({ icon: FileText, text: plural(tr, money1[4].count, "{n} draft invoice not sent", "{n} draft invoices not sent"), sub: money(money1[4].cents), href: "/finances?tab=draft", tone: "warn" });
  const lowStock = stock?.filter((s) => s.status !== "ok") ?? [];
  if (lowStock.length) attention.push({ icon: Package, text: plural(tr, lowStock.length, "{n} supply to reorder", "{n} supplies to reorder"), sub: lowStock.slice(0, 3).map((s) => s.name).join(", "), href: "/inventory?tab=supplies", tone: "warn" });
  if (inventoryReports) attention.push({ icon: Package, text: plural(tr, inventoryReports, "{n} inventory report from the crew", "{n} inventory reports from the crew"), href: "/inventory", tone: "info" });
  const vehicleIssues = vehicles.filter((v) => (v.milesLeft != null && v.milesLeft <= 500) || v.milOn || (v.battery && v.battery !== "normal"));
  for (const v of vehicleIssues)
    attention.push({
      icon: Wrench,
      text: `${v.name}: ${[
        v.milesLeft != null && v.milesLeft < 0 ? tr("service overdue") : v.milesLeft != null && v.milesLeft <= 500 ? tr("service in {n} mi", { n: v.milesLeft }) : null,
        v.milOn ? tr("check engine light") : null,
        v.battery && v.battery !== "normal" ? tr("battery {state}", { state: tr(v.battery) }) : null,
      ]
        .filter(Boolean)
        .join(", ")}`,
      href: "/fleet?tab=maintenance",
      tone: v.milOn || (v.milesLeft != null && v.milesLeft < 0) ? "bad" : "warn",
    });
  const owed = crew?.filter((c) => c.owed > 0) ?? [];
  if (owed.length) attention.push({ icon: HandCoins, text: plural(tr, owed.length, "{n} contractor to pay", "{n} contractors to pay"), sub: tr("{amount} owed for days worked", { amount: money(owed.reduce((s, c) => s + c.owed, 0)) }), href: "/contractors", tone: "info" });
  const billsDue = schedules?.filter((s) => s.status.state === "due" || s.status.state === "overdue") ?? [];
  if (billsDue.length) attention.push({ icon: ReceiptText, text: plural(tr, billsDue.length, "{n} recurring bill due", "{n} recurring bills due"), sub: billsDue.slice(0, 3).map((s) => s.vendorName).join(", "), href: "/finances/expenses?tab=recurring", tone: billsDue.some((s) => s.status.state === "overdue") ? "bad" : "warn" });

  // ---- today ----
  const done = visits.filter((v) => v.status === "completed" || v.departed).length;
  const onSite = visits.filter((v) => v.arrived && !v.departed && v.status !== "completed").length;
  const todayInvoiced = visits.reduce((s, v) => s + (v.invoicedCents ?? 0), 0);
  const maxVisits = Math.max(1, ...week.map((d) => d.visits));
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i + 1));

  // ---- pipeline ----
  const openQuotes = quotes?.filter((x) => isOpen(quoteState(x, today))) ?? [];
  const since90 = addDays(today, -90);
  const decided = quotes?.filter((x) => x.sentAt && x.sentAt.slice(0, 10) >= since90 && ["accepted", "scheduled", "declined", "expired"].includes(quoteState(x, today))) ?? [];
  const won = decided.filter((x) => ["accepted", "scheduled"].includes(quoteState(x, today))).length;

  const hour = Number(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }));
  const greeting = hour < 12 ? tr("Good morning") : hour < 17 ? tr("Good afternoon") : tr("Good evening");

  // each widget's contents; the grid places them as the user arranged them
  const widgets: Widget[] = [
    {
      id: "attention",
      title: tr("Needs attention"),
      action: attention.length > 0 && <Badge variant="warning">{attention.length}</Badge>,
      body:
        attention.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-brand-green" aria-hidden="true" />
            {tr("All caught up.")}
          </p>
        ) : (
          <ul className="-mx-2 grid grid-cols-[minmax(0,1fr)]">
            {attention.map((a, i) => (
              <li key={i}>
                <Link href={a.href} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-secondary">
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", a.tone === "bad" ? "bg-destructive/10 text-destructive" : a.tone === "warn" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-brand-blue/10 text-brand-blue")}>
                    <a.icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm font-medium">{a.text}</span>
                    {a.sub && <span className="block truncate text-[0.8rem] text-muted-foreground">{a.sub}</span>}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ),
    },
    {
      id: "today",
      title: tr("Today"),
      action: (
        <Link href={`/appointments?view=day&date=${today}`} className="text-sm text-link hover:underline">
          {tr("Calendar")}
        </Link>
      ),
      body:
        visits.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr("Nothing booked today.")}</p>
        ) : (
          <>
            <p className="mb-2 text-[0.8rem] text-muted-foreground">
              {tr("{done} done · {onSite} on site · {left} to go", { done, onSite, left: visits.length - done - onSite })}
              {seeMoney && todayInvoiced > 0 && ` · ${tr("{amount} invoiced", { amount: money(todayInvoiced) })}`}
            </p>
            <ol className="-mx-2 grid grid-cols-[minmax(0,1fr)]">
              {visits.map((v) => {
                const s = liveState(v, now, tr, fmt);
                return (
                  <li key={v.id}>
                    <Link href={`/appointments/${v.id}`} className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2 rounded-lg px-2 py-2 hover:bg-secondary">
                      <span className="text-sm font-semibold tabular-nums">{fmt.time(v.start)}</span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="truncate text-sm font-medium">{v.name}</span>
                          <Badge variant={s.variant}>{s.label}</Badge>
                        </span>
                        <span className="block truncate text-[0.8rem] text-muted-foreground">
                          {v.street}
                          {v.crew && ` · ${v.crew}`}
                          {v.vehicles && ` · ${v.vehicles}`}
                          {seeMoney && v.invoicedCents != null && ` · ${money(v.invoicedCents)}`}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </>
        ),
    },
    {
      id: "recurring",
      title: tr("Recurring visits to book"),
      action: (
        <Link href={`/appointments?view=week&date=${today}`} className="text-sm text-link hover:underline">
          {tr("Calendar")}
        </Link>
      ),
      body:
        recurringSoon.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr("Nothing to book this week: every recurring visit is booked.")}</p>
        ) : (
          <ul className="-mx-2 grid grid-cols-[minmax(0,1fr)]">
            {recurringSoon.map((e) => (
              <li key={`${e.memorizedId}-${e.day}`} className={cn("flex items-center gap-3 rounded-lg px-2 py-2", e.day <= addDays(today, 2) && "bg-destructive/5")}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{e.name}</span>
                  <span className="block text-[0.75rem] text-muted-foreground">
                    {fmt.shortDay(e.day)} · {fmt.clock(e.start)}
                    {seeMoney && ` · ${money(e.totalCents)}`}
                  </span>
                </span>
                <ExpectedActions memorizedId={e.memorizedId} day={e.day} start={e.start} end={e.end} compact />
              </li>
            ))}
          </ul>
        ),
    },
    {
      id: "week",
      title: tr("Next 7 days"),
      body: (
        <ul className="grid gap-1">
          {days.map((d) => {
            const w = week.find((x) => x.day === d);
            return (
              <li key={d}>
                <Link href={`/appointments?view=day&date=${d}`} className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-1 py-1 text-sm hover:bg-secondary">
                  <span className="text-muted-foreground">{fmt.shortDay(d)}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-secondary">
                    <span className="block h-full rounded-full bg-brand-blue" style={{ width: `${((w?.visits ?? 0) / maxVisits) * 100}%` }} />
                  </span>
                  <span className="text-right text-[0.75rem] text-muted-foreground tabular-nums">{w ? `${w.visits} · ${w.hours.toFixed(1)} h` : "—"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ),
    },
    ...(money1
      ? [
          {
            id: "money" as const,
            title: tr("This month"),
            action: (
              <Link href="/reports?tab=money" className="text-sm text-link hover:underline">
                {tr("Reports")}
              </Link>
            ),
            body: (
              <div className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
                <Kpi label={tr("Collected")} value={money(money1[0].cents)} change={change(money1[0].cents, money1[1].cents)} sub={tr("vs same days last month")} />
                <Kpi label={tr("Invoiced")} value={money(money1[2].cents)} sub={plural(tr, money1[2].invoices, "{n} invoice", "{n} invoices")} />
                <Kpi
                  label={tr("Outstanding")}
                  value={money(money1[3].total)}
                  sub={money1[3].pastDue ? tr("{amount} past due", { amount: money(money1[3].pastDue) }) : plural(tr, money1[3].invoices, "{n} open invoice", "{n} open invoices")}
                  tone={money1[3].pastDue ? "bad" : undefined}
                  href="/finances?tab=open"
                />
                {spent ? (
                  <Kpi
                    label={tr("Collected − spent")}
                    value={money(money1[0].cents - spent.cents)}
                    sub={tr("{amount} spent", { amount: money(spent.cents) })}
                    tone={money1[0].cents - spent.cents < 0 ? "bad" : undefined}
                    href="/finances/expenses"
                  />
                ) : (
                  <Kpi label={tr("Recurring revenue")} value={money(money1[5].monthlyCents)} sub={tr("a month, from recurring invoices")} />
                )}
              </div>
            ),
          },
        ]
      : []),
    {
      id: "sales",
      title: tr("Customers and sales"),
      body: (
        <div className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
          <Kpi label={tr("Active customers")} value={String(customers.active)} sub={tr("{added} new · {lost} lost this month", { added: customers.added, lost: customers.lost })} href="/customers" />
          <Kpi label={tr("Leads")} value={String(customers.leads)} sub={tr("{n} added this month", { n: customers.created - customers.created_converted })} href="/leads" />
          {quotes && (
            <>
              <Kpi
                label={tr("Open estimates")}
                value={String(openQuotes.length)}
                sub={tr("{amount} waiting", { amount: money(openQuotes.reduce((s, x) => s + (x.content.options[0]?.priceCents ?? 0), 0)) })}
                href="/finances/estimates?tab=sent"
              />
              <Kpi
                label={tr("Win rate (90 days)")}
                value={decided.length ? `${Math.round((won / decided.length) * 100)}%` : "—"}
                sub={decided.length ? tr("{won} of {decided} decided", { won, decided: decided.length }) : tr("No answers yet")}
                href="/reports?tab=estimates"
              />
            </>
          )}
        </div>
      ),
    },
    {
      id: "rebook",
      title: tr("Rebook these regulars"),
      body:
        rebook.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tr("Every regular customer has a visit booked in the next 30 days.")}</p>
        ) : (
          <ul className="-mx-2 grid grid-cols-[minmax(0,1fr)]">
            {rebook.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-secondary">
                <Link href={`/customers/${c.id}`} className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.name}</span>
                  <span className="block text-[0.75rem] text-muted-foreground">{tr("Last cleaned {date}", { date: fmt.calendarDate(c.last.slice(0, 10)) })}</span>
                </Link>
                <Link href={`/appointments/new?customer=${c.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  {tr("Book")}
                </Link>
              </li>
            ))}
          </ul>
        ),
    },
    {
      id: "calendar",
      title: tr("Calendar"),
      body: (
        <Suspense fallback={<MiniCalendarFallback />}>
          <MiniCalendar bare />
        </Suspense>
      ),
    },
    {
      id: "shortcuts",
      title: tr("Shortcuts"),
      body: (
        <div className="grid grid-cols-2 gap-2">
          <Link href="/appointments/new" className={buttonVariants({ variant: "outline", className: "justify-start" })}>
            <CalendarClock aria-hidden="true" />
            {tr("Book a visit")}
          </Link>
          {seeQuotes && (
            <Link href="/finances/estimates/quick" className={buttonVariants({ variant: "outline", className: "justify-start" })}>
              <FileText aria-hidden="true" />
              {tr("Estimate")}
            </Link>
          )}
          <Link href="/customers/new?lead=1" className={buttonVariants({ variant: "outline", className: "justify-start" })}>
            <UserPlus aria-hidden="true" />
            {tr("New lead")}
          </Link>
          {can(user, "invoices.create") && (
            <Link href="/finances/invoices/new" className={buttonVariants({ variant: "outline", className: "justify-start" })}>
              <ReceiptText aria-hidden="true" />
              {tr("Invoice")}
            </Link>
          )}
          <Link href="/fleet" className={buttonVariants({ variant: "outline", className: "justify-start" })}>
            <Car aria-hidden="true" />
            {tr("Fleet")}
          </Link>
          <Link href="/reports" className={buttonVariants({ variant: "outline", className: "justify-start" })}>
            <AlertTriangle aria-hidden="true" />
            {tr("Reports")}
          </Link>
        </div>
      ),
    },
  ];

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">
          {greeting}
          {user?.name ? `, ${user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {fmt.fullDay(today)} · {visits.length ? plural(tr, visits.length, "{n} visit today", "{n} visits today") : tr("No visits today")}
        </p>
      </div>
      <DashboardGrid widgets={widgets} initial={layout} />
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Dashboard />
    </Suspense>
  );
}
