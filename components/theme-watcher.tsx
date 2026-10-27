"use client";

import { useEffect } from "react";
import { THEME_COOKIE, isTheme, type Theme } from "@/lib/i18n/config";

// Applies a theme to the page now (used right after changing it in settings).
export function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

function savedTheme(): Theme {
  const value = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`))?.[1];
  return isTheme(value) ? value : "system";
}

// With the "system" theme, follows the device switching between light and
// dark while the app is open. (The inline script in app/layout.tsx handles
// the initial paint.)
export function ThemeWatcher() {
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (savedTheme() === "system") applyTheme("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return null;
}
