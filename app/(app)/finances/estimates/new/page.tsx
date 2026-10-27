import { redirect } from "next/navigation";

// New estimates are built from the price list; old links land there.
export default async function NewQuotePage(props: PageProps<"/finances/estimates/new">) {
  const sp = await props.searchParams;
  redirect(typeof sp.customer === "string" && /^\d{1,15}$/.test(sp.customer) ? `/finances/estimates/quick?customer=${sp.customer}` : "/finances/estimates/quick");
}
