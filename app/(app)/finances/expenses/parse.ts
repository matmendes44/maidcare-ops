// Checking what's typed into the expense and recurring-expense forms. Pure:
// shared by the server actions and the tests.
import { cardBrandKeys, categoryKeys, frequencyKeys, isCard, paymentMethodKeys, type CardBrand, type Category, type Frequency, type PaymentMethod } from "@/lib/expenses/options";
import { phrase } from "@/lib/i18n/tr";
import { parseCents } from "../invoices/money";

export const MAX_EXPENSE_CENTS = 100_000_000; // $1,000,000.00, as in the database

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const addYears = (day: string, n: number) => `${Number(day.slice(0, 4)) + n}${day.slice(4)}`;

type Errors = Record<string, string>;
const text = (formData: FormData, k: string) => String(formData.get(k) ?? "").trim();

// The amount and how it was paid, shared by both forms.
function parsePayment(formData: FormData, errors: Errors) {
  const amountRaw = text(formData, "amount");
  const amountCents = parseCents(amountRaw);
  if (!amountRaw) errors.amount = phrase("Enter the amount.");
  else if (amountCents === null) errors.amount = phrase("Enter an amount like 49.99.");
  else if (amountCents <= 0) errors.amount = phrase("The amount must be more than $0.");
  else if (amountCents > MAX_EXPENSE_CENTS) errors.amount = phrase("That's more than $1,000,000. Check the amount.");

  const paymentMethod = text(formData, "paymentMethod") as PaymentMethod;
  if (!paymentMethodKeys.includes(paymentMethod)) errors.paymentMethod = phrase("Pick how it was paid.");
  const card = isCard(paymentMethod);
  const brand = text(formData, "cardBrand");
  const cardBrand = card && brand ? (brand as CardBrand) : null;
  if (cardBrand && !cardBrandKeys.includes(cardBrand)) errors.cardBrand = phrase("Pick a card from the list.");
  const last4 = text(formData, "cardLast4").replace(/\D/g, "");
  const cardLast4 = card && last4 ? last4 : null;
  if (cardLast4 && cardLast4.length !== 4) errors.cardLast4 = phrase("Enter the last 4 digits of the card.");

  const category = text(formData, "category") as Category;
  if (!categoryKeys.includes(category)) errors.category = phrase("Pick a category.");
  const description = text(formData, "description");
  if (description.length > 2000) errors.description = phrase("Keep the description under 2,000 characters.");
  return { amountCents: amountCents ?? 0, paymentMethod, cardBrand, cardLast4, category, description: description || null };
}

// The vendor: an existing one, or a new one typed in on the form.
function parseVendor(formData: FormData, errors: Errors) {
  const raw = text(formData, "vendorId");
  if (raw === "new") {
    const name = text(formData, "newVendorName").replace(/\s+/g, " ");
    if (!name) errors.newVendorName = phrase("Enter the new vendor's name.");
    else if (name.length > 120) errors.newVendorName = phrase("Keep the name under 120 characters.");
    return { vendorId: null, newVendorName: name };
  }
  if (!/^\d{1,15}$/.test(raw)) errors.vendorId = phrase("Pick who was paid.");
  return { vendorId: raw ? Number(raw) : null, newVendorName: null };
}

export function parseExpenseForm(formData: FormData, today: string) {
  const errors: Errors = {};
  const expenseDate = text(formData, "expenseDate");
  if (!expenseDate) errors.expenseDate = phrase("Enter the date.");
  else if (!isDay(expenseDate)) errors.expenseDate = phrase("That date doesn't look right.");
  else if (expenseDate > addYears(today, 1)) errors.expenseDate = phrase("That's more than a year from now.");
  else if (expenseDate < "2000-01-01") errors.expenseDate = phrase("That date is too far back.");

  const vendor = parseVendor(formData, errors);
  const payment = parsePayment(formData, errors);
  const reference = text(formData, "reference");
  if (reference.length > 100) errors.reference = phrase("Keep this under 100 characters.");

  // "Repeats": empty for a one-time expense, or how often it repeats (which
  // starts a recurring schedule from this expense)
  const repeats = text(formData, "repeats");
  if (repeats && !frequencyKeys.includes(repeats as Frequency)) errors.repeats = phrase("Pick how often it repeats.");
  const scheduleRaw = text(formData, "recurringExpenseId");
  const recurringExpenseId = /^\d{1,15}$/.test(scheduleRaw) ? Number(scheduleRaw) : null;

  return {
    values: {
      expenseDate,
      ...vendor,
      ...payment,
      reference: reference || null,
      repeats: (repeats || null) as Frequency | null,
      recurringExpenseId,
    },
    errors,
    confirmedDuplicate: text(formData, "confirmDuplicate") === "1",
  };
}

export function parseScheduleForm(formData: FormData) {
  const errors: Errors = {};
  const vendor = parseVendor(formData, errors);
  const payment = parsePayment(formData, errors);
  const frequency = text(formData, "frequency") as Frequency;
  if (!frequencyKeys.includes(frequency)) errors.frequency = phrase("Pick how often it repeats.");
  const startDate = text(formData, "startDate");
  if (!startDate) errors.startDate = phrase("Enter the first due date.");
  else if (!isDay(startDate)) errors.startDate = phrase("That date doesn't look right.");
  const endDate = text(formData, "endDate");
  if (endDate && !isDay(endDate)) errors.endDate = phrase("That date doesn't look right.");
  else if (endDate && startDate && endDate < startDate) errors.endDate = phrase("The end date is before the first due date.");
  return {
    values: { ...vendor, ...payment, frequency, startDate, endDate: endDate || null, amountVaries: text(formData, "amountVaries") === "on" },
    errors,
  };
}
