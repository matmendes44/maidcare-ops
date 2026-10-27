import { Suspense } from "react";
import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { inventoryAssets, inventoryItems } from "@/db/schema";
import { Logo } from "@/components/logo";
import { ReportForm } from "../../../(app)/inventory/report-form";
import { reportChoices } from "../../../(app)/inventory/data";
import { reportFromAsset } from "../../actions";

export const metadata: Metadata = { title: "Report a problem", robots: { index: false, follow: false } };

// The page behind the QR label on a piece of equipment: no sign-in.
async function AssetReport({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [asset] = /^[0-9a-f]{64}$/.test(token)
    ? await db
        .select({ id: inventoryAssets.id, tag: inventoryAssets.assetTag, name: inventoryItems.name, status: inventoryAssets.status })
        .from(inventoryAssets)
        .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryAssets.itemId))
        .where(eq(inventoryAssets.reportToken, token))
    : [];
  if (!asset || asset.status === "retired") return <p className="rounded-lg border px-4 py-8 text-center">This code isn&apos;t valid anymore. Ask the office for a new label.</p>;
  const { people } = await reportChoices(null);
  return (
    <>
      <h1 className="text-2xl font-bold">Report a problem</h1>
      <p className="mt-1 mb-6 text-muted-foreground">
        {asset.name} ({asset.tag})
      </p>
      <ReportForm action={reportFromAsset.bind(null, token)} choices={{ items: [], assets: [], people }} fixedAsset={{ id: asset.id, label: `${asset.name} (${asset.tag})` }} />
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
        <AssetReport params={props.params} />
      </Suspense>
    </main>
  );
}
