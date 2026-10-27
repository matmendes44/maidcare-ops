"use client";

import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown, Search } from "lucide-react";
import { useI18n } from "@/components/i18n-provider";

export type CustomerOption = { id: number; label: string };

// Searchable customer select: type part of a name, company or customer code.
// The chosen id is submitted through a hidden input named `name`.
export function CustomerPicker({
  id,
  name,
  customers,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  name: string;
  customers: CustomerOption[];
  value: CustomerOption | null;
  onChange: (customer: CustomerOption | null) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const { t } = useI18n();
  return (
    <Combobox.Root
      items={customers}
      value={value}
      onValueChange={(next) => onChange(next)}
      itemToStringLabel={(c: CustomerOption) => c.label}
      isItemEqualToValue={(a: CustomerOption, b: CustomerOption) => a.id === b.id}
      autoHighlight
    >
      <input type="hidden" name={name} value={value?.id ?? ""} />
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Combobox.Input
          id={id}
          placeholder={t.properties.picker.placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="h-9 w-full min-w-0 rounded-lg border border-input bg-background py-1 pr-9 pl-9 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm"
        />
        <Combobox.Trigger
          aria-label={t.properties.picker.show}
          className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <ChevronDown className="size-4" aria-hidden="true" />
        </Combobox.Trigger>
      </div>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="z-50 outline-none">
          <Combobox.Popup className="max-h-[min(var(--available-height),20rem)] w-(--anchor-width) overflow-y-auto rounded-lg border bg-popover py-1 text-popover-foreground shadow-lg outline-none">
            <Combobox.Empty className="px-3 py-2 text-sm text-muted-foreground empty:hidden">
              {t.properties.picker.empty}
            </Combobox.Empty>
            <Combobox.List>
              {(c: CustomerOption) => (
                <Combobox.Item
                  key={c.id}
                  value={c}
                  className="flex cursor-default items-center gap-2 px-3 py-2 text-sm outline-none select-none data-highlighted:bg-secondary data-highlighted:text-secondary-foreground"
                >
                  {/* fixed slot so labels line up whether or not they're checked */}
                  <span className="grid size-4 shrink-0 place-items-center">
                    <Combobox.ItemIndicator className="text-brand-blue">
                      <Check className="size-4" aria-hidden="true" />
                    </Combobox.ItemIndicator>
                  </span>
                  <span>{c.label}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
