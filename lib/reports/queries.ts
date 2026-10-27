import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { visitsPerMonth, type Frequency } from "@/lib/recurring/schedule";
import { TIME_ZONE } from "@/lib/i18n/config";
import { phrase } from "@/lib/i18n/tr";

// The numbers behind the Reports page. No permission checks here: the page's
// data layer checks "reports.view" before calling these. Days are Eastern
// ("YYYY-MM-DD", both ends included); money is in cents.
//
// Money comes only from invoices and their statuses; visits (appointments)
// only feed the operations numbers. Definitions used throughout:
// - Collected: paid invoices, on the day they were paid. Every payment
//   recorded in the app (each one a paid Stripe invoice, including imported
//   history) plus every paid invoice that isn't already one of those
//   payments (matched by Stripe invoice id), so nothing is counted twice.
// - Invoiced: finalized invoices that aren't void (open or paid), on the day
//   they were finalized.
// - Outstanding: what's still owed on open (finalized, unpaid) invoices.
// - Drafts: invoices made but not finalized yet.

type Range = { from: string; to: string };

// the time zone is written into the SQL (a fixed constant, not user input)
// so GROUP BY sees the same expression as SELECT
const TZ = sql.raw(`'${TIME_ZONE}'`);
const startOf = (day: string) => sql`(${day}::date::timestamp at time zone ${TZ})`;
const endOf = (day: string) => sql`((${day}::date + 1)::timestamp at time zone ${TZ})`;
const inRange = (column: SQL, r: Range) => sql`${column} >= ${startOf(r.from)} and ${column} < ${endOf(r.to)}`;
const localMonth = (column: SQL) => sql`to_char(${column} at time zone ${TZ}, 'YYYY-MM')`;

async function rows<T>(query: SQL) {
  return (await db.execute(query)).rows as T[];
}
const num = (v: unknown) => (v == null ? 0 : Number(v));
const display = sql`coalesce(nullif(concat_ws(' ', c.first_name, c.last_name), ''), c.company_name, c.customer_code)`;

// One row per payment received (see "Collected" above), with a method
// grouped for reporting: card, cash, check, zelle, venmo, other.
const COLLECTED = sql`collected as (
  select p.paid_at as at, p.amount_cents as cents, p.customer_id,
         case p.method::text
           when 'stripe' then 'card'
           when 'zelle_business' then 'zelle'
           when 'zelle_personal' then 'zelle'
           else p.method::text end as method
    from payments p
  union all
  select i.paid_at, i.amount_paid_cents, i.customer_id,
         case
           when coalesce(i.paid_via, 'stripe') = 'stripe' then 'card'
           when i.paid_via in ('cash', 'check') then i.paid_via
           when i.paid_via_note ilike 'zelle%' then 'zelle'
           when i.paid_via_note ilike 'venmo%' then 'venmo'
           else 'other' end
    from invoices i
   where i.status = 'paid' and i.paid_at is not null and i.amount_paid_cents > 0
     and not exists (select 1 from payments p2 where p2.stripe_invoice_id = i.stripe_invoice_id)
)`;

// ---------- money ----------

export async function collectedTotal(r: Range) {
  const [row] = await rows<{ cents: string; payments: number }>(
    sql`with ${COLLECTED} select coalesce(sum(cents), 0) as cents, count(*)::int as payments from collected where ${inRange(sql`at`, r)}`,
  );
  return { cents: num(row.cents), payments: row.payments };
}

export async function collectedByMonth(r: Range) {
  const month = localMonth(sql`at`);
  return (
    await rows<{ month: string; cents: string }>(
      sql`with ${COLLECTED} select ${month} as month, sum(cents) as cents from collected where ${inRange(sql`at`, r)} group by ${month} order by 1`,
    )
  ).map((x) => ({ month: x.month, cents: num(x.cents) }));
}

export async function collectedByMethod(r: Range) {
  return (
    await rows<{ method: string; cents: string; n: number }>(
      sql`with ${COLLECTED} select method, sum(cents) as cents, count(*)::int as n from collected where ${inRange(sql`at`, r)} group by method order by 2 desc`,
    )
  ).map((x) => ({ method: x.method, cents: num(x.cents), count: x.n }));
}

