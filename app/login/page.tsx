import { Suspense } from "react";
import type { Metadata } from "next";
import { I18nProvider } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { isDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n/server";
import { demoSignIn } from "./actions";
import { LoginForm } from "./login-form";
import { AuthShell } from "./shell";

export const metadata: Metadata = {
  title: "Sign in · MaidCare",
  robots: { index: false, follow: false },
};

// The public demo: one click in, as either role, so the difference in what
// each can see and do is easy to compare.
async function DemoCard() {
  const { tr } = await getI18n();
  return (
    <div className="mt-6 rounded-xl border-2 border-brand-green/60 bg-card p-6 shadow-sm sm:p-8">
      <h2 className="text-lg font-bold">{tr("Try the demo")}</h2>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        {tr("Every customer, visit, invoice and vehicle here is made up, and the data resets every night. Two-step login is skipped for these demo accounts only.")}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <form action={demoSignIn.bind(null, "owner")}>
          <Button type="submit" size="lg" className="w-full">
            {tr("Sign in as the owner")}
          </Button>
        </form>
        <form action={demoSignIn.bind(null, "staff")}>
          <Button type="submit" size="lg" variant="outline" className="w-full">
            {tr("Sign in as staff")}
          </Button>
        </form>
      </div>
    </div>
  );
}

// Not signed in yet, so the language comes from this browser's last choice
// or what the browser asks for.
async function SignInCard() {
  const { locale, t } = await getI18n();
  return (
    <I18nProvider locale={locale}>
      {isDemo() && <DemoCard />}
      <div className="mt-6 rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold">{t.login.title}</h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">{t.login.subtitle}</p>
        <LoginForm />
      </div>
    </I18nProvider>
  );
}

export default function LoginPage() {
  return (
    <AuthShell>
      <Suspense fallback={<div className="mt-6 h-80 rounded-xl border bg-card" aria-busy="true" />}>
        <SignInCard />
      </Suspense>
    </AuthShell>
  );
}
