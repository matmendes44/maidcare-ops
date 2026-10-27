import "server-only";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, PREFERENCE_COOKIE_MAX_AGE, THEME_COOKIE, type Locale, type Theme } from "@/lib/i18n/config";

// Server Actions only. Mirrors the user's saved preferences into cookies the
// inline script in app/layout.tsx reads before the first paint. Not httpOnly
// for that reason; they hold nothing sensitive.
export async function setPreferenceCookies(prefs: { theme?: Theme; locale?: Locale }) {
  const jar = await cookies();
  const options = {
    path: "/",
    maxAge: PREFERENCE_COOKIE_MAX_AGE,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
  if (prefs.theme) jar.set(THEME_COOKIE, prefs.theme, options);
  if (prefs.locale) jar.set(LOCALE_COOKIE, prefs.locale, options);
}
