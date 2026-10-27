import { cookies } from "next/headers";
import { Suspense } from "react";
import { I18nProvider } from "@/components/i18n-provider";
import { Logo } from "@/components/logo";
import { getI18n, getLocale } from "@/lib/i18n/server";
import { GlobalSearch } from "./global-search";
import { NotificationBell } from "./notification-bell";
import { MobileNav, Sidebar, type NavLabels } from "./nav-links";
import { SIDEBAR_COOKIE } from "./sidebar-cookie";
import { openReportCount } from "./inventory/data";
import { quotesToSchedule } from "./finances/estimates/data";
import { UserMenu } from "./user-menu";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { isDemo } from "@/lib/demo";

// Menu labels depend on the user's language, which is read from the request.
async function navProps() {
  const [{ t, tr }, user] = await Promise.all([getI18n(), getCurrentUser()]);
  const hidden = [
    ...(can(user, "reports.view") ? [] : (["reports"] as const)),
    ...(can(user, "expenses.view") ? [] : (["expenses"] as const)),
    ...(can(user, "vendors.view") ? [] : (["vendors"] as const)),
    ...(can(user, "priceList.manage") ? [] : (["priceList"] as const)),
    ...(can(user, "inventory.view") ? [] : (["inventory"] as const)),
    ...(can(user, "contractors.view") ? [] : (["contractors"] as const)),
    ...(can(user, "contractors.tax") ? [] : (["taxForms"] as const)),
  ];
  const labels: NavLabels = {
    dashboard: t.nav.dashboard,
    leads: tr("Leads"),
    customers: t.nav.customers,
    properties: t.nav.properties,
    appointments: t.nav.appointments,
    fleet: tr("Fleet"),
    invoices: tr("Invoices"),
    estimates: tr("Estimates"),
    priceList: tr("Price list"),
    expenses: tr("Expenses"),
    vendors: tr("Vendors"),
    contractors: tr("Contractors"),
    taxForms: tr("1099s"),
    inventory: tr("Inventory"),
    reports: tr("Reports"),
    settings: t.nav.settings,
    menu: tr("Menu"),
  };
  // problems cleaners reported, waiting for someone who can act on them
  const [reports, toSchedule] = await Promise.all([can(user, "inventory.manage") ? openReportCount() : Promise.resolve(0), quotesToSchedule()]);
  const badges = { ...(reports ? { inventory: reports } : {}), ...(toSchedule ? { estimates: toSchedule } : {}) };
  return { labels, hidden, badges };
}

async function SideNav() {
  const [props, jar, locale] = await Promise.all([navProps(), cookies(), getLocale()]);
  return (
    <I18nProvider locale={locale}>
      <Sidebar
        {...props}
        initiallyCollapsed={jar.get(SIDEBAR_COOKIE)?.value === "collapsed"}
        logo={<Logo className="[&_img]:h-11" />}
        mark={<Logo variant="mark" />}
      />
    </I18nProvider>
  );
}

// (the header is outside the page's LocaleBoundary, so it gets its own)
async function TopBar() {
  const [props, locale] = await Promise.all([navProps(), getLocale()]);
  return (
    <I18nProvider locale={locale}>
      {/* below large screens the sidebar is a drawer behind this button */}
      <div className="flex shrink-0 items-center gap-2 lg:hidden">
        <MobileNav {...props} logo={<Logo className="[&_img]:h-11" />} />
        <Logo compact className="[&_img]:h-10 sm:[&_img]:h-11" />
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:gap-3 lg:justify-between">
        <GlobalSearch />
        <div className="flex items-center gap-2 sm:gap-3">
          <NotificationBell />
          <UserMenu />
        </div>
      </div>
    </I18nProvider>
  );
}

async function DemoBanner() {
  const { tr } = await getI18n();
  return (
    <p className="border-b bg-brand-green/10 px-4 py-2 text-center text-sm sm:px-8 print:hidden">
      {tr("Demo: all customers, money and vehicles are made up, and the data resets every night.")}
    </p>
  );
}

// Gives Client Components the user's language (useI18n).
async function LocaleBoundary({ children }: { children: React.ReactNode }) {
  return <I18nProvider locale={await getLocale()}>{children}</I18nProvider>;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Suspense fallback={<div className="hidden w-56 shrink-0 border-r bg-sidebar lg:block" />}>
        <SideNav />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <div aria-hidden="true" className="h-1 bg-gradient-to-r from-brand-green to-brand-blue print:hidden" />
        {isDemo() && (
          <Suspense>
            <DemoBanner />
          </Suspense>
        )}
        <header className="sticky top-0 z-40 border-b bg-background/95 supports-backdrop-filter:backdrop-blur print:hidden">
          <div className="flex h-15 items-center gap-3 px-4 sm:gap-4 sm:px-8 lg:px-6">
            <Suspense fallback={<div className="flex-1" />}>
              <TopBar />
            </Suspense>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[88rem] px-4 py-8 sm:px-8 sm:py-10 lg:px-6 print:p-0">
          {/* Pages render inside this boundary so they can read the user's
              language (a request value) anywhere, headings included. */}
          <Suspense fallback={<div className="h-40" aria-busy="true" />}>
            <LocaleBoundary>{children}</LocaleBoundary>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
