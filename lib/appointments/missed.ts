import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { notify } from "@/lib/notifications";

// Missed: still pending an hour after it should have ended, and nobody
// arrived (no arrival detected or entered). These need rescheduling, or
// marking completed if the crew went without GPS. Looks back 30 days.
const MISSED = sql`a.status = 'pending' and a.actual_arrival is null
  and a.scheduled_end < now() - interval '1 hour' and a.scheduled_end > now() - interval '30 days'`;

const display = sql`coalesce(nullif(concat_ws(' ', c.first_name, c.last_name), ''), c.company_name, c.customer_code)`;

export async function missedVisits(limit = 50) {
  const rows = (
    await db.execute(sql`
      select a.id, a.scheduled_start as start, a.scheduled_end as "end", c.id as customer_id, c.customer_code as code, ${display} as name, p.street
        from appointments a join customers c on c.id = a.customer_id join properties p on p.id = a.property_id
       where ${MISSED} order by a.scheduled_start desc limit ${limit}`)
  ).rows as { id: number; start: string; end: string; customer_id: number; code: string; name: string; street: string }[];
  return rows.map((r) => ({ ...r, id: Number(r.id), customer_id: Number(r.customer_id) }));
}

// One notification per missed visit (the bell), never repeated. Cheap enough
// to run on every fleet sync and dashboard visit.
export async function notifyMissedVisits() {
  const fresh = (
    await db.execute(sql`
      select a.id, a.scheduled_start as start, ${display} as name, p.street
        from appointments a join customers c on c.id = a.customer_id join properties p on p.id = a.property_id
       where ${MISSED}
         and not exists (select 1 from notifications n where n.kind = 'appointment_missed' and n.href = '/appointments/' || a.id)
       limit 20`)
  ).rows as { id: number; start: string; name: string; street: string }[];
  for (const v of fresh)
    await notify({
      kind: "appointment_missed",
      title: "Missed visit: {name}, {at}",
      body: "Nobody arrived at {street}. Reschedule it, or mark it completed if it was done.",
      href: `/appointments/${v.id}`,
      vars: { name: v.name, at: new Date(v.start).toISOString(), street: v.street },
    });
  return fresh.length;
}

// Whether one visit counts as missed (its page shows a banner).
export function isMissed(a: { status: string; actualArrival: string | null; scheduledEnd: string }) {
  const end = new Date(a.scheduledEnd).getTime();
  return a.status === "pending" && !a.actualArrival && end < Date.now() - 3600_000 && end > Date.now() - 30 * 86_400_000;
}
