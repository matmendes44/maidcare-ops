// The dashboard's widgets and how someone has arranged them (saved per user
// in users.dashboard_layout). Shared by the page, the editor and the save.

export const widgetIds = ["attention", "today", "recurring", "week", "money", "sales", "rebook", "calendar", "shortcuts"] as const;
export type WidgetId = (typeof widgetIds)[number];
// small = one column; wide = two columns (on screens with room for them)
export type WidgetSize = "small" | "wide";
export type DashboardLayout = { order: WidgetId[]; hidden: WidgetId[]; sizes: Partial<Record<WidgetId, WidgetSize>> };

export const widgetNames: Record<WidgetId, string> = {
  attention: "Needs attention",
  today: "Today",
  recurring: "Recurring visits to book",
  week: "Next 7 days",
  money: "This month",
  sales: "Customers and sales",
  rebook: "Rebook these regulars",
  calendar: "Calendar",
  shortcuts: "Shortcuts",
};

export const defaultSizes: Record<WidgetId, WidgetSize> = {
  attention: "small",
  today: "small",
  recurring: "small",
  week: "small",
  money: "wide",
  sales: "wide",
  rebook: "small",
  calendar: "small",
  shortcuts: "small",
};

export const defaultLayout: DashboardLayout = { order: [...widgetIds], hidden: [], sizes: {} };

const isId = (v: unknown): v is WidgetId => typeof v === "string" && (widgetIds as readonly string[]).includes(v);

// Whatever was saved (or sent), made valid: known widgets only, each once,
// and any widget added since the layout was saved shows up at the end.
export function normalizeLayout(raw: unknown): DashboardLayout {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const order = [...new Set((Array.isArray(r.order) ? r.order : []).filter(isId))];
  for (const id of widgetIds) if (!order.includes(id)) order.push(id);
  const hidden = [...new Set((Array.isArray(r.hidden) ? r.hidden : []).filter(isId))];
  const sizes: DashboardLayout["sizes"] = {};
  const rawSizes = (r.sizes && typeof r.sizes === "object" ? r.sizes : {}) as Record<string, unknown>;
  for (const id of widgetIds) if (rawSizes[id] === "small" || rawSizes[id] === "wide") sizes[id] = rawSizes[id] as WidgetSize;
  return { order, hidden, sizes };
}

export const sizeOf = (layout: DashboardLayout, id: WidgetId) => layout.sizes[id] ?? defaultSizes[id];
