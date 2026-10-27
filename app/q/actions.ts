"use server";

import { and, desc, eq, gt, sql } from "drizzle-orm";
import { after } from "next/server";
import { headers } from "next/headers";
import { db } from "@/db";
import { customers, quoteAcceptances, quoteEvents, quotes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { company } from "@/lib/company";
import { pgError } from "@/lib/db-helpers";
import { logError } from "@/lib/log";
import { notify } from "@/lib/notifications";
import { totalFor } from "@/lib/quotes/content";
import { fingerprint } from "@/lib/quotes/fingerprint";
import { invoiceAcceptedQuote } from "@/lib/quotes/invoice";
import { isOpen, quoteState } from "@/lib/quotes/status";
import { CONSENT_VERSION, consentText } from "@/lib/quotes/terms";
import { todayISO } from "../(app)/customers/options";
import { quoteByToken, snapshotOf, verifierFor } from "./load";

type Msg = { message?: string; ok?: boolean };
const MAX_FAILURES = 5;
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

async function client() {
  const h = await headers();
  return {
    ip: (h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "").slice(0, 64) || null,
    userAgent: (h.get("user-agent") ?? "").slice(0, 300) || null,
  };
}

// Counts an opening of the page (sent from the browser, so link previews in
// text messages don't count); the same device within 30 minutes counts once.
export async function recordView(token: string) {
  // staff looking at the customer's page isn't the customer viewing it
  if (await getCurrentUser()) return;
  const q = await quoteByToken(token);
  if (!q) return;
  const { ip, userAgent } = await client();
  const [recent] = await db
    .select({ id: quoteEvents.id })
    .from(quoteEvents)
    .where(and(eq(quoteEvents.quoteId, q.quote.id), eq(quoteEvents.kind, "viewed"), sql`${quoteEvents.ipAddress} is not distinct from ${ip}`, gt(quoteEvents.createdAt, sql`now() - interval '30 minutes'`)))
    .orderBy(desc(quoteEvents.createdAt))
    .limit(1);
  if (recent) return;
  await db.batch([
    db
      .update(quotes)
      .set({ viewCount: sql`${quotes.viewCount} + 1`, lastViewedAt: sql`now()`, firstViewedAt: sql`coalesce(${quotes.firstViewedAt}, now())` })
      .where(eq(quotes.id, q.quote.id)),
    db.insert(quoteEvents).values({ quoteId: q.quote.id, kind: "viewed", ipAddress: ip, userAgent }),
  ]);
}

// The customer accepts. Everything is checked again here: the quote is open
// and unchanged since the page loaded, the choice is on it, their identity
// check matches, they typed their name and gave both consents. The record
// is written in one transaction with the quote marked accepted.
export async function acceptQuote(token: string, _prev: Msg, f: FormData): Promise<Msg> {
  // the customer accepts from their own device, never staff on their behalf
  if (await getCurrentUser()) return { message: "You're signed in to MaidCare: only the customer can accept, from their own phone or computer." };
  const q = await quoteByToken(token);
  if (!q) return { message: "This estimate isn't available anymore. Call or text us." };
  const today = todayISO();
  if (q.acceptance || q.quote.status === "accepted") return { message: "This estimate was already accepted." };
  if (!isOpen(quoteState(q.quote, today))) return { message: `This estimate can't be accepted anymore. Call or text ${company.phone} and we'll send a new one.` };
  if (q.quote.verifyLockedUntil && Date.parse(q.quote.verifyLockedUntil) > Date.now()) return { message: `Too many tries. Try again in an hour, or call or text ${company.phone}.` };

  const snapshot = snapshotOf(q);
  const sha = fingerprint(snapshot);
  if (String(f.get("version")) !== String(q.quote.version) || String(f.get("sha")) !== sha) return { message: "This estimate was just updated. Reload the page to see the latest before accepting." };

  const optionId = String(f.get("optionId") ?? (q.quote.content.options.length === 1 ? q.quote.content.options[0].id : ""));
  const addOnIds = f.getAll("addOnIds").map(String);
  const choice = totalFor(q.quote.content, optionId, addOnIds);
  if (!choice) return { message: q.quote.content.options.length > 1 ? "Choose one of the options." : "Something about your choice doesn't match this estimate. Reload and try again." };

  const signerName = String(f.get("signerName") ?? "").trim().replace(/\s+/g, " ");
  if (signerName.length < 2 || signerName.length > 100) return { message: "Type your full name to sign." };
  if (f.get("agree") !== "on") return { message: "Tick the box to accept." };

  const verifier = verifierFor(q.parties);
  const { ip, userAgent } = await client();
  if (!verifier.matches(String(f.get("verify") ?? ""))) {
    const failures = q.quote.verifyFailures + 1;
    const locked = failures >= MAX_FAILURES;
    await db.batch([
      db
        .update(quotes)
        .set(locked ? { verifyFailures: 0, verifyLockedUntil: sql`now() + interval '1 hour'` } : { verifyFailures: failures })
        .where(eq(quotes.id, q.quote.id)),
      db.insert(quoteEvents).values({ quoteId: q.quote.id, kind: "verify_failed", detail: { locked }, ipAddress: ip, userAgent }),
    ]);
    if (locked) await notify({ kind: "quote_locked", title: "Estimate #{number}: too many wrong identity checks", body: "Acceptance is locked for an hour. If it was the customer, help them by phone.", href: `/finances/estimates/${q.quote.id}`, vars: { number: q.quote.quoteNumber } });
    return { message: locked ? `That didn't match, and we've paused this for an hour to keep it safe. Call or text ${company.phone}.` : verifier.kind === "phone" ? "That doesn't match the phone number we have for you." : "That doesn't match the email we have for you." };
  }

  const consent = consentText().join("\n\n");
  try {
    await db.batch([
      db.insert(quoteAcceptances).values({
        quoteId: q.quote.id,
        quoteVersion: q.quote.version,
        optionId: choice.option.id,
        optionName: choice.option.name,
        addOnIds: choice.addOns.map((a) => a.id),
        totalCents: choice.totalCents,
        signerName,
        verifiedBy: verifier.kind,
        consentVersion: CONSENT_VERSION,
        consentText: consent,
        snapshot,
        snapshotSha256: sha,
        ipAddress: ip,
        userAgent,
      }),
      db.update(quotes).set({ status: "accepted", acceptedAt: sql`now()`, verifyFailures: 0 }).where(and(eq(quotes.id, q.quote.id), eq(quotes.status, "sent"))),
      db.insert(quoteEvents).values({ quoteId: q.quote.id, kind: "accepted", detail: { option: choice.option.name, addOns: choice.addOns.map((a) => a.name), totalCents: choice.totalCents, signerName }, ipAddress: ip, userAgent }),
      // a lead who accepts becomes a customer
      db.update(customers).set({ status: "active", startDate: today }).where(and(eq(customers.id, q.quote.customerId), eq(customers.status, "lead"))),
    ]);
  } catch (err) {
    const pg = pgError(err);
    if (pg?.code === "23505") return { message: "This estimate was already accepted." };
    logError("quote accept failed", err);
    return { message: `Something went wrong saving your acceptance. Please try again, or call or text ${company.phone}.` };
  }

  const extras = choice.addOns.length ? ` + ${choice.addOns.map((a) => a.name).join(", ")}` : "";
  await notify({
    kind: "quote_accepted",
    title: "Estimate #{number} accepted by {name}",
    body: "{choice} · {total}. Call to schedule the first visit.",
    href: `/finances/estimates/${q.quote.id}`,
    vars: { number: q.quote.quoteNumber, name: q.parties.name, choice: `${choice.option.name}${extras}`, total: usd(choice.totalCents) },
  });
  // the draft invoice is made after answering, so the customer isn't kept waiting
  after(() => invoiceAcceptedQuote(q.quote.id).catch((err) => logError("quote invoice failed", err)));
  return { ok: true };
}

export async function declineQuote(token: string, _prev: Msg, f: FormData): Promise<Msg> {
  if (await getCurrentUser()) return { message: "You're signed in to MaidCare: only the customer can decline here." };
  const q = await quoteByToken(token);
  if (!q) return { message: "This estimate isn't available anymore." };
  if (!isOpen(quoteState(q.quote, todayISO()))) return { message: "This estimate is closed." };
  const reason = [String(f.get("reason") ?? ""), String(f.get("detail") ?? "")].map((s) => s.trim()).filter(Boolean).join(": ").slice(0, 500) || null;
  const { ip, userAgent } = await client();
  await db.batch([
    db.update(quotes).set({ status: "declined", declinedAt: sql`now()`, declineReason: reason }).where(and(eq(quotes.id, q.quote.id), eq(quotes.status, "sent"))),
    db.insert(quoteEvents).values({ quoteId: q.quote.id, kind: "declined", detail: { reason }, ipAddress: ip, userAgent }),
  ]);
  await notify({
    kind: "quote_declined",
    title: "Estimate #{number} declined by {name}",
    body: reason ? "{reason}" : "No reason given.",
    href: `/finances/estimates/${q.quote.id}`,
    vars: { number: q.quote.quoteNumber, name: q.parties.name, reason: reason ?? "" },
  });
  return { ok: true };
}
