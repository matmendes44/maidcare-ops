// Who may change an appointment: anyone with appointments.editPast, and
// everyone else only from its day on (today and future visits; past ones are
// for viewing). Days are compared in the business's time zone.
import { can, type Role } from "@/lib/auth/permissions";

const easternDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso));

export function canChangeAppointment(user: { role: Role } | null | undefined, scheduledStart: string, today: string) {
  return can(user, "appointments.editPast") || (Boolean(user) && easternDay(scheduledStart) >= today);
}
