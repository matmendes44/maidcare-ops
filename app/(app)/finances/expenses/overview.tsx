import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CalendarClock } from "lucide-react";
import { BarChart, Donut, HBars, Kpi, LineChart, chartColors } from "@/components/charts";
import { cn } from "cn";
import { categoryLabel, frequencies, paidWith } from "@/lib/expenses/options";
import { dueDates, expectedByMonth, yearlyCost } from "@/lib/expenses/recurring";
import { collectedByMonth } from "@/lib/reports/queries";
import { addDays, change, daysIn, monthLabel, monthsBetween, presetLabels, previousRange, type Preset, type Range } from "@/lib/reports/range";
import { getI18n } from "@/lib/i18n/server";
import { plural } from "@/lib/i18n/tr";
import { moneyShort, Section } from "../../reports/shared";
import { getSchedules, oneTimePerDay, spendByCategory, spendByDay, spendByMethod, spendByMonth, spendTotal, topVendors } from "./data";

// Colors for categories in the ring, in order of size.
const PALETTE = ["#3174e7", "#63ae33", "#d97706", "#8b5cf6", "#0891b2", "#db2777", "#65a30d", "#ea580c", "#475569", "#a16207"];
const ranges: Preset[] = ["month", "last-month", "3m", "ytd", "12m", "all"];

const monthEnd = (ym: string) => addDays(`${nextMonth(ym)}-01`, -1);
const nextMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

