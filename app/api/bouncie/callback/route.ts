import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { fleetSync } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { bouncieUser } from "@/lib/bouncie/client";
import { connectWithCode, setAccountEmail } from "@/lib/bouncie/tokens";
import { syncFleet } from "@/lib/fleet/sync";
import { can } from "@/lib/auth/permissions";
import { logError } from "@/lib/log";

// Bouncie sends the user back here after they approve (or deny) access.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (result: string) => Response.redirect(new URL(`/fleet?tab=setup&bouncie=${result}`, request.url));
  const user = await getCurrentUser();
  if (!user) return Response.redirect(new URL("/login?next=/fleet", request.url));
  if (!can(user, "fleet.manage")) return Response.redirect(new URL("/fleet?tab=setup&bouncie=forbidden", request.url));

  const jar = await cookies();
  const saved = jar.get("bouncie_oauth")?.value ?? "";
  jar.delete({ name: "bouncie_oauth", path: "/api/bouncie" });
  const [state, verifier] = saved.split(".");
  const returned = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  // the state must be the one this browser was sent with
  if (!state || !verifier || state.length !== returned.length || !timingSafeEqual(Buffer.from(state), Buffer.from(returned))) {
    return back("invalid");
  }
  if (!code) return back("denied");

  try {
    await connectWithCode(code, verifier, user.id);
    const account = await bouncieUser().catch(() => null);
    await setAccountEmail(account?.email ?? null);
    // start fresh from the real account
    await db.update(fleetSync).set({ tripsSyncedUntil: null }).where(eq(fleetSync.id, 1));
    await syncFleet({ force: true });
  } catch (err) {
    logError("bouncie connect failed", err);
    return back("failed");
  }
  return back("connected");
}
