// Translating the app's English text: tr("New expense") is the text itself in
// English and its entry in the language's phrase book otherwise (English when
// a phrase is missing, so nothing is ever blank). {name} placeholders are
// filled from vars: tr("{n} visits", { n: 3 }). A word that translates two
// ways gets a context before a bar: tr("invoice|Open") is "Open" in English.
// Every literal passed to tr() must have a pt-BR entry (tests/unit/i18n.test.ts
// checks).
import type { Locale } from "./config";
import { ptBR } from "./phrases/pt-BR";

export type Vars = Record<string, string | number>;
export type Tr = (text: string, vars?: Vars) => string;

const books: Record<Locale, Record<string, string> | null> = { "en-US": null, "pt-BR": ptBR };

const fill = (text: string, vars?: Vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text);

const plain = (text: string) => {
  const bar = text.indexOf("|");
  return bar > 0 && /^[a-z ]+$/.test(text.slice(0, bar)) ? text.slice(bar + 1) : text;
};

const cache = new Map<Locale, Tr>();
export function translator(locale: Locale): Tr {
  let tr = cache.get(locale);
  if (!tr) {
    const book = books[locale];
    tr = (text, vars) => fill(book?.[text] ?? plain(text), vars);
    cache.set(locale, tr);
  }
  return tr;
}

// "1 visit" / "3 visits": the text for one or for many, with {n} filled in.
// The test reads the two texts here too, so keep them literals.
export function plural(tr: Tr, n: number, one: string, many: string, vars?: Vars) {
  return tr(n === 1 ? one : many, { n, ...vars });
}

// Marks English text made away from the page (a lib function's error, say)
// as translatable: it's returned as is, and whoever shows it passes it
// through tr(). The test checks these have translations too.
export function phrase<T extends string>(text: T): T {
  return text;
}
