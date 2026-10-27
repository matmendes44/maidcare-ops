import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { today } from "@/lib/today";
import { NoAccess } from "../../../no-access";
import { getVendorOptions } from "../../../vendors/data";
import { createSchedule } from "../../actions";
import { lastPaymentUsed } from "../../data";
import { ScheduleForm } from "../../schedule-form";

async function NewSchedule() {
  if (!can(await getCurrentUser(), "expenses.manage")) return <NoAccess what="this page" />;
  const [vendors, last, day] = await Promise.all([getVendorOptions(), lastPaymentUsed(), today()]);
  return (
    <>
      <Link href="/finances/expenses?tab=recurring" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Recurring expenses
      </Link>
      <h1 className="text-3xl font-bold">Add a recurring expense</h1>
      <p className="mt-1 text-sm text-muted-foreground">Insurance, software, phone, storage… Each due date then shows as expected until a payment is recorded.</p>
      <ScheduleForm
        mode="create"
        action={createSchedule}
        vendors={vendors}
        cancelHref="/finances/expenses?tab=recurring"
        initialValues={{
          vendorId: "",
          category: "",
          amount: "",
          amountVaries: false,
          frequency: "monthly",
          startDate: day,
          endDate: "",
          paymentMethod: last.paymentMethod,
          cardBrand: last.cardBrand ?? "",
          cardLast4: last.cardLast4 ?? "",
          description: "",
        }}
      />
    </>
  );
}

export default function NewSchedulePage() {
  return (
    <div className="max-w-2xl">
      <Suspense fallback={<PageLoading />}>
        <NewSchedule />
      </Suspense>
    </div>
  );
}
