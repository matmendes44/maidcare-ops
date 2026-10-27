// Shared by server and client code, so only *types* come from the schema.
import type { appointments } from "@/db/schema";
import { TIME_ZONE } from "@/lib/i18n/config";

export { TIME_ZONE };

export type AppointmentStatus = (typeof appointments.$inferSelect)["status"];

// Labels: t.enums.appointmentStatus (lib/i18n/messages).
// in_progress: a vehicle has arrived (set by GPS) and nobody has marked it done
export const appointmentStatuses: AppointmentStatus[] = ["pending", "in_progress", "completed", "canceled"];
// not done or canceled yet
export const openStatuses: AppointmentStatus[] = ["pending", "in_progress"];

export const statusVariant: Record<AppointmentStatus, "info" | "warning" | "success" | "muted"> = {
  pending: "info",
  in_progress: "warning",
  completed: "success",
  canceled: "muted",
};

// Remembers the calendar view (day / week / month) last used in this browser. Kept
// here rather than in the client component that sets it: a Server Component
// importing a plain value from a "use client" file gets a reference, not the
// string.
export const VIEW_COOKIE = "appointments_view";

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: TIME_ZONE,
});

// A stored timestamp as the date ("2026-10-16") and time ("09:00") inputs
// show it in the business's time zone.
export function toLocalInputs(iso: string) {
  const p = Object.fromEntries(partsFormat.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// "YYYY-MM-DD" arithmetic on calendar dates, independent of time zones.
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function startOfMonth(date: string) {
  return `${date.slice(0, 7)}-01`;
}
export function addMonths(date: string, months: number) {
  const d = new Date(`${startOfMonth(date)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
export function startOfWeek(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((day + 6) % 7)); // weeks start on Monday
}
