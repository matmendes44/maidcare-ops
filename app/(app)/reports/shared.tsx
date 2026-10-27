import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "cn";
import { presetLabels, presets, type Range } from "@/lib/reports/range";
import { getI18n } from "@/lib/i18n/server";

export const tabs = ["overview", "money", "customers", "estimates", "operations", "pricing", "fleet"] as const;
export type Tab = (typeof tabs)[number];
// (shown through tr())
export const tabLabels: Record<Tab, string> = {
  overview: "Overview",
  money: "Money",
  customers: "Customers",
  estimates: "Estimates",
  operations: "Operations",
  pricing: "Pricing",
  fleet: "Fleet",
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const money = (cents: number) => usd.format(cents / 100);
export const moneyWhole = (cents: number) => usdWhole.format(cents / 100);
// short axis labels: $950, $1.2k, $34k
export const moneyShort = (cents: number): string => {
  if (cents < 0) return `-${moneyShort(-cents)}`;
  const d = cents / 100;
  if (Math.abs(d) >= 10_000) return `$${Math.round(d / 1000)}k`;
  if (Math.abs(d) >= 1000) return `$${(d / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${Math.round(d)}`;
};
export const whole = (n: number) => Math.round(n).toLocaleString("en-US");
export const percent = (n: number) => `${Math.round(n * 100)}%`;
export const minutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m` : `${Math.round(m)} min`);

export function rangeQuery(r: Range) {
  return r.preset === "custom" ? `range=custom&from=${r.from}&to=${r.to}` : `range=${r.preset}`;
}

export function Section({ title, text, children, className, id }: { title: string; text?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("grid content-start gap-3 rounded-lg border bg-card p-4", className)} aria-label={title}>
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {text && <p className="mt-0.5 text-[0.8rem] text-muted-foreground">{text}</p>}
      </div>
      {children}
    </section>
  );
}

export async function RangePicker({ tab, range }: { tab: Tab; range: Range }) {
  const { tr } = await getI18n();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets
        .filter((p) => p !== "custom")
        .map((p) => (
          <Link
            key={p}
            href={`/reports?tab=${tab}&range=${p}`}
            aria-current={range.preset === p ? "true" : undefined}
            className={cn(
              "rounded-md border px-2.5 py-1 text-sm",
              range.preset === p ? "border-brand-blue bg-brand-blue/10 font-medium" : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {tr(presetLabels[p])}
          </Link>
        ))}
      <form action="/reports" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="tab" value={tab} />
        <input type="hidden" name="range" value="custom" />
        <Input type="date" name="from" defaultValue={range.from} aria-label={tr("From")} className="h-8 w-38" />
        <span className="text-sm text-muted-foreground">{tr("range|to")}</span>
        <Input type="date" name="to" defaultValue={range.to} aria-label={tr("To")} className="h-8 w-38" />
        <Button type="submit" variant="outline" size="sm">
          {tr("Show")}
        </Button>
      </form>
    </div>
  );
}
