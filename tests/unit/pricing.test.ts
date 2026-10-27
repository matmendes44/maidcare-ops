// The price list math, checked against MaidCare's prices.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkContent, totalFor } from "../../lib/quotes/content";
import { allowedFrequencies, basePrice, frequencyRequired, buildEstimate, checkPriceList, cleaningProblem, defaultPriceList as list, extraLine, sqftRanges, sum } from "../../lib/quotes/pricing";

const home = { bedrooms: 3, bathrooms: 2, halfBaths: 0, sqft: 2000 };
const est = (levels: string[], frequencyId: string | null = null, extras: { id: string; units: number }[] = []) => buildEstimate(list, { ...home, levels, frequencyId, extras });

test("3 BR / 2 BA / 1,501–2,000 sq ft: $300, the size folded into the bedroom line", () => {
  const { lines } = basePrice(list, home);
  assert.deepEqual(lines, [{ label: "3 bedrooms", cents: 24000 }, { label: "2 bathrooms", cents: 6000 }]);
  const { content, error } = est(["standard"]);
  assert.equal(error, undefined);
  assert.equal(totalFor(content, "standard", [])!.totalCents, 30000);
  assert.deepEqual(checkContent(content).errors, []);
  assert.doesNotMatch(JSON.stringify(content), /sq ft/);
  assert.equal(content.areas[0], "Your home: 3 bedrooms, 2 bathrooms.");
});

test("each bedroom price plus the required bathroom", () => {
  for (const [bedrooms, lowest] of [[1, 15000], [2, 18500], [3, 24000], [4, 26500], [5, 31000], [6, 36500]])
    assert.equal(sum(basePrice(list, { bedrooms, bathrooms: 0, halfBaths: 0, sqft: null }).lines), lowest, `${bedrooms} BR`);
});

test("square-foot ranges, half baths and bathroom limits", () => {
  assert.deepEqual(sqftRanges(list).map((r) => r.label).slice(0, 3), ["Up to 1,500 sq ft", "1,501–2,000 sq ft", "2,001–2,500 sq ft"]);
  const p = (sqft: number | null, extra = {}) => sum(basePrice(list, { ...home, sqft, ...extra }).lines);
  assert.equal(p(1500), 27000);
  assert.equal(p(2500), 27000 + 8000);
  assert.equal(p(6000), 27000 + 16000);
  assert.ok(basePrice(list, { ...home, sqft: 6001 }).error);
  assert.equal(p(null, { halfBaths: 2 }), 27000 + 2000);
  assert.equal(p(null, { bathrooms: 15 }), 21000 + 10 * 3000);
});

test("extras: per unit and flat", () => {
  assert.deepEqual(list.extras.map((e) => e.id), ["rooms", "cabinets", "fridge", "oven", "laundry"]);
  assert.equal(extraLine(list, "rooms", 2)!.cents, 5000);
  assert.equal(extraLine(list, "fridge", 5)!.cents, 4500);
});

test("deep clean first, then standard cleanings at a discount (extras not repeated)", () => {
  const { content, error } = est(["standard", "deep"], "biweekly", [{ id: "oven", units: 1 }]);
  assert.equal(error, undefined);
  assert.equal(content.options.length, 1);
  assert.equal(content.options[0].id, "deep");
  assert.equal(content.options[0].name, "First Visit: Deep Clean");
  assert.equal(content.title, "First Visit: Deep Clean");
  assert.equal(content.options[0].priceCents, 30000 + 17500 + 4500);
  assert.equal(content.options[0].recurringCents, null);
  assert.deepEqual(content.recurring, [{ name: "Standard cleaning", description: "10% off every visit after the first", when: "Every 2 weeks", priceCents: 27000 }]);
  assert.ok(content.included.tasks.some((t) => t.label === "Inside the oven"));
});

test("standard alone repeats the same service", () => {
  const { content } = est(["standard"], "weekly");
  assert.equal(content.options[0].recurringCents, 24000);
  assert.equal(allowedFrequencies(list, ["standard"]).length, 4);
});

test("which cleanings go together", () => {
  const ok = (levels: string[], f: string | null = null) => cleaningProblem(list, { levels, frequencyId: f });
  assert.ok(ok([]));
  // deep + standard needs weekly, every 2 weeks or monthly
  assert.deepEqual(allowedFrequencies(list, ["deep", "standard"]).map((f) => f.id), ["weekly", "biweekly", "monthly"]);
  assert.ok(ok(["deep", "standard"]));
  assert.ok(ok(["deep", "standard"], "every3"));
  assert.equal(ok(["deep", "standard"], "monthly"), null);
  // deep alone: one time, or the deep clean monthly
  assert.deepEqual(allowedFrequencies(list, ["deep"]).map((f) => f.id), ["monthly"]);
  assert.equal(ok(["deep"]), null);
  assert.equal(ok(["deep"], "monthly"), null);
  assert.ok(ok(["deep"], "weekly"));
  // move-in/out never with deep; alone it's one time; with standard, how often is required
  assert.ok(ok(["moveout", "deep"]));
  assert.deepEqual(allowedFrequencies(list, ["moveout"]), []);
  assert.equal(ok(["moveout"]), null);
  assert.ok(ok(["moveout"], "weekly"));
  assert.equal(allowedFrequencies(list, ["moveout", "standard"]).length, 4);
  assert.equal(ok(["moveout", "standard"], "every3"), null);
  assert.ok(ok(["moveout", "standard"]));
  assert.equal(frequencyRequired(["moveout", "standard"]), true);
  assert.equal(frequencyRequired(["deep"]), false);
  assert.equal(est(["moveout", "standard"], "weekly").content.options[0].priceCents, 30000 + 21000);
  assert.equal(est(["moveout", "standard"], "weekly").content.options[0].name, "First Visit: Move In / Move Out");
  // on its own it keeps the price list's name
  assert.equal(est(["deep"]).content.options[0].name, "Deep clean");
});

test("a deep clean on its own can repeat monthly, at the deep clean price less the discount", () => {
  const { content } = est(["deep"], "monthly");
  // $300 home + $175 deep = $475, 5% off
  assert.equal(content.options[0].recurringCents, 45125);
  assert.deepEqual(content.recurring, [{ name: "Deep clean", description: "5% off every visit after the first", when: "Every month", priceCents: 45125 }]);
  assert.match(content.recurringIntro, /the deep clean repeats every month/);
});

test("the price list keeps the three cleanings and the four frequencies", () => {
  const { list: l, errors } = checkPriceList({ ...list, levels: [{ id: "deep", name: "Deep", upgradeCents: 20000, tasks: ["A"] }, { id: "x", name: "Bogus" }], frequencies: [{ id: "weekly", discountPct: 25 }, { id: "daily", discountPct: 50 }], extras: [{ id: "w", name: "Windows", icon: "window", priceCents: 500 }, { id: "z", name: "Odd", icon: "nope", priceCents: 1 }] });
  assert.deepEqual(errors, []);
  assert.deepEqual(l.levels.map((x) => x.id), ["standard", "deep", "moveout"]);
  assert.equal(l.levels[1].upgradeCents, 20000);
  assert.deepEqual(l.frequencies.map((f) => [f.id, f.discountPct]), [["weekly", 25], ["every3", 15], ["biweekly", 10], ["monthly", 5]]);
  assert.deepEqual(l.extras.map((e) => e.icon), ["window", "sparkles"]);
});
