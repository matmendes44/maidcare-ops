import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import { NoAccess } from "../../no-access";
import { savePriceList } from "../actions";
import { getPriceList } from "../data";
import { PriceForm } from "./price-form";

async function Pricing() {
  if (!can(await getCurrentUser(), "priceList.manage")) return <NoAccess what="this page" />;
  const [{ saved, updatedAt, ...list }, { fmt }] = await Promise.all([getPriceList(), getI18n()]);
  return (
    <>
      <Link href="/finances/estimates" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Estimates
      </Link>
      <h1 className="text-3xl font-bold">Price list</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        What quick estimates are priced from. {saved && updatedAt ? `Last changed ${fmt.stamp(updatedAt)}.` : "These are your starting prices; save to keep changes."} Estimates already made keep their prices.
      </p>
      <PriceForm action={savePriceList} initial={list} />
    </>
  );
}

export default function PricingPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Pricing />
    </Suspense>
  );
}
