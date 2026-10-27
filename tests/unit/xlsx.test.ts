// Export files: CSV can't smuggle formulas; the .xlsx is a valid zip.
import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import { csv, workbook } from "../../lib/xlsx";

test("CSV quotes fields and defuses formulas", () => {
  const out = csv([["Vendor", "Amount"], ['=HYPERLINK("http://evil")', 12.5], ["+1 cmd", null], ['He said "hi"', 3]]);
  assert.ok(out.startsWith("﻿"));
  assert.ok(out.includes(`"'=HYPERLINK(""http://evil"")",12.5`));
  assert.ok(out.includes(`"'+1 cmd",`));
  assert.ok(out.includes(`"He said ""hi""",3`));
});

// reads the zip's central directory and inflates each file
function unzip(buf: Buffer) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString();
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    files[name] = inflateRawSync(buf.subarray(start, start + size)).toString();
    p += 46 + nameLen;
  }
  return files;
}

test("the workbook has its parts, escaped text, money and dates", () => {
  const files = unzip(
    workbook([{ name: "Expenses: 2026/Q1", rows: [["Vendor", "Date", "Amount"], ["Sam's <Club> & Co", { date: "2026-10-18" }, { money: 4999 }]] }]),
  );
  for (const part of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml"]) assert.ok(files[part], part);
  assert.ok(files["xl/workbook.xml"].includes('name="Expenses  2026 Q1"'));
  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.ok(sheet.includes("Sam's &lt;Club&gt; &amp; Co"));
  assert.ok(sheet.includes("<v>49.99</v>"));
  assert.ok(sheet.includes("<v>46313</v>")); // 2026-10-18 as an Excel day number
  assert.ok(!sheet.includes("<f>"));
});