export async function topCustomers(r: Range, limit = 10) {
  return (
    await rows<{ id: number; code: string; name: string; cents: string; n: number }>(sql`
      with ${COLLECTED}
      select c.id, c.customer_code as code, ${display} as name, sum(k.cents) as cents, count(*)::int as n
        from collected k join customers c on c.id = k.customer_id
       where ${inRange(sql`k.at`, r)}
       group by c.id order by 4 desc limit ${limit}`)
  ).map((x) => ({ ...x, id: Number(x.id), cents: num(x.cents) }));
}

// what a visit was booked for (GPS moves today's scheduled times to the real ones)
const BOOKED_START = sql`coalesce(a.booked_start, a.scheduled_start)`;
const BOOKED_END = sql`coalesce(a.booked_end, a.scheduled_end)`;
const completedWhere = (r: Range) => sql`a.status = 'completed' and ${inRange(sql`a.scheduled_start`, r)}`;
const INVOICED = sql`i.finalized_at is not null and i.status in ('open', 'paid')`;

export async function invoicedTotal(r: Range) {
  const [row] = await rows<{ cents: string; n: number }>(
    sql`select coalesce(sum(i.total_cents), 0) as cents, count(*)::int as n from invoices i where ${INVOICED} and ${inRange(sql`i.finalized_at`, r)}`,
  );
  return { cents: num(row.cents), invoices: row.n };
}

// Every invoice made in the period, by where it stands now.
export async function invoicesByStatus(r: Range) {
  return (
    await rows<{ status: string; cents: string; n: number }>(
      sql`select i.status::text as status, coalesce(sum(i.total_cents), 0) as cents, count(*)::int as n from invoices i where ${inRange(sql`i.created_at`, r)} group by 1`,
    )
  ).map((x) => ({ status: x.status, cents: num(x.cents), count: x.n }));
}

// Invoices made but not finalized (sent) yet, whenever they were made.
export async function drafts() {
  const [row] = await rows<{ cents: string; n: number }>(sql`select coalesce(sum(total_cents), 0) as cents, count(*)::int as n from invoices where status = 'draft'`);
  return { cents: num(row.cents), count: row.n };
}

export async function invoicedByMonth(r: Range) {
  const month = localMonth(sql`i.finalized_at`);
  return (
    await rows<{ month: string; cents: string }>(
      sql`select ${month} as month, sum(i.total_cents) as cents from invoices i
           where ${INVOICED} and ${inRange(sql`i.finalized_at`, r)}
           group by ${month} order by 1`,
    )
  ).map((x) => ({ month: x.month, cents: num(x.cents) }));
}

// What's owed right now, by how late it is.
export async function outstanding() {
  const [row] = await rows<Record<string, string>>(sql`
    select coalesce(sum(amount_remaining_cents), 0) as total,
           count(*)::int as invoices,
           coalesce(sum(amount_remaining_cents) filter (where due_date is null or due_date >= now()), 0) as current,
           coalesce(sum(amount_remaining_cents) filter (where due_date < now() and due_date >= now() - interval '30 days'), 0) as d30,
           coalesce(sum(amount_remaining_cents) filter (where due_date < now() - interval '30 days' and due_date >= now() - interval '60 days'), 0) as d60,
           coalesce(sum(amount_remaining_cents) filter (where due_date < now() - interval '60 days' and due_date >= now() - interval '90 days'), 0) as d90,
           coalesce(sum(amount_remaining_cents) filter (where due_date < now() - interval '90 days'), 0) as over90,
           count(*) filter (where due_date < now())::int as past_due_invoices
      from invoices where status = 'open' and amount_remaining_cents > 0`);
  const pastDue = num(row.d30) + num(row.d60) + num(row.d90) + num(row.over90);
  return {
    total: num(row.total),
    invoices: num(row.invoices),
    pastDue,
    pastDueInvoices: num(row.past_due_invoices),
    aging: [
      { label: phrase("Not due yet"), cents: num(row.current) },
      { label: phrase("1–30 days late"), cents: num(row.d30) },
      { label: phrase("31–60 days late"), cents: num(row.d60) },
      { label: phrase("61–90 days late"), cents: num(row.d90) },
      { label: phrase("Over 90 days late"), cents: num(row.over90) },
    ],
  };
}

export async function topOwing(limit = 10) {
  return (
    await rows<{ id: number; code: string; name: string; cents: string; n: number; oldest_due: string | null }>(sql`
      select c.id, c.customer_code as code, ${display} as name, sum(i.amount_remaining_cents) as cents, count(*)::int as n, min(i.due_date) as oldest_due
        from invoices i join customers c on c.id = i.customer_id
       where i.status = 'open' and i.amount_remaining_cents > 0
       group by c.id order by 4 desc limit ${limit}`)
  ).map((x) => ({ ...x, id: Number(x.id), cents: num(x.cents) }));
}

