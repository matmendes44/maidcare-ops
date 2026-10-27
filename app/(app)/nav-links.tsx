"use client";

import { Dialog } from "@base-ui/react/dialog";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  FileCheck,
  FileSignature,
  FileText,
  CalendarDays,
  HardHat,
  Home,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  Package,
  PanelLeftOpen,
  Receipt,
  Settings,
  Store,
  Truck,
  UserPlus,
  Users,
  X,
  type LucideIcon,
  Tags,
} from "lucide-react";
import { cn } from "cn";
import { useI18n } from "@/components/i18n-provider";
import { SIDEBAR_COOKIE } from "./sidebar-cookie";

// The app's sections, grouped like the sidebar shows them. `also` lists other
// paths that count as the section (invoice pages live under /finances, but
// so do expenses and vendors, which are sections of their own).
type NavLink = { href: string; key: string; icon: LucideIcon; also?: readonly string[] };
const groups = [
  { title: null, links: [{ href: "/", key: "dashboard", icon: LayoutDashboard }] },
  {
    title: "Work",
    links: [
      { href: "/customers", key: "customers", icon: Users },
      { href: "/leads", key: "leads", icon: UserPlus },
      { href: "/properties", key: "properties", icon: Home },
      { href: "/appointments", key: "appointments", icon: CalendarDays },
      { href: "/contractors", key: "contractors", icon: HardHat },
    ],
  },
  {
    title: "Finances",
    links: [
      { href: "/finances", key: "invoices", icon: FileText, also: ["/finances/invoices"] },
      { href: "/finances/estimates", key: "estimates", icon: FileSignature },
      { href: "/finances/estimates/pricing", key: "priceList", icon: Tags },
      { href: "/finances/expenses", key: "expenses", icon: Receipt },
      { href: "/finances/vendors", key: "vendors", icon: Store },
      { href: "/finances/1099s", key: "taxForms", icon: FileCheck },
    ],
  },
  {
    title: "Operations",
    links: [
      { href: "/inventory", key: "inventory", icon: Package },
      { href: "/fleet", key: "fleet", icon: Truck },
    ],
  },
  {
    title: "Business",
    links: [{ href: "/reports", key: "reports", icon: BarChart3 }],
  },
] as const satisfies readonly { title: string | null; links: readonly NavLink[] }[];

type Key = (typeof groups)[number]["links"][number]["key"];
export type NavLabels = Record<Key, string> & { menu: string; settings: string };
type Hidden = readonly Key[];

const under = (base: string, pathname: string) => pathname === base || pathname.startsWith(`${base}/`);
// the most specific section wins: /finances/expenses is Expenses, not Invoices
const allLinks: readonly NavLink[] = [...groups.flatMap((g): readonly NavLink[] => g.links), { href: "/settings", key: "settings", icon: Settings }];
function isActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  const link = allLinks.find((l) => l.href === href);
  const mine = [href, ...(link?.also ?? [])].some((base) => under(base, pathname));
  return mine && !allLinks.some((other) => other.href !== href && other.href.startsWith(`${href}/`) && under(other.href, pathname));
}

