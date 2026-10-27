import { Suspense } from "react";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { inventoryLocations, vehicles } from "@/db/schema";
import { Logo } from "@/components/logo";
import { reportChoices } from "../../(app)/inventory/data";
import { ReportForm } from "../../(app)/inventory/report-form";
import { reportFromLocation } from "../actions";

export const metadata: Metadata = { title: "Report a problem", robots: { index: false, follow: false } };

// The page behind the QR code in a vehicle or storage: no sign-in. It shows
// only this place's name and the supply and equipment names to pick from.
async function LocationReport({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [loc] = /^[0-9a-f]{64}$/.test(token)
    ? await db
        .select({ id: inventoryLocations.id, name: inventoryLocations.name, vehicleName: vehicles.name, isActive: inventoryLocations.isActive })
        .from(inventoryLocations)
        .leftJoin(vehicles, eq(vehicles.id, inventoryLocations.vehicleId))
        .where(eq(inventoryLocations.reportToken, token))
    : [];
  if (!loc?.isActive) return <p className="rounded-lg border px-4 py-8 text-center">This code isn&apos;t valid anymore. Ask the office for a new label.</p>;
  const choices = await reportChoices(loc.id);
  return (
    <>
      <h1 className="text-2xl font-bold">Report a problem</h1>
      <p className="mt-1 mb-6 text-muted-foreground">{loc.vehicleName ?? loc.name}</p>
      <ReportForm action={reportFromLocation.bind(null, token)} choices={choices} />
    </>
  );
}

export default function Page(props: { params: Promise<{ token: string }> }) {
  return (
    <main className="mx-auto min-h-screen max-w-lg px-4 py-6">
      <div className="mb-6">
        <Logo />
      </div>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <LocationReport params={props.params} />
      </Suspense>
    </main>
  );
}
