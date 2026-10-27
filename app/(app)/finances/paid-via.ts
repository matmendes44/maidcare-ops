// How an invoice was paid, in English (shown through tr()).
export const paidViaLabels = {
  stripe: "Card (Stripe)",
  outside_stripe: "Outside Stripe",
  cash: "Cash",
  check: "Check",
  other: "Other",
} as const;
