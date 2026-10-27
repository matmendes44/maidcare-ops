import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { Repeat } from "lucide-react";
import { db } from "@/db";
import { memorizedInvoices, properties } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import type { Formatters } from "@/lib/i18n/format";
import { getI18n } from "@/lib/i18n/server";
import { expectedVisits } from "@/lib/recurring/expected";
import type { MemorizedLine } from "@/lib/recurring/draft";
import { frequencyLabel, LOOKAHEAD_DAYS } from "@/lib/recurring/schedule";
import { today as getToday } from "@/lib/today";
import { addDays } from "../appointments/options";
import { ExpectedActions } from "../appointments/expected-actions";
import { formatAddress } from "../properties/options";
import { RecurringControls } from "./recurring-controls";

// The customer's memorized (recurring) invoice: what each visit is billed,
// how often they come, and the visits expected next.
export async function RecurringSection({ customerId, fmt }: { customerId: number; fmt: Formatters }) {
  const [{ tr }, user, today, rows] = await Promise.all([
    getI18n(),
    getCurrentUser(),
    getToday(),
    db
      .select({ m: memorizedInvoices, property: properties })
      .from(memorizedInvoices)
      .leftJoin(properties, eq(properties.id, memorizedInvoices.propertyId))
      .where(and(eq(memorizedInvoices.customerId, customerId), eq(memorizedInvoices.isActive, true)))
      .orderBy(desc(memorizedInvoices.createdAt)),
  ]);
  const manage = can(user, "invoices.memorize");
  const upcoming = rows.length ? (await expectedVisits(today, addDays(today, LOOKAHEAD_DAYS))).filter((e) => e.customerId === customerId) : [];

  return (
    <section id="recurring" className="mt-6 scroll-mt-20 rounded-xl border p-4 sm:p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <Repeat className="size-4 text-brand-green" aria-hidden="true" />
        {tr("Recurring invoice")}
      </h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {manage
            ? tr("None. It's set when they accept an estimate with recurring cleanings, or open one of their invoices and choose Set as recurring invoice.")
            : tr("None. It's set when they accept an estimate with recurring cleanings.")}
        </p>
      ) : (
        rows.map(({ m, property }) => {
          const lines = m.lines as MemorizedLine[];
          const mine = upcoming.filter((e) => e.memorizedId === m.id);
          return (
            <div key={m.id} className="mt-3 grid gap-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm">
                  <span className="font-semibold">{tr(frequencyLabel[m.frequency])}</span>
                  {property && <span className="text-muted-foreground"> · {formatAddress(property)}</span>}
                  {m.pausedUntil && <span className="text-amber-700 dark:text-amber-400"> · {tr("paused until {date}", { date: fmt.calendarDate(m.pausedUntil) })}</span>}
                </p>
                <p className="text-lg font-bold tabular-nums">{fmt.money(m.totalCents)}</p>
              </div>
              <ul className="grid gap-1 text-sm text-muted-foreground">
                {lines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="min-w-0">{l.description}</span>
                    <span className="tabular-nums">{fmt.money(l.cents)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[0.8rem] text-muted-foreground">
                {m.source === "estimate" ? tr("From an accepted estimate") : tr("From an invoice")}
                {m.sourceQuoteId && (
                  <>
                    {" "}
                    (
                    <Link href={`/finances/estimates/${m.sourceQuoteId}`} className="text-link hover:underline">
                      {tr("the estimate")}
                    </Link>
                    )
                  </>
                )}
                {m.sourceInvoiceId && (
                  <>
                    {" "}
                    (
                    <Link href={`/finances/invoices/${m.sourceInvoiceId}`} className="text-link hover:underline">
                      {tr("the invoice")}
                    </Link>
                    )
                  </>
                )}
                . {tr("Each visit gets a draft made from it when it's booked.")}
              </p>

              <div>
                <h3 className="mb-2 text-sm font-medium">{tr("Expected next (4 weeks)")}</h3>
                {mine.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{tr("Nothing expected yet: visits are expected after their first one is booked.")}</p>
                ) : (
                  <ul className="grid gap-2">
                    {mine.map((e) => (
                      <li key={e.day} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2 text-sm">
                        <span>
                          {fmt.dayHeading(e.day)} · {fmt.time(`${e.day}T${e.start}:00${offset(e.day)}`)}
                        </span>
                        <ExpectedActions memorizedId={e.memorizedId} day={e.day} start={e.start} end={e.end} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {manage && <RecurringControls id={m.id} frequency={m.frequency} pausedUntil={m.pausedUntil} />}
            </div>
          );
        })
      )}
    </section>
  );
}

// "-04:00" / "-05:00": Eastern's offset on a day (for showing a local time)
function offset(day: string) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).formatToParts(new Date(`${day}T12:00:00Z`)).find((p) => p.type === "timeZoneName")!.value;
  const h = Number(name.replace("GMT", "") || 0);
  return `${h < 0 ? "-" : "+"}${String(Math.abs(h)).padStart(2, "0")}:00`;
}
