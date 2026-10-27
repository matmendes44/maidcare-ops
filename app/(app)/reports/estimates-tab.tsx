import { BarChart, HBars, Kpi, chartColors } from "@/components/charts";
import { getI18n } from "@/lib/i18n/server";
import { localDay, quoteState } from "@/lib/quotes/status";
import { monthLabel, monthsBetween, type Range } from "@/lib/reports/range";
import { today } from "@/lib/today";
import { getQuotes } from "../finances/estimates/data";
import { moneyShort, Section } from "./shared";

const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

// Estimates: how they turn into work in the chosen dates (by month, by type
// of cleaning, how fast) and why people say no.
export async function Estimates({ range }: { range: Range }) {
  const [day, { fmt, tr, locale }] = await Promise.all([today(), getI18n()]);
  const all = (await getQuotes()).map((q) => ({ ...q, state: quoteState(q, day) }));
  const months = monthsBetween(`${range.from.slice(0, 7)}-01`, range.to).slice(-24);
  // estimates sent in the chosen dates
  const sent = all.filter((q) => q.sentAt && localDay(q.sentAt) >= range.from && localDay(q.sentAt) <= range.to);
  const per = (m: string, f: (q: (typeof all)[number]) => boolean) => sent.filter((q) => localDay(q.sentAt!).slice(0, 7) === m && f(q)).length;
  const won = (q: (typeof all)[number]) => q.state === "accepted" || q.state === "scheduled";
  const byType = new Map<string, { sent: number; won: number; value: number }>();
  for (const q of sent) {
    const k = `${q.content.title || tr("Untitled")}${q.content.recurring.length ? ` + ${tr("recurring")}` : ""}`;
    const t = byType.get(k) ?? { sent: 0, won: 0, value: 0 };
    t.sent++;
    if (won(q)) {
      t.won++;
      t.value += q.acceptance?.totalCents ?? 0;
    }
    byType.set(k, t);
  }
  const reasons = new Map<string, number>();
  for (const q of sent.filter((x) => x.state === "declined")) {
    const r = q.declineReason ? q.declineReason.split(":")[0] : tr("No reason given");
    reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  const viewed = sent.filter((q) => q.firstViewedAt);
  const toView = viewed.map((q) => days(q.sentAt!, q.firstViewedAt!)).filter((d) => d >= 0);
  const plans = new Map<string, number>();
  for (const q of sent.filter(won)) {
    const when = q.content.recurring[0]?.when ?? tr("One time");
    plans.set(when, (plans.get(when) ?? 0) + 1);
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={tr("Sent")} value={String(sent.length)} sub={tr("in these dates")} />
        <Kpi label={tr("Opened")} value={sent.length ? `${Math.round((viewed.length / sent.length) * 100)}%` : "—"} sub={toView.length ? tr("first opened {n} days after sending", { n: (toView.reduce((a, b) => a + b, 0) / toView.length).toFixed(1) }) : undefined} />
        <Kpi label={tr("Won")} value={String(sent.filter(won).length)} sub={fmt.money(sent.filter(won).reduce((s, q) => s + (q.acceptance?.totalCents ?? 0), 0))} />
        <Kpi label={tr("Lost")} value={String(sent.filter((q) => q.state === "declined" || q.state === "expired").length)} sub={tr("declined or expired")} />
      </div>
      <Section title={tr("Sent and accepted by month")}>
        <BarChart
          label={tr("Estimates sent and accepted each month")}
          categories={months.map((m) => monthLabel(m, locale))}
          series={[
            { name: tr("estimates|Sent"), values: months.map((m) => per(m, () => true)), color: chartColors.gray },
            { name: tr("estimates|Accepted"), values: months.map((m) => per(m, won)), color: chartColors.green },
          ]}
          format={(n) => String(Math.round(n))}
        />
      </Section>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-2">
        <Section title={tr("By type of cleaning")} text={tr("Which kinds of estimates win.")}>
          {byType.size === 0 ? (
            <p className="text-sm text-muted-foreground">{tr("Nothing sent yet.")}</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {[...byType.entries()]
                .sort((a, b) => b[1].sent - a[1].sent)
                .map(([name, t]) => (
                  <li key={name} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate">{name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {tr("{won}/{sent} won", { won: t.won, sent: t.sent })} · {Math.round((t.won / t.sent) * 100)}% · {moneyShort(t.value)}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </Section>
        <Section title={tr("Why customers declined")}>
          <HBars rows={[...reasons.entries()].map(([label, value]) => ({ label: tr(label), value }))} format={(n) => String(n)} color={chartColors.red} empty={tr("No declines yet.")} />
        </Section>
        <Section title={tr("Recurring plans won")} text={tr("How often accepted estimates repeat.")}>
          <HBars rows={[...plans.entries()].map(([label, value]) => ({ label, value }))} format={(n) => String(n)} empty={tr("No acceptances yet.")} />
        </Section>
      </div>
    </div>
  );
}

