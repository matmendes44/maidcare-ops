// Who may change an expense: anyone who manages expenses, or whoever added it
// (staff, who can only add one-time expenses).
import { can, type Role } from "@/lib/auth/permissions";

export function canEditExpense(user: { id: number; role: Role } | null | undefined, createdBy: number | null) {
  if (can(user, "expenses.manage")) return true;
  return Boolean(user) && can(user, "expenses.create") && createdBy === user!.id;
}
