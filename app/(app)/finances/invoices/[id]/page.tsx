import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { memorizedInvoices } from "@/db/schema";
import { SetRecurringButton } from "./set-recurring-button";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ExternalLink, FileText, List, Pencil, Receipt } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { Field, FieldColumn, FieldGroup, RecordType, TableFrame, linkClass } from "@/components/record";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getI18n } from "@/lib/i18n/server";
import { phrase } from "@/lib/i18n/tr";
import { stripeDashboardUrl } from "@/lib/stripe";
import { displayName } from "../../../customers/options";
import { formatAddress } from "../../../properties/options";
import { getCardsOnFile, getInvoiceDetail, parseInvoiceId, serviceDateOf } from "../../data";
import { InvoiceStatusBadge, paidViaLabel } from "../../invoice-table";
import { ChargeButton } from "./charge-button";
import { DeleteDraftButton } from "./delete-draft-button";
import { FinalizeButton } from "./finalize-button";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";

// (shown through tr())
const savedMessages: Record<string, string> = {
  created: phrase("Draft invoice created in Stripe."),
  updated: phrase("Changes saved."),
  finalized: phrase("Invoice finalized. It wasn't emailed or charged."),
  charged: phrase("Card charged. The invoice is paid."),
  paid: phrase("Marked paid."),
  "already-paid": phrase("Nothing was charged: this invoice had already been paid."),
  "already-void": phrase("Nothing was charged: this invoice had been voided."),
  "already-uncollectible": phrase("Nothing was charged: this invoice is marked uncollectible."),
};

