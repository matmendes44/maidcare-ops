import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { authorizeUrl, bouncieConfig } from "@/lib/bouncie/tokens";
import { can } from "@/lib/auth/permissions";

// Starts connecting the Bouncie account: sends a signed-in user to Bouncie to
// approve access. The state and PKCE verifier ride along in a short-lived
// cookie and are checked in the callback.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.redirect(new URL("/login?next=/fleet", request.url));
  if (!can(user, "fleet.manage")) return Response.redirect(new URL("/fleet?tab=setup&bouncie=forbidden", request.url));
  if (!bouncieConfig()) return Response.redirect(new URL("/fleet?bouncie=not-configured", request.url));
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  (await cookies()).set("bouncie_oauth", `${state}.${verifier}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/bouncie",
    maxAge: 600,
  });
  return Response.redirect(authorizeUrl(state, challenge));
}
