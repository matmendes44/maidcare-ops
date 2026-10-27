import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userAvatars } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";

// Profile photos, for signed-in staff only. Links include ?v=<last change>,
// so a photo can be cached for good and a new one gets a new URL.
export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!(await getCurrentUser())) return new Response(null, { status: 401 });
  const raw = (await params).userId;
  if (!/^\d+$/.test(raw)) return new Response(null, { status: 404 });

  const [row] = await db
    .select({ image: userAvatars.image })
    .from(userAvatars)
    .where(eq(userAvatars.userId, Number(raw)));
  if (!row) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(row.image), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
