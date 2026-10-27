"use client";

import { Check } from "lucide-react";
import { CleaningIcon } from "@/components/cleaning-icon";
import { cn } from "cn";
import { useI18n } from "@/components/i18n-provider";

// A clickable card with an icon and a small title; picked ones glow green.
// A toggle by default; `radio` makes it one choice of a role="radiogroup".
// `suggested` marks a choice made for the user that still needs a tap.
export function ChoiceTile({
  icon,
  title,
  sub,
  on,
  disabled,
  radio,
  suggested,
  onClick,
  children,
}: {
  icon?: string;
  title: string;
  sub?: string;
  on: boolean;
  disabled?: boolean;
  radio?: boolean;
  suggested?: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  const { tr } = useI18n();
  return (
    <div className="grid content-start">
      <button
        type="button"
        {...(radio ? { role: "radio", "aria-checked": on } : { "aria-pressed": on })}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "relative grid min-h-24 place-items-center content-center gap-1.5 rounded-xl border bg-card p-3 text-center transition-all duration-150",
          on
            ? "border-brand-green bg-brand-green/[0.07] shadow-[0_0_0_3px_color-mix(in_oklab,var(--brand-green)_25%,transparent),0_6px_20px_-4px_color-mix(in_oklab,var(--brand-green)_55%,transparent)]"
            : suggested
              ? "border-2 border-dashed border-amber-500 bg-amber-500/[0.06] hover:-translate-y-0.5 hover:shadow-md"
              : "hover:-translate-y-0.5 hover:border-brand-green/50 hover:shadow-md",
          disabled && "cursor-not-allowed opacity-40 hover:translate-y-0 hover:shadow-none",
        )}
      >
        {on && (
          <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-brand-green text-white">
            <Check className="size-3.5" aria-hidden="true" />
          </span>
        )}
        {suggested && !on && (
          <span aria-hidden="true" className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-amber-500 px-2 py-0.5 text-[0.65rem] font-semibold tracking-wide text-white uppercase">{tr("Suggested")}</span>
        )}
        {icon && <CleaningIcon name={icon} className={cn("size-7", on ? "text-brand-green" : "text-muted-foreground")} />}
        <span className={cn("leading-tight font-medium", icon ? "text-[0.8rem]" : "text-sm")}>{title}</span>
        {sub && <span className="text-[0.7rem] text-muted-foreground">{sub}</span>}
      </button>
      {children}
    </div>
  );
}
