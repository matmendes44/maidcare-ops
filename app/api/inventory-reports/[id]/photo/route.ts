import { eq } from "drizzle-orm";
import { db } from "@/db";
import { inventoryReports } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";

// A photo attached to a problem report, for signed-in staff.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentUser())) return new Response(null, { status: 401 });
  const raw = (await params).id;
  if (!/^\d{1,15}$/.test(raw)) return new Response(null, { status: 404 });
  const [row] = await db.select({ photo: inventoryReports.photo }).from(inventoryReports).where(eq(inventoryReports.id, Number(raw)));
  if (!row?.photo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(row.photo), {
    headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" },
  });
}
