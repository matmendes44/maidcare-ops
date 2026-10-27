import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { currentChallenge, isUsedUp } from "@/lib/auth/two-factor";
import { AuthCard, AuthShell } from "../shell";
import { UsedUp, VerifyForm } from "../two-factor-forms";

export const metadata: Metadata = { title: "Two-step login · MaidCare", robots: { index: false, follow: false } };

async function Verify() {
  const found = await currentChallenge();
  if (!found || found.challenge.purpose !== "verify") redirect("/login");
  if (isUsedUp(found.challenge)) return <UsedUp />;
  return (
    <AuthCard title="Enter your code" subtitle={<>Open your authenticator app and enter the 6-digit code for MaidCare ({found.user.email}).</>}>
      <VerifyForm />
    </AuthCard>
  );
}

export default function VerifyPage() {
  return (
    <AuthShell>
      <Suspense fallback={<div className="mt-6 h-72 rounded-xl border bg-card" aria-busy="true" />}>
        <Verify />
      </Suspense>
    </AuthShell>
  );
}
