"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Building2, FileText, Loader2, Search, Store, User } from "lucide-react";
import { cn } from "cn";
import { useI18n } from "@/components/i18n-provider";
import type { SearchResult } from "@/lib/search";

const groups = [
  { kind: "customer", label: "Customers", icon: User },
  { kind: "property", label: "Properties", icon: Building2 },
  { kind: "invoice", label: "Invoices", icon: FileText },
  { kind: "vendor", label: "Vendors", icon: Store },
] as const;

// Header search across customers, properties and invoices. Opens from the
// button, ⌘K / Ctrl+K, or "/" when not typing in a field. Arrow keys move
// through the results and Enter opens one.
export function GlobalSearch() {
  const router = useRouter();
  const { tr } = useI18n();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchedFor, setSearchedFor] = useState("");
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inFlight = useRef<AbortController>(undefined);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function search(text: string) {
    setQuery(text);
    clearTimeout(timer.current);
    inFlight.current?.abort();
    if (text.trim().length < 2) {
      setResults([]);
      setSearchedFor("");
      setLoading(false);
      return;
    }
    setLoading(true);
    // wait for a pause in typing, then ask; a newer search cancels this one
    timer.current = setTimeout(async () => {
      const controller = new AbortController();
      inFlight.current = controller;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(text)}`, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data: { results: SearchResult[] } = await res.json();
        setResults(data.results);
        setSearchedFor(text);
        setActive(0);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setResults([]);
        setSearchedFor(text);
      }
      setLoading(false);
    }, 150);
  }

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) search("");
  }

  function go(result: SearchResult) {
    changeOpen(false);
    router.push(result.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    }
  }

  const optionId = (i: number) => `${listId}-${i}`;
  const ready = query.trim().length >= 2 && searchedFor === query && !loading;

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger
        aria-label={tr("Search")}
        className="flex h-9 min-w-0 items-center gap-2 rounded-lg border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:w-72 sm:shrink sm:px-3"
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="hidden truncate sm:inline">{tr("Search…")}</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-sans text-[0.7rem] sm:inline">⌘K</kbd>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs" />
        <Dialog.Popup
          className="fixed inset-x-3 top-3 z-50 mx-auto flex max-h-[min(36rem,calc(100dvh-1.5rem))] max-w-xl flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl outline-none transition-all data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0 sm:top-[12vh]"
        >
          <Dialog.Title className="sr-only">{tr("Search")}</Dialog.Title>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(e) => search(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={tr("Search customers, properties, invoices…")}
              aria-label={tr("Search customers, properties and invoices")}
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls={listId}
              aria-activedescendant={results.length > 0 ? optionId(active) : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
              className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
            {loading && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label={tr("Searching")} />}
            <Dialog.Close className="rounded border px-1.5 py-0.5 text-[0.7rem] text-muted-foreground hover:bg-secondary">Esc</Dialog.Close>
          </div>

          <div className="overflow-y-auto overscroll-contain">
            <ul id={listId} role="listbox" aria-label={tr("Results")} className="py-1">
              {groups.map(({ kind, label, icon: Icon }) => {
                const items = results.map((r, i) => ({ r, i })).filter(({ r }) => r.kind === kind);
                if (items.length === 0) return null;
                return (
                  <li key={kind} role="presentation">
                    <div className="px-3 pt-2 pb-1 text-[0.75rem] font-semibold tracking-wide text-muted-foreground uppercase" aria-hidden="true">
                      {tr(label)}
                    </div>
                    <ul role="presentation">
                      {items.map(({ r, i }) => (
                        <li
                          key={`${r.kind}-${r.id}`}
                          id={optionId(i)}
                          role="option"
                          aria-selected={i === active}
                          onMouseMove={() => setActive(i)}
                          onClick={() => go(r)}
                          className={cn(
                            "mx-1 flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2",
                            i === active && "bg-secondary text-secondary-foreground",
                          )}
                        >
                          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{r.title}</span>
                            {r.subtitle && <span className="block truncate text-[0.8rem] text-muted-foreground">{r.subtitle}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
            {query.trim().length < 2 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {tr("Type a name, customer code, phone, address or invoice number.")}
              </p>
            ) : (
              ready &&
              results.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">{tr("No matches for “{query}”.", { query: query.trim() })}</p>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
