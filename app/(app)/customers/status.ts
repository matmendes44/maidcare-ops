import type { CustomerStatus } from "./options";

export const statusVariant: Record<
  CustomerStatus,
  "info" | "success" | "outline" | "muted"
> = {
  lead: "info",
  active: "success",
  paused: "outline",
  inactive: "muted",
};
