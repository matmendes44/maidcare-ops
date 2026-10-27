import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import QRCode from "qrcode";
import { otpauthUri } from "@/lib/auth/totp";
import { getCurrentUser } from "@/lib/auth/session";
import { currentChallenge, isUsedUp, openSecret } from "@/lib/auth/two-factor";
import { AuthCard, AuthShell } from "../shell";
import { SetupForm, UsedUp } from "../two-factor-forms";

export const metadata: Metadata = { title: "Set up two-step login · MaidCare", robots: { index: false, follow: false } };

async function Setup() {
  const found = await currentChallenge();
  if (found && isUsedUp(found.challenge)) return <UsedUp />;
  let instructions: React.ReactNode = null;
  if (found?.challenge.purpose === "enroll" && found.challenge.pendingSecret) {
    const secret = openSecret(found.challenge.pendingSecret);
    // drawn on the server: the secret never goes to a third-party QR service
    const qr = await QRCode.toDataURL(otpauthUri(secret, found.user.email), { margin: 1, width: 208, errorCorrectionLevel: "M" });
    instructions = (
      <ol className="mb-5 grid gap-4 text-sm">
        <li>
          <span className="font-medium">1. Install an authenticator app</span> on your phone if you don&apos;t have one: Google Authenticator,
          Microsoft Authenticator, 1Password or Authy.
        </li>
        <li className="grid gap-2">
          <span>
            <span className="font-medium">2. Scan this code</span> with the app (tap + or &ldquo;Add account&rdquo;).
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL drawn on the server */}
          <img src={qr} alt="QR code to add MaidCare to your authenticator app" width={208} height={208} className="mx-auto rounded-md border bg-white p-1" />
          <details className="text-[0.8rem] text-muted-foreground">
            <summary className="cursor-pointer">Can&apos;t scan it? Enter this key instead</summary>
            <code className="mt-1 block rounded bg-muted px-2 py-1.5 text-center font-mono text-[0.85rem] tracking-wider break-all text-foreground">
              {secret.match(/.{1,4}/g)!.join(" ")}
            </code>
          </details>
        </li>
        <li>
          <span className="font-medium">3. Enter the 6-digit code</span> the app shows for MaidCare.
        </li>
      </ol>
    );
  } else if (!(await getCurrentUser())) {
    redirect("/login");
  }
  // Right after setup is confirmed the challenge is gone and the session has
  // started; this page re-renders as part of that response and must keep the
  // form (now showing the recovery codes) in the same place, so the
  // instructions slot is left empty instead of redirecting.
  return (
    <AuthCard
      title="Set up two-step login"
      subtitle="MaidCare handles customer information and payments, so every account signs in with a password and a code from an authenticator app."
    >
      {instructions}
      <SetupForm />
    </AuthCard>
  );
}

export default function SetupPage() {
  return (
    <AuthShell wide>
      <Suspense fallback={<div className="mt-6 h-96 rounded-xl border bg-card" aria-busy="true" />}>
        <Setup />
      </Suspense>
    </AuthShell>
  );
}
