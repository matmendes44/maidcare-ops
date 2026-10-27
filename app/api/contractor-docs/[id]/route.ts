import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contractorDocuments } from "@/db/schema";
import { auditEntry } from "@/lib/audit";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";

// A contractor's W-9, 1099 or other paper. These hold tax ID numbers, so
// only people with the contractors.tax permission get them, every view is
// logged, and nothing is cached.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  if (!can(user, "contractors.tax")) return new Response(null, { status: 403 });
  const raw = (await params).id;
  if (!/^\d{1,15}$/.test(raw)) return new Response(null, { status: 404 });
  const [row] = await db
    .select({ data: contractorDocuments.data, contentType: contractorDocuments.contentType, fileName: contractorDocuments.fileName, contractorId: contractorDocuments.contractorId, kind: contractorDocuments.kind })
    .from(contractorDocuments)
    .where(eq(contractorDocuments.id, Number(raw)));
  if (!row) return new Response(null, { status: 404 });
  await auditEntry(user.id, "contractor_documents", Number(raw), "view", { contractor_id: row.contractorId, kind: row.kind });

  const download = new URL(request.url).searchParams.get("download") === "1";
  const ascii = row.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.contentType,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    },
  });
}
