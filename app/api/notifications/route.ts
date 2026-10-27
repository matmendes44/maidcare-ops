import { getCurrentUser } from "@/lib/auth/session";
import { markRead, notificationsFor } from "@/lib/notifications";

// The header bell: GET lists the latest notifications; POST marks some (or
// all) as read for the signed-in person.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  return Response.json(await notificationsFor(user.id, user.role, user.locale), { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  // same-site requests only (a page elsewhere can't mark things read)
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return Response.json({ error: "Not allowed." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { ids?: unknown; all?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is number => Number.isSafeInteger(x)) : [];
  await markRead(user.id, user.role, body.all === true ? "all" : ids);
  return Response.json({ ok: true });
}