export async function Overview({ range, today, trend, showIncome, manage }: { range: Range; today: string; trend?: string; showIncome: boolean; manage: boolean }) {
  const { tr, fmt, locale } = await getI18n();
  const money = fmt.money;
  const month = (ym: string) => monthLabel(ym, locale);
  const prev = previousRange(range);
  const thisMonth = today.slice(0, 7);
  const monthStart = `${thisMonth}-01`;
  const window = { from: `${shiftMonth(thisMonth, -5)}-01`, to: today };
  const trendMonths = trend === "3" ? 3 : trend === "12" ? 12 : 6;
  const trendSpan = { from: `${shiftMonth(thisMonth, -(trendMonths - 1))}-01`, to: today };

  const [total, prevTotal, byCategory, prevByCategory, vendors, byMethod, schedules, monthly, mtdDays, perDay, trendSpend, income] = await Promise.all([
    spendTotal(range),
    spendTotal(prev),
    spendByCategory(range),
    spendByCategory(prev),
    topVendors(range),
    spendByMethod(range),
    getSchedules(today),
    spendByMonth(window),
    spendByDay({ from: monthStart, to: today }),
    oneTimePerDay({ from: addDays(today, -89), to: today }, 90),
    spendByMonth(trendSpan),
    showIncome ? collectedByMonth(trendSpan) : Promise.resolve([]),
  ]);

  const active = schedules.filter((s) => !s.ended);
  const monthlyRecurring = active.reduce((sum, s) => sum + yearlyCost(s) / 12, 0);

  // ---- this month: running total vs expected ----
  const lastDay = monthEnd(thisMonth);
  const days = Array.from({ length: Number(lastDay.slice(8)) }, (_, i) => addDays(monthStart, i));
  const dueThisMonth = active.flatMap((s) => dueDates(s, monthStart, lastDay).map((d) => ({ day: d, cents: s.amountCents })));
  let running = 0;
  const actualRunning = days.map((d) => {
    if (d > today) return null;
    running += mtdDays.find((x) => x.day === d)?.cents ?? 0;
    return running;
  });
  const expectedRunning = days.map((d, i) => dueThisMonth.filter((x) => x.day <= d).reduce((s, x) => s + x.cents, 0) + perDay * (i + 1));
  const spentThisMonth = running;
  const expectedThisMonth = expectedRunning.at(-1) ?? 0;
  const expectedSoFar = expectedRunning[days.indexOf(today)] ?? 0;

  // ---- expected vs actual, 6 months back and 3 ahead ----
  const months = Array.from({ length: 10 }, (_, i) => shiftMonth(thisMonth, i - 5));
  const recurringExpected = expectedByMonth(schedules, months);
  const expected = months.map((m, i) => Math.round(recurringExpected[i] + perDay * Number(monthEnd(m).slice(8))));
  const actual = months.map((m) => (m > thisMonth ? 0 : (monthly.find((x) => x.month === m)?.cents ?? 0)));

  // ---- income vs expenses ----
  const tMonths = monthsBetween(trendSpan.from, trendSpan.to);
  const incomeBy = tMonths.map((m) => income.find((x) => x.month === m)?.cents ?? 0);
  const spendBy = tMonths.map((m) => trendSpend.find((x) => x.month === m)?.cents ?? 0);
  const incomeTotal = incomeBy.reduce((a, b) => a + b, 0);
  const spendTotalTrend = spendBy.reduce((a, b) => a + b, 0);

  // ---- where spending grew ----
  const growth = byCategory
    .map((c) => ({ category: c.category, now: c.cents, before: prevByCategory.find((p) => p.category === c.category)?.cents ?? 0 }))
    .map((c) => ({ ...c, diff: c.now - c.before }))
    .filter((c) => c.diff > 0)
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 4);
  const subscriptions = [...active].sort((a, b) => yearlyCost(b) - yearlyCost(a)).slice(0, 5);

  // ---- coming up in the next 30 days ----
  const soon = addDays(today, 30);
  const coming = active
    .flatMap((s) => {
      const items: { s: typeof s; day: string; late: boolean }[] = [];
      if ((s.status.state === "due" || s.status.state === "overdue") && s.status.dueDate) items.push({ s, day: s.status.dueDate, late: s.status.state === "overdue" });
      if (s.status.nextDue && s.status.nextDue <= soon && s.status.nextDue !== s.status.dueDate) items.push({ s, day: s.status.nextDue, late: false });
      else if (s.status.state === "upcoming" && s.status.dueDate && s.status.dueDate <= soon && !items.length) items.push({ s, day: s.status.dueDate, late: false });
      return items;
    })
    .sort((a, b) => a.day.localeCompare(b.day));
  const comingTotal = coming.reduce((sum, c) => sum + c.s.amountCents, 0);

  const rangeHref = (p: Preset) => `/finances/expenses?range=${p}`;
  const listHref = (extra: string) => `/finances/expenses?tab=list&from=${range.from}&to=${range.to}${extra}`;

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center gap-1.5 text-sm" role="group" aria-label={tr("Period")}>
        {ranges.map((p) => (
          <Link
            key={p}
            href={rangeHref(p)}
            aria-current={range.preset === p ? "true" : undefined}
            className={cn("rounded-md border px-2.5 py-1", range.preset === p ? "border-brand-blue bg-brand-blue/10 font-medium" : "text-muted-foreground hover:bg-secondary")}
          >
            {tr(presetLabels[p])}
          </Link>
        ))}
        <span className="ml-1 text-muted-foreground">
          {range.from} – {range.to}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label={tr("Spent · {period}", { period: tr(presetLabels[range.preset]).toLowerCase() })}
          value={money(total.cents)}
          change={change(total.cents, prevTotal.cents)}
          goodWhen="down"
          sub={plural(tr, total.count, "{n} expense", "{n} expenses")}
          href={listHref("")}
        />
        <Kpi
          label={tr("This month so far")}
          value={money(spentThisMonth)}
          sub={tr("expected about {amount} by month end", { amount: money(expectedThisMonth) })}
          tone={spentThisMonth > expectedSoFar * 1.15 && spentThisMonth > 0 ? "warn" : undefined}
        />
        <Kpi label={tr("Recurring, per month")} value={money(Math.round(monthlyRecurring))} sub={tr("{n} recurring · {amount} a year", { n: active.length, amount: money(Math.round(monthlyRecurring * 12)) })} href="/finances/expenses?tab=recurring" />
        <Kpi label={tr("Missing receipts")} value={String(total.missing)} sub={tr("in this period")} tone={total.missing > 0 ? "warn" : undefined} href={listHref("&receipt=missing")} />
      </div>

      {coming.length > 0 && (
        <Section title={tr("Coming up")} text={tr("Recurring expenses due or overdue, and due in the next 30 days · {amount}", { amount: money(comingTotal) })}>
          <ul className="divide-y rounded-lg border">
            {coming.slice(0, 8).map(({ s, day, late }) => (
              <li key={`${s.id}-${day}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                {late ? <AlertTriangle className="size-4 text-destructive" aria-hidden="true" /> : <CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />}
                <span className={cn("w-28 tabular-nums", late && "font-medium text-destructive")}>{fmt.calendarDate(day)}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{s.vendorName}</span>
                <span className="text-muted-foreground">{tr(frequencies[s.frequency])}</span>
                <span className="w-24 text-right tabular-nums">
                  {s.amountVaries && "~"}
                  {money(s.amountCents)}
                </span>
                {manage && (
                  <Link href={`/finances/expenses/new?recurring=${s.id}&due=${day}`} className="text-link underline-offset-4 hover:underline">
                    {tr("Record")}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={tr("This month, as it happens")} text={tr("Running total of what's been spent, against what's expected: recurring bills on their due dates plus your usual day-to-day spending (last 90 days).")}>
        <LineChart
          label={tr("Spending this month against expected")}
          categories={days.map((d) => String(Number(d.slice(8))))}
          series={[
            { name: tr("Spent so far"), values: actualRunning, color: chartColors.blue },
            { name: tr("Expected"), values: expectedRunning.map(Math.round), color: chartColors.gray, dashed: true },
          ]}
          format={moneyShort}
          markIndex={days.indexOf(today)}
        />
      </Section>

      <Section title={tr("Expected vs actual")} text={tr("Each month's spending against what was expected. The next three months are the forecast.")}>
        <BarChart
          label={tr("Expected and actual spending by month")}
          categories={months.map((m) => (m > thisMonth ? `${month(m)}*` : month(m)))}
          series={[
            { name: tr("Actual"), values: actual, color: chartColors.blue },
            { name: tr("Expected"), values: expected, color: chartColors.gray },
          ]}
          format={moneyShort}
        />
      </Section>

      {showIncome && (
        <Section
          title={tr("Income vs expenses")}
          text={
            <span className="inline-flex flex-wrap items-center gap-1.5">
              {tr("Money collected against money spent, by month.")}
              {[3, 6, 12].map((n) => (
                <Link
                  key={n}
                  href={`/finances/expenses?range=${range.preset}&trend=${n}`}
                  aria-current={trendMonths === n ? "true" : undefined}
                  className={cn("rounded border px-1.5 text-[0.8rem]", trendMonths === n ? "border-brand-blue bg-brand-blue/10 text-foreground" : "hover:bg-secondary")}
                >
                  {tr("{n} months", { n })}
                </Link>
              ))}
            </span>
          }
        >
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <Kpi label={tr("Collected")} value={money(incomeTotal)} />
            <Kpi label={tr("Spent")} value={money(spendTotalTrend)} />
            <Kpi label={tr("Net")} value={money(incomeTotal - spendTotalTrend)} tone={incomeTotal - spendTotalTrend < 0 ? "bad" : undefined} />
            <Kpi label={tr("Margin")} value={incomeTotal ? `${Math.round(((incomeTotal - spendTotalTrend) / incomeTotal) * 100)}%` : "—"} sub={tr("net ÷ collected")} />
          </div>
          <BarChart
            label={tr("Income and expenses by month")}
            categories={tMonths.map(month)}
            series={[
              { name: tr("Collected"), values: incomeBy, color: chartColors.green },
              { name: tr("Spent"), values: spendBy, color: chartColors.red },
            ]}
            format={moneyShort}
          />
          <div className="mt-4">
            <LineChart label={tr("Net by month")} categories={tMonths.map(month)} series={[{ name: tr("Net (collected − spent)"), values: tMonths.map((_, i) => incomeBy[i] - spendBy[i]), color: chartColors.blue }]} format={moneyShort} height={170} />
          </div>
        </Section>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title={tr("By category")}>
          <Donut
            slices={byCategory.map((c, i) => ({ label: tr(categoryLabel(c.category)), value: c.cents, color: PALETTE[i % PALETTE.length], href: listHref(`&category=${c.category}`) }))}
            format={money}
            centerLabel={moneyShort(total.cents)}
          />
        </Section>
        <Section title={tr("Top vendors")}>
          <HBars rows={vendors.map((v) => ({ label: v.name, value: v.cents, href: `/finances/vendors/${v.id}`, sub: `${v.count}×` }))} format={money} />
        </Section>
        <Section title={tr("Paid with")} text={tr("Which cards and methods the money went out on.")}>
          <HBars rows={byMethod.map((m) => ({ label: paidWith({ ...m, reference: null }, tr), value: m.cents }))} format={money} color={chartColors.amber} />
        </Section>
        <Section title={tr("Where spending grew")} text={tr("Categories up the most against the previous period of the same length.")}>
          {growth.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr("Nothing grew against the previous period.")}</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {growth.map((g) => (
                <li key={g.category} className="flex items-center justify-between gap-3">
                  <Link href={listHref(`&category=${g.category}`)} className="hover:text-link hover:underline">
                    {tr(categoryLabel(g.category))}
                  </Link>
                  <span className="inline-flex items-center gap-1 tabular-nums text-destructive">
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                    {money(g.diff)}
                    <span className="text-muted-foreground">
                      ({money(g.before)} → {money(g.now)})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {subscriptions.length > 0 && (
            <>
              <h3 className="mt-5 mb-2 text-sm font-semibold">{tr("Biggest recurring costs, per year")}</h3>
              <HBars rows={subscriptions.map((s) => ({ label: s.vendorName, value: yearlyCost(s), sub: tr(frequencies[s.frequency]).toLowerCase(), href: `/finances/expenses/recurring/${s.id}/edit` }))} format={money} color={chartColors.gray} />
            </>
          )}
        </Section>
      </div>
      <p className="text-[0.8rem] text-muted-foreground">
        {tr("{n} days. Expected spending uses your recurring expenses plus your average one-time spending over the last 90 days ({amount} a month).", { n: daysIn(range), amount: money(Math.round(perDay * 30)) })}
      </p>
    </div>
  );
}
