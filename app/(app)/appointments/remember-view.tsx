"use client";

import { useEffect } from "react";
import { VIEW_COOKIE } from "./options";

// Saves the calendar view (day / week / month) in this browser so /appointments
// opens on it next time. A cookie rather than localStorage so the server can
// render the right view straight away.
export function RememberView({ view }: { view: "day" | "week" | "month" }) {
  useEffect(() => {
    const secure = location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${VIEW_COOKIE}=${view}; path=/; max-age=31536000; samesite=lax${secure}`;
  }, [view]);
  return null;
}
