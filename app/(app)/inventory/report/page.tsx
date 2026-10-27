import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageLoading } from "@/components/page-loading";
import { submitReport } from "../actions";
import { getLocations, reportChoices } from "../data";
import { ReportForm } from "../report-form";

// Anyone signed in can report a problem.
async function Report() {
  const [locations, choices] = await Promise.all([getLocations(), reportChoices(null)]);
  return (
    <>
      <Link href="/inventory" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Inventory
      </Link>
      <h1 className="text-3xl font-bold">Report a problem</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">Something running low, out, broken or missing. It shows up on the Inventory page right away.</p>
      <ReportForm action={submitReport} choices={choices} locations={locations.filter((l) => l.isActive).map((l) => ({ id: l.id, name: l.name }))} />
    </>
  );
}

export default function ReportPage() {
  return (
    <div className="max-w-xl">
      <Suspense fallback={<PageLoading />}>
        <Report />
      </Suspense>
    </div>
  );
}
