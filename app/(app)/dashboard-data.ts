import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { TIME_ZONE } from "@/lib/i18n/config";

// The dashboard's own numbers (the rest come from the Reports, Estimates,
// Inventory, Contractors and Expenses data). Days are Eastern "YYYY-MM-DD".

const TZ = sql.raw(`'${TIME_ZONE}'`);
const startOf = (day: string) => sql`(${day}::date::timestamp at time zone ${TZ})`;
const display = sql`coalesce(nullif(concat_ws(' ', c.first_name, c.last_name), ''), c.company_name, c.customer_code)`;
async function rows<T>(query: ReturnType<typeof sql>) {
  return (await db.execute(query)).rows as T[];
}

export type TodayVisit = {
  id: number;
  start: string;
  end: string;
  status: "pending" | "in_progress" | "completed" | "canceled";
  arrived: string | null;
  departed: string | null;
  customerId: number;
  name: string;
  street: string;
  crew: string | null;
  vehicles: string | null;
  invoicedCents: number | null;
};

// Today's visits (not canceled), with who's going, in what, and what's
// invoiced for each.
export async function todayVisits(today: string) {
  const list = await rows<Record<string, unknown>>(sql`
    select a.id, a.scheduled_start as start, a.scheduled_end as "end", a.status, a.actual_arrival as arrived, a.actual_departure as departed,
           c.id as customer_id, ${display} as name, p.street,
           (select string_agg(k.first_name, ', ' order by k.first_name) from appointment_contractors ac join contractors k on k.id = ac.contractor_id where ac.appointment_id = a.id) as crew,
           coalesce((select string_agg(v.name, ', ' order by v.name) from appointment_vehicles av join vehicles v on v.id = av.vehicle_id where av.appointment_id = a.id),
                    (select v.name from vehicles v where v.id = a.vehicle_id)) as vehicles,
           (select sum(i.total_cents) from invoices i where i.appointment_id = a.id and i.status <> 'void') as invoiced
      from appointments a join customers c on c.id = a.customer_id join properties p on p.id = a.property_id
     where a.status <> 'canceled' and a.scheduled_start >= ${startOf(today)} and a.scheduled_start < ${startOf(today)} + interval '1 day'
     order by a.scheduled_start`);
  return list.map(
    (r): TodayVisit => ({
      id: Number(r.id),
      start: String(r.start),
      end: String(r.end),
      status: r.status as TodayVisit["status"],
      arrived: (r.arrived as string | null) ?? null,
      departed: (r.departed as string | null) ?? null,
      customerId: Number(r.customer_id),
      name: String(r.name),
      street: String(r.street),
      crew: (r.crew as string | null) ?? null,
      vehicles: (r.vehicles as string | null) ?? null,
      invoicedCents: r.invoiced == null ? null : Number(r.invoiced),
    }),
  );
}

// The next 7 days: visits and hours booked each day (capacity at a glance).
export async function weekAhead(today: string) {
  const list = await rows<{ day: string; visits: number; hours: string }>(sql`
    select to_char(a.scheduled_start at time zone ${TZ}, 'YYYY-MM-DD') as day, count(*)::int as visits,
           sum(extract(epoch from a.scheduled_end - a.scheduled_start) / 3600) as hours
      from appointments a
     where a.status <> 'canceled' and a.scheduled_start >= ${startOf(today)} + interval '1 day' and a.scheduled_start < ${startOf(today)} + interval '8 days'
     group by 1 order by 1`);
  return list.map((r) => ({ day: r.day, visits: r.visits, hours: Number(r.hours ?? 0) }));
}

// Things that slip through the cracks, as counts (each links to a list).
export async function operationsChecks() {
  const [row] = await rows<Record<string, string | number | null>>(sql`
    select
      -- the crew was there but nobody marked it completed
      (select count(*) from appointments a where a.status in ('pending', 'in_progress') and a.actual_arrival is not null and a.scheduled_end < now() and a.scheduled_end > now() - interval '30 days')::int as to_complete,
      -- running late right now: should have started 15+ minutes ago, nobody there yet
      (select count(*) from appointments a where a.status = 'pending' and a.actual_arrival is null and a.scheduled_start < now() - interval '15 minutes' and a.scheduled_end > now() - interval '1 hour')::int as late_now,
      -- open invoices with no visit booked against them yet
      (select count(*) from invoices i left join appointments a on a.id = i.appointment_id where i.status = 'open' and i.customer_id is not null and (a.id is null or a.status = 'canceled'))::int as unbooked_invoices,
      (select coalesce(sum(i.total_cents), 0) from invoices i left join appointments a on a.id = i.appointment_id where i.status = 'open' and i.customer_id is not null and (a.id is null or a.status = 'canceled')) as unbooked_cents,
      -- new leads (30 days) nobody has sent an estimate yet
      (select count(*) from customers c where c.status = 'lead' and c.created_at > now() - interval '30 days' and not exists (select 1 from quotes q where q.customer_id = c.id))::int as leads_waiting,
      -- regulars with nothing booked: a visit in the last 60 days, none in the next 30
      (select count(*) from customers c where c.status = 'active'
         and exists (select 1 from appointments a where a.customer_id = c.id and a.status = 'completed' and a.scheduled_start > now() - interval '60 days')
         and not exists (select 1 from appointments a where a.customer_id = c.id and a.status = 'pending' and a.scheduled_start > now() and a.scheduled_start < now() + interval '30 days'))::int as regulars_unbooked`);
  return {
    toComplete: Number(row.to_complete),
    lateNow: Number(row.late_now),
    unbookedInvoices: Number(row.unbooked_invoices),
    unbookedCents: Number(row.unbooked_cents),
    leadsWaiting: Number(row.leads_waiting),
    regularsUnbooked: Number(row.regulars_unbooked),
  };
}

// Completed visits (30 days) whose invoice isn't finalized (a draft, or none)
// and with no payment recorded.
export async function toFinalizeCount() {
  const [row] = await rows<{ n: number }>(sql`
    select count(*)::int as n from appointments a
     where a.status = 'completed' and a.scheduled_start > now() - interval '30 days'
       and not exists (select 1 from invoices i where i.appointment_id = a.id and i.status in ('open', 'paid'))
       and not exists (select 1 from payments p where p.appointment_id = a.id)`);
  return row.n;
}

// Regulars with nothing booked (the list behind the count above).
export async function regularsUnbooked(limit = 20) {
  return (
    await rows<{ id: number; code: string; name: string; last: string }>(sql`
      select c.id, c.customer_code as code, ${display} as name,
             (select max(a.scheduled_start) from appointments a where a.customer_id = c.id and a.status = 'completed') as last
        from customers c where c.status = 'active'
         and exists (select 1 from appointments a where a.customer_id = c.id and a.status = 'completed' and a.scheduled_start > now() - interval '60 days')
         and not exists (select 1 from appointments a where a.customer_id = c.id and a.status = 'pending' and a.scheduled_start > now() and a.scheduled_start < now() + interval '30 days')
       order by 4 asc limit ${limit}`)
  ).map((r) => ({ ...r, id: Number(r.id) }));
}
