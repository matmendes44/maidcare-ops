import "server-only";

import { db } from "@/db";
import { auditLog } from "@/db/schema";

// An audit_log entry written by the app, for things the database triggers
// don't see: someone viewing or exporting a tax ID or a tax document, or a
// tax ID being changed (the entry never contains the number itself).
export function auditEntry(userId: number, tableName: string, rowId: number, action: "view" | "update" | "insert" | "delete", what: Record<string, unknown>) {
  return db.insert(auditLog).values({ tableName, rowId, action, changedBy: userId, changes: what });
}
