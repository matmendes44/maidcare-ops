import { BarChart, chartColors, HBars } from "@/components/charts";
import * as q from "@/lib/reports/queries";
import { monthLabel, monthsBetween, type Range } from "@/lib/reports/range";
import { moneyShort, moneyWhole, Section, whole } from "./shared";
import { getI18n } from "@/lib/i18n/server";
import { phrase, plural, type Tr } from "@/lib/i18n/tr";

// (shown through tr())
const methodLabels: Record<string, string> = { card: phrase("Card (Stripe)"), cash: phrase("Cash"), check: phrase("Check"), zelle: phrase("Zelle"), venmo: phrase("Venmo"), other: phrase("Other") };
const statusLabels: Record<string, string> = {
  draft: phrase("Draft (not sent)"),
  open: phrase("Open (sent, unpaid)"),
  paid: phrase("invoice|Paid"),
  void: phrase("invoice|Void"),
  uncollectible: phrase("invoice|Uncollectible"),
};
const zoneLabels: Record<string, string> = { south: phrase("South"), northwest: phrase("Northwest"), city_core: phrase("City core"), north_northeast: phrase("North / Northeast"), other: phrase("Other") };
const days = (n: number | null, tr: Tr) => (n == null ? "—" : n < 1 ? tr("same day") : tr("{n} days", { n: n.toFixed(1) }));

// Money, all from invoices and their statuses.
export async function Money({ range }: { range: Range }) {
  const { tr, locale } = await getI18n();
  const [byMonth, invoiced, methods, owed, owing, speed, statuses, zones, top] = await Promise.all([
    q.collectedByMonth(range),
    q.invoicedByMonth(range),
    q.collectedByMethod(range),
    q.outstanding(),
    q.topOwing(10),
    q.daysToPaid(range),
    q.invoicesByStatus(range),
    q.revenueByZone(range),
    q.topCustomers(range, 10),
  ]);
  const firstMonth = [...byMonth, ...invoiced].map((m) => m.month).sort()[0];
  const months = monthsBetween(firstMonth && `${firstMonth}-01` > range.from ? `${firstMonth}-01` : range.from, range.to).slice(-24);
  const at = (list: { month: string; cents: number }[], m: string) => list.find((x) => x.month === m)?.cents ?? 0;

  return (
    <div className="grid gap-4">
      <Section title={tr("Revenue by month")} text={tr("Collected = paid invoices, when paid. Invoiced = invoices finalized (open or paid), when finalized.")}>
        <BarChart
          label={tr("Revenue by month")}
          categories={months.map((m) => monthLabel(m, locale))}
          series={[
            { name: tr("Collected"), color: chartColors.green, values: months.map((m) => at(byMonth, m)) },
            { name: tr("Invoiced"), color: chartColors.blue, values: months.map((m) => at(invoiced, m)) },
          ]}
          format={moneyShort}
        />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={tr("How customers pay")} text={tr("Money collected in this period, by method.")}>
          <HBars
            rows={methods.map((m) => ({ label: methodLabels[m.method] ? tr(methodLabels[m.method]) : m.method, value: m.cents, sub: plural(tr, m.count, "{n} payment", "{n} payments", { n: whole(m.count) }) }))}
            format={moneyWhole}
            color={chartColors.green}
          />
        </Section>
        <Section
          title={tr("Outstanding now")}
          text={plural(tr, owed.invoices, "{amount} owed on {n} open invoice, by how late it is.", "{amount} owed on {n} open invoices, by how late it is.", { amount: moneyWhole(owed.total) })}
        >
          <HBars rows={owed.aging.map((a) => ({ label: tr(a.label), value: a.cents }))} format={moneyWhole} color={chartColors.amber} empty={tr("Nothing is owed.")} />
          {owing.length > 0 && (
            <div className="border-t pt-3">
              <h3 className="mb-2 text-sm font-medium">{tr("Who owes the most")}</h3>
              <HBars
                rows={owing.map((o) => ({ label: `${o.code} ${o.name}`, value: o.cents, href: `/customers/${o.id}`, sub: plural(tr, o.n, "{n} invoice", "{n} invoices") }))}
                format={moneyWhole}
                color={chartColors.red}
              />
            </div>
          )}
        </Section>
        <Section title={tr("How long payment takes")} text={tr("For money collected in this period.")}>
          <dl className="grid gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">{tr("Invoice finalized → paid")}</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums">{days(speed.invoice.medianDays, tr)}</dd>
              <dd className="text-[0.8rem] text-muted-foreground">
                {tr("median of {n} · average {avg}", { n: whole(speed.invoice.count), avg: days(speed.invoice.avgDays, tr) })}
              </dd>
            </div>
          </dl>
        </Section>
        <Section title={tr("Top customers by revenue")} text={tr("Collected in this period.")}>
          <HBars rows={top.map((c) => ({ label: `${c.code} ${c.name}`, value: c.cents, href: `/customers/${c.id}`, sub: plural(tr, c.n, "{n} payment", "{n} payments") }))} format={moneyWhole} />
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={tr("Invoices by status")} text={tr("Invoices made in this period, by where they stand now.")}>
          <HBars
            rows={["draft", "open", "paid", "void", "uncollectible"]
              .map((st) => statuses.find((x) => x.status === st))
              .filter((x): x is NonNullable<typeof x> => Boolean(x))
              .map((x) => ({ label: statusLabels[x.status] ? tr(statusLabels[x.status]) : x.status, value: x.cents, sub: plural(tr, x.count, "{n} invoice", "{n} invoices", { n: whole(x.count) }) }))}
            format={moneyWhole}
            empty={tr("No invoices made in this period.")}
          />
        </Section>
        <Section title={tr("Revenue by zone")} text={tr("Invoiced in this period, by the invoice's property's service zone.")}>
          {zones.some((z) => z.zone) ? (
            <HBars
              rows={zones.map((z) => ({ label: z.zone ? (zoneLabels[z.zone] ? tr(zoneLabels[z.zone]) : z.zone) : tr("No zone set"), value: z.cents, sub: plural(tr, z.invoices, "{n} invoice", "{n} invoices") }))}
              format={moneyWhole}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{tr("No invoiced properties have a zone yet. Set the zone when editing a property to see revenue by area.")}</p>
          )}
        </Section>
      </div>
    </div>
  );
}
