import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AlertTriangle, CalendarPlus, Repeat, Copy, FileSignature, FileText, Link2Off, Pencil, RotateCcw, ShieldCheck, Trash2, Undo2, XCircle } from "lucide-react";
import { ConfirmButton } from "@/components/confirm-button";
import { PageLoading } from "@/components/page-loading";
import { QuoteDocument } from "@/components/quote-document";
import { RecordType, linkClass } from "@/components/record";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { company } from "@/lib/company";
import { siteOrigin } from "@/lib/inventory/qr";
import { followUp, isOpen, localDay, quoteState, stateStyle } from "@/lib/quotes/status";
import { getI18n } from "@/lib/i18n/server";
import { phrase, plural } from "@/lib/i18n/tr";
import { today } from "@/lib/today";
import { PrintButton } from "../../expenses/report/print-button";
import { deleteDraftQuote, duplicateQuote, markSent, reopenQuote, resetQuoteLink, retryQuoteInvoice, withdrawQuote } from "../actions";
import { getQuote, parseId } from "../data";
import { frequencyLabel } from "@/lib/recurring/schedule";
import { SharePanel } from "./share-panel";

// (shown through tr())
const saved: Record<string, string> = { created: phrase("Estimate saved. Send it when it's ready."), updated: phrase("Changes saved.") };
const eventLabel: Record<string, string> = {
  created: phrase("event|Created"),
  edited: phrase("event|Edited"),
  sent: phrase("event|Sent"),
  viewed: phrase("Opened by the customer"),
  verify_failed: phrase("Wrong identity check"),
  accepted: phrase("event|Accepted"),
  declined: phrase("event|Declined"),
  withdrawn: phrase("event|Withdrawn"),
  link_reset: phrase("New link made (old one stopped working)"),
  invoice_created: phrase("Draft invoice made"),
  invoice_failed: phrase("Draft invoice failed"),
  scheduled: phrase("First visit booked"),
  reopened: phrase("event|Reopened"),
};
// the moment the page is made (follow-ups depend on it)
const currentTime = () => Date.now();
// how a link was sent (ShareSend's "via")
const sentVia: Record<string, string> = { text: phrase("via|text"), email: phrase("via|email"), copy: phrase("via|copied link") };