function NavItem({
  href,
  label,
  icon: Icon,
  collapsed = false,
  onNavigate,
  badge,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  collapsed?: boolean;
  onNavigate?: () => void;
  // a count needing attention (open problem reports)
  badge?: number;
}) {
  const active = isActive(href, usePathname());
  const { tr } = useI18n();
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      // collapsed, the name is a tooltip and still the link's accessible name
      title={collapsed ? label : undefined}
      aria-label={collapsed || badge ? `${label}${badge ? tr(", {n} to look at", { n: badge }) : ""}` : undefined}
      className={cn(
        "relative flex h-10 items-center gap-3 rounded-md px-3 text-[0.925rem] font-medium transition-colors",
        // green bar on the left marks the current section
        "before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full",
        collapsed && "justify-center px-0",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground before:bg-brand-green"
          : "text-muted-foreground hover:bg-secondary hover:text-sidebar-foreground",
      )}
    >
      <Icon className="size-[1.15rem] shrink-0" aria-hidden="true" />
      {!collapsed && <span className="truncate">{label}</span>}
      {badge ? (
        <span aria-hidden="true" className={cn("rounded-full bg-amber-500 px-1.5 text-[0.7rem] font-semibold text-white tabular-nums", collapsed ? "absolute top-1 right-1" : "ml-auto")}>
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

export type NavBadges = Partial<Record<Key, number>>;

function SectionLinks({ labels, hidden, collapsed, onNavigate, badges = {} }: { labels: NavLabels; hidden: Hidden; collapsed?: boolean; onNavigate?: () => void; badges?: NavBadges }) {
  const { tr } = useI18n();
  return groups.map((group) => {
    const links = group.links.filter(({ key }) => !hidden.includes(key));
    if (!links.length) return null;
    return (
      <div key={group.title ?? "main"} className="grid gap-0.5">
        {group.title &&
          (collapsed ? (
            <div aria-hidden="true" className="mx-3 my-2 border-t border-sidebar-border" />
          ) : (
            <div className="px-3 pt-4 pb-1 text-[0.7rem] font-semibold tracking-wider text-muted-foreground uppercase">{tr(group.title)}</div>
          ))}
        {links.map(({ href, key, icon }) => (
          <NavItem key={href} href={href} label={labels[key]} icon={icon} collapsed={collapsed} onNavigate={onNavigate} badge={badges[key]} />
        ))}
      </div>
    );
  });
}

// The sidebar on large screens. It can shrink to icons only; the choice is
// kept in a cookie so the server draws it the same way on the next page load.
export function Sidebar({
  labels,
  hidden = [],
  initiallyCollapsed,
  logo,
  mark,
  badges,
}: {
  labels: NavLabels;
  hidden?: Hidden;
  badges?: NavBadges;
  initiallyCollapsed: boolean;
  logo: React.ReactNode;
  mark: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
  }
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const { tr } = useI18n();
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex print:hidden",
        collapsed ? "w-[4.25rem]" : "w-56",
      )}
    >
      <Link href="/" aria-label="MaidCare" className={cn("flex h-16 shrink-0 items-center border-b border-sidebar-border", collapsed ? "justify-center" : "px-4")}>
        {collapsed ? mark : logo}
      </Link>
      <nav aria-label={tr("Sections")} className="grid flex-1 content-start gap-0.5 overflow-y-auto p-2.5">
        <SectionLinks labels={labels} hidden={hidden} collapsed={collapsed} badges={badges} />
      </nav>
      <div className="grid gap-0.5 border-t border-sidebar-border p-2.5">
        <NavItem href="/settings" label={labels.settings} icon={Settings} collapsed={collapsed} />
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? tr("Expand sidebar") : tr("Collapse sidebar")}
          title={collapsed ? tr("Expand sidebar") : tr("Collapse sidebar")}
          className={cn(
            "flex h-10 items-center gap-3 rounded-md px-3 text-[0.925rem] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-sidebar-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          <ToggleIcon className="size-[1.15rem] shrink-0" aria-hidden="true" />
          {!collapsed && <span>{tr("Collapse")}</span>}
        </button>
      </div>
    </aside>
  );
}

// Below large screens the same links are in a drawer that slides in from the
// left; picking one closes it.
export function MobileNav({ labels, hidden = [], logo, badges }: { labels: NavLabels; hidden?: Hidden; logo: React.ReactNode; badges?: NavBadges }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const { tr } = useI18n();
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger aria-label={labels.menu} className="grid size-9 shrink-0 place-items-center rounded-md border hover:bg-secondary">
        <Menu className="size-[1.15rem]" aria-hidden="true" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed inset-y-0 left-0 z-50 flex w-[min(17rem,85vw)] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl outline-none transition-transform duration-200 data-ending-style:-translate-x-full data-starting-style:-translate-x-full">
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-sidebar-border pr-2 pl-4">
            <Dialog.Title className="sr-only">{labels.menu}</Dialog.Title>
            {logo}
            <Dialog.Close aria-label={tr("Close menu")} className="grid size-9 place-items-center rounded-md hover:bg-secondary">
              <X className="size-5" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <nav aria-label={labels.menu} className="grid flex-1 content-start gap-0.5 overflow-y-auto p-2.5">
            <SectionLinks labels={labels} hidden={hidden} onNavigate={close} badges={badges} />
            <div aria-hidden="true" className="mx-3 my-2 border-t border-sidebar-border" />
            <NavItem href="/settings" label={labels.settings} icon={Settings} onNavigate={close} />
          </nav>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