// How long payment takes: invoice finalized → paid.
export async function daysToPaid(r: Range) {
  const [inv] = await rows<{ n: number; avg: string | null; median: string | null }>(sql`
    select count(*)::int as n,
           avg(extract(epoch from paid_at - finalized_at) / 86400) as avg,
           percentile_cont(0.5) within group (order by extract(epoch from paid_at - finalized_at) / 86400) as median
      from invoices
     where status = 'paid' and paid_at is not null and finalized_at is not null and ${inRange(sql`paid_at`, r)}`);
  const pack = (x: { n: number; avg: string | null; median: string | null }) => ({
    count: x.n,
    avgDays: x.avg == null ? null : Number(x.avg),
    medianDays: x.median == null ? null : Number(x.median),
  });
  return { invoice: pack(inv) };
}

// (operations) Completed visits with no invoice: no payment recorded against
// them and no invoice (other than a voided one) linked to them. Counted, not
// priced: money only comes from invoices.
const NOT_BILLED = sql`a.status = 'completed'
  and not exists (select 1 from payments p where p.appointment_id = a.id)
  and not exists (select 1 from invoices i where i.appointment_id = a.id and i.status <> 'void')`;

export async function notInvoiced(r: Range, limit = 50) {
  const where = sql`${NOT_BILLED} and ${inRange(sql`a.scheduled_start`, r)}`;
  const [totals] = await rows<{ n: number }>(sql`select count(*)::int as n from appointments a where ${where}`);
  const list = await rows<{ id: number; start: string; customer_id: number; code: string; name: string; street: string }>(sql`
    select a.id, a.scheduled_start as start, c.id as customer_id, c.customer_code as code, ${display} as name, pr.street
      from appointments a join customers c on c.id = a.customer_id join properties pr on pr.id = a.property_id
     where ${where} order by a.scheduled_start desc limit ${limit}`);
  return { count: totals.n, list: list.map((x) => ({ ...x, id: Number(x.id), customer_id: Number(x.customer_id) })) };
}

// ---------- customers ----------

// Customers count from their start date until their end date; leads aren't
// customers yet.
export async function customersByMonth(months: string[]) {
  if (months.length === 0) return [];
  return (
    await rows<{ month: string; active: number; added: number; lost: number }>(sql`
      with m as (select to_char(d, 'YYYY-MM') as month, d::date as first, (d + interval '1 month')::date as next
                   from generate_series(${`${months[0]}-01`}::date, ${`${months.at(-1)}-01`}::date, interval '1 month') d)
      select m.month,
             (select count(*) from customers c where c.status <> 'lead' and c.start_date < m.next and (c.end_date is null or c.end_date >= m.next))::int as active,
             (select count(*) from customers c where c.status <> 'lead' and c.start_date >= m.first and c.start_date < m.next)::int as added,
             (select count(*) from customers c where c.end_date >= m.first and c.end_date < m.next)::int as lost
        from m order by m.month`)
  );
}

export async function customerCounts(r: Range) {
  const [row] = await rows<Record<string, number>>(sql`
    select count(*) filter (where status = 'active')::int as active,
           count(*) filter (where status = 'paused')::int as paused,
           count(*) filter (where status = 'inactive')::int as inactive,
           count(*) filter (where status = 'lead')::int as leads,
           count(*) filter (where status <> 'lead' and start_date between ${r.from}::date and ${r.to}::date)::int as added,
           count(*) filter (where end_date between ${r.from}::date and ${r.to}::date)::int as lost,
           count(*) filter (where type = 'residential' and status <> 'lead')::int as residential,
           count(*) filter (where type = 'commercial' and status <> 'lead')::int as commercial,
           count(*) filter (where type = 'referral_partner' and status <> 'lead')::int as referral_partner,
           count(*) filter (where created_at >= ${startOf(r.from)} and created_at < ${endOf(r.to)})::int as created,
           count(*) filter (where created_at >= ${startOf(r.from)} and created_at < ${endOf(r.to)} and status <> 'lead')::int as created_converted
      from customers`);
  return row;
}

export async function churnReasons(r: Range) {
  return (
    await rows<{ reason: string; n: number }>(sql`
      select coalesce(reason::text, 'not recorded') as reason, count(*)::int as n
        from customers c left join lateral unnest(nullif(c.end_reasons, '{}')) as reason on true
       where c.end_date between ${r.from}::date and ${r.to}::date
       group by 1 order by 2 desc`)
  );
}

