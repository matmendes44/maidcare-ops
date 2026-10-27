import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ExternalLink, FileText, List, Pencil, Plus, Receipt, Repeat, Trash2 } from "lucide-react";
import { ConfirmButton } from "@/components/confirm-button";
import { PageLoading } from "@/components/page-loading";
import { Field, FieldColumn, FieldGroup, RecordType, linkClass } from "@/components/record";
import { buttonVariants } from "@/components/ui/button";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { canEditExpense } from "@/lib/expenses/access";
import { categories, frequencies, paidWith, type Category } from "@/lib/expenses/options";
import { getI18n } from "@/lib/i18n/server";
import { phrase } from "@/lib/i18n/tr";
import { plural } from "@/lib/inventory/options";
import { NoAccess } from "../../no-access";
import { deleteExpense, deleteReceipt, uploadReceipts } from "../actions";
import { expenseHistory, getExpense, inventoryFor, parseExpenseId } from "../data";
import { ReceiptUploader } from "./receipt-uploader";

// (shown through tr())
const savedMessages: Record<string, string> = { created: phrase("Expense saved."), updated: phrase("Changes saved.") };
const fieldNames: Record<string, string> = {
  expense_date: phrase("field|date"),
  vendor_id: phrase("field|vendor"),
  category: phrase("field|category"),
  amount_cents: phrase("field|total"),
  payment_method: phrase("field|payment method"),
  card_brand: phrase("field|card"),
  card_last4: phrase("field|card digits"),
  reference: phrase("field|reference"),
  description: phrase("field|description"),
  recurring_expense_id: phrase("field|recurring link"),
};

