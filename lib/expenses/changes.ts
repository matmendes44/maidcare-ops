// What an edit changed on an expense, in words, for the owner's notification
// when staff edit one. Pure: shared by the action and the tests.
import { cardBrands, categories, paymentMethods, type CardBrand, type Category, type PaymentMethod } from "@/lib/expenses/options";

export type ExpenseSnapshot = {
  expenseDate: string;
  vendorName: string;
  category: string;
  amountCents: number;
  paymentMethod: string;
  cardBrand: string | null;
  cardLast4: string | null;
  reference: string | null;
  description: string | null;
};

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shown = (s: string | null) => (s ? (s.length > 40 ? `"${s.slice(0, 40)}…"` : `"${s}"`) : "(none)");

export function expenseChanges(before: ExpenseSnapshot, after: ExpenseSnapshot): string[] {
  const out: string[] = [];
  const change = (label: string, a: string, b: string) => {
    if (a !== b) out.push(`${label}: ${a} → ${b}`);
  };
  change("Date", before.expenseDate, after.expenseDate);
  change("Amount", money(before.amountCents), money(after.amountCents));
  change("Vendor", before.vendorName, after.vendorName);
  change("Category", categories[before.category as Category]?.label ?? before.category, categories[after.category as Category]?.label ?? after.category);
  change("Paid by", paymentMethods[before.paymentMethod as PaymentMethod] ?? before.paymentMethod, paymentMethods[after.paymentMethod as PaymentMethod] ?? after.paymentMethod);
  change("Card", before.cardBrand ? cardBrands[before.cardBrand as CardBrand] : "(none)", after.cardBrand ? cardBrands[after.cardBrand as CardBrand] : "(none)");
  change("Last 4", before.cardLast4 ?? "(none)", after.cardLast4 ?? "(none)");
  change("Reference", shown(before.reference), shown(after.reference));
  change("Description", shown(before.description), shown(after.description));
  return out;
}
