// Compares the app's customers and visits with what's in Stripe, and writes a
// report of anything that looks wrong. READ ONLY: it never changes Stripe or
// the database.
//
//   npm run stripe:audit -- <report.md>             (live Stripe, needs STRIPE_AUDIT_KEY)
//   npm run stripe:audit -- <report.md> --sandbox   (the sandbox in STRIPE_SECRET_KEY, to try it out)
//
// STRIPE_AUDIT_KEY must be a *restricted* live key (rk_live_…) with read
// access only, so this script can't change anything even by mistake. The
// report contains customer names: keep it out of the repository.
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "../db";

const [outPath, ...flags] = process.argv.slice(2);
if (!outPath) throw new Error("Usage: npm run stripe:audit -- <report.md> [--sandbox]");
const sandbox = flags.includes("--sandbox");
const key = (sandbox ? process.env.STRIPE_SECRET_KEY : process.env.STRIPE_AUDIT_KEY)?.trim() ?? "";
if (sandbox ? !key.startsWith("sk_test_") : !key.startsWith("rk_live_")) {
  throw new Error(
    sandbox
      ? "--sandbox needs a test key (sk_test_…) in STRIPE_SECRET_KEY."
      : "Set STRIPE_AUDIT_KEY to a restricted, read-only live key (rk_live_…). Full keys (sk_live_…) are refused.",
  );
}
const stripe = new Stripe(key, { maxNetworkRetries: 2 });
const TZ = "America/New_York";

