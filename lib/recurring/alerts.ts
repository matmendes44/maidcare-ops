import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { notifyMissedVisits } from "@/lib/appointments/missed";
import { logError } from "@/lib/log";
import { notify } from "@/lib/notifications";
import { expectedVisits } from "./expected";
import { PROMPT_DAYS } from "./schedule";

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const sent = async (kind: string, href: string) =>
  ((await db.execute(sql`select 1 from notifications where kind = ${kind} and href = ${href} limit 1`)).rows.length > 0);

// Recurring visits coming up within a week with nothing booked: one alert
// each, so someone makes the draft invoice and books it.
export async function notifyRecurringDue(today: string) {
  let n = 0;
  for (const e of await expectedVisits(today, addDays(today, PROMPT_DAYS))) {
    const href = `/appointments?view=day&date=${e.day}&expected=${e.memorizedId}`;
    if (await sent("recurring_due", href)) continue;
    await notify({ kind: "recurring_due", title: "Recurring visit to book: {name}, {day}", body: "Make its invoice and book it (Invoice & book on the calendar).", href, vars: { name: e.name, day: e.day } });
    n++;
  }
  return n;
}

// Completed visits whose invoice isn't finalized yet (a draft, or none at
// all) and with no payment recorded: one alert each, for the owner to
// finalize. Looks back 30 days, newest first.
export async function notifyToFinalize() {
  const rows = (
    await db.execute(sql`
      select a.id, a.scheduled_start as start,
             coalesce(nullif(concat_ws(' ', c.first_name, c.last_name), ''), c.company_name, c.customer_code) as name
        from appointments a join customers c on c.id = a.customer_id
       where a.status = 'completed' and a.scheduled_start > now() - interval '30 days'
         and not exists (select 1 from invoices i where i.appointment_id = a.id and i.status in ('open', 'paid'))
         and not exists (select 1 from payments p where p.appointment_id = a.id)
         and not exists (select 1 from notifications n where n.kind = 'invoice_to_finalize' and n.href = '/finances?tab=to_finalize&visit=' || a.id)
       order by a.scheduled_start desc
       limit 20`)
  ).rows as { id: number; start: string; name: string }[];
  for (const v of rows)
    await notify({
      kind: "invoice_to_finalize",
      title: "Finalize the invoice: {name}, {day}",
      body: "The visit is done but its invoice is still a draft (or there isn't one).",
      href: `/finances?tab=to_finalize&visit=${v.id}`,
      audience: "owner",
      vars: { name: v.name, day: new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(v.start)) },
    });
  return rows.length;
}

// Every scheduling alert, run on each fleet sync and dashboard visit.
export async function runScheduleAlerts(today: string) {
  for (const [name, run] of [
    ["missed visits", () => notifyMissedVisits()],
    ["recurring visits", () => notifyRecurringDue(today)],
    ["invoices to finalize", () => notifyToFinalize()],
  ] as const) {
    await run().catch((err) => logError(`${name} alert failed`, err));
  }
}
