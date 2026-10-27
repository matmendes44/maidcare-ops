// Runs first in every production deploy (vercel-build). Stops the deploy,
// before building or migrating and with the current version still live, if a
// setting production can't work without is missing. Warns about optional
// ones. Preview and local builds are not checked.
const production = process.env.VERCEL_ENV === "production";
const problems: string[] = [];
const warnings: string[] = [];

if (production) {
  const authSecret = process.env.AUTH_SECRET?.trim() ?? "";
  if (authSecret.length < 32) problems.push("AUTH_SECRET is missing or shorter than 32 characters (two-step login can't work without it).");
  if (!process.env.DATABASE_URL?.trim()) problems.push("DATABASE_URL is missing.");
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (stripeKey && !/^(sk|rk)_live_/.test(stripeKey)) warnings.push("STRIPE_SECRET_KEY isn't a live key; production will use Stripe test mode.");
  if (!stripeKey) warnings.push("STRIPE_SECRET_KEY isn't set; Finances and charging are off.");
  if (stripeKey && !process.env.STRIPE_WEBHOOK_SECRET?.trim()) warnings.push("STRIPE_WEBHOOK_SECRET isn't set; invoices only update with Sync with Stripe.");
  const bouncie = ["BOUNCIE_CLIENT_ID", "BOUNCIE_CLIENT_SECRET", "BOUNCIE_REDIRECT_URI"].filter((k) => process.env[k]?.trim());
  if (bouncie.length > 0 && bouncie.length < 3) warnings.push("Only some of BOUNCIE_CLIENT_ID / BOUNCIE_CLIENT_SECRET / BOUNCIE_REDIRECT_URI are set; the Fleet page needs all three.");
  if (process.env.BOUNCIE_REDIRECT_URI && !process.env.BOUNCIE_REDIRECT_URI.startsWith("https://")) problems.push("BOUNCIE_REDIRECT_URI must be the https:// production address.");
  // the public demo must never hold a real account's keys
  if (process.env.DEMO_MODE === "1") {
    const real = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", ...bouncie].filter((k) => process.env[k]?.trim());
    if (real.length) problems.push(`The demo (DEMO_MODE=1) must not have ${real.join(", ")} set: remove them.`);
    if ((process.env.CRON_SECRET?.trim() ?? "").length < 16) problems.push("CRON_SECRET is missing or short; the nightly demo reset needs it.");
  }
}

for (const w of warnings) console.warn(`warning: ${w}`);
if (problems.length) {
  console.error("Production settings are incomplete; the deploy was stopped before migrating:");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("Add them in Vercel → Settings → Environment Variables (Production), then redeploy.");
  process.exit(1);
}
console.log(production ? "Production settings OK." : "Not a production deploy; settings not checked.");
