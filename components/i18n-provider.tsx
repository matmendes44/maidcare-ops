"use client";

import { createContext, use } from "react";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { formatters } from "@/lib/i18n/format";
import { messages } from "@/lib/i18n/messages";
import { translator } from "@/lib/i18n/tr";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

// Only the locale crosses from server to client; the dictionaries are bundled
// on the client (they contain functions, which can't be serialized).
export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

export function useI18n() {
  const locale = use(LocaleContext);
  return { locale, t: messages[locale], fmt: formatters(locale), tr: translator(locale) };
}