async function ExpenseRecord({ params, searchParams }: Pick<PageProps<"/finances/expenses/[id]">, "params" | "searchParams">) {
  const { tr } = await getI18n();
  const user = await getCurrentUser();
  if (!can(user, "expenses.view")) return <NoAccess what="expenses" />;
  const id = parseExpenseId((await params).id);
  const found = id === null ? null : await getExpense(id);
  if (!found) notFound();
  const [{ saved }, history, { fmt }, inventory] = await Promise.all([searchParams, expenseHistory(found.expense.id), getI18n(), inventoryFor(found.expense.id)]);
  const { expense: e, vendor, schedule, receipts } = found;
  const manage = can(user, "expenses.manage");
  const editable = canEditExpense(user, e.createdBy);
  const canAdd = can(user, "expenses.create");
  const cat = categories[e.category as Category];

  return (
    <>
      {typeof saved === "string" && savedMessages[saved] && (
        <p role="status" className="mb-4 rounded-lg border border-brand-green/40 bg-success px-4 py-2.5 text-sm font-medium text-success-foreground">
          {tr(savedMessages[saved])}
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <RecordType icon={Receipt}>{tr("Expense")}</RecordType>
          <h1 className="mt-1.5 text-3xl font-bold">
            <span className="tabular-nums">{fmt.money(e.amountCents)}</span> <span className="text-muted-foreground">·</span> {vendor.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {fmt.calendarDate(e.expenseDate)} · {cat ? tr(cat.label) : e.category}
            {schedule && ` · ${tr("repeats {how}", { how: tr(frequencies[schedule.frequency]).toLowerCase() })}`}
          </p>
        </div>
        <Link href="/finances/expenses?tab=list" className={buttonVariants({ variant: "ghost", className: "text-muted-foreground" })}>
          <List aria-hidden="true" />
          {tr("List")}
        </Link>
      </div>

      {(editable || canAdd) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-b pb-4">
          {editable && (
            <Link href={`/finances/expenses/${e.id}/edit`} className={buttonVariants()}>
              <Pencil aria-hidden="true" />
              {tr("Edit")}
            </Link>
          )}
          {canAdd && (
            <Link href={`/finances/expenses/new?vendor=${vendor.id}`} className={buttonVariants({ variant: editable ? "outline" : "default" })}>
              <Plus aria-hidden="true" />
              {tr("Another from {vendor}", { vendor: vendor.name })}
            </Link>
          )}
          <span className="flex-1" />
          {manage && (
          <ConfirmButton
            label={tr("Delete")}
            icon={<Trash2 aria-hidden="true" />}
            title={tr("Delete this expense?")}
            description={tr("{amount} to {vendor} on {date}, with its receipts. The deletion is kept in the change history.", { amount: fmt.money(e.amountCents), vendor: vendor.name, date: fmt.calendarDate(e.expenseDate) })}
            confirmLabel={tr("Delete expense")}
            cancelLabel={tr("Keep it")}
            action={deleteExpense.bind(null, e.id)}
          />
          )}
        </div>
      )}

      <div className="mt-6">
        <FieldGroup title={tr("Details")}>
          <FieldColumn>
            <Field label={tr("Date")}>{fmt.calendarDate(e.expenseDate)}</Field>
            <Field label={tr("Total")}>
              <span className="font-semibold tabular-nums">{fmt.money(e.amountCents)}</span>
            </Field>
          </FieldColumn>
          <FieldColumn>
            <Field label={tr("Vendor")}>
              {can(user, "vendors.view") ? (
                <Link href={`/finances/vendors/${vendor.id}`} className={linkClass}>
                  {vendor.vendorCode} {vendor.name}
                </Link>
              ) : (
                `${vendor.vendorCode} ${vendor.name}`
              )}
            </Field>
            <Field label={tr("Category")}>
              {cat ? tr(cat.label) : e.category}
              {cat && <div className="text-[0.8rem] text-muted-foreground">{tr("Schedule C line {line}", { line: cat.scheduleC })}</div>}
            </Field>
          </FieldColumn>
          <FieldColumn>
            <Field label={tr("Paid with")}>{paidWith(e, tr)}</Field>
            <Field label={e.paymentMethod === "check" ? tr("Check number") : tr("Reference")}>{e.reference}</Field>
          </FieldColumn>
          <FieldColumn>
            <Field label={tr("Recurring")}>
              {schedule ? (
                <span className="inline-flex items-center gap-1.5">
                  <Repeat className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  {tr(frequencies[schedule.frequency])} · {tr("expected {amount}", { amount: fmt.money(schedule.amountCents) })}
                </span>
              ) : (
                tr("One-time")
              )}
            </Field>
            <Field label={tr("Recorded by")}>
              {found.createdByName ?? tr("Unknown")}
              <div className="text-[0.8rem] text-muted-foreground">{fmt.stamp(e.createdAt)}</div>
              {e.updatedAt && (
                <div className="text-[0.8rem] text-muted-foreground">
                  {tr("Last edited by {name}, {time}", { name: found.updatedByName ?? tr("unknown"), time: fmt.stamp(e.updatedAt) })}
                </div>
              )}
            </Field>
          </FieldColumn>
        </FieldGroup>
        {e.description && (
          <FieldGroup title={tr("Description")}>
            <p className="col-span-full text-[0.95rem] whitespace-pre-wrap">{e.description}</p>
          </FieldGroup>
        )}
      </div>

      {can(user, "inventory.view") && (inventory.assets.length > 0 || inventory.stock.length > 0) && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">{tr("Inventory from this purchase")}</h2>
          <ul className="divide-y rounded-lg border text-sm">
            {inventory.assets.map((a) => (
              <li key={`a${a.id}`} className="px-4 py-2">
                <Link href={`/inventory/assets/${a.id}`} className={linkClass}>
                  {a.tag} {a.name}
                </Link>
              </li>
            ))}
            {inventory.stock.map((s) => (
              <li key={`s${s.itemId}`} className="flex justify-between px-4 py-2">
                <Link href={`/inventory/items/${s.itemId}`} className={linkClass}>
                  {s.name}
                </Link>
                <span className="tabular-nums">{plural(s.quantity, s.unit)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8" aria-labelledby="receipts-heading">
        <h2 id="receipts-heading" className="mb-3 text-lg font-semibold">
          {tr("Receipts")} <span className="text-muted-foreground">({receipts.length})</span>
        </h2>
        {receipts.length === 0 ? (
          <p className="mb-3 rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{tr("No receipt yet.")}</p>
        ) : (
          <ul className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {receipts.map((r) => (
              <li key={r.id} className="group relative overflow-hidden rounded-lg border bg-card">
                <a href={`/api/receipts/${r.id}`} target="_blank" rel="noopener" className="block">
                  {r.contentType === "application/pdf" ? (
                    <div className="grid aspect-[3/4] place-items-center bg-muted text-muted-foreground">
                      <FileText className="size-10" aria-hidden="true" />
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- served by our own authenticated route
                    <img src={`/api/receipts/${r.id}`} alt={tr("Receipt: {name}", { name: r.fileName })} loading="lazy" className="aspect-[3/4] w-full object-cover" />
                  )}
                  <div className="flex items-center gap-1 border-t px-2 py-1.5 text-[0.8rem]">
                    <span className="min-w-0 flex-1 truncate">{r.fileName}</span>
                    <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </div>
                </a>
                <div className="px-2 pb-1.5 text-[0.72rem] text-muted-foreground">
                  {r.uploadedByName ?? tr("Unknown")} · {fmt.stamp(r.uploadedAt)}
                </div>
                {manage && (
                  <div className="absolute top-1.5 right-1.5 rounded-md bg-background/90 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                    <ConfirmButton
                      label={tr("Remove {name}", { name: r.fileName })}
                      icon={<Trash2 aria-hidden="true" />}
                      size="icon-sm"
                      variant="ghost"
                      title={tr("Remove this receipt?")}
                      description={r.fileName}
                      confirmLabel={tr("Remove")}
                      action={deleteReceipt.bind(null, r.id)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {editable && receipts.length < 10 && <ReceiptUploader action={uploadReceipts.bind(null, e.id)} />}
      </section>

      {history.length > 0 && (
        <details className="mt-8 rounded-lg border">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">{tr("Change history ({n})", { n: history.length })}</summary>
          <ul className="grid gap-2 border-t px-4 py-3 text-sm">
            {history.map((h, i) => (
              <li key={i} className="flex flex-wrap gap-x-2">
                <span className="text-muted-foreground">{fmt.stamp(h.changedAt)}</span>
                <span className="font-medium">{h.name ?? tr("Outside the app")}</span>
                <span>
                  {h.action === "insert"
                    ? tr("recorded it")
                    : h.action === "delete"
                      ? tr("deleted it")
                      : tr("changed {fields}", {
                          fields: Object.keys(h.changes as object)
                            .map((k) => (fieldNames[k] ? tr(fieldNames[k]) : k))
                            .join(", "),
                        })}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

export default function ExpensePage(props: PageProps<"/finances/expenses/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ExpenseRecord params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}