async function InvoiceRecord({ params, searchParams }: Pick<PageProps<"/finances/invoices/[id]">, "params" | "searchParams">) {
  const id = parseInvoiceId((await params).id);
  const detail = id === null ? null : await getInvoiceDetail(id);
  if (!detail) notFound();
  const [{ saved }, { fmt, tr }] = await Promise.all([searchParams, getI18n()]);
  const { invoice: inv, customer, property, stripeInvoice, lines } = detail;
  const isDraft = inv.status === "draft";
  const savedMessage = typeof saved === "string" ? savedMessages[saved] : undefined;
  // what's left to collect (a draft's whole total)
  const dueCents = isDraft ? stripeInvoice.total : stripeInvoice.amount_remaining;
  const user = await getCurrentUser();
  // whether this invoice is the customer's current recurring (memorized) one
  const [memorized] = await db.select({ id: memorizedInvoices.id }).from(memorizedInvoices).where(and(eq(memorizedInvoices.sourceInvoiceId, inv.id), eq(memorizedInvoices.isActive, true)));
  const isRecurringSource = Boolean(memorized);
  const canCharge = (isDraft || inv.status === "open") && dueCents > 0 && Boolean(customer?.id) && can(user, "invoices.collect");
  const cards = canCharge ? await getCardsOnFile(inv.stripeCustomerId).catch(() => []) : [];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <RecordType icon={Receipt}>{tr("Invoice")}</RecordType>
          <h1 className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-3xl font-bold">
            {/* Stripe numbers an invoice when it's finalized */}
            {inv.number ? <span className="font-mono">{inv.number}</span> : <span>{tr("Draft invoice")}</span>}
            <InvoiceStatusBadge status={inv.status} isPastDue={detail.isPastDue} />
          </h1>
          <p className="mt-1 text-[0.95rem] text-muted-foreground">
            {customer?.id ? (
              <Link href={`/customers/${customer.id}`} className={linkClass}>
                {customer.customerCode} {displayName(customer)}
              </Link>
            ) : (
              inv.customerName ?? inv.stripeCustomerId
            )}{" "}
            · {fmt.money(inv.totalCents)}
          </p>
        </div>
        <Link href="/finances" className={buttonVariants({ variant: "ghost", className: "text-muted-foreground" })}>
          <List aria-hidden="true" />
          {tr("Finances")}
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-b pb-4">
        {isDraft && customer?.id && can(user, "invoices.create") && (
          <Link href={`/finances/invoices/${inv.id}/edit`} className={buttonVariants()}>
            <Pencil aria-hidden="true" />
            {tr("Edit")}
          </Link>
        )}
        {canCharge && <ChargeButton id={inv.id} amountCents={dueCents} isDraft={isDraft} cards={cards} />}
        {isDraft && customer?.id && can(user, "invoices.finalize") && <FinalizeButton id={inv.id} />}
        {customer?.id && inv.status !== "void" && can(user, "invoices.memorize") && <SetRecurringButton id={inv.id} current={isRecurringSource} />}
        {can(user, "stripe.manage") && (
          <a href={stripeDashboardUrl(`invoices/${inv.stripeInvoiceId}`)} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" })}>
            <ExternalLink aria-hidden="true" />
            {tr("Open in Stripe")}
          </a>
        )}
        {inv.invoicePdfUrl && (
          <a href={inv.invoicePdfUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" })}>
            <FileText aria-hidden="true" />
            PDF
          </a>
        )}
        {isDraft && can(user, "invoices.deleteDraft") && (
          <>
            <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
            <DeleteDraftButton id={inv.id} />
          </>
        )}
      </div>

      {savedMessage && (
        <p role="status" className="mt-4 rounded-lg border border-brand-green/40 bg-success px-4 py-2.5 text-sm font-medium text-success-foreground">
          {tr(savedMessage)}
        </p>
      )}
      {isDraft && (
        <p className="mt-4 rounded-lg border bg-secondary/40 px-4 py-2.5 text-sm">
          {tr("This is a draft: Stripe hasn't numbered, sent or charged it. You can edit it until it's finalized.")}
        </p>
      )}
      {inv.status === "open" && (
        <p className="mt-4 rounded-lg border bg-secondary/40 px-4 py-2.5 text-sm">
          {tr("Finalized and waiting for payment. Stripe won't email it or charge the customer on its own.")}
        </p>
      )}

      <div className="mt-6">
        <FieldGroup title={tr("Primary Information")}>
          <FieldColumn>
            <Field label={tr("Bill to")}>
              {customer?.id ? (
                <Link href={`/customers/${customer.id}`} className={linkClass}>
                  {customer.customerCode} {displayName(customer)}
                </Link>
              ) : (
                inv.customerName
              )}
            </Field>
            <Field label={tr("Email")}>{inv.customerEmail}</Field>
          </FieldColumn>
          <FieldColumn>
            <Field label={tr("Service address")}>
              {property &&
                (can(user, "properties.edit") ? (
                  <Link href={`/properties/${property.id}/edit`} className={linkClass}>
                    {formatAddress(property)}
                  </Link>
                ) : (
                  formatAddress(property)
                ))}
            </Field>
          </FieldColumn>
          <FieldColumn>
            <Field label={tr("Created")}>{fmt.date(inv.createdAt)}</Field>
            <Field label={tr("Due date")}>
              {inv.dueDate
                ? fmt.date(inv.dueDate)
                : stripeInvoice.collection_method === "charge_automatically" && tr("None (no email in Stripe; pay with card on file)")}
            </Field>
          </FieldColumn>
          <FieldColumn>
            <Field label={tr("Memo")}>{stripeInvoice.description && <span className="whitespace-pre-wrap">{stripeInvoice.description}</span>}</Field>
            {inv.paidAt && <Field label={tr("Paid on")}>{fmt.date(inv.paidAt)}</Field>}
            {inv.paidVia && (
              <Field label={tr("Paid via")}>
                {tr(paidViaLabel(inv)!)}
                {detail.paidByName && <span className="text-muted-foreground"> · {tr("recorded by {name}", { name: detail.paidByName })}</span>}
              </Field>
            )}
          </FieldColumn>
        </FieldGroup>
      </div>

      <h2 className="mt-8 mb-3 text-xl font-semibold">{tr("Line items")}</h2>
      <TableFrame>
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead>{tr("Description")}</TableHead>
              <TableHead>{tr("Service date")}</TableHead>
              <TableHead className="text-right">{tr("Qty")}</TableHead>
              <TableHead className="text-right">{tr("Unit price")}</TableHead>
              <TableHead className="text-right">{tr("Amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {tr("No line items.")}
                </TableCell>
              </TableRow>
            ) : (
              lines.map((l) => {
                const serviceDate = serviceDateOf(l, stripeInvoice.created);
                return (
                <TableRow key={l.id}>
                  <TableCell data-primary className="whitespace-normal">{l.description}</TableCell>
                  <TableCell data-label={tr("Service date")} data-phone-hidden={!serviceDate || undefined}>
                    {serviceDate ? fmt.calendarDate(serviceDate) : "—"}
                  </TableCell>
                  <TableCell data-label={tr("Qty")} className="text-right tabular-nums">{l.quantity ?? 1}</TableCell>
                  <TableCell data-label={tr("Unit price")} className="text-right tabular-nums">{fmt.money(Math.round(l.amount / (l.quantity || 1)))}</TableCell>
                  <TableCell data-label={tr("Amount")} className="text-right font-medium tabular-nums">{fmt.money(l.amount)}</TableCell>
                </TableRow>
                );
              })
            )}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} className="text-right">{tr("Total")}</TableCell>
              <TableCell className="text-right text-base tabular-nums">{fmt.money(inv.totalCents)}</TableCell>
            </TableRow>
            {inv.status !== "draft" && (
              <TableRow>
                <TableCell colSpan={4} className="text-right font-normal text-muted-foreground">{tr("Amount due")}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt.money(inv.amountRemainingCents)}</TableCell>
              </TableRow>
            )}
          </TableFooter>
        </Table>
      </TableFrame>
    </>
  );
}

export default function InvoicePage(props: PageProps<"/finances/invoices/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <InvoiceRecord params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}
