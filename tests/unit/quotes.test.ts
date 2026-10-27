// Quotes: checking a document, adding up a choice, and fingerprints.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkContent, emptyContent, priceRange, totalFor } from "../../lib/quotes/content";
import { canonicalJson, fingerprint } from "../../lib/quotes/fingerprint";
import { buildEstimate, defaultPriceList } from "../../lib/quotes/pricing";

// An older-style estimate with two options and add-ons, which saved quotes can still have.
const sample = checkContent({
  title: "Deep clean",
  options: [
    { id: "standard", name: "Standard", priceCents: 18500 },
    { id: "deep", name: "Deep clean", priceCents: 38500 },
  ],
  addOns: [
    { id: "closets", name: "Inside closets", priceCents: 27000, kind: "optional" },
    { id: "floor4", name: "4th floor", priceCents: 7500, kind: "on_request" },
  ],
}).content;

test("estimates from the price list are valid quotes", () => {
  for (const levels of [["standard"], ["deep"], ["deep", "standard"], ["moveout", "standard"]]) {
    const { content, error } = buildEstimate(defaultPriceList, { bedrooms: 2, bathrooms: 1, halfBaths: 1, sqft: 1200, levels, frequencyId: levels.length > 1 ? "monthly" : null, extras: [{ id: "rooms", units: 2 }] });
    assert.equal(error, undefined, levels.join("+"));
    assert.deepEqual(checkContent(content).errors, [], levels.join("+"));
  }
});

test("missing names and prices are caught; bad values are cleaned", () => {
  const { errors } = checkContent(emptyContent());
  assert.ok(errors.some((e) => /title/.test(e)));
  assert.ok(errors.some((e) => /Option 1 needs a name/.test(e)));
  assert.ok(errors.some((e) => /Option 1 needs a price/.test(e)));
  const { content, errors: e2 } = checkContent({ title: " Deep clean ", options: [{ name: "A", priceCents: 1.5 }, { name: "B", priceCents: -100 }, { name: "C", priceCents: 99_999_999 }] });
  assert.equal(content.title, "Deep clean");
  assert.equal(e2.filter((e) => /needs a price/.test(e)).length, 3);
  // option ids are made unique
  const dup = checkContent({ title: "x", options: [{ id: "a", name: "A", priceCents: 100 }, { id: "a", name: "B", priceCents: 200 }] }).content;
  assert.notEqual(dup.options[0].id, dup.options[1].id);
});

test("the total is the option plus the optional add-ons picked; on-request add-ons can't be picked", () => {
  const c = sample; // deep clean $385 + optional closets $270
  assert.equal(totalFor(c, "deep", [])!.totalCents, 38500);
  assert.equal(totalFor(c, "deep", ["closets"])!.totalCents, 65500);
  assert.equal(totalFor(c, "deep", ["closets", "closets"])!.totalCents, 65500);
  assert.equal(totalFor(c, "nope", []), null);
  assert.equal(totalFor(c, "deep", ["made-up"]), null);
  assert.equal(totalFor(c, "standard", ["floor4"]), null); // 4th floor is on request
  assert.deepEqual(priceRange(c), { low: 18500, high: 38500 });
});

test("fingerprints don't depend on key order, and change with any content", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
  const c = sample;
  assert.equal(fingerprint(c), fingerprint(JSON.parse(JSON.stringify(c))));
  assert.notEqual(fingerprint(c), fingerprint({ ...c, options: [{ ...c.options[0], priceCents: 38400 }] }));
});

import { followUp, quoteState, validUntilFrom } from "../../lib/quotes/status";

test("estimates are good for two weeks from the day they're sent", () => {
  assert.equal(validUntilFrom("2026-10-20"), "2026-11-03");
  assert.equal(validUntilFrom("2026-12-25"), "2027-01-08");
});

test("quote states, including expiry and scheduling", () => {
  const base = { status: "sent", validUntil: "2026-11-01", firstViewedAt: null, appointmentId: null };
  assert.equal(quoteState(base, "2026-10-18"), "sent");
  assert.equal(quoteState({ ...base, firstViewedAt: "2026-10-18T12:00:00Z" }, "2026-10-18"), "viewed");
  assert.equal(quoteState(base, "2026-11-02"), "expired");
  assert.equal(quoteState({ ...base, status: "accepted" }, "2026-12-01"), "accepted"); // accepted never expires
  assert.equal(quoteState({ ...base, status: "accepted", appointmentId: 5 }, "2026-10-18"), "scheduled");
  assert.equal(quoteState({ ...base, status: "draft", validUntil: "2020-01-01" }, "2026-10-18"), "draft");
});

test("follow-ups: unopened, ignored, expiring, and accepted but not scheduled", () => {
  const now = Date.parse("2026-10-18T15:00:00Z");
  const q = { status: "sent", validUntil: "2026-11-15", firstViewedAt: null, appointmentId: null, sentAt: "2026-10-15T15:00:00Z", lastViewedAt: null };
  assert.match(followUp(q, "2026-10-18", now)!, /Not opened/);
  assert.equal(followUp({ ...q, sentAt: "2026-10-17T15:00:00Z" }, "2026-10-18", now), null);
  assert.match(followUp({ ...q, firstViewedAt: "2026-10-14T12:00:00Z", lastViewedAt: "2026-10-14T12:00:00Z" }, "2026-10-18", now)!, /no answer/);
  assert.match(followUp({ ...q, validUntil: "2026-10-20" }, "2026-10-18", now)!, /Expires in 2 days/);
  assert.match(followUp({ ...q, status: "accepted" }, "2026-10-18", now)!, /call to schedule/);
  assert.equal(followUp({ ...q, status: "accepted", appointmentId: 1 }, "2026-10-18", now), null);
});
