import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { CustomersIndex } from "../customers/customer-list";

// People who haven't booked yet: customers with the "lead" status. Their
// records still live under /customers/[id].
export default function LeadsPage(props: PageProps<"/leads">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <CustomersIndex kind="leads" searchParams={props.searchParams} />
    </Suspense>
  );
}
