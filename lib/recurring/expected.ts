import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { TIME_ZONE } from "@/lib/i18n/config";
import { expectedDays, expectedTime, type Frequency } from "./schedule";

export type ExpectedVisit = {
  memorizedId: number;
  customerId: number;
  propertyId: number | null;
  customerCode: string;
  name: string;
  street: string | null;
  day: string;
  start: string;
  end: string;
  totalCents: number;
  frequency: Frequency;
};

const TZ = sql.raw(`'${TIME_ZONE}'`);
const display = sql`coalesce(nullif(concat_ws(' ', c.first_name, c.last_name), ''), c.company_name, c.customer_code)`;

// Expected (not yet booked) recurring visits from `from` to `to`: for each
// active memorized invoice, every interval (or month) after the customer's latest visit
// at that property (booked or done, not canceled). Booking the next visit
// moves the schedule along with it. Customers who've never had a visit have
// none expected yet: book the first one.
export async function expectedVisits(from: string, to: string): Promise<ExpectedVisit[]> {
  const rows = (
    await db.execute(sql`
      select m.id, m.customer_id, m.property_id, m.frequency, m.total_cents, m.paused_until,
             c.customer_code, ${display} as name, p.street,
             last.day, last.start, last.minutes,
             coalesce((select array_agg(to_char(s.day, 'YYYY-MM-DD')) from memorized_skips s where s.memorized_invoice_id = m.id), '{}') as skips
        from memorized_invoices m
        join customers c on c.id = m.customer_id
        left join properties p on p.id = m.property_id
        join lateral (
          select to_char(coalesce(a.actual_arrival, a.scheduled_start) at time zone ${TZ}, 'YYYY-MM-DD') as day,
                 to_char(coalesce(a.actual_arrival, a.scheduled_start) at time zone ${TZ}, 'HH24:MI') as start,
                 extract(epoch from coalesce(a.booked_end, a.scheduled_end) - coalesce(a.booked_start, a.scheduled_start)) / 60 as minutes
            from appointments a
           where a.customer_id = m.customer_id and a.status <> 'canceled'
             and (m.property_id is null or a.property_id = m.property_id)
           order by a.scheduled_start desc limit 1
        ) last on true
       where m.is_active and c.status <> 'inactive'`)
  ).rows as {
    id: number; customer_id: number; property_id: number | null; frequency: Frequency; total_cents: number; paused_until: string | null;
    customer_code: string; name: string; street: string | null; day: string; start: string; minutes: string; skips: string[];
  }[];
  const out: ExpectedVisit[] = [];
  for (const r of rows) {
    const time = expectedTime(r.start, Number(r.minutes));
    for (const day of expectedDays(r.day, r.frequency, { from, to, skips: new Set(r.skips), pausedUntil: r.paused_until ? String(r.paused_until).slice(0, 10) : null }))
      out.push({
        memorizedId: Number(r.id),
        customerId: Number(r.customer_id),
        propertyId: r.property_id == null ? null : Number(r.property_id),
        customerCode: r.customer_code,
        name: r.name,
        street: r.street,
        day,
        ...time,
        totalCents: r.total_cents,
        frequency: r.frequency,
      });
  }
  return out.sort((a, b) => (a.day + a.start).localeCompare(b.day + b.start));
}
