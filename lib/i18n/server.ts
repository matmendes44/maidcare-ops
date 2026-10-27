import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "./config";
import { formatters } from "./format";
import { messages } from "./messages";
import { translator } from "./tr";

// The signed-in user's language, else the browser's last choice (cookie),
// else what the browser asks for. Reads the request, so it only runs inside
// a Suspense boundary or a Server Action.
export const getLocale = cache(async (): Promise<Locale> => {
  const user = await getCurrentUser();
  if (user) return user.locale;
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  const accept = (await headers()).get("accept-language") ?? "";
  return /^pt\b/i.test(accept.trim()) ? "pt-BR" : DEFAULT_LOCALE;
});

// Messages and formatters for Server Components and Server Actions.
export async function getI18n() {
  const locale = await getLocale();
  return { locale, t: messages[locale], fmt: formatters(locale), tr: translator(locale) };
}
