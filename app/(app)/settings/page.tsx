import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { requireUser } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { recoveryCodesLeft } from "@/lib/auth/two-factor";
import { SecuritySection } from "./security";
import { AppearancePicker, EmailForm, LanguagePicker, PasswordForm, PhotoForm } from "./settings-forms";

function Section({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t py-8 first-of-type:border-t-0 first-of-type:pt-0 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-10">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{text}</p>
      </div>
      <div>{children}</div>
    </section>
  );
}

async function SettingsContent() {
  const { tr } = await getI18n();
  const [user, { t, locale }] = await Promise.all([requireUser(), getI18n()]);
  const [security, codesLeft] = await Promise.all([
    db.query.users.findFirst({ columns: { totpEnabledAt: true }, where: eq(users.id, user.id) }),
    recoveryCodesLeft(user.id),
  ]);
  return (
    <div className="max-w-4xl">
      <h1 className="text-3xl font-bold">{t.settings.title}</h1>
      <p className="mt-2 text-muted-foreground">{t.settings.subtitle}</p>
      {/* keyed by language so messages from before a switch don't linger */}
      <div className="mt-8" key={locale}>
        <Section title={t.settings.photo.title} text={t.settings.photo.text}>
          <PhotoForm user={user} />
        </Section>
        <Section title={t.settings.email.title} text={t.settings.email.text(user.email)}>
          <EmailForm />
        </Section>
        <Section title={t.settings.password.title} text={t.settings.password.text}>
          <PasswordForm />
        </Section>
        <Section title={tr("Security")} text={tr("Two-step login protects this account even if the password leaks.")}>
          <SecuritySection enabledAt={security?.totpEnabledAt ?? null} codesLeft={codesLeft} canManageUsers={can(user, "users.manage")} />
        </Section>
        <Section title={t.settings.appearance.title} text={t.settings.appearance.text}>
          <AppearancePicker initial={user.theme} />
        </Section>
        <Section title={t.settings.language.title} text={t.settings.language.text}>
          <LanguagePicker />
        </Section>
        {can(user, "invoices.memorize") && (
          <Section title={tr("Recurring invoices")} text={tr("Set up customers' recurring invoices from their service plans and latest invoices.")}>
            <Link href="/settings/recurring-import" className={buttonVariants({ variant: "outline" })}>
              {tr("Review service plans")}
            </Link>
          </Section>
        )}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <SettingsContent />
    </Suspense>
  );
}
