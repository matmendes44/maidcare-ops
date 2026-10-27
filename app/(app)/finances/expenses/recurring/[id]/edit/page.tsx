import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { NoAccess } from "../../../../no-access";
import { getVendorOptions } from "../../../../vendors/data";
import { updateSchedule } from "../../../actions";
import { getSchedule, parseExpenseId } from "../../../data";
import { ScheduleForm } from "../../../schedule-form";

async function EditSchedule({ params }: Pick<PageProps<"/finances/expenses/recurring/[id]/edit">, "params">) {
  if (!can(await getCurrentUser(), "expenses.manage")) return <NoAccess what="this page" />;
  const id = parseExpenseId((await params).id);
  const found = id === null ? null : await getSchedule(id);
  if (!found) notFound();
  const vendors = await getVendorOptions();
  const s = found.schedule;
  return (
    <>
      <Link href="/finances/expenses?tab=recurring" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Recurring expenses
      </Link>
      <h1 className="text-3xl font-bold">Edit recurring expense</h1>
      <p className="mt-1 text-sm text-muted-foreground">Changes apply to what&apos;s expected from now on; payments already recorded stay as they are.</p>
      <ScheduleForm
        mode="edit"
        action={updateSchedule.bind(null, s.id)}
        vendors={vendors}
        cancelHref="/finances/expenses?tab=recurring"
        initialValues={{
          vendorId: String(s.vendorId),
          category: s.category,
          amount: (s.amountCents / 100).toFixed(2),
          amountVaries: s.amountVaries,
          frequency: s.frequency,
          startDate: s.startDate,
          endDate: s.endDate ?? "",
          paymentMethod: s.paymentMethod,
          cardBrand: s.cardBrand ?? "",
          cardLast4: s.cardLast4 ?? "",
          description: s.description ?? "",
        }}
      />
    </>
  );
}

export default function EditSchedulePage(props: PageProps<"/finances/expenses/recurring/[id]/edit">) {
  return (
    <div className="max-w-2xl">
      <Suspense fallback={<PageLoading />}>
        <EditSchedule params={props.params} />
      </Suspense>
    </div>
  );
}
