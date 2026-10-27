// Every English text passed to tr() has a Brazilian Portuguese entry, with the
// same {placeholders}; and tr() fills them in (lib/i18n/tr.ts).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { phraseLists } from "../../lib/i18n/phrase-lists";
import { ptBR } from "../../lib/i18n/phrases/pt-BR";
import { translator } from "../../lib/i18n/tr";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name.startsWith(".") ? [] : files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

// tr("…"), tr('…') or tr(`…`) as the first argument (or phrase(…))
const call = /\b(?:tr|phrase)\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/g;
const unescape = (s: string) => s.replace(/\\(["'`\\])/g, "$1").replace(/\\n/g, "\n");
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// plural(tr, n, "one", "many"): its arguments, split at top-level commas (n
// can be any expression); the two texts must be plain strings
function pluralTexts(source: string): string[] {
  const found: string[] = [];
  const start = "plural(tr,";
  for (let at = source.indexOf(start); at !== -1; at = source.indexOf(start, at + 1)) {
    const args: string[] = [];
    let depth = 0;
    let quote = "";
    let current = "";
    for (let i = at + start.length; i < source.length && args.length < 3; i++) {
      const c = source[i];
      if (quote) {
        current += c;
        if (c === "\\") current += source[++i];
        else if (c === quote) quote = "";
      } else if (c === '"' || c === "'" || c === "`") {
        quote = c;
        current += c;
      } else if ("([{".includes(c)) {
        depth++;
        current += c;
      } else if (")]}".includes(c) && depth === 0) {
        args.push(current.trim());
        break;
      } else if (")]}".includes(c)) {
        depth--;
        current += c;
      } else if (c === "," && depth === 0) {
        args.push(current.trim());
        current = "";
      } else current += c;
    }
    for (const arg of args.slice(1, 3)) {
      const m = /^"((?:[^"\\]|\\.)*)"$/.exec(arg);
      found.push(m ? unescape(m[1]) : `\${not a plain string: ${arg}}`);
    }
  }
  return found;
}

const used = new Map<string, string>();
for (const file of ["app", "components", "lib"].flatMap((d) => files(d))) {
  const source = readFileSync(file, "utf8");
  for (const m of source.matchAll(call)) used.set(unescape(m[1] ?? m[2] ?? m[3]), file);
  for (const text of pluralTexts(source)) used.set(text, file);
}

test("tr() is given plain text, not ${…} (use {placeholders})", () => {
  const bad = [...used].filter(([text]) => text.includes("${")).map(([text, file]) => `${file}: ${text}`);
  assert.deepEqual(bad, []);
});

test("every tr() text has a pt-BR translation", () => {
  const missing = [...used].filter(([text]) => !(text in ptBR)).map(([text, file]) => `${file}: ${text}`);
  assert.deepEqual(missing, []);
});

test("every label list shown through tr() has a pt-BR translation", () => {
  const missing = phraseLists().filter((text) => !(text in ptBR));
  assert.deepEqual(missing, []);
});

test("translations keep their placeholders", () => {
  const wrong = Object.entries(ptBR).filter(([en, pt]) => placeholders(en).join() !== placeholders(pt).join()).map(([en]) => en);
  assert.deepEqual(wrong, []);
});

test("tr() translates and fills placeholders; English is the text itself", () => {
  const en = translator("en-US");
  const pt = translator("pt-BR");
  assert.equal(en("{n} visits", { n: 3 }), "3 visits");
  assert.equal(pt("A phrase nobody translated"), "A phrase nobody translated");
  const [some] = Object.keys(ptBR);
  assert.equal(pt(some), ptBR[some]);
});
