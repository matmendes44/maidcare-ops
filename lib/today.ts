import "server-only";

import { connection } from "next/server";
import { todayISO } from "@/app/(app)/customers/options";

// Today's date ("YYYY-MM-DD", Eastern) for Server Components. Waits for the
// request first: with Cache Components, reading the clock while a page is
// prerendered would freeze the build's date into it.
export async function today() {
  await connection();
  return todayISO();
}
