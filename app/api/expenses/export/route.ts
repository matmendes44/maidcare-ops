import { getExpenses, parseExpenseFilters, type ExpenseRow } from "@/app/(app)/finances/expenses/data";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { categories, frequencies, paidWith, paymentMethods, cardBrands, type Category, type PaymentMethod, type CardBrand } from "@/lib/expenses/options";
import { csv, workbook, type Cell } from "@/lib/xlsx";

// Expenses as CSV or Excel, for the accountant: every expense with its
// Schedule C line, and (Excel) summary sheets by category, line, vendor and
// month. Takes the same filters as the expense list.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  if (!can(user, "expenses.view")) return new Response(null, { status: 403 });

  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams);
  const filters = { ...parseExpenseFilters(params), sort: "date" as const, dir: "asc" as const, page: 1 };
  const { rows, sum } = await getExpenses(filters, { all: true });
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const span = filters.from || filters.to ? `${filters.from ?? "start"}-to-${filters.to ?? "today"}` : "all";
  const name = `expenses-${span}.${format}`;

  const header = ["Date", "Vendor ID", "Vendor", "Category", "Schedule C line", "Description", "Paid with", "Payment method", "Card", "Card last 4", "Reference", "Recurring", "Receipts", "Amount", "Recorded by", "Expense ID"];
  const detail = (r: ExpenseRow, money: (c: number) => Cell, date: (d: string) => Cell): Cell[] => {
    const e = r.expense;
    const cat = categories[e.category as Category];
    return [
      date(e.expenseDate),
      r.vendorCode,
      r.vendorName,
      cat?.label ?? e.category,
      cat?.scheduleC ?? "",
      e.description ?? "",
      paidWith(e),
      paymentMethods[e.paymentMethod as PaymentMethod] ?? e.paymentMethod,
      e.cardBrand ? (cardBrands[e.cardBrand as CardBrand] ?? e.cardBrand) : "",
      e.cardLast4 ?? "",
      e.reference ?? "",
      r.frequency ? frequencies[r.frequency] : "One-time",
      r.receipts,
      money(e.amountCents),
      r.createdByName ?? "",
      e.id,
    ];
  };

  if (format === "csv") {
    const body = csv([header, ...rows.map((r) => detail(r, (c) => (c / 100).toFixed(2), (d) => d) as (string | number)[])]);
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const group = (key: (r: ExpenseRow) => string) => {
    const m = new Map<string, { count: number; cents: number }>();
    for (const r of rows) {
      const k = key(r);
      const g = m.get(k) ?? { count: 0, cents: 0 };
      g.count++;
      g.cents += r.expense.amountCents;
      m.set(k, g);
    }
    return [...m.entries()];
  };
  const byCategory = group((r) => r.expense.category).sort((a, b) => b[1].cents - a[1].cents);
  const byLine = group((r) => categories[r.expense.category as Category]?.scheduleC ?? "Other").sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true }));
  const byVendor = group((r) => `${r.vendorCode} ${r.vendorName}`).sort((a, b) => b[1].cents - a[1].cents);
  const byMonth = group((r) => r.expense.expenseDate.slice(0, 7)).sort((a, b) => a[0].localeCompare(b[0]));
  const totalRow = (cols: number): Cell[] => [{ bold: "Total" }, ...Array(cols - 2).fill(null), { boldMoney: sum }];

  const file = workbook([
    {
      name: "Summary",
      widths: [34, 30, 10, 14],
      rows: [
        ["Category", "Schedule C line", "Expenses", "Total"],
        ...byCategory.map(([k, g]) => [categories[k as Category]?.label ?? k, categories[k as Category]?.scheduleC ?? "", g.count, { money: g.cents }] as Cell[]),
        [{ bold: "Total" }, null, rows.length, { boldMoney: sum }],
        [],
        [{ bold: "Schedule C line" }, null, { bold: "Expenses" }, { bold: "Total" }],
        ...byLine.map(([k, g]) => [k, null, g.count, { money: g.cents }] as Cell[]),
        [],
        [{ bold: `Period: ${filters.from ?? "start"} to ${filters.to ?? "today"}` }],
        ["Schedule C lines are a suggestion from the category; check with your accountant."],
      ],
    },
    { name: "Expenses", widths: [11, 9, 26, 24, 30, 36, 18, 18, 12, 10, 14, 14, 9, 12, 16, 10], rows: [header, ...rows.map((r) => detail(r, (c) => ({ money: c }), (d) => ({ date: d }))), totalRow(14)] },
    { name: "By vendor", widths: [36, 10, 14], rows: [["Vendor", "Expenses", "Total"], ...byVendor.map(([k, g]) => [k, g.count, { money: g.cents }] as Cell[]), totalRow(3)] },
    { name: "By month", widths: [12, 10, 14], rows: [["Month", "Expenses", "Total"], ...byMonth.map(([k, g]) => [k, g.count, { money: g.cents }] as Cell[]), totalRow(3)] },
  ]);
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
