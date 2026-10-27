import { Suspense } from "react";
import type { Metadata } from "next";
import { QuoteDocument } from "@/components/quote-document";
import { getCurrentUser } from "@/lib/auth/session";
import { company } from "@/lib/company";
import { fingerprint } from "@/lib/quotes/fingerprint";
import { isOpen, localDay, quoteState } from "@/lib/quotes/status";
import { consentAgreement, consentDetails } from "@/lib/quotes/terms";
import { todayISO } from "../../(app)/customers/options";
import { acceptQuote, declineQuote, recordView } from "../actions";
import { quoteByToken, snapshotOf, verifierFor } from "../load";
import { AcceptPanel } from "./accept-panel";
import { PrintLink } from "./print-link";

export const metadata: Metadata = { title: "Your estimate", robots: { index: false, follow: false }, referrer: "no-referrer" };

const day = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const stamp = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }) + " ET";
const money = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);

// The estimate a customer opens from the link we send. No sign-in: the long
// random token in the link is the key, and accepting also asks them to
// confirm who they are.
async function Estimate({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const q = await quoteByToken(token);
  if (!q)
    return (
      <p className="mx-auto mt-16 max-w-md rounded-xl border bg-white p-8 text-center text-[#1a2433]">
        This estimate isn&apos;t available. Call or text {company.phone} and we&apos;ll help.
      </p>
    );
  const state = quoteState(q.quote, todayISO());
  const a = q.acceptance;
  const accepted = a ? (a.snapshot as { content: typeof q.quote.content }).content : null;
  const verifier = verifierFor(q.parties);
  const staff = await getCurrentUser();
  return (
    <div className="grid gap-6">
      <QuoteDocument
        number={q.quote.quoteNumber}
        date={day(localDay(q.quote.sentAt ?? q.quote.createdAt))}
        validUntil={isOpen(state) ? day(q.quote.validUntil) : undefined}
        company={company}
        preparedFor={{ name: q.parties.name, address: q.parties.address }}
        // after acceptance: exactly what they accepted
        content={accepted ?? q.quote.content}
        selected={a ? { optionId: a.optionId, addOnIds: a.addOnIds } : undefined}
      />
      <div className="mx-auto w-full max-w-3xl print:max-w-none">
        {a ? (
          <section className="rounded-xl border border-[#4caf3f]/50 bg-white p-5 text-sm text-[#1a2433] sm:p-6 print:break-inside-avoid">
            <h2 className="text-lg font-bold">Accepted</h2>
            <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-[10rem_1fr]">
              <dt className="text-[#6b7280]">Signed by</dt>
              <dd className="font-serif text-base italic">{a.signerName}</dd>
              <dt className="text-[#6b7280]">On</dt>
              <dd>{stamp(a.acceptedAt)}</dd>
              <dt className="text-[#6b7280]">Choice</dt>
              <dd>{a.optionName}</dd>
              <dt className="text-[#6b7280]">First visit total</dt>
              <dd className="font-semibold">{money(a.totalCents)}</dd>
              <dt className="text-[#6b7280]">Record</dt>
              <dd className="font-mono text-[0.75rem] break-all">{a.snapshotSha256}</dd>
            </dl>
            <p className="mt-3 text-[0.8rem] text-[#6b7280]">We&apos;ll call or text you to schedule. Keep this page or print it for your records.</p>
            <div className="mt-2">
              <PrintLink />
            </div>
          </section>
        ) : state === "declined" ? (
          <p className="rounded-xl border bg-white p-6 text-center text-[#1a2433]">You declined this estimate. If anything changes, call or text {company.phone}.</p>
        ) : state === "expired" ? (
          <p className="rounded-xl border bg-white p-6 text-center text-[#1a2433]">This estimate expired on {day(q.quote.validUntil)}. Call or text {company.phone} and we&apos;ll send an updated one.</p>
        ) : staff ? (
          <p className="rounded-xl border border-[#2f7cf6]/40 bg-[#e8f0fe] p-5 text-center text-sm text-[#1a2433] print:hidden">
            You&apos;re signed in to MaidCare, so this is a preview: the customer accepts from their own device. Views from your account aren&apos;t counted.
          </p>
        ) : (
          <div className="grid gap-3 print:hidden">
            <AcceptPanel
              accept={acceptQuote.bind(null, token)}
              decline={declineQuote.bind(null, token)}
              ping={recordView.bind(null, token)}
              options={q.quote.content.options}
              addOns={q.quote.content.addOns.filter((x) => x.kind === "optional")}
              verifyKind={verifier.kind}
              consent={{ agreement: consentAgreement(), details: consentDetails() }}
              version={q.quote.version}
              sha={fingerprint(snapshotOf(q))}
              phone={company.phone}
              taxBp={q.quote.content.taxBp}
            />
            <div className="text-center">
              <PrintLink label="Print or save this estimate" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function EstimatePage(props: { params: Promise<{ token: string }> }) {
  return (
    <main className="min-h-screen bg-[#eef1f5] px-3 py-6 sm:py-10 print:bg-white print:p-0">
      <Suspense fallback={<p className="text-center text-[#6b7280]">Loading your estimate…</p>}>
        <Estimate params={props.params} />
      </Suspense>
    </main>
  );
}
