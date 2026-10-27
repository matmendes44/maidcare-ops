// Fills the demo database with made-up data (lib/demo-seed.ts), wiping what's
// there. Needs DEMO_MODE=1 and a database with no real accounts:
//
//   npm run demo:seed            (uses .env.demo)
import { resetDemoData } from "../lib/demo-seed";

const started = Date.now();
resetDemoData()
  .then((r) => {
    console.log(`Demo data ready in ${((Date.now() - started) / 1000).toFixed(1)}s:`, r);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Demo seed failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
