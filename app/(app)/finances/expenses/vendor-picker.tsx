"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import { cn } from "cn";
import type { VendorChoice } from "./expense-form";
import { useI18n } from "@/components/i18n-provider";

// Letters and digits only, so "sams" finds "Sam's Club" and "v1000" finds V1000.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const label = (v: VendorChoice) => `${v.code} ${v.name}`;
const MAX_SHOWN = 50;

// A vendor field you can type in: matches by name or vendor ID as you type,
// arrow keys and Enter to choose, and the last option adds what was typed as
// a new vendor. Submits the vendor's id (or "new") as `name`.
export function VendorPicker({
  id,
  name,
  vendors,
  value,
  newName,
  onChange,
  invalid,
}: {
  id: string;
  name: string;
  vendors: VendorChoice[];
  // a vendor id, "new", or "" for none
  value: string;
  newName: string;
  onChange: (value: string, vendor: VendorChoice | null, newName: string) => void;
  invalid?: boolean;
}) {
  const { tr } = useI18n();
  const listId = useId();
  const selected = vendors.find((v) => String(v.id) === value) ?? null;
  const shown = selected ? label(selected) : value === "new" ? newName : "";
  const [query, setQuery] = useState(shown);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const typed = query.trim();
  const editing = open && query !== shown;
  const matches = useMemo(() => {
    const q = norm(editing ? typed : "");
    const pool = vendors.filter((v) => v.isActive || String(v.id) === value);
    const hits = q ? pool.filter((v) => norm(v.name).includes(q) || norm(v.code).includes(q)) : pool;
    // names that start with what's typed first
    return hits.sort((a, b) => Number(norm(b.name).startsWith(q)) - Number(norm(a.name).startsWith(q))).slice(0, MAX_SHOWN);
  }, [vendors, value, typed, editing]);
  const exact = vendors.some((v) => norm(v.name) === norm(typed));
  const options: ({ kind: "vendor"; vendor: VendorChoice } | { kind: "new" })[] = [
    ...matches.map((vendor) => ({ kind: "vendor" as const, vendor })),
    ...(editing && typed && !exact ? [{ kind: "new" as const }] : []),
  ];

  function choose(i: number) {
    const option = options[i];
    if (!option) return;
    if (option.kind === "vendor") {
      setQuery(label(option.vendor));
      onChange(String(option.vendor.id), option.vendor, "");
    } else {
      setQuery(typed);
      onChange("new", null, typed);
    }
    setOpen(false);
  }

  return (
    <div className="relative">
      <input type="hidden" name={name} value={value} />
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        ref={input}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        autoComplete="off"
        placeholder={tr("Search by name or vendor ID…")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={(e) => {
          e.target.select();
          setOpen(true);
        }}
        onBlur={() => {
          // leaving without choosing puts back what was chosen
          setOpen(false);
          setQuery(shown);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, options.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            choose(active);
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            setOpen(false);
            setQuery(shown);
          }
        }}
        className="h-9 w-full min-w-0 rounded-lg border border-input bg-background py-1 pr-8 pl-9 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"
      />
      <ChevronsUpDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      {open && (
        <ul id={listId} role="listbox" aria-label={tr("Vendors")} className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border bg-popover p-1 text-sm shadow-lg">
          {options.length === 0 && <li className="px-3 py-2 text-muted-foreground">{vendors.length ? tr("No vendor matches. Type a name to add one.") : tr("No vendors yet. Type a name to add one.")}</li>}
          {options.map((option, i) => (
            <li
              key={option.kind === "vendor" ? option.vendor.id : "new"}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, so the choice happens before the input loses focus
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
              onMouseMove={() => setActive(i)}
              className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2", i === active && "bg-secondary")}
            >
              {option.kind === "vendor" ? (
                <>
                  <span className="w-14 shrink-0 font-mono text-[0.75rem] text-muted-foreground">{option.vendor.code}</span>
                  <span className="min-w-0 flex-1 truncate">{option.vendor.name}</span>
                  {!option.vendor.isActive && <span className="text-[0.75rem] text-muted-foreground">{tr("inactive")}</span>}
                  {String(option.vendor.id) === value && <Check className="size-4 text-brand-green" aria-hidden="true" />}
                </>
              ) : (
                <>
                  <Plus className="size-4 text-brand-blue" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">
                    {tr("Add “{name}” as a new vendor", { name: typed })}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
