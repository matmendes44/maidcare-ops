// Label lists the app shows through tr() (option names kept in English in
// lib/…/options files and the like), so the i18n test can check each has a
// translation.
import { permissions } from "@/lib/auth/permissions";
import { widgetNames } from "@/lib/dashboard/layout";
import { frequencyLabel } from "@/lib/recurring/schedule";
import { stateStyle } from "@/lib/quotes/status";
import { presetLabels } from "@/lib/reports/range";
import { cardBrands, categories, frequencies as expenseFrequencies, paymentMethods } from "@/lib/expenses/options";
import { paidViaLabels } from "@/app/(app)/finances/paid-via";
import { noAccessSubjects } from "@/app/(app)/finances/no-access-subjects";

export function phraseLists(): string[] {
  return [
    ...Object.values(permissions),
    ...Object.values(widgetNames),
    ...Object.values(frequencyLabel),
    ...noAccessSubjects,
    ...Object.values(paidViaLabels),
    ...Object.values(stateStyle).map((s) => s.label),
    ...Object.values(categories).map((c) => c.label),
    ...Object.values(paymentMethods),
    ...Object.values(cardBrands),
    ...Object.values(expenseFrequencies),
    ...Object.values(presetLabels),
    // report tabs (reports/shared.tsx)
    "Overview", "Money", "Customers", "Estimates", "Operations", "Pricing", "Fleet",
    // estimate list: filters and status pills (finances/estimates/page.tsx)
    ...["All", "Draft", "Sent", "Accepted", "Scheduled", "Declined", "Expired", "Withdrawn"].map((s) => `estimates|${s}`),
    ...["Draft", "Sent", "Viewed", "Accepted", "Scheduled", "Declined", "Expired", "Withdrawn"].map((s) => `estimate|${s}`),
    // invoice list tabs (finances/page.tsx)
    "All invoices", "To finalize", "invoices|Draft", "invoices|Open", "invoices|Past due", "invoices|Paid",
    // customer types (lead form)
    "Residential", "Commercial",
    // vehicle battery states (dashboard)
    "low", "critical",
    // sidebar groups, header search groups
    "Work", "Finances", "Operations", "Business", "Customers", "Properties", "Invoices", "Vendors",
    // customer and invoice statuses (search results)
    ...["Lead", "Active", "Paused", "Inactive"].map((s) => `customer|${s}`),
    ...["Draft", "Open", "Paid", "Void", "Uncollectible"].map((s) => `invoice|${s}`),
  ];
}
