// The fixed lists behind expenses: categories, how they were paid, card
// brands and how often recurring ones repeat. The database checks the same
// values (drizzle/0013_expenses.sql); add to both together. The labels are
// English: they're shown through tr().
import { translator, type Tr } from "@/lib/i18n/tr";

export const categories = {
  supplies: { label: "Cleaning supplies", scheduleC: "22 Supplies" },
  equipment: { label: "Equipment & tools", scheduleC: "22 Supplies" },
  fuel: { label: "Fuel", scheduleC: "9 Car and truck expenses" },
  vehicle: { label: "Vehicle repairs & upkeep", scheduleC: "9 Car and truck expenses" },
  insurance: { label: "Insurance", scheduleC: "15 Insurance" },
  wages: { label: "Wages", scheduleC: "26 Wages" },
  contractors: { label: "Contract labor", scheduleC: "11 Contract labor" },
  marketing: { label: "Advertising & marketing", scheduleC: "8 Advertising" },
  software: { label: "Software & subscriptions", scheduleC: "27a Other expenses" },
  phone: { label: "Phone & internet", scheduleC: "25 Utilities" },
  rent: { label: "Rent & storage", scheduleC: "20b Rent: other business property" },
  utilities: { label: "Utilities", scheduleC: "25 Utilities" },
  office: { label: "Office expenses", scheduleC: "18 Office expense" },
  fees: { label: "Bank & card fees", scheduleC: "27a Other expenses" },
  taxes: { label: "Taxes & licenses", scheduleC: "23 Taxes and licenses" },
  professional: { label: "Legal & accounting", scheduleC: "17 Legal and professional services" },
  meals: { label: "Meals", scheduleC: "24b Deductible meals" },
  travel: { label: "Travel", scheduleC: "24a Travel" },
  uniforms: { label: "Uniforms", scheduleC: "27a Other expenses" },
  training: { label: "Training", scheduleC: "27a Other expenses" },
  other: { label: "Other", scheduleC: "27a Other expenses" },
} as const;
export type Category = keyof typeof categories;
export const categoryKeys = Object.keys(categories) as Category[];

export const paymentMethods = {
  credit_card: "Credit card",
  debit_card: "Debit card",
  cash: "Cash",
  check: "Check",
  bank_transfer: "Bank transfer (ACH)",
  zelle: "Zelle",
  app: "Venmo / PayPal / Cash App",
  other: "Other",
} as const;
export type PaymentMethod = keyof typeof paymentMethods;
export const paymentMethodKeys = Object.keys(paymentMethods) as PaymentMethod[];
export const isCard = (m: string | null | undefined) => m === "credit_card" || m === "debit_card";

export const cardBrands = { amex: "Amex", visa: "Visa", mastercard: "Mastercard", discover: "Discover", other: "Other card" } as const;
export type CardBrand = keyof typeof cardBrands;
export const cardBrandKeys = Object.keys(cardBrands) as CardBrand[];

export const frequencies = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Every 3 months",
  yearly: "Yearly",
} as const;
export type Frequency = keyof typeof frequencies;
export const frequencyKeys = Object.keys(frequencies) as Frequency[];

// How the expense was paid, in a few words: "Amex ••1005", "Check #1042".
// (in the language of tr; English by default)
export function paidWith(e: { paymentMethod: string; cardBrand: string | null; cardLast4: string | null; reference?: string | null }, tr: Tr = translator("en-US")) {
  const method = tr(paymentMethods[e.paymentMethod as PaymentMethod] ?? e.paymentMethod);
  let text: string = method;
  if (isCard(e.paymentMethod) && e.cardBrand) text = cardBrands[e.cardBrand as CardBrand] ? tr(cardBrands[e.cardBrand as CardBrand]) : method;
  if (e.cardLast4) text += ` ••${e.cardLast4}`;
  if (e.paymentMethod === "check" && e.reference) text += ` #${e.reference.replace(/^#/, "")}`;
  return text;
}

export const categoryLabel = (c: string) => categories[c as Category]?.label ?? c;