async function QuoteRecord({ params, searchParams }: Pick<PageProps<"/finances/estimates/[id]">, "params" | "searchParams">) {
  const id = parseId((await params).id);
  const q = id === null ? null : await getQuote(id);
  if (!q) notFound();
  const [sp, user, day, { fmt, tr }, origin] = await Promise.all([searchParams, getCurrentUser(), today(), getI18n(), siteOrigin()]);
  const manage = can(user, "quotes.manage");
  const state = quoteState(q, day);
  const style = stateStyle[state];
  const url = `${origin}/q/${q.publicToken}`;
  const a = q.acceptance;
  const nudge = followUp(q, day, currentTime(), tr);
  const shown = a ? (a.snapshot as { content: typeof q.content }).content : q.content;
  const noVerifier = q.parties.phones.length === 0 && !q.parties.email;

  return (
    <div className="mx-auto max-w-3xl">
      {typeof sp.saved === "string" && saved[sp.saved] && (
        <p role="status" className="mb-4 rounded-lg border border-brand-green/40 bg-success px-4 py-2.5 text-sm font-medium text-success-foreground print:hidden">
          {tr(saved[sp.saved])}
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div className="min-w-0">
          <RecordType icon={FileSignature}>{tr("Estimate")}</RecordType>
          <h1 className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-bold sm:text-3xl">
            <span>
              <span className="text-muted-foreground">#{q.quoteNumber}</span> {q.customerName}
            </span>
            <Badge variant={style.variant} className="h-7 px-3 text-[0.8rem]">
              {tr(style.label)}
            </Badge>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={`/customers/${q.customerId}`} className={linkClass}>
              {q.customerCode}
            </Link>
            {q.customerStatus === "lead" && ` (${tr("customer|Lead").toLowerCase()})`} · {q.content.title}
            {q.version > 1 && ` · ${tr("version {n}", { n: q.version })}`}
            {isOpen(state) && ` · ${tr("good until {date}", { date: fmt.calendarDate(q.validUntil) })}`}
          </p>
        </div>
      </div>

      {nudge && (
        <p className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 print:hidden">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          {nudge}
        </p>
      )}
      {/* the first-visit draft or the memorized recurring invoice didn't get made */}
      {q.invoiceError && q.status === "accepted" && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive print:hidden">
          <span className="min-w-0 flex-1">{tr("A draft invoice wasn't made: {error}", { error: tr(q.invoiceError) })}</span>
          {manage && (
            <ConfirmButton
              label={tr("Try again")}
              variant="outline"
              size="sm"
              title={tr("Make the draft invoice again?")}
              description={tr("Creates the draft invoice in Stripe from what was accepted. Nothing is sent or charged.")}
              confirmLabel={tr("Make it")}
              action={retryQuoteInvoice.bind(null, q.id)}
            />
          )}
        </div>
      )}

      {manage && (
        <div className="mt-4 grid grid-cols-2 gap-2 border-b pb-4 sm:flex sm:flex-wrap sm:items-center print:hidden [&>*]:w-full sm:[&>*]:w-auto">
          {state === "accepted" && (
            <Link href={`/appointments/new?customer=${q.customerId}${q.propertyId ? `&property=${q.propertyId}` : ""}&quote=${q.id}`} className={buttonVariants()}>
              <CalendarPlus aria-hidden="true" />
              {tr("Book the first visit")}
            </Link>
          )}
          {q.status !== "accepted" && (
            <Link href={`/finances/estimates/${q.id}/edit`} className={buttonVariants({ variant: state === "accepted" ? "outline" : "default" })}>
              <Pencil aria-hidden="true" />
              {tr("Edit")}
            </Link>
          )}
          {can(user, "quotes.duplicate") && (
            <ConfirmButton
              label={tr("Duplicate")}
              icon={<Copy aria-hidden="true" />}
              variant="outline"
              title={tr("Make a copy?")}
              description={tr("A new draft estimate with the same content, for the same customer. You can change who it's for.")}
              confirmLabel={tr("Duplicate")}
              action={duplicateQuote.bind(null, q.id)}
            />
          )}
          <PrintButton variant="outline" label={tr("Print / PDF")} />
          {q.invoiceId && (
            <Link href={`/finances/invoices/${q.invoiceId}`} className={buttonVariants({ variant: "outline" })}>
              <FileText aria-hidden="true" />
              {tr("First visit invoice")}
              {q.invoiceNumber ? ` ${q.invoiceNumber}` : ""}
            </Link>
          )}
          {q.memorized && (
            <Link href={`/customers/${q.customerId}#recurring`} className={buttonVariants({ variant: "outline" })}>
              <Repeat aria-hidden="true" />
              {tr("Recurring invoice")} · {tr(frequencyLabel[q.memorized.frequency]).toLowerCase()}
            </Link>
          )}
          {q.recurringInvoiceId && (
            <Link href={`/finances/invoices/${q.recurringInvoiceId}`} className={buttonVariants({ variant: "outline" })}>
              <FileText aria-hidden="true" />
              {tr("Recurring invoice")}
              {q.recurringInvoiceNumber ? ` ${q.recurringInvoiceNumber}` : ""}
            </Link>
          )}
          <span className="hidden flex-1 sm:block" />
          {(state === "declined" || state === "expired" || state === "withdrawn") && (
            <ConfirmButton
              label={tr("Reopen")}
              icon={<RotateCcw aria-hidden="true" />}
              variant="outline"
              title={tr("Reopen this estimate?")}
              description={tr("The customer can accept it again at the same link. If it had expired, it's good for 2 more weeks.")}
              confirmLabel={tr("Reopen")}
              action={reopenQuote.bind(null, q.id)}
            />
          )}
          {isOpen(state) && (
            <ConfirmButton
              label={tr("Withdraw")}
              icon={<Undo2 aria-hidden="true" />}
              variant="outline"
              title={tr("Withdraw this estimate?")}
              description={tr("The link stops working and it can't be accepted. You can reopen it later.")}
              confirmLabel={tr("Withdraw")}
              action={withdrawQuote.bind(null, q.id)}
            />
          )}
          {q.status !== "accepted" && q.status !== "draft" && (
            <ConfirmButton
              label={tr("New link")}
              icon={<Link2Off aria-hidden="true" />}
              variant="ghost"
              title={tr("Make a new link?")}
              description={tr("The old link stops working (use this if it went to the wrong person). Send the new one.")}
              confirmLabel={tr("Make new link")}
              action={resetQuoteLink.bind(null, q.id)}
            />
          )}
          {q.status === "draft" && !q.sentAt && (
            <ConfirmButton
              label={tr("Delete")}
              icon={<Trash2 aria-hidden="true" />}
              title={tr("Delete this draft?")}
              description={tr("It was never sent, so it's removed for good.")}
              confirmLabel={tr("Delete draft")}
              action={deleteDraftQuote.bind(null, q.id)}
            />
          )}
        </div>
      )}

      {/* one column on every screen: send it, the estimate, then the record */}
      <div className="mt-6 grid grid-cols-1 gap-6 [&>*]:min-w-0">
        {manage && (isOpen(state) || state === "draft") && (
          <div className="grid content-start gap-4 print:hidden">
            {noVerifier && (
              <p className="rounded-lg border border-amber-500/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                {tr("This customer has no phone or email on file, so they can't confirm it's them when accepting. Add one to their account first.")}
              </p>
            )}
            <SharePanel key={url} url={url} firstName={q.parties.name.split(" ")[0]} phone={q.parties.phone} email={q.parties.email} markSent={markSent.bind(null, q.id)} company={company.shortName} />
          </div>
        )}
        <div className="-mx-4 sm:mx-0 sm:rounded-lg sm:bg-[#eef1f5] sm:p-6 print:mx-0 print:bg-white print:p-0">
          <QuoteDocument
            number={q.quoteNumber}
            date={fmt.calendarDate(localDay(q.sentAt ?? q.createdAt))}
            // the two weeks start when it's first sent
            validUntil={!q.sentAt ? "2 weeks after it's sent" : isOpen(state) || state === "draft" ? fmt.calendarDate(q.validUntil) : undefined}
            company={company}
            preparedFor={{ name: q.parties.name, address: q.parties.address, phone: q.parties.phone, email: q.parties.email }}
            content={shown}
            selected={a ? { optionId: a.optionId, addOnIds: a.addOnIds } : undefined}
          />
        </div>
        <div className="grid content-start gap-4 print:hidden">
          {a && (
            <section className="rounded-lg border border-brand-green/40 p-4 text-sm">
              <h2 className="mb-2 flex items-center gap-1.5 font-semibold">
                <ShieldCheck className="size-4 text-brand-green" aria-hidden="true" />
                {tr("Acceptance record")}
              </h2>
              <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">{tr("Signed by")}</dt>
                <dd className="font-serif italic">{a.signerName}</dd>
                <dt className="text-muted-foreground">{tr("When")}</dt>
                <dd>{fmt.stamp(a.acceptedAt)}</dd>
                <dt className="text-muted-foreground">{tr("Chose")}</dt>
                <dd>
                  {a.optionName}
                  {a.addOnIds.length > 0 && ` + ${plural(tr, a.addOnIds.length, "{n} add-on", "{n} add-ons")}`}
                </dd>
                <dt className="text-muted-foreground">{tr("First visit")}</dt>
                <dd className="font-semibold">{fmt.money(a.totalCents)}</dd>
                <dt className="text-muted-foreground">{tr("Identity")}</dt>
                <dd>{a.verifiedBy === "phone" ? tr("Confirmed phone number on file") : a.verifiedBy === "email" ? tr("Confirmed email on file") : tr("Not checked (no phone or email on file)")}</dd>
                <dt className="text-muted-foreground">{tr("Consent")}</dt>
                <dd>{tr("E-signature and terms, version {n}", { n: a.consentVersion })}</dd>
                <dt className="text-muted-foreground">{tr("Version")}</dt>
                <dd>{a.quoteVersion}</dd>
                <dt className="text-muted-foreground">{tr("From")}</dt>
                <dd className="break-all">
                  {a.ipAddress ?? tr("unknown")}
                  <span className="block text-[0.75rem] text-muted-foreground">{a.userAgent}</span>
                </dd>
                <dt className="text-muted-foreground">{tr("Fingerprint")}</dt>
                <dd className="font-mono text-[0.7rem] break-all">{a.snapshotSha256}</dd>
              </dl>
              <p className="mt-2 text-[0.75rem] text-muted-foreground">{tr("Saved with a full copy of what they saw and the exact consent wording. This record can't be changed or deleted.")}</p>
            </section>
          )}
          {state === "declined" && q.declineReason && (
            <p className="flex items-start gap-2 rounded-lg border p-4 text-sm">
              <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
              {tr("Declined: {reason}", { reason: q.declineReason })}
            </p>
          )}

          <section className="rounded-lg border p-4">
            <h2 className="mb-2 font-semibold">{tr("Activity")}</h2>
            <p className="mb-2 text-[0.8rem] text-muted-foreground">
              {plural(tr, q.viewCount, "Opened {n} time", "Opened {n} times")}
              {q.lastViewedAt && `, ${tr("last {time}", { time: fmt.stamp(q.lastViewedAt) })}`}
            </p>
            <ol className="grid gap-2 text-sm">
              {q.events.map(({ event: e, byName }) => (
                <li key={e.id} className="grid gap-0.5">
                  <span>
                    <span className="font-medium">
                      {e.kind === "invoice_created" && (e.detail as { recurring?: boolean } | null)?.recurring
                        ? tr("Recurring draft invoice made")
                        : e.kind === "invoice_created" && (e.detail as { memorized?: boolean } | null)?.memorized
                          ? tr("Recurring invoice memorized")
                          : eventLabel[e.kind]
                            ? tr(eventLabel[e.kind])
                            : e.kind}
                    </span>
                    {e.kind === "sent" && (e.detail as { via?: string } | null)?.via && (
                      <span className="text-muted-foreground"> {tr("by {how}", { how: sentVia[(e.detail as { via: string }).via] ? tr(sentVia[(e.detail as { via: string }).via]) : (e.detail as { via: string }).via })}</span>
                    )}
                    {e.kind === "invoice_failed" && <span className="text-destructive"> · {tr((e.detail as { error?: string } | null)?.error ?? "")}</span>}
                  </span>
                  <span className="text-[0.75rem] text-muted-foreground">
                    {fmt.stamp(e.createdAt)}
                    {byName ? ` · ${byName}` : e.ipAddress ? ` · ${tr("from {ip}", { ip: e.ipAddress })}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </section>
          {q.internalNotes && (
            <section className="rounded-lg border bg-secondary/30 p-4 text-sm">
              <h2 className="mb-1 font-semibold">{tr("Internal notes")}</h2>
              <p className="whitespace-pre-wrap">{q.internalNotes}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default function QuotePage(props: PageProps<"/finances/estimates/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <QuoteRecord params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}
