import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { frequencies } from "@/lib/expenses/options";
import { today } from "@/lib/today";
import { getI18n } from "@/lib/i18n/server";
import { NoAccess } from "../../no-access";
import { getVendorOptions } from "../../vendors/data";
import { createExpense } from "../actions";
import { getSchedule, lastPaymentUsed, scheduleChoices } from "../data";
import { ExpenseForm } from "../expense-form";

const cents = (n: number) => (n / 100).toFixed(2);

// ?vendor=ID starts with that vendor; ?recurring=ID (and ?due=YYYY-MM-DD)
// records a payment for a recurring expense, filled in from it.
async function NewExpense({ searchParams }: Pick<PageProps<"/finances/expenses/new">, "searchParams">) {
  const { tr } = await getI18n();
  const user = await getCurrentUser();
  if (!can(user, "expenses.create")) return <NoAccess what="this page" />;
  // recurring expenses (and payments toward them) are the owner's
  const manage = can(user, "expenses.manage");
  const params = await searchParams;
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const [vendors, last, day, { fmt }, recurring] = await Promise.all([getVendorOptions(), lastPaymentUsed(), today(), getI18n(), scheduleChoices()]);
  const scheduleId = manage && /^\d{1,15}$/.test(one("recurring")) ? Number(one("recurring")) : null;
  const found = scheduleId ? await getSchedule(scheduleId) : null;
  const s = found?.schedule;
  const vendor = vendors.find((v) => String(v.id) === one("vendor"));
  const due = /^\d{4}-\d{2}-\d{2}$/.test(one("due")) ? one("due") : null;

  return (
    <>
      <Link href="/finances/expenses?tab=list" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {tr("Expenses")}
      </Link>
      <h1 className="text-3xl font-bold">{s ? tr("Record a recurring payment") : tr("New expense")}</h1>
      <ExpenseForm
        mode="create"
        action={createExpense}
        vendors={vendors}
        allowRecurring={manage}
        schedules={(manage ? recurring : []).map((r) => ({ id: r.id, vendorId: r.vendorId, label: `${r.vendorName} · ${fmt.money(r.amountCents)} ${frequencies[r.frequency].toLowerCase()}` }))}
        cancelHref={s ? "/finances/expenses?tab=recurring" : "/finances/expenses?tab=list"}
        schedule={s ? { id: s.id, label: `${found.vendorName} · ${fmt.money(s.amountCents)} ${frequencies[s.frequency].toLowerCase()}` } : null}
        initialValues={
          s
            ? {
                expenseDate: due && due <= day ? due : day,
                vendorId: String(s.vendorId),
                category: s.category,
                amount: cents(s.amountCents),
                paymentMethod: s.paymentMethod,
                cardBrand: s.cardBrand ?? "",
                cardLast4: s.cardLast4 ?? "",
                reference: "",
                description: s.description ?? "",
                recurringExpenseId: String(s.id),
              }
            : {
                expenseDate: day,
                vendorId: vendor ? String(vendor.id) : "",
                category: vendor?.defaultCategory ?? "",
                amount: /^\d{1,7}(\.\d{1,2})?$/.test(one("amount")) && one("amount") !== "0.00" ? one("amount") : "",
                paymentMethod: last.paymentMethod,
                cardBrand: last.cardBrand ?? "",
                cardLast4: last.cardLast4 ?? "",
                reference: "",
                description: one("note").slice(0, 300),
                recurringExpenseId: "",
              }
        }
      />
    </>
  );
}

export default function NewExpensePage(props: PageProps<"/finances/expenses/new">) {
  return (
    <div className="max-w-2xl">
      <Suspense fallback={<PageLoading />}>
        <NewExpense searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
