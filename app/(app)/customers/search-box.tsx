"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function SearchBox({ label, placeholder }: { label: string; placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timeout.current), []);

  // Keeps the query in the URL (alongside the current sort) so results can be
  // bookmarked and survive a refresh. Debounced so we don't query per keystroke.
  function onChange(value: string) {
    clearTimeout(timeout.current);
    timeout.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (value.trim()) params.set("q", value.trim());
      else params.delete("q");
      const qs = params.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    }, 250);
  }

  return (
    <div className="relative w-full sm:max-w-sm">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        defaultValue={searchParams.get("q") ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="pl-8"
        data-pending={isPending || undefined}
      />
    </div>
  );
}

export function SearchBoxFallback({ label }: { label: string }) {
  return (
    <div className="relative w-full sm:max-w-sm">
      <Input disabled aria-label={label} placeholder={`${label}…`} className="pl-8" />
    </div>
  );
}
