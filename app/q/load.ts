import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { quoteAcceptances, quotes } from "@/db/schema";
import { company } from "@/lib/company";
import { checkContent } from "@/lib/quotes/content";
import { partiesFor } from "../(app)/finances/estimates/data";

// A quote by its link token, as the customer sees it. Drafts and withdrawn
// quotes aren't shown.
export async function quoteByToken(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const [q] = await db.select().from(quotes).where(eq(quotes.publicToken, token));
  if (!q || q.status === "draft" || q.status === "withdrawn") return null;
  const [acceptance] = await db.select().from(quoteAcceptances).where(eq(quoteAcceptances.quoteId, q.id));
  const parties = await partiesFor(q.customerId, q.propertyId);
  return { quote: { ...q, content: checkContent(q.content).content }, acceptance: acceptance ?? null, parties };
}

// How the customer proves it's them: the last 4 digits of a phone number on
// file, or else the email on file. Neither is shown on their page.
export function verifierFor(parties: { phones: string[]; email: string | null }) {
  const last4s = parties.phones.map((p) => p.replace(/\D/g, "").slice(-4)).filter((d) => d.length === 4);
  if (last4s.length) return { kind: "phone" as const, matches: (input: string) => last4s.includes(input.replace(/\D/g, "")) };
  if (parties.email) return { kind: "email" as const, matches: (input: string) => input.trim().toLowerCase() === parties.email!.toLowerCase() };
  return { kind: "none" as const, matches: () => true };
}

// What the customer saw: stored with their acceptance and fingerprinted.
export function snapshotOf(q: NonNullable<Awaited<ReturnType<typeof quoteByToken>>>) {
  return {
    quoteNumber: q.quote.quoteNumber,
    version: q.quote.version,
    validUntil: q.quote.validUntil,
    preparedFor: { name: q.parties.name, address: q.parties.address },
    company,
    content: q.quote.content,
  };
}

