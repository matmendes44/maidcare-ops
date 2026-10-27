import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { NoAccess } from "../finances/no-access";

// Every inventory page needs inventory.view (the crew's QR report pages under
// /r are separate and public).
async function Gate({ children }: { children: React.ReactNode }) {
  if (!can(await getCurrentUser(), "inventory.view")) return <NoAccess what="inventory" />;
  return <>{children}</>;
}

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}
