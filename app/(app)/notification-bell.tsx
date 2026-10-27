"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { cn } from "cn";
import { useI18n } from "@/components/i18n-provider";
import type { Tr } from "@/lib/i18n/tr";

type Item = { id: number; kind: string; title: string; body: string | null; href: string | null; createdAt: string; read: boolean };

const ago = (iso: string, tr: Tr) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return tr("just now");
  if (m < 60) return tr("{n} min ago", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return tr("{n} h ago", { n: h });
  return tr("{n} d ago", { n: Math.round(h / 24) });
};

// The bell in the header: unread count, a list of recent notifications, and
// a pop-up when a new one arrives (checked every minute, on returning to the
// window, and on moving to another page, e.g. after an action that alerts).
export function NotificationBell() {
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Item | null>(null);
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const seen = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const { tr } = useI18n();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data: { items: Item[]; unread: number } = await res.json();
      setItems(data.items);
      setUnread(data.unread);
      const newest = data.items[0];
      // a pop-up for anything new since the last check (not on first load)
      if (seen.current !== null && newest && newest.id > seen.current && !newest.read) setToast(newest);
      seen.current = newest?.id ?? 0;
    } catch {
      // offline: try again next time
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 60_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // a new page may come right after something that added a notification
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [pathname, query, load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 12_000);
    return () => clearTimeout(t);
  }, [toast]);

  async function mark(body: { ids?: number[]; all?: boolean }) {
    await fetch("/api/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
    load();
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={unread ? tr("Notifications, {n} unread", { n: unread }) : tr("Notifications")}
        className="relative grid size-9 place-items-center rounded-md border hover:bg-secondary"
      >
        <Bell className="size-[1.1rem]" aria-hidden="true" />
        {unread > 0 && <span className="absolute -top-1 -right-1 min-w-4 rounded-full bg-destructive px-1 text-center text-[0.65rem] leading-4 font-semibold text-white">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        // phones: full width under the header; larger screens: under the bell
        <div className="fixed inset-x-4 top-16 z-50 overflow-hidden rounded-lg border bg-popover shadow-xl sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-[22rem]" role="dialog" aria-label={tr("Notifications")}>
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">{tr("Notifications")}</span>
            {unread > 0 && (
              <button type="button" onClick={() => mark({ all: true })} className="inline-flex items-center gap-1 text-[0.8rem] text-link hover:underline">
                <CheckCheck className="size-3.5" aria-hidden="true" />
                {tr("Mark all read")}
              </button>
            )}
          </div>
          {/* a short, scrollable list; each entry at most two lines of text */}
          <ul className="max-h-[min(24rem,60vh)] divide-y overflow-y-auto overscroll-contain">
            {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">{tr("Nothing yet.")}</li>}
            {items.map((n) => {
              const body = (
                <>
                  <span className="flex items-start gap-2">
                    {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-blue" aria-label={tr("Unread")} />}
                    <span className={cn("line-clamp-2 text-sm", !n.read && "font-semibold")}>{n.title}</span>
                  </span>
                  {n.body && <span className="mt-0.5 line-clamp-2 text-[0.8rem] text-muted-foreground">{n.body}</span>}
                  <span className="mt-0.5 block text-[0.7rem] text-muted-foreground">{ago(n.createdAt, tr)}</span>
                </>
              );
              return (
                <li key={n.id}>
                  {n.href ? (
                    <Link
                      href={n.href}
                      onClick={() => {
                        setOpen(false);
                        if (!n.read) mark({ ids: [n.id] });
                      }}
                      className="block px-3 py-2.5 hover:bg-secondary"
                    >
                      {body}
                    </Link>
                  ) : (
                    <button type="button" onClick={() => !n.read && mark({ ids: [n.id] })} className="block w-full px-3 py-2.5 text-left hover:bg-secondary">
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {toast && (
        <div role="status" className="fixed right-4 bottom-4 z-[60] w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-brand-green/50 bg-popover p-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <Bell className="mt-0.5 size-5 shrink-0 text-brand-green" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 font-semibold">{toast.title}</p>
              {toast.body && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{toast.body}</p>}
              {toast.href && (
                <Link
                  href={toast.href}
                  onClick={() => {
                    mark({ ids: [toast.id] });
                    setToast(null);
                  }}
                  className="mt-2 inline-block text-sm font-medium text-link hover:underline"
                >
                  {tr("Open")}
                </Link>
              )}
            </div>
            <button type="button" onClick={() => setToast(null)} aria-label={tr("Dismiss")} className="grid size-6 place-items-center rounded hover:bg-secondary">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
