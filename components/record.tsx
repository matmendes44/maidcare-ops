// Building blocks for record pages (customer, appointment), modelled on
// NetSuite's record view: collapsible field groups of small uppercase labels.
import { ChevronDown } from "lucide-react";

export const linkClass = "text-link underline-offset-4 hover:underline";

// A collapsible group of fields under a grey bar ("Primary Information").
export function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details open className="group mt-6 first-of-type:mt-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md bg-muted px-3 py-2 text-[0.95rem] font-semibold select-none hover:bg-secondary [&::-webkit-details-marker]:hidden">
        <ChevronDown
          className="size-4 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0"
          aria-hidden="true"
        />
        {title}
      </summary>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 px-3 pt-4 sm:gap-x-8 lg:grid-cols-4">{children}</div>
    </details>
  );
}

// One column of label/value pairs inside a field group.
export function FieldColumn({ children }: { children: React.ReactNode }) {
  return <dl className="grid content-start gap-4">{children}</dl>;
}

export function Field({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[0.72rem] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-[0.95rem] break-words">{children || "—"}</dd>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

// Buttons above a tab's table, like NetSuite's "New Case | View History".
export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-center gap-2">{children}</div>;
}

export function TableFrame({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-lg border">{children}</div>;
}

// The small "CUSTOMER" / "APPOINTMENT" label above a record's title.
export function RecordType({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[0.8rem] font-semibold tracking-wide text-muted-foreground uppercase">
      <span className="grid size-6 place-items-center rounded-md bg-accent text-accent-foreground" aria-hidden="true">
        <Icon className="size-3.5" />
      </span>
      {children}
    </div>
  );
}