// How long customers stay, and what a customer is worth on average.
export async function lifetime() {
  const [row] = await rows<Record<string, string | null>>(sql`
    with ${COLLECTED},
    paid as (select customer_id, sum(cents) as cents from collected group by customer_id)
    select avg((c.end_date - c.start_date)) filter (where c.end_date is not null) as ended_days,
           avg((current_date - c.start_date)) filter (where c.end_date is null and c.status = 'active') as active_days,
           count(*) filter (where c.end_date is not null)::int as ended,
           (select avg(cents) from paid) as value_per_customer,
           (select count(*) from paid)::int as paying
      from customers c where c.status <> 'lead'`);
  return {
    endedAvgDays: row.ended_days == null ? null : Number(row.ended_days),
    activeAvgDays: row.active_days == null ? null : Number(row.active_days),
    ended: num(row.ended),
    valuePerCustomer: row.value_per_customer == null ? null : Number(row.value_per_customer),
    payingCustomers: num(row.paying),
  };
}

export async function topCustomersAllTime(limit = 10) {
  return topCustomers({ from: "2000-01-01", to: "2100-01-01" }, limit);
}

export async function referrals(r: Range) {
  const [row] = await rows<{ referred: number; total: number }>(sql`
    select count(*) filter (where referred_by_id is not null)::int as referred, count(*)::int as total
      from customers where status <> 'lead' and start_date between ${r.from}::date and ${r.to}::date`);
  const top = await rows<{ id: number; code: string; name: string; n: number }>(sql`
    select c.id, c.customer_code as code, ${display} as name, count(*)::int as n
      from customers r join customers c on c.id = r.referred_by_id
     group by c.id order by 4 desc limit 10`);
  return { referred: row.referred, total: row.total, top: top.map((x) => ({ ...x, id: Number(x.id) })) };
}

// ---------- operations ----------

export async function visitsByWeek(r: Range) {
  const week = sql`to_char(date_trunc('week', a.scheduled_start at time zone ${TZ}), 'YYYY-MM-DD')`;
  return rows<{ week: string; completed: number; canceled: number; pending: number }>(sql`
    select ${week} as week,
           count(*) filter (where status = 'completed')::int as completed,
           count(*) filter (where status = 'canceled')::int as canceled,
           count(*) filter (where status in ('pending', 'in_progress'))::int as pending
      from appointments a where ${inRange(sql`a.scheduled_start`, r)} group by ${week} order by 1`);
}

export async function visitCounts(r: Range) {
  const [row] = await rows<{ completed: number; canceled: number; pending: number }>(sql`
    select count(*) filter (where status = 'completed')::int as completed,
           count(*) filter (where status = 'canceled')::int as canceled,
           count(*) filter (where status in ('pending', 'in_progress'))::int as pending
      from appointments a where ${inRange(sql`a.scheduled_start`, r)}`);
  return row;
}

export async function busiestWeekdays(r: Range) {
  // 1 = Monday … 7 = Sunday
  return rows<{ dow: number; visits: number }>(sql`
    select extract(isodow from a.scheduled_start at time zone ${TZ})::int as dow, count(*)::int as visits
      from appointments a where ${completedWhere(r)} group by 1 order by 1`);
}

// Expected revenue a month from active customers' recurring (memorized)
// invoices: each visit's amount × visits a month. Paused ones don't count.
export async function recurringRevenue() {
  const plans = await rows<{ frequency: Frequency; plans: number; cents: string }>(sql`
    select m.frequency, count(*)::int as plans, sum(m.total_cents) as cents
      from memorized_invoices m join customers c on c.id = m.customer_id
     where m.is_active and c.status = 'active' and (m.paused_until is null or m.paused_until <= current_date)
     group by 1`);
  const byFrequency = plans.map((p) => ({ frequency: p.frequency as string, plans: p.plans, monthlyCents: Math.round(num(p.cents) * visitsPerMonth(p.frequency)) }));
  return { monthlyCents: byFrequency.reduce((s, p) => s + p.monthlyCents, 0), byFrequency: byFrequency.sort((a, b) => b.monthlyCents - a.monthlyCents) };
}

