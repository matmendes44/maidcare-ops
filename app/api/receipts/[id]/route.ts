import { eq } from "drizzle-orm";
import { db } from "@/db";
import { expenseReceipts } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";

// A receipt photo or PDF, for people who may see expenses. Shown in the
// browser (?download=1 saves it instead). The stored type is one we set
// ourselves (re-encoded WebP or a checked PDF), and the response may not run
// scripts or be framed.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  if (!can(user, "expenses.view")) return new Response(null, { status: 403 });
  const raw = (await params).id;
  if (!/^\d{1,15}$/.test(raw)) return new Response(null, { status: 404 });

  const [row] = await db
    .select({ data: expenseReceipts.data, contentType: expenseReceipts.contentType, fileName: expenseReceipts.fileName })
    .from(expenseReceipts)
    .where(eq(expenseReceipts.id, Number(raw)));
  if (!row) return new Response(null, { status: 404 });

  const download = new URL(request.url).searchParams.get("download") === "1";
  const ascii = row.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.contentType,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    },
  });
}
