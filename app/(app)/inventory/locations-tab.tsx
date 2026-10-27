import Link from "next/link";
import { Building2, Car, Printer, Warehouse } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { locationKinds } from "@/lib/inventory/options";
import { createLocation } from "./actions";
import { ActionForm, Submit } from "./action-form";
import { getAssets, stockLevels, type Location } from "./data";

const icons = { storage: Warehouse, vehicle: Car, site: Building2 };

export async function LocationsTab({ locations, manage }: { locations: Location[]; manage: boolean }) {
  const [levels, assets] = await Promise.all([stockLevels(), getAssets()]);
  const units = (id: number) => [...levels.values()].reduce((s, m) => s + Math.max(0, m.get(id) ?? 0), 0);
  return (
    <div className="grid gap-6">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {locations.map((l) => {
          const Icon = icons[l.kind];
          return (
            <li key={l.id}>
              <Link
                href={`/inventory/locations/${l.id}`}
                className="flex items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-brand-blue/50 hover:bg-secondary/30"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-semibold">
                    {l.name}
                    {!l.isActive && <Badge variant="muted">Inactive</Badge>}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {locationKinds[l.kind]} · {units(l.id)} units ·{" "}
                    {assets.filter((a) => a.asset.locationId === l.id && a.asset.status !== "retired" && a.asset.status !== "lost").length}{" "}
                    equipment
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-start gap-6">
        <Link href="/inventory/labels" className={buttonVariants({ variant: "outline" })}>
          <Printer aria-hidden="true" />
          Print QR labels
        </Link>
        {manage && (
          <ActionForm action={createLocation} className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
            <NativeSelect name="kind" defaultValue="storage" aria-label="Kind of location">
              <NativeSelectOption value="storage">Storage</NativeSelectOption>
              <NativeSelectOption value="site">Client site (supply closet)</NativeSelectOption>
            </NativeSelect>
            <Input name="name" placeholder="Example: Garage shelf" aria-label="Location name" className="w-56" />
            <Submit>Add location</Submit>
          </ActionForm>
        )}
      </div>
      <p className="text-[0.8rem] text-muted-foreground">
        Vehicles are added automatically from Fleet. Client sites are for commercial accounts that keep supplies on site.
      </p>
    </div>
  );
}