// Invoiced (finalized, not void) by the invoice's property's service zone.
export async function revenueByZone(r: Range) {
  return (
    await rows<{ zone: string | null; cents: string; n: number }>(sql`
      select p.zone::text as zone, coalesce(sum(i.total_cents), 0) as cents, count(*)::int as n
        from invoices i left join properties p on p.id = i.property_id
       where ${INVOICED} and ${inRange(sql`i.finalized_at`, r)} group by 1 order by 2 desc`)
  ).map((x) => ({ zone: x.zone, cents: num(x.cents), invoices: x.n }));
}

// Hours booked on each vehicle, against the weeks in the range.
export async function vehicleHours(r: Range) {
  return (
    await rows<{ id: number; name: string; hours: string; visits: number }>(sql`
      select v.id, v.name, sum(extract(epoch from a.scheduled_end - a.scheduled_start) / 3600) as hours, count(*)::int as visits
        from appointments a join vehicles v on v.id = a.vehicle_id
       where a.status <> 'canceled' and ${inRange(sql`a.scheduled_start`, r)}
       group by v.id order by 3 desc`)
  ).map((x) => ({ id: Number(x.id), name: x.name, hours: num(x.hours), visits: x.visits }));
}

// ---------- pricing ----------

// Completed visits with real arrival and departure times, priced by their
// open or paid invoices (b.cents): money from invoices, time from the visit.
const BILLED = sql`join (select appointment_id, sum(total_cents) as cents from invoices
  where status in ('open', 'paid') and appointment_id is not null group by 1) b on b.appointment_id = a.id`;
const TIMED = sql`a.status = 'completed' and b.cents > 0 and a.actual_arrival is not null and a.actual_departure is not null
  and a.actual_departure > a.actual_arrival and a.actual_departure - a.actual_arrival < interval '12 hours'`;

export async function revenuePerHour(r: Range) {
  const [row] = await rows<{ cents: string; minutes: string; visits: number; labor_minutes: string | null; with_crew: number; from_gps: number }>(sql`
    select coalesce(sum(b.cents), 0) as cents,
           count(*) filter (where a.actual_source in ('gps', 'gps_simulated'))::int as from_gps,
           coalesce(sum(extract(epoch from a.actual_departure - a.actual_arrival) / 60), 0) as minutes,
           count(*)::int as visits,
           sum(extract(epoch from a.actual_departure - a.actual_arrival) / 60 * a.crew_size) as labor_minutes,
           count(*) filter (where a.crew_size is not null)::int as with_crew
      from appointments a ${BILLED} where ${TIMED} and ${inRange(sql`a.scheduled_start`, r)}`);
  const minutes = num(row.minutes);
  return {
    visits: row.visits,
    centsPerHour: minutes ? Math.round(num(row.cents) / (minutes / 60)) : null,
    avgMinutes: row.visits ? minutes / row.visits : null,
    withCrew: row.with_crew,
    // visits whose times came from GPS rather than the calendar import
    fromGps: row.from_gps,
    centsPerLaborHour: row.labor_minutes && num(row.labor_minutes) > 0 ? Math.round(num(row.cents) / (num(row.labor_minutes) / 60)) : null,
  };
}

export async function revenuePerHourByMonth(r: Range) {
  const month = localMonth(sql`a.scheduled_start`);
  return (
    await rows<{ month: string; cents: string; minutes: string }>(sql`
      select ${month} as month, sum(b.cents) as cents, sum(extract(epoch from a.actual_departure - a.actual_arrival) / 60) as minutes
        from appointments a ${BILLED} where ${TIMED} and ${inRange(sql`a.scheduled_start`, r)} group by ${month} order by 1`)
  ).map((x) => ({ month: x.month, centsPerHour: num(x.minutes) ? Math.round(num(x.cents) / (num(x.minutes) / 60)) : 0 }));
}

