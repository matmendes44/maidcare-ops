import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeWatcher } from "@/components/theme-watcher";
import { LOCALE_COOKIE, THEME_COOKIE } from "@/lib/i18n/config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MaidCare",
  description: "Customer and scheduling management for MaidCare Cleaning Service staff.",
};

// Runs while the HTML is parsed, before the first paint: applies the saved
// theme (dark class + color-scheme) and page language from their cookies, so
// a dark-mode user never sees a flash of light. "system" follows the device.
const preferencesScript = `(function(){try{var c=document.cookie,r=document.documentElement;var t=(c.match(/(?:^|; )${THEME_COOKIE}=(light|dark|system)/)||[])[1]||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";var l=(c.match(/(?:^|; )${LOCALE_COOKIE}=(en-US|pt-BR)/)||[])[1];if(l)r.lang=l}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en-US"
      // the script above changes class, style and lang before React hydrates
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: preferencesScript }} />
      </head>
      <body
        className="min-h-full flex flex-col"
        // browser extensions add attributes here before React hydrates (e.g.
        // ColorZilla's cz-shortcut-listen); this only covers <body>'s own
        // attributes, not anything inside it
        suppressHydrationWarning
      >
        {children}
        <ThemeWatcher />
      </body>
    </html>
  );
}
