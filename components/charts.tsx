import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "cn";
import { getI18n } from "@/lib/i18n/server";

// Small charts for the Reports page, drawn as SVG on the server: no chart
// library and no JavaScript in the browser. Every chart has a "Show the
// numbers" table for exact values and screen readers.

export type Series = { name: string; values: number[]; color: string };

const COLORS = {
  blue: "var(--brand-blue)",
  green: "var(--brand-green)",
  amber: "#d97706",
  gray: "color-mix(in oklab, var(--foreground) 35%, transparent)",
  red: "var(--destructive)",
};
export const chartColors = COLORS;

function niceMax(max: number) {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= max) return m * pow;
  return 10 * pow;
}

// Vertical bars per category, side by side or stacked.
export async function BarChart({
  categories,
  series,
  format,
  stacked = false,
  height = 220,
  label,
}: {
  categories: string[];
  series: Series[];
  format: (n: number) => string;
  stacked?: boolean;
  height?: number;
  label: string;
}) {
  const { tr } = await getI18n();
  const totals = categories.map((_, i) => (stacked ? series.reduce((s, x) => s + Math.max(0, x.values[i] ?? 0), 0) : Math.max(0, ...series.map((x) => x.values[i] ?? 0))));
  const max = niceMax(Math.max(0, ...totals));
  const left = 64;
  const bottom = 26;
  const top = 8;
  // a wide drawing area even for a few bars, so text keeps its size when the
  // chart is stretched to the page; bars themselves stay a sensible width
  const plotWidth = Math.max(categories.length * 26, 680);
  const groupWidth = plotWidth / Math.max(1, categories.length);
  const width = left + plotWidth + 8;
  const plot = height - bottom - top;
  const y = (v: number) => top + plot - (v / max) * plot;
  const barWidth = stacked ? Math.min(groupWidth * 0.62, 56) : Math.min((groupWidth * 0.7) / series.length, 40);
  const every = Math.ceil(categories.length / 14);
  const empty = totals.every((t) => t === 0);

  return (
    <figure className="grid gap-2">
      {series.length > 1 && (
        <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-[0.8rem] text-muted-foreground">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </figcaption>
      )}
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="h-auto w-full" style={{ minWidth: Math.min(width, 320) }}>
          {(empty ? [0] : [0, 0.25, 0.5, 0.75, 1]).map((t) => (
            <g key={t}>
              <line x1={left} x2={width - 4} y1={y(max * t)} y2={y(max * t)} stroke="currentColor" className="text-border" strokeWidth={1} />
              <text x={left - 6} y={y(max * t) + 4} textAnchor="end" className="fill-muted-foreground" fontSize={11}>
                {format(max * t)}
              </text>
            </g>
          ))}
          {categories.map((cat, i) => {
            const x0 = left + i * groupWidth + (groupWidth - (stacked ? barWidth : barWidth * series.length)) / 2;
            let stackTop = 0;
            return (
              <g key={cat}>
                {series.map((s, si) => {
                  const v = Math.max(0, s.values[i] ?? 0);
                  const h = (v / max) * plot;
                  const x = stacked ? x0 : x0 + si * barWidth;
                  const yTop = stacked ? y(stackTop + v) : y(v);
                  stackTop += stacked ? v : 0;
                  return (
                    <rect key={s.name} x={x} y={yTop} width={Math.max(1, barWidth - (stacked ? 0 : 2))} height={Math.max(0, h)} rx={2} style={{ fill: s.color }}>
                      <title>{`${cat} · ${s.name}: ${format(s.values[i] ?? 0)}`}</title>
                    </rect>
                  );
                })}
                {i % every === 0 && (
                  <text x={left + i * groupWidth + groupWidth / 2} y={height - 8} textAnchor="middle" className="fill-muted-foreground" fontSize={11}>
                    {cat}
                  </text>
                )}
              </g>
            );
          })}
          {empty && (
            <text x={left + (width - left) / 2} y={top + plot / 2} textAnchor="middle" className="fill-muted-foreground" fontSize={13}>
              {tr("Nothing in this period")}
            </text>
          )}
        </svg>
      </div>
      <details className="text-[0.8rem] text-muted-foreground">
        <summary className="cursor-pointer">{tr("Show the numbers")}</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left tabular-nums">
            <thead>
              <tr>
                <th className="py-1 pr-4 font-medium">&nbsp;</th>
                {series.map((s) => (
                  <th key={s.name} className="py-1 pr-4 text-right font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((cat, i) => (
                <tr key={cat} className="border-t">
                  <td className="py-1 pr-4">{cat}</td>
                  {series.map((s) => (
                    <td key={s.name} className="py-1 pr-4 text-right text-foreground">
                      {format(s.values[i] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

// Labelled horizontal bars, largest first: payment methods, top customers…
export async function HBars({
  rows,
  format,
  color = COLORS.blue,
  empty,
}: {
  rows: { label: string; value: number; href?: string; sub?: string }[];
  format: (n: number) => string;
  color?: string;
  empty?: string;
}) {
  const { tr } = await getI18n();
  if (rows.length === 0 || rows.every((r) => r.value === 0)) return <p className="text-sm text-muted-foreground">{empty ?? tr("Nothing in this period.")}</p>;
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <ul className="grid gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              {r.href ? (
                <Link href={r.href} className="hover:text-link hover:underline">
                  {r.label}
                </Link>
              ) : (
                r.label
              )}
              {r.sub && <span className="ml-1.5 text-[0.8rem] text-muted-foreground">{r.sub}</span>}
            </span>
            <span className="shrink-0 font-medium tabular-nums">{format(r.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${max ? Math.max(2, (r.value / max) * 100) : 0}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// A headline number with its change from the previous period.
export async function Kpi({
  label,
  value,
  change,
  goodWhen = "up",
  sub,
  href,
  tone,
}: {
  label: string;
  value: string;
  change?: number | null;
  goodWhen?: "up" | "down";
  sub?: React.ReactNode;
  href?: string;
  tone?: "warn" | "bad";
}) {
  const { tr } = await getI18n();
  const direction = change == null || Math.abs(change) < 0.005 ? "flat" : change > 0 ? "up" : "down";
  const good = direction === "flat" ? null : direction === goodWhen;
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  const body = (
    <>
      <div className="text-[0.8rem] font-medium text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-bold tabular-nums", tone === "bad" && "text-destructive", tone === "warn" && "text-amber-700 dark:text-amber-400")}>{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.8rem] text-muted-foreground">
        {change !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium",
              good === true && "text-brand-green",
              good === false && "text-destructive",
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {change == null ? tr("no earlier data") : `${change > 0 ? "+" : ""}${Math.round(change * 100)}%`}
            {change != null && <span className="sr-only"> {tr("vs the previous period")}</span>}
          </span>
        )}
        {sub}
      </div>
    </>
  );
  return href ? (
    <Link href={href} className="rounded-lg border bg-card p-4 transition-colors hover:border-brand-blue/50 hover:bg-secondary/30">
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border bg-card p-4">{body}</div>
  );
}

// Shares of a whole as a ring, with a legend: spending by category…
export async function Donut({
  slices,
  format,
  centerLabel,
  empty,
}: {
  slices: { label: string; value: number; color: string; href?: string }[];
  format: (n: number) => string;
  centerLabel?: string;
  empty?: string;
}) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const { tr } = await getI18n();
  if (total <= 0) return <p className="text-sm text-muted-foreground">{empty ?? tr("Nothing in this period.")}</p>;
  const r = 15.915; // circumference 100, so dash lengths are percentages
  const pcts = slices.map((s) => (Math.max(0, s.value) / total) * 100);
  // each slice starts where the previous ended, from 12 o'clock
  const offsets = pcts.map((_, i) => 25 - pcts.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <div className="grid items-center gap-5 sm:grid-cols-[10rem_1fr]">
      <svg viewBox="0 0 42 42" role="img" aria-label={slices.map((s) => `${s.label} ${format(s.value)}`).join(", ")} className="mx-auto size-40">
        <circle cx="21" cy="21" r={r} fill="none" stroke="currentColor" className="text-muted" strokeWidth="6" />
        {slices.map((s, i) => (
          <circle key={s.label} cx="21" cy="21" r={r} fill="none" strokeWidth="6" strokeDasharray={`${pcts[i]} ${100 - pcts[i]}`} strokeDashoffset={offsets[i]} style={{ stroke: s.color }}>
            <title>{`${s.label}: ${format(s.value)} (${Math.round(pcts[i])}%)`}</title>
          </circle>
        ))}
        {centerLabel && (
          <text x="21" y="22.5" textAnchor="middle" fontSize="4.2" fontWeight="700" className="fill-foreground">
            {centerLabel}
          </text>
        )}
      </svg>
      <ul className="grid gap-1.5 text-sm">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              {s.href ? (
                <Link href={s.href} className="truncate hover:text-link hover:underline">
                  {s.label}
                </Link>
              ) : (
                <span className="truncate">{s.label}</span>
              )}
            </span>
            <span className="shrink-0 tabular-nums">
              {format(s.value)} <span className="text-muted-foreground">· {Math.round((Math.max(0, s.value) / total) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Lines over categories (months, days); values may be negative (net profit).
// A series can stop early (null values aren't drawn), and `dashed` marks a
// projection.
export async function LineChart({
  categories,
  series,
  format,
  height = 220,
  label,
  markIndex,
}: {
  categories: string[];
  series: { name: string; values: (number | null)[]; color: string; dashed?: boolean }[];
  format: (n: number) => string;
  height?: number;
  label: string;
  // a vertical marker (e.g. today)
  markIndex?: number;
}) {
  const { tr } = await getI18n();
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const maxRaw = Math.max(0, ...all);
  const minRaw = Math.min(0, ...all);
  const max = niceMax(maxRaw);
  // a small dip below zero gets a little room, not a full mirrored axis
  const min = minRaw >= 0 ? 0 : -minRaw < maxRaw * 0.2 ? -max * 0.2 : -niceMax(-minRaw);
  const left = 64;
  const bottom = 26;
  const top = 8;
  const plotWidth = Math.max(categories.length * 26, 680);
  // room on the right for the last label
  const width = left + plotWidth + 30;
  const plot = height - bottom - top;
  const y = (v: number) => top + ((max - v) / (max - min || 1)) * plot;
  const x = (i: number) => left + (categories.length === 1 ? plotWidth / 2 : (i / (categories.length - 1)) * plotWidth);
  const every = Math.ceil(categories.length / 12);
  const empty = all.every((v) => v === 0);
  const ticks = empty ? [0] : min < 0 ? (-min < max * 0.5 ? [0, max / 2, max] : [min, min / 2, 0, max / 2, max]) : [0, max * 0.25, max * 0.5, max * 0.75, max];

  return (
    <figure className="grid gap-2">
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-[0.8rem] text-muted-foreground">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: s.color, opacity: s.dashed ? 0.7 : 1 }} />
            {s.name}
          </span>
        ))}
      </figcaption>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="h-auto w-full" style={{ minWidth: Math.min(width, 320) }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width - 4} y1={y(t)} y2={y(t)} stroke="currentColor" className={t === 0 ? "text-muted-foreground/50" : "text-border"} strokeWidth={1} />
              <text x={left - 6} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground" fontSize={11}>
                {format(t)}
              </text>
            </g>
          ))}
          {markIndex !== undefined && markIndex >= 0 && markIndex < categories.length && (
            <line x1={x(markIndex)} x2={x(markIndex)} y1={top} y2={top + plot} stroke="currentColor" className="text-muted-foreground/40" strokeDasharray="3 3" />
          )}
          {series.map((s) => {
            const points = s.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
            return (
              <g key={s.name}>
                <polyline points={points.join(" ")} fill="none" strokeWidth={2.25} strokeLinejoin="round" strokeDasharray={s.dashed ? "6 4" : undefined} style={{ stroke: s.color }} />
                {categories.length <= 31 &&
                  s.values.map((v, i) =>
                    v === null ? null : (
                      <circle key={i} cx={x(i)} cy={y(v)} r={2.5} style={{ fill: s.color }}>
                        <title>{`${categories[i]} · ${s.name}: ${format(v)}`}</title>
                      </circle>
                    ),
                  )}
              </g>
            );
          })}
          {empty && (
            <text x={left + plotWidth / 2} y={top + plot / 2} textAnchor="middle" className="fill-muted-foreground" fontSize={13}>
              {tr("Nothing yet")}
            </text>
          )}
          {categories.map((cat, i) =>
            i % every === 0 ? (
              <text key={cat} x={x(i)} y={height - 8} textAnchor="middle" className="fill-muted-foreground" fontSize={11}>
                {cat}
              </text>
            ) : null,
          )}
        </svg>
      </div>
      <details className="text-[0.8rem] text-muted-foreground">
        <summary className="cursor-pointer">{tr("Show the numbers")}</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left tabular-nums">
            <thead>
              <tr>
                <th className="py-1 pr-4 font-medium">&nbsp;</th>
                {series.map((s) => (
                  <th key={s.name} className="py-1 pr-4 text-right font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((cat, i) => (
                <tr key={cat} className="border-t">
                  <td className="py-1 pr-4">{cat}</td>
                  {series.map((s) => (
                    <td key={s.name} className="py-1 pr-4 text-right text-foreground">
                      {s.values[i] === null ? "—" : format(s.values[i]!)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
