"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, GripVertical, LayoutGrid, Maximize2, Minimize2, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { useI18n } from "@/components/i18n-provider";
import { defaultLayout, sizeOf, widgetNames, type DashboardLayout, type WidgetId } from "@/lib/dashboard/layout";
import { saveDashboardLayout } from "./dashboard-actions";

export type Widget = { id: WidgetId; title: string; action?: React.ReactNode; body: React.ReactNode };

// The dashboard's widgets in the order (and sizes) someone chose. Customize:
// drag a widget by its handle (mouse or touch) or use the arrows, make it
// small or wide, hide it, or add hidden ones back. Saved to their account.
export function DashboardGrid({ widgets, initial }: { widgets: Widget[]; initial: DashboardLayout }) {
  const [layout, setLayout] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState<WidgetId | null>(null);
  const { tr } = useI18n();
  const live = useRef(layout); // the latest layout while dragging (saved on drop)
  useEffect(() => {
    live.current = layout;
  }, [layout]);

  const available = new Set(widgets.map((w) => w.id));
  const order = layout.order.filter((id) => available.has(id));
  const shown = order.filter((id) => !layout.hidden.includes(id));
  const hidden = order.filter((id) => layout.hidden.includes(id));
  const byId = new Map(widgets.map((w) => [w.id, w]));

  function save(next: DashboardLayout) {
    setLayout(next);
    startTransition(async () => {
      await saveDashboardLayout(next);
    });
  }
  const move = (id: WidgetId, to: WidgetId) => {
    if (id === to) return live.current;
    const o = live.current.order.filter((x) => x !== id);
    o.splice(o.indexOf(to) + (live.current.order.indexOf(id) < live.current.order.indexOf(to) ? 1 : 0), 0, id);
    return { ...live.current, order: o };
  };
  const step = (id: WidgetId, by: -1 | 1) => {
    const i = shown.indexOf(id);
    const to = shown[i + by];
    if (to) save(move(id, to));
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {editing && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setLayout(defaultLayout);
              startTransition(async () => {
                await saveDashboardLayout(null);
              });
            }}
          >
            <RotateCcw aria-hidden="true" />
            {tr("Reset")}
          </Button>
        )}
        <Button type="button" variant={editing ? "default" : "outline"} size="sm" onClick={() => setEditing(!editing)}>
          {editing ? <Check aria-hidden="true" /> : <LayoutGrid aria-hidden="true" />}
          {editing ? tr("Done") : tr("Customize")}
        </Button>
      </div>
      {editing && <p className="text-[0.8rem] text-muted-foreground">{tr("Drag a widget by its handle (or use the arrows) to move it. Make it small or wide, or hide it.")}</p>}

      <div className="grid grid-flow-row-dense grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((id, i) => {
          const w = byId.get(id)!;
          const wide = sizeOf(layout, id) === "wide";
          return (
            <section
              key={id}
              id={`w-${id}`}
              data-widget={id}
              aria-label={w.title}
              className={cn(
                "flex max-h-[30rem] min-w-0 scroll-mt-20 flex-col rounded-xl border bg-card transition-shadow",
                wide && "md:col-span-2",
                editing && "border-dashed border-brand-blue/50",
                dragging === id && "z-10 opacity-80 shadow-xl ring-2 ring-brand-blue",
              )}
            >
              <div className="flex items-center gap-2 px-4 pt-4 pb-3 sm:px-5">
                {editing && (
                  <button
                    type="button"
                    aria-label={`Move ${w.title}`}
                    className="-ml-1 grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-md text-muted-foreground hover:bg-secondary active:cursor-grabbing"
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setDragging(id);
                    }}
                    onPointerMove={(e) => {
                      if (dragging !== id) return;
                      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-widget]")?.dataset.widget as WidgetId | undefined;
                      if (over && over !== id) setLayout(move(id, over));
                    }}
                    onPointerUp={() => {
                      setDragging(null);
                      save(live.current);
                    }}
                    onPointerCancel={() => setDragging(null)}
                  >
                    <GripVertical className="size-4" aria-hidden="true" />
                  </button>
                )}
                <h2 className="min-w-0 flex-1 truncate font-semibold">{w.title}</h2>
                {editing ? (
                  <span className="flex shrink-0 items-center">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={tr("Move {name} up", { name: w.title })} disabled={i === 0} onClick={() => step(id, -1)}>
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={tr("Move {name} down", { name: w.title })} disabled={i === shown.length - 1} onClick={() => step(id, 1)}>
                      <ArrowDown aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" className="hidden md:inline-flex" aria-label={wide ? tr("Make {name} small", { name: w.title }) : tr("Make {name} wide", { name: w.title })} onClick={() => save({ ...layout, sizes: { ...layout.sizes, [id]: wide ? "small" : "wide" } })}>
                      {wide ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={tr("Hide {name}", { name: w.title })} onClick={() => save({ ...layout, hidden: [...layout.hidden, id] })}>
                      <EyeOff aria-hidden="true" />
                    </Button>
                  </span>
                ) : (
                  w.action
                )}
              </div>
              {/* long content scrolls inside the widget */}
              <div className={cn("@container min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-5 sm:pb-5", editing && "pointer-events-none opacity-60 select-none")}>{w.body}</div>
            </section>
          );
        })}
      </div>

      {editing && hidden.length > 0 && (
        <div className="rounded-xl border border-dashed p-4">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <Eye className="size-4" aria-hidden="true" />
            {tr("Hidden widgets")}
          </p>
          <div className="flex flex-wrap gap-2">
            {hidden.map((id) => (
              <Button key={id} type="button" variant="outline" size="sm" onClick={() => save({ ...layout, hidden: layout.hidden.filter((x) => x !== id) })}>
                <Plus aria-hidden="true" />
                {tr(widgetNames[id])}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
