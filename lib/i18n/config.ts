// Shared by server and client code.

export const locales = ["en-US", "pt-BR"] as const;
export type Locale = (typeof locales)[number];
export const DEFAULT_LOCALE: Locale = "en-US";
export const isLocale = (value: unknown): value is Locale => locales.includes(value as Locale);

export const themes = ["system", "light", "dark"] as const;
export type Theme = (typeof themes)[number];
export const isTheme = (value: unknown): value is Theme => themes.includes(value as Theme);

// Copies of the signed-in user's preferences, readable before anything
// renders: the inline script in app/layout.tsx applies the theme and page
// language from them before the first paint. The database is the source of
// truth; these are refreshed on sign-in and whenever settings change.
export const THEME_COOKIE = "theme";
export const LOCALE_COOKIE = "locale";
export const PREFERENCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// All scheduling happens in the business's own time zone.
export const TIME_ZONE = "America/New_York";