// ---------- helpers ----------
const norm = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
const digits = (s: string | null | undefined) => {
  const d = (s ?? "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
};
const day = (unix: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(unix * 1000));
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const codeIn = (name: string | null | undefined) => /\b(C\d{3,6})\b/i.exec(name ?? "")?.[1]?.toUpperCase() ?? null;
// the customer name without a leading code, e.g. "C1001 Amy Meyers" -> "amymeyers"
const bareName = (name: string | null | undefined) => norm((name ?? "").replace(/\bC\d{3,6}\b/i, ""));

async function main() {
  // ---------- load ----------
  console.log(`Reading ${sandbox ? "sandbox" : "live"} Stripe…`);
  const stripeCustomers: Stripe.Customer[] = [];
  for await (const c of stripe.customers.list({ limit: 100 })) stripeCustomers.push(c);
  const stripeInvoices: Stripe.Invoice[] = [];
  for await (const inv of stripe.invoices.list({ limit: 100 })) stripeInvoices.push(inv);
  console.log(`  ${stripeCustomers.length} customers, ${stripeInvoices.length} invoices`);

  console.log("Reading the app's database…");
  type AppCustomer = {
    id: number;
    code: string;
    first_name: string | null;
    last_name: string | null;
    company_name: string | null;
    email: string | null;
    status: string;
    stripe_customer_id: string | null;
    street: string | null;
    zip: string | null;
    phones: string[] | null;
  };
  const appCustomers = (
    await db.execute(sql`
      select c.id, c.customer_code as code, c.first_name, c.last_name, c.company_name, c.email, c.status::text as status, c.stripe_customer_id,
             bp.street, bp.zip,
             (select array_agg(ct.phone) from contacts ct where ct.customer_id = c.id and ct.phone is not null) as phones
        from customers c left join properties bp on bp.id = c.billing_property_id
       order by length(c.customer_code), c.customer_code`)
  ).rows as AppCustomer[];
  type Visit = { id: number; customer_id: number; day: string; price: number; status: string };
  const visits = (
    await db.execute(sql`
      select a.id, a.customer_id, to_char(a.scheduled_start at time zone ${TZ}, 'YYYY-MM-DD') as day, a.price_cents as price, a.status
        from appointments a where a.status = 'completed' order by a.scheduled_start`)
  ).rows as Visit[];
  const nameOf = (c: AppCustomer) => [c.first_name, c.last_name].filter(Boolean).join(" ") || c.company_name || c.code;
  console.log(`  ${appCustomers.length} customers, ${visits.length} completed visits`);

  // ---------- match Stripe customers to app customers ----------
  type Match = { app: AppCustomer; how: string[] };
  const invoicesOf = (stripeId: string) =>
    stripeInvoices.filter((i) => (typeof i.customer === "string" ? i.customer : i.customer?.id) === stripeId);
  const paidTotal = (stripeId: string) => invoicesOf(stripeId).reduce((s, i) => s + (i.status === "paid" ? i.amount_paid : 0), 0);
  const lastInvoice = (stripeId: string) => {
    const list = invoicesOf(stripeId);
    return list.length ? day(Math.max(...list.map((i) => i.created))) : "never";
  };

  const matchesFor = new Map<string, Match[]>(); // stripe id -> app customers it matches
  for (const sc of stripeCustomers) {
    const found: Match[] = [];
    for (const app of appCustomers) {
      const how: string[] = [];
      if (app.stripe_customer_id === sc.id) how.push("saved Stripe id");
      if (sc.metadata?.app_customer_id === String(app.id)) how.push("app id in Stripe");
      const code = codeIn(sc.name) ?? sc.metadata?.customer_code?.toUpperCase();
      if (code && code === app.code.toUpperCase()) how.push("customer code");
      if (sc.email && app.email && norm(sc.email) === norm(app.email)) how.push("email");
      const scPhone = digits(sc.phone);
      if (scPhone.length >= 10 && (app.phones ?? []).some((p) => digits(p) === scPhone)) how.push("phone");
      const bn = bareName(sc.name);
      if (bn.length >= 4 && (bn === norm(nameOf(app)) || (app.company_name && bn === norm(app.company_name)))) how.push("name");
      if (
        sc.address?.line1 &&
        app.street &&
        norm(sc.address.line1) === norm(app.street) &&
        (!sc.address.postal_code || sc.address.postal_code === app.zip)
      )
        how.push("address");
      if (how.length) found.push({ app, how });
    }
    matchesFor.set(sc.id, found);
  }

  // ---------- findings ----------
  const lines: string[] = [];
  const h = (s: string) => lines.push("", `## ${s}`, "");
  const stripeLabel = (sc: Stripe.Customer) =>
    `${sc.name ?? "(no name)"} \`${sc.id}\` · ${sc.email ?? "no email"} · ${invoicesOf(sc.id).length} invoices, ${usd(paidTotal(sc.id))} paid, last ${lastInvoice(sc.id)}`;
  const appLabel = (a: AppCustomer) => `${a.code} ${nameOf(a)} (${a.status})`;
  const live = new Set(stripeCustomers.map((c) => c.id));

  lines.push(
    `# Stripe vs app audit (${sandbox ? "sandbox" : "live"} Stripe)`,
    "",
    `Generated ${new Date().toISOString()}. Read only: nothing was changed.`,
  );
  lines.push(
    "",
    `Stripe: ${stripeCustomers.length} customers, ${stripeInvoices.length} invoices. App: ${appCustomers.length} customers, ${visits.length} completed visits.`,
  );

  // 1. app customers matching several Stripe customers (likely duplicates in Stripe)
  const stripeFor = new Map<number, { sc: Stripe.Customer; how: string[] }[]>();
  for (const sc of stripeCustomers)
    for (const m of matchesFor.get(sc.id) ?? []) {
      const list = stripeFor.get(m.app.id) ?? [];
      list.push({ sc, how: m.how });
      stripeFor.set(m.app.id, list);
    }
  const dupes = [...stripeFor.entries()].filter(([, list]) => list.length > 1);
  h(`1. App customers that match more than one Stripe customer (${dupes.length})`);
  lines.push("Likely duplicate customers in Stripe. Usually one should be kept and its invoices are spread across both.", "");
  for (const [appId, list] of dupes) {
    const app = appCustomers.find((a) => a.id === appId)!;
    lines.push(`- **${appLabel(app)}**`);
    for (const { sc, how } of list) lines.push(`  - ${stripeLabel(sc)} — matched by ${how.join(", ")}`);
  }

  // 2. Stripe customers that match no app customer
  const orphans = stripeCustomers.filter((sc) => (matchesFor.get(sc.id) ?? []).length === 0);
  h(`2. Stripe customers with no matching app customer (${orphans.length})`);
  for (const sc of orphans.sort((a, b) => invoicesOf(b.id).length - invoicesOf(a.id).length)) lines.push(`- ${stripeLabel(sc)}`);

  // 3. Stripe customers matching several app customers (ambiguous, or duplicate app customers)
  const ambiguous = stripeCustomers.filter((sc) => (matchesFor.get(sc.id) ?? []).length > 1);
  h(`3. Stripe customers that match more than one app customer (${ambiguous.length})`);
  lines.push("Either duplicate customers in the app, or two people sharing an email/phone/address.", "");
  for (const sc of ambiguous) {
    lines.push(`- ${stripeLabel(sc)}`);
    for (const m of matchesFor.get(sc.id)!) lines.push(`  - ${appLabel(m.app)} — by ${m.how.join(", ")}`);
  }

  // 4. app customers with no Stripe customer at all
  const noStripe = appCustomers.filter((a) => !stripeFor.has(a.id) && a.status !== "lead");
  h(`4. App customers (not leads) with no matching Stripe customer (${noStripe.length})`);
  for (const a of noStripe)
    lines.push(
      `- ${appLabel(a)}${a.stripe_customer_id ? ` — saved Stripe id \`${a.stripe_customer_id}\` isn't in this Stripe account` : ""}`,
    );

  // 5. saved Stripe ids that point nowhere (deleted, or from the other Stripe mode)
  const deadIds = appCustomers.filter((a) => a.stripe_customer_id && !live.has(a.stripe_customer_id));
  h(`5. App customers whose saved Stripe id isn't in this Stripe account (${deadIds.length})`);
  lines.push(
    "From the sandbox, deleted in Stripe, or typed wrong. The suggested match (if any) is the Stripe customer that matches by other details.",
    "",
  );
  for (const a of deadIds) {
    const suggestion = (stripeFor.get(a.id) ?? []).map((x) => `\`${x.sc.id}\` (${x.how.join(", ")})`).join(" or ");
    lines.push(`- ${appLabel(a)}: \`${a.stripe_customer_id}\`${suggestion ? ` → suggested: ${suggestion}` : ""}`);
  }

  // 6. details that differ between a matched pair
  h("6. Details that differ between matched customers");
  let diffs = 0;
  for (const [appId, list] of stripeFor) {
    if (list.length !== 1) continue;
    const app = appCustomers.find((a) => a.id === appId)!;
    const sc = list[0].sc;
    const notes: string[] = [];
    if (sc.email && app.email && norm(sc.email) !== norm(app.email)) notes.push(`email: Stripe ${sc.email} vs app ${app.email}`);
    if (sc.email && !app.email) notes.push(`email only in Stripe: ${sc.email}`);
    if (bareName(sc.name) && bareName(sc.name) !== norm(nameOf(app)) && bareName(sc.name) !== norm(app.company_name))
      notes.push(`name: Stripe "${sc.name}" vs app "${nameOf(app)}"`);
    if (sc.address?.line1 && app.street && norm(sc.address.line1) !== norm(app.street))
      notes.push(`address: Stripe "${sc.address.line1}" vs app billing "${app.street}"`);
    if (notes.length) {
      diffs++;
      lines.push(`- **${appLabel(app)}** ↔ \`${sc.id}\`: ${notes.join("; ")}`);
    }
  }
  if (!diffs) lines.push("None.");

  // 7. visits vs invoices: each completed visit should have an invoice
  h("7. Completed visits vs invoices");
  lines.push(
    "Each completed visit is matched to an unused invoice of the same customer (any of their Stripe customers), dated 3 days before to 21 days after the visit, preferring the same amount. Voided invoices are ignored.",
    "",
  );
  const used = new Set<string>();
  const unmatchedVisits: { v: Visit; app: AppCustomer }[] = [];
  const amountDiffs: string[] = [];
  let matched = 0;
  for (const v of visits) {
    const app = appCustomers.find((a) => a.id === v.customer_id);
    if (!app) continue;
    const theirInvoices = (stripeFor.get(app.id) ?? [])
      .flatMap((x) => invoicesOf(x.sc.id))
      .filter((i) => i.status !== "void" && i.status !== "draft" && !used.has(i.id!));
    const visitTime = Date.parse(`${v.day}T12:00:00Z`) / 1000;
    const candidates = theirInvoices
      .map((i) => {
        const lineStart = i.lines?.data?.[0]?.period?.start;
        const when = lineStart && Math.abs(lineStart - i.created) > 3600 ? lineStart : i.created;
        return { i, offsetDays: (when - visitTime) / 86400 };
      })
      .filter((x) => x.offsetDays >= -3 && x.offsetDays <= 21)
      .sort((a, b) => Number(b.i.total === v.price) - Number(a.i.total === v.price) || Math.abs(a.offsetDays) - Math.abs(b.offsetDays));
    const best = candidates[0];
    if (!best) {
      unmatchedVisits.push({ v, app });
      continue;
    }
    used.add(best.i.id!);
    matched++;
    if (best.i.total !== v.price)
      amountDiffs.push(`- ${v.day} ${appLabel(app)}: visit ${usd(v.price)} vs invoice ${best.i.number ?? best.i.id} ${usd(best.i.total)}`);
  }
  lines.push(`${matched} of ${visits.length} completed visits have an invoice.`, "");
  lines.push(`### Visits with no invoice found (${unmatchedVisits.length})`, "");
  for (const { v, app } of unmatchedVisits)
    lines.push(`- ${v.day} ${appLabel(app)} · ${usd(v.price)}${stripeFor.has(app.id) ? "" : " (customer not matched to Stripe)"}`);
  lines.push("", `### Visit price differs from its invoice (${amountDiffs.length})`, "", ...amountDiffs);
  const unusedPaid = stripeInvoices.filter(
    (i) => i.status === "paid" && !used.has(i.id!) && visits.length && i.created >= Date.parse(`${visits[0].day}T00:00:00Z`) / 1000,
  );
  lines.push("", `### Paid invoices since the first visit with no visit matched (${unusedPaid.length})`, "");
  lines.push("Could be extra charges, visits not in the app, or a visit booked under a different customer.", "");
  for (const i of unusedPaid) {
    const sc = stripeCustomers.find((c) => c.id === (typeof i.customer === "string" ? i.customer : i.customer?.id));
    lines.push(`- ${i.number ?? i.id} ${day(i.created)} ${usd(i.total)} · ${sc?.name ?? "unknown customer"}`);
  }

  writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(`\nSummary:
    1. app customers with several Stripe customers: ${dupes.length}
    2. Stripe customers with no app customer:      ${orphans.length}
    3. Stripe customers matching several app ones: ${ambiguous.length}
    4. app customers with no Stripe customer:      ${noStripe.length}
    5. saved Stripe ids not in this account:       ${deadIds.length}
    6. matched pairs with differing details:       ${diffs}
    7. visits with an invoice:                     ${matched}/${visits.length} (price differs on ${amountDiffs.length}); paid invoices with no visit: ${unusedPaid.length}
  Report written to ${outPath}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