// Per property: price, time on site, revenue per hour, and how far visits run
// past the booked time. Lowest revenue per hour first (likely underpriced).
export async function pricingByProperty(r: Range, limit = 100) {
  return (
    await rows<{
      property_id: number; street: string; customer_id: number; code: string; name: string; visits: number;
      avg_price: string; median_minutes: string; cents_per_hour: string; avg_booked: string; avg_over: string;
    }>(sql`
      select p.id as property_id, p.street, c.id as customer_id, c.customer_code as code, ${display} as name, count(*)::int as visits,
             avg(b.cents) as avg_price,
             percentile_cont(0.5) within group (order by extract(epoch from a.actual_departure - a.actual_arrival) / 60) as median_minutes,
             sum(b.cents) / nullif(sum(extract(epoch from a.actual_departure - a.actual_arrival) / 3600), 0) as cents_per_hour,
             avg(extract(epoch from ${BOOKED_END} - ${BOOKED_START}) / 60) as avg_booked,
             avg(extract(epoch from (a.actual_departure - a.actual_arrival) - (${BOOKED_END} - ${BOOKED_START})) / 60) as avg_over
        from appointments a ${BILLED} join properties p on p.id = a.property_id join customers c on c.id = a.customer_id
       where ${TIMED} and ${inRange(sql`a.scheduled_start`, r)}
       group by p.id, c.id order by 9 asc nulls last limit ${limit}`)
  ).map((x) => ({
    propertyId: Number(x.property_id),
    street: x.street,
    customerId: Number(x.customer_id),
    code: x.code,
    name: x.name,
    visits: x.visits,
    avgPriceCents: Math.round(num(x.avg_price)),
    medianMinutes: Math.round(num(x.median_minutes)),
    centsPerHour: Math.round(num(x.cents_per_hour)),
    avgBookedMinutes: Math.round(num(x.avg_booked)),
    avgOverMinutes: Math.round(num(x.avg_over)),
  }));
}

// Miles driven to each customer (trips that ended at their properties).
export async function driveMilesByCustomer(r: Range, limit = 15) {
  return (
    await rows<{ id: number; code: string; name: string; visits: number; miles: string }>(sql`
      select c.id, c.customer_code as code, ${display} as name, count(*)::int as visits, sum(t.distance_miles) as miles
        from vehicle_trips t join properties p on p.id = t.end_property_id join customers c on c.id = p.customer_id
       where t.is_simulated = false and ${inRange(sql`t.start_at`, r)}
       group by c.id order by 5 desc limit ${limit}`)
  ).map((x) => ({ ...x, id: Number(x.id), miles: num(x.miles) }));
}

// ---------- fleet ----------

export async function milesByVehicleMonth(r: Range) {
  const month = localMonth(sql`t.start_at`);
  return (
    await rows<{ month: string; vehicle: string; miles: string; fuel: string; trips: number }>(sql`
      select ${month} as month, v.name as vehicle, sum(t.distance_miles) as miles, coalesce(sum(t.fuel_gallons), 0) as fuel, count(*)::int as trips
        from vehicle_trips t join vehicles v on v.id = t.vehicle_id
       where t.is_simulated = false and ${inRange(sql`t.start_at`, r)}
       group by ${month}, v.name order by 1, 2`)
  ).map((x) => ({ month: x.month, vehicle: x.vehicle, miles: num(x.miles), fuel: num(x.fuel), trips: x.trips }));
}

// On time = arrived no more than 5 minutes after the booked start (GPS moves
// today's scheduled start to the arrival, so the booked time is what counts). Only
// arrivals detected by GPS (Bouncie) count: imported calendar times are just
// the booked times, which would always look on time.
export async function onTimeByMonth(r: Range) {
  const month = localMonth(sql`a.scheduled_start`);
  return (
    await rows<{ month: string; visits: number; on_time: number; gps: number }>(sql`
      select ${month} as month, count(*)::int as visits,
             count(*) filter (where a.actual_arrival <= ${BOOKED_START} + interval '5 minutes')::int as on_time,
             count(*) filter (where a.actual_source in ('gps', 'gps_simulated'))::int as gps
        from appointments a
       where a.status = 'completed' and a.actual_arrival is not null and a.actual_source in ('gps', 'gps_simulated')
         and ${inRange(sql`a.scheduled_start`, r)}
       group by ${month} order by 1`)
  ).map((x) => ({ month: x.month, visits: x.visits, onTime: x.on_time, gps: x.gps }));
}

export async function maintenanceDue() {
  return (
    await rows<{ id: number; name: string; odometer: number | null; interval: number; last_odometer: number | null; mil_on: boolean | null; battery: string | null }>(sql`
      select v.id, v.name, v.odometer, v.service_interval_miles as interval, v.mil_on, v.battery_status as battery,
             (select r.odometer from vehicle_service_records r where r.vehicle_id = v.id order by r.performed_on desc, r.id desc limit 1) as last_odometer
        from vehicles v where v.is_active order by v.name`)
  ).map((v) => {
    const milesLeft = v.odometer != null && v.last_odometer != null ? Math.round(v.last_odometer + v.interval - v.odometer) : null;
    return { id: Number(v.id), name: v.name, milesLeft, milOn: Boolean(v.mil_on), battery: v.battery };
  });
}
