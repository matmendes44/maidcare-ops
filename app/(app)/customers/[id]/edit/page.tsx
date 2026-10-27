import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { getI18n } from "@/lib/i18n/server";
import { ArrowLeft } from "lucide-react";
import { updateCustomer } from "../../actions";
import { CustomerForm } from "../../customer-form";
import {
  getCustomer,
  getCustomerPropertyOptions,
  getReferrerOptions,
  parseCustomerId,
} from "../../data";
import { customerToFormValues, displayName } from "../../options";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";

async function EditCustomerForm({ params }: Pick<PageProps<"/customers/[id]/edit">, "params">) {
  const user = await getCurrentUser();
  const id = parseCustomerId((await params).id);
  const [customer, referrers, properties] =
    id === null
      ? [undefined, [], []]
      : await Promise.all([getCustomer(id), getReferrerOptions(id), getCustomerPropertyOptions(id)]);
  const { t } = await getI18n();
  if (!customer) notFound();

  return (
    <>
      <Link
        href={`/customers/${customer.id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {displayName(customer)}
      </Link>
      <h1 className="text-3xl font-bold">{t.customers.form.editTitle}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t.customers.form.editIntro}</p>
      <CustomerForm
        mode="edit"
        action={updateCustomer.bind(null, customer.id)}
        initialValues={customerToFormValues(customer)}
        referrers={referrers}
        properties={properties}
        cancelHref={`/customers/${customer.id}`}
        canEditStripe={can(user, "stripe.manage")}
        canEditAccount={can(user, "customers.editAccount")}
      />
    </>
  );
}

export default function EditCustomerPage(props: PageProps<"/customers/[id]/edit">) {
  return (
    <div className="max-w-2xl">
      <Suspense fallback={<PageLoading />}>
        <EditCustomerForm params={props.params} />
      </Suspense>
    </div>
  );
}
