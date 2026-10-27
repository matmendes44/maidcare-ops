import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { CustomersIndex } from "./customer-list";

// Everyone except leads; those have their own page (/leads).
export default function CustomersPage(props: PageProps<"/customers">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <CustomersIndex kind="customers" searchParams={props.searchParams} />
    </Suspense>
  );
}
