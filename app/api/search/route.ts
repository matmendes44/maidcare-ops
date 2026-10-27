import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { searchEverything } from "@/lib/search";

// GET /api/search?q=… for the header search box. Signed-in users only; the
// results are customer data, so they're never cached.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const results = await searchEverything(q, { withVendors: can(user, "vendors.view"), locale: user.locale });
  return Response.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
}
