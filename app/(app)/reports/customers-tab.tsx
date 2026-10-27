import { BarChart, chartColors, HBars, Kpi } from "@/components/charts";
import * as q from "@/lib/reports/queries";
import { monthLabel, monthsBetween, type Range } from "@/lib/reports/range";
import { moneyWhole, percent, Section, whole } from "./shared";
import { getI18n } from "@/lib/i18n/server";
import { phrase, plural, type Tr } from "@/lib/i18n/tr";

// (shown through tr())
const reasonLabels: Record<string, string> = {
  quality: phrase("Quality"),
  scheduling_communication: phrase("Scheduling / communication"),
  client_circumstances: phrase("Client circumstances"),
  "not recorded": phrase("Not recorded"),
};
const tenure = (d: number | null, tr: Tr) => (d == null ? "—" : d >= 60 ? tr("{n} months", { n: (d / 30.4).toFixed(1) }) : tr("{n} days", { n: Math.round(d) }));

export async function Customers({ range }: { range: Range }) {
  const { tr, locale } = await getI18n();
  const counts = await q.customerCounts(range);
  // the chart starts at the first month anyone was a customer
  const months = monthsBetween(range.from, range.to).slice(-24);
  const [byMonth, reasons, life, refs, top] = await Promise.all([
    q.customersByMonth(months),
    q.churnReasons(range),
    q.lifetime(),
    q.referrals(range),
    q.topCustomersAllTime(10),
  ]);
  const firstActive = byMonth.findIndex((m) => m.active > 0 || m.added > 0 || m.lost > 0);
  const shown = firstActive === -1 ? byMonth : byMonth.slice(firstActive);
  const conversion = counts.created ? counts.created_converted / counts.created : null;

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label={tr("Active customers")} value={whole(counts.active)} sub={tr("{paused} paused · {inactive} inactive", { paused: counts.paused, inactive: counts.inactive })} href="/customers" />
        <Kpi label={tr("New in this period")} value={whole(counts.added)} sub={tr("{n} lost", { n: counts.lost })} />
        <Kpi label={tr("Open leads")} value={whole(counts.leads)} sub={conversion == null ? tr("no customers added in this period") : tr("{pct} of those added became customers", { pct: percent(conversion) })} />
        <Kpi label={tr("How long customers stay")} value={tenure(life.activeAvgDays, tr)} sub={tr("active customers so far; those who left stayed {time}", { time: tenure(life.endedAvgDays, tr) })} />
        <Kpi label={tr("Revenue per customer")} value={life.valuePerCustomer == null ? "—" : moneyWhole(life.valuePerCustomer)} sub={tr("all-time average over {n} paying customers", { n: life.payingCustomers })} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={tr("Active customers by month")} text={tr("Counted at the end of each month, from customers' start and end dates.")}>
          <BarChart label={tr("Active customers by month")} categories={shown.map((m) => monthLabel(m.month, locale))} series={[{ name: tr("customer|Active"), color: chartColors.blue, values: shown.map((m) => m.active) }]} format={whole} />
        </Section>
        <Section title={tr("New vs lost")} text={tr("Customers who started or ended each month.")}>
          <BarChart
            label={tr("New and lost customers by month")}
            categories={shown.map((m) => monthLabel(m.month, locale))}
            series={[
              { name: tr("customers|New"), color: chartColors.green, values: shown.map((m) => m.added) },
              { name: tr("customers|Lost"), color: chartColors.red, values: shown.map((m) => m.lost) },
            ]}
            format={whole}
          />
        </Section>
        <Section title={tr("Why customers left")} text={tr("Reasons recorded on customers who ended in this period.")}>
          <HBars rows={reasons.map((r) => ({ label: reasonLabels[r.reason] ? tr(reasonLabels[r.reason]) : r.reason, value: r.n }))} format={whole} color={chartColors.red} empty={tr("Nobody left in this period.")} />
          {reasons.some((r) => r.reason === "not recorded") && (
            <p className="text-[0.8rem] text-muted-foreground">{tr("Recording a reason when marking a customer inactive makes this more useful.")}</p>
          )}
        </Section>
        <Section title={tr("Where customers come from")} text={refs.total ? tr("{referred} of {total} customers who started in this period were referred.", { referred: whole(refs.referred), total: whole(refs.total) }) : undefined}>
          <HBars
            rows={refs.top.map((r) => ({ label: `${r.code} ${r.name}`, value: r.n, href: `/customers/${r.id}`, sub: tr("referrals") }))}
            format={whole}
            color={chartColors.green}
            empty={tr("No referrals recorded yet. Set “Referred by” on a customer to track who sends you business.")}
          />
        </Section>
        <Section title={tr("Customer types")}>
          <HBars
            rows={[
              { label: tr("Residential"), value: counts.residential },
              { label: tr("Commercial"), value: counts.commercial },
              { label: tr("Referral partner"), value: counts.referral_partner },
            ].filter((r) => r.value > 0)}
            format={whole}
          />
        </Section>
        <Section title={tr("Top customers, all time")} text={tr("By money collected.")}>
          <HBars rows={top.map((c) => ({ label: `${c.code} ${c.name}`, value: c.cents, href: `/customers/${c.id}`, sub: plural(tr, c.n, "{n} payment", "{n} payments") }))} format={moneyWhole} />
        </Section>
      </div>
    </div>
  );
}
