"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "cn";
import { useI18n } from "@/components/i18n-provider";

type Contractor = { id: number; label: string; isActive: boolean };

const colors = ["bg-sky-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500", "bg-rose-500", "bg-teal-500", "bg-indigo-500", "bg-orange-500"];
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

// A small round picture for a contractor: their initials on a color of their own.
export function Avatar({ id, name, className }: { id: number; name: string; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("grid size-8 shrink-0 place-items-center rounded-full text-[0.7rem] font-semibold text-white ring-2 ring-background", colors[id % colors.length], className)}>
      {initials(name)}
    </span>
  );
}

// "Who's cleaning": a dropdown of contractors (picture and name), any number
// of them picked. The picked ones go with the form as contractorIds.
export function CrewPicker({ options, value, onChange, invalid }: { options: Contractor[]; value: string[]; onChange: (ids: string[]) => void; invalid?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { tr } = useI18n();
  const picked = options.filter((c) => value.includes(String(c.id)));

  // closes on a tap outside, or Escape
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div ref={box} className="relative">
      {value.map((id) => (
        <input key={id} type="hidden" name="contractorIds" value={id} />
      ))}
      <button
        type="button"
        id="contractorIds"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex min-h-11 w-full items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-left text-sm transition-colors hover:bg-secondary/40",
          invalid && "border-destructive ring-3 ring-destructive/20",
        )}
      >
        {picked.length === 0 ? (
          <span className="flex-1 text-muted-foreground">{tr("Choose who's cleaning")}</span>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="flex -space-x-2">
              {picked.slice(0, 4).map((c) => (
                <Avatar key={c.id} id={c.id} name={c.label} className="size-7" />
              ))}
            </span>
            <span className="truncate">{picked.map((c) => c.label.split(" ")[0]).join(", ")}</span>
          </span>
        )}
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg border bg-popover shadow-lg">
          <ul role="listbox" aria-multiselectable="true" aria-label={tr("Who's cleaning")} className="max-h-72 overflow-y-auto py-1">
            {options.map((c) => {
              const on = value.includes(String(c.id));
              return (
                <li
                  key={c.id}
                  role="option"
                  aria-selected={on}
                  tabIndex={0}
                  onClick={() => toggle(String(c.id))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggle(String(c.id));
                    }
                  }}
                  className={cn("flex cursor-pointer items-center gap-3 px-3 py-2 text-sm outline-none hover:bg-secondary focus-visible:bg-secondary", on && "bg-brand-green/[0.07]")}
                >
                  <Avatar id={c.id} name={c.label} />
                  <span className="min-w-0 flex-1 truncate">
                    {c.label}
                    {!c.isActive && <span className="text-muted-foreground"> (inactive)</span>}
                  </span>
                  <span className={cn("grid size-5 place-items-center rounded-full border", on ? "border-brand-green bg-brand-green text-white" : "border-input")}>
                    {on && <Check className="size-3.5" aria-hidden="true" />}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between border-t px-3 py-2 text-[0.8rem] text-muted-foreground">
            {value.length} picked
            <button type="button" onClick={() => setOpen(false)} className="font-medium text-link">
              {tr("Done")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
