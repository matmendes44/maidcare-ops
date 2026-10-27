// The public demo (DEMO_MODE=1): made-up data, one-click sign-in as a demo
// owner or staff member, and nothing that reaches a real Stripe or Bouncie
// account. The data is rebuilt every night (app/api/demo/reset). What the
// demo blocks is in lib/auth/permissions.ts (demoBlocked).

export const isDemo = () => process.env.DEMO_MODE === "1";

export const demoUsers = {
  owner: { email: "owner@demo.maidcare.invalid", name: "Olivia Owner" },
  staff: { email: "staff@demo.maidcare.invalid", name: "Sam Staff" },
} as const;
export type DemoRole = keyof typeof demoUsers;
