import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { frequencies } from "@/lib/expenses/options";
import { canEditExpense } from "@/lib/expenses/access";
import { getI18n } from "@/lib/i18n/server";
import { NoAccess } from "../../../no-access";
import { getVendorOptions } from "../../../vendors/data";
import { updateExpense } from "../../actions";
import { getExpense, parseExpenseId, scheduleChoices } from "../../data";
import { ExpenseForm } from "../../expense-form";

async function EditExpense({ params }: Pick<PageProps<"/finances/expenses/[id]/edit">, "params">) {
  const { tr } = await getI18n();
  const user = await getCurrentUser();
  if (!can(user, "expenses.create")) return <NoAccess what="this page" />;
  const manage = can(user, "expenses.manage");
  const id = parseExpenseId((await params).id);
  const found = id === null ? null : await getExpense(id);
  if (!found) notFound();
  if (!canEditExpense(user, found.expense.createdBy)) return <NoAccess what="this expense (only the person who added it can change it)" />;
  const [vendors, { fmt }, recurring] = await Promise.all([getVendorOptions(), getI18n(), scheduleChoices()]);
  const { expense: e, schedule: s } = found;
  return (
    <>
      <Link href={`/finances/expenses/${e.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {tr("Back to the expense")}
      </Link>
      <h1 className="text-3xl font-bold">{tr("Edit expense")}</h1>
      <ExpenseForm
        mode="edit"
        action={updateExpense.bind(null, e.id)}
        vendors={vendors}
        allowRecurring={manage}
        schedules={(manage ? recurring : []).map((r) => ({ id: r.id, vendorId: r.vendorId, label: `${r.vendorName} · ${fmt.money(r.amountCents)} ${frequencies[r.frequency].toLowerCase()}` }))}
        cancelHref={`/finances/expenses/${e.id}`}
        schedule={s && manage ? { id: s.id, label: `${found.vendor.name} · ${fmt.money(s.amountCents)} ${frequencies[s.frequency].toLowerCase()}` } : null}
        initialValues={{
          expenseDate: e.expenseDate,
          vendorId: String(e.vendorId),
          category: e.category,
          amount: (e.amountCents / 100).toFixed(2),
          paymentMethod: e.paymentMethod,
          cardBrand: e.cardBrand ?? "",
          cardLast4: e.cardLast4 ?? "",
          reference: e.reference ?? "",
          description: e.description ?? "",
          recurringExpenseId: e.recurringExpenseId ? String(e.recurringExpenseId) : "",
        }}
      />
    </>
  );
}

export default function EditExpensePage(props: PageProps<"/finances/expenses/[id]/edit">) {
  return (
    <div className="max-w-2xl">
      <Suspense fallback={<PageLoading />}>
        <EditExpense params={props.params} />
      </Suspense>
    </div>
  );
}
