import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AlertTriangle, CalendarPlus, FileText, HardHat, Pencil, Trash2, Wallet, X } from "lucide-react";
import { Kpi } from "@/components/charts";
import { ConfirmButton } from "@/components/confirm-button";
import { PageLoading } from "@/components/page-loading";
import { Field, FieldColumn, FieldGroup, RecordType, linkClass } from "@/components/record";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { describeRate } from "@/lib/contractors/pay";
import { dueDate, maskTin, taxClassifications, thresholdCents, yearStatus, type TaxClassification } from "@/lib/contractors/tax";
import { getI18n } from "@/lib/i18n/server";
import { today } from "@/lib/today";
import { addDays, startOfMonth, startOfWeek, addMonths } from "../../appointments/options";
import { getExpenses, parseExpenseFilters } from "../../finances/expenses/data";
import { ExpenseTable } from "../../finances/expenses/expense-table";
import { NoAccess } from "../../finances/no-access";
import { deleteDocument, deletePayRate, removeFromVisit, revealTin, setDayRate, uploadDocument } from "../actions";
import { getContractor, parseContractorId, workIn } from "../data";
import { DayRateForm, DocumentUploader, TaxIdReveal } from "./parts";

const saved: Record<string, string> = { created: "Contractor added.", updated: "Changes saved.", visits: "Visits added." };
const docKinds = { w9: "W-9", "1099_nec": "1099-NEC", other: "Document" } as const;

function periods(day: string) {
  const week = startOfWeek(day);
  const month = startOfMonth(day);
  return [
    { key: "week", label: "This week", from: week, to: day },
    { key: "last-week", label: "Last week", from: addDays(week, -7), to: addDays(week, -1) },
    { key: "month", label: "This month", from: month, to: day },
    { key: "last-month", label: "Last month", from: addMonths(day, -1), to: addDays(month, -1) },
    { key: "year", label: "This year", from: `${day.slice(0, 4)}-01-01`, to: day },
  ];
}

async function ContractorRecord({ params, searchParams }: Pick<PageProps<"/contractors/[id]">, "params" | "searchParams">) {
  const user = await getCurrentUser();
  if (!can(user, "contractors.view")) return <NoAccess what="contractors" />;
  const id = parseContractorId((await params).id);
  const c = id === null ? null : await getContractor(id);
  if (!c) notFound();
  const [sp, { fmt }, day] = await Promise.all([searchParams, getI18n(), today()]);
  const manage = can(user, "contractors.manage");
  const tax = can(user, "contractors.tax");
  const seeExpenses = can(user, "expenses.view");

  const options = periods(day);
  const period = options.find((p) => p.key === sp.period) ?? options[0];
  const work = workIn(c, period);
  const payments = seeExpenses ? await getExpenses({ ...parseExpenseFilters({}), vendor: c.vendorId, from: `${day.slice(0, 4)}-01-01` }) : null;
  const owed = c.earnedTotal - c.paidTotal;
  const currentRate = c.rates.map((r) => r.rate).find((r) => r.effectiveFrom <= day) ?? null;
  const masked = maskTin(c.tinType, c.tinLast4);
  const hasAddress = Boolean(c.street && c.city && c.state && c.zip);
  const year = Number(day.slice(0, 4));
  const years = [...new Set([year, year - 1, ...c.paidByYear.map((p) => p.year)])].sort((a, b) => b - a);
  const payHref = (cents: number, note: string) =>
    `/finances/expenses/new?vendor=${c.vendorId}&amount=${(Math.max(0, cents) / 100).toFixed(2)}&note=${encodeURIComponent(note)}`;
  const periodNote = `Pay for ${fmt.calendarDate(period.from)} – ${fmt.calendarDate(period.to)} (${work.daysWorked} ${work.daysWorked === 1 ? "day" : "days"})`;

  return (
    <>
      {typeof sp.saved === "string" && saved[sp.saved] && (
        <p role="status" className="mb-4 rounded-lg border border-brand-green/40 bg-success px-4 py-2.5 text-sm font-medium text-success-foreground">
          {sp.saved === "visits" && typeof sp.n === "string" ? `${sp.n} ${sp.n === "1" ? "visit" : "visits"} added.` : saved[sp.saved]}
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <RecordType icon={HardHat}>Contractor</RecordType>
          <h1 className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-3xl font-bold">
            {c.firstName} {c.lastName}
            <Badge variant={c.isActive ? "success" : "muted"} className="h-7 px-3 text-[0.8rem]">
              {c.isActive ? "Active" : "Inactive"}
            </Badge>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {c.businessName && `${c.businessName} · `}
            {seeExpenses ? (
              <Link href={`/finances/vendors/${c.vendorId}`} className={linkClass}>
                Vendor {c.vendorCode}
              </Link>
            ) : (
              `Vendor ${c.vendorCode}`
            )}
            {currentRate && ` · ${describeRate(currentRate, fmt.money)}`}
          </p>
        </div>
      </div>

      {manage && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-b pb-4">
          <Link href={`/contractors/${c.id}/edit`} className={buttonVariants()}>
            <Pencil aria-hidden="true" />
            Edit
          </Link>
          {can(user, "expenses.manage") && (
            <Link href={payHref(owed, `Pay through ${fmt.calendarDate(day)}`)} className={buttonVariants({ variant: "outline" })}>
              <Wallet aria-hidden="true" />
              Record a payment
            </Link>
          )}
          <Link href={`/contractors/${c.id}/visits`} className={buttonVariants({ variant: "outline" })}>
            <CalendarPlus aria-hidden="true" />
            Add past visits
          </Link>
        </div>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={`Days worked · ${period.label.toLowerCase()}`} value={String(work.daysWorked)} sub={(() => {
            const n = work.days.reduce((s, d) => s + d.visits.length, 0);
            return `${n} ${n === 1 ? "visit" : "visits"}`;
          })()} />
        <Kpi label={`Earned · ${period.label.toLowerCase()}`} value={fmt.money(work.totalCents)} />
        <Kpi label="Unpaid" value={fmt.money(owed)} tone={owed > 0 ? "warn" : undefined} sub={`earned ${fmt.money(c.earnedTotal)} · paid ${fmt.money(c.paidTotal)}`} />
        <Kpi
          label={`${year} on the 1099-NEC`}
          value={fmt.money(c.paidByYear.find((p) => p.year === year)?.reportable ?? 0)}
          sub={`1099 needed at ${fmt.money(thresholdCents(year))}`}
        />
      </div>

      {work.daysWithoutRate.length > 0 && (
        <p role="alert" className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          {work.daysWithoutRate.length} {work.daysWithoutRate.length === 1 ? "day" : "days"} worked before any day rate was set earn nothing. Set a rate starting on or before {work.daysWithoutRate[0]}.
        </p>
      )}

      <section className="mt-8" aria-labelledby="work-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="work-heading" className="text-lg font-semibold">
            Days worked
          </h2>
          <div className="flex flex-wrap gap-1.5 text-sm" role="group" aria-label="Period">
            {options.map((p) => (
              <Link
                key={p.key}
                href={`/contractors/${c.id}?period=${p.key}`}
                scroll={false}
                aria-current={p.key === period.key ? "true" : undefined}
                className={cn("rounded-md border px-2.5 py-1", p.key === period.key ? "border-brand-blue bg-brand-blue/10 font-medium" : "text-muted-foreground hover:bg-secondary")}
              >
                {p.label}
              </Link>
            ))}
          </div>
        </div>
        {work.days.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No completed visits in this period.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <ul className="divide-y">
              {work.days.map((d) => (
                <li key={d.day} className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr_7rem]">
                  <div className="font-medium">{fmt.calendarDate(d.day)}</div>
                  <ul className="grid gap-1 text-sm">
                    {d.visits.map((v) => (
                      <li key={v.appointmentId} className="flex flex-wrap items-center gap-x-2">
                        <Link href={`/appointments/${v.appointmentId}`} className={linkClass}>
                          {fmt.timeRange(v.start, v.end)}
                        </Link>
                        <span>{v.customerName}</span>
                        <span className="text-muted-foreground">{v.address}</span>
                        {v.contractorsOnVisit > 1 && <span className="text-[0.75rem] text-muted-foreground">· {v.contractorsOnVisit} cleaners</span>}
                        {manage && (
                          <ConfirmButton
                            label={`Remove from this visit`}
                            icon={<X aria-hidden="true" />}
                            size="icon-sm"
                            variant="ghost"
                            title="Take them off this visit?"
                            description="Use this if they didn't work it. The day's pay changes to match."
                            confirmLabel="Remove"
                            action={removeFromVisit.bind(null, c.id, v.appointmentId)}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="text-right tabular-nums sm:self-start">
                    {d.rate ? fmt.money(d.cents) : <span className="text-amber-700 dark:text-amber-400">No rate</span>}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/40 px-4 py-2.5 text-sm">
              <span>
                {work.daysWorked} {work.daysWorked === 1 ? "day" : "days"} · <span className="font-semibold">{fmt.money(work.totalCents)}</span>
              </span>
              {manage && can(user, "expenses.manage") && work.totalCents > 0 && (
                <Link href={payHref(work.totalCents, periodNote)} className={buttonVariants({ size: "sm" })}>
                  <Wallet aria-hidden="true" />
                  Pay this period
                </Link>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="mt-8" aria-labelledby="rate-heading">
        <h2 id="rate-heading" className="mb-3 text-lg font-semibold">
          Pay rate
        </h2>
        <div className="grid gap-4 rounded-lg border p-4">
          {manage && <DayRateForm action={setDayRate.bind(null, c.id)} today={day} />}
          {c.rates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rate set yet.</p>
          ) : (
            <ul className="divide-y rounded-md border text-sm">
              {c.rates.map(({ rate: r, setByName }) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="font-medium tabular-nums">{describeRate(r, fmt.money)}</span>
                  <span className="text-muted-foreground">from {fmt.calendarDate(r.effectiveFrom)}</span>
                  {r === currentRate && <Badge variant="success">Current</Badge>}
                  {r.effectiveFrom > day && <Badge variant="info">Upcoming</Badge>}
                  {r.note && <span className="text-muted-foreground">· {r.note}</span>}
                  <span className="ml-auto text-[0.75rem] text-muted-foreground">set by {setByName ?? "unknown"}</span>
                  {manage && (
                    <ConfirmButton
                      label="Remove this rate"
                      icon={<Trash2 aria-hidden="true" />}
                      size="icon-sm"
                      variant="ghost"
                      title="Remove this rate?"
                      description="Days from its start date then use the rate before it. Use this to fix a mistake; for a raise, add a new rate instead."
                      confirmLabel="Remove"
                      action={deletePayRate.bind(null, c.id, r.id)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[0.8rem] text-muted-foreground">
            Paid by the day: one day&apos;s pay for each day they&apos;re on at least one completed visit. A new rate applies from its start date; days before keep their old rate.
          </p>
        </div>
      </section>

      {payments && (
        <section className="mt-8" aria-labelledby="payments-heading">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="payments-heading" className="text-lg font-semibold">
              Payments this year
            </h2>
            <Link href={`/finances/expenses?tab=list&vendor=${c.vendorId}`} className="text-sm text-link underline-offset-4 hover:underline">
              All payments
            </Link>
          </div>
          <ExpenseTable rows={payments.rows} fmt={fmt} hideVendor empty="No payments recorded this year." />
          <p className="mt-2 text-[0.8rem] text-muted-foreground">Card, Venmo and PayPal payments aren&apos;t on the 1099-NEC: the payment company reports those. Cash, checks, bank transfers and Zelle are.</p>
        </section>
      )}

      <section className="mt-8" aria-labelledby="tax-heading">
        <h2 id="tax-heading" className="mb-3 text-lg font-semibold">
          Taxes and 1099s
        </h2>
        <FieldGroup title="From their W-9">
          <FieldColumn>
            <Field label="Legal name">
              {c.firstName} {c.lastName}
              {c.businessName && <div className="text-muted-foreground">{c.businessName}</div>}
            </Field>
          </FieldColumn>
          <FieldColumn>
            <Field label="Tax classification">{c.taxClassification ? taxClassifications[c.taxClassification as TaxClassification] : null}</Field>
          </FieldColumn>
          <FieldColumn>
            <Field label={c.tinType === "ein" ? "EIN" : "SSN"}>
              {!masked ? null : tax ? <TaxIdReveal masked={masked} action={revealTin.bind(null, c.id)} /> : <span className="font-mono">{masked}</span>}
            </Field>
            <Field label="W-9 received">{c.w9ReceivedOn ? fmt.calendarDate(c.w9ReceivedOn) : <span className="text-destructive">Not yet</span>}</Field>
          </FieldColumn>
          <FieldColumn>
            <Field label="Mailing address">
              {hasAddress ? (
                <>
                  {c.street}
                  <div>
                    {c.city}, {c.state} {c.zip}
                  </div>
                </>
              ) : (
                <span className="text-destructive">Incomplete</span>
              )}
            </Field>
          </FieldColumn>
        </FieldGroup>

        <div className="mt-4 overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-[0.8rem] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Tax year</th>
                <th className="px-3 py-2 text-right font-medium">On 1099-NEC</th>
                <th className="px-3 py-2 text-right font-medium">Card / app</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {years.map((y) => {
                const p = c.paidByYear.find((x) => x.year === y);
                const filedDoc = c.documents.find((d) => d.kind === "1099_nec" && d.taxYear === y);
                const st = yearStatus(y, {
                  reportableCents: p?.reportable ?? 0,
                  taxClassification: c.taxClassification,
                  tinLast4: c.tinLast4,
                  w9ReceivedOn: c.w9ReceivedOn,
                  hasAddress,
                  filed: filedDoc ? { reportedCents: filedDoc.reportedCents ?? 0 } : null,
                });
                return (
                  <tr key={y} className="align-top">
                    <td className="px-3 py-2 font-medium">{y}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt.money(p?.reportable ?? 0)}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{fmt.money(p?.excluded ?? 0)}</td>
                    <td className="px-3 py-2">
                      {st.state === "needs_1099" && <Badge variant="destructive">1099 needed by {fmt.calendarDate(dueDate(y))}</Badge>}
                      {st.state === "filed" && <Badge variant="success">1099 filed</Badge>}
                      {st.state === "below_threshold" && <span className="text-muted-foreground">Under {fmt.money(thresholdCents(y))}: no 1099 needed yet</span>}
                      {st.state === "exempt" && <span className="text-muted-foreground">Corporation: no 1099</span>}
                      {st.changedSinceFiled && (
                        <div className="mt-1 text-[0.8rem] text-destructive">
                          Payments changed since the 1099 was filed ({fmt.money(filedDoc!.reportedCents ?? 0)} reported). You may need a corrected 1099.
                        </div>
                      )}
                      {(st.state === "needs_1099" || (st.state === "below_threshold" && y === year)) &&
                        st.problems.map((problem) => (
                          <div key={problem} className="mt-1 text-[0.8rem] text-amber-700 dark:text-amber-400">
                            {problem}
                          </div>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {tax && (
          <div className="mt-6 grid gap-4">
            <h3 className="font-semibold">Documents</h3>
            {c.documents.length > 0 && (
              <ul className="divide-y rounded-lg border text-sm">
                {c.documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
                    <Badge variant="secondary">
                      {docKinds[d.kind]}
                      {d.taxYear ? ` ${d.taxYear}` : ""}
                    </Badge>
                    <a href={`/api/contractor-docs/${d.id}`} target="_blank" rel="noopener" className={linkClass}>
                      {d.fileName}
                    </a>
                    {d.kind === "1099_nec" && <span className="text-muted-foreground">reported {fmt.money(d.reportedCents ?? 0)}</span>}
                    <span className="ml-auto text-[0.75rem] text-muted-foreground">
                      {d.uploadedByName ?? "Unknown"} · {fmt.stamp(d.uploadedAt)}
                    </span>
                    <ConfirmButton
                      label={`Delete ${d.fileName}`}
                      icon={<Trash2 aria-hidden="true" />}
                      size="icon-sm"
                      variant="ghost"
                      title="Delete this document?"
                      description={`${docKinds[d.kind]}: ${d.fileName}. The deletion is logged.`}
                      confirmLabel="Delete"
                      action={deleteDocument.bind(null, c.id, d.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
            <DocumentUploader action={uploadDocument.bind(null, c.id)} years={years} />
            <p className="text-[0.8rem] text-muted-foreground">
              W-9s hold their tax ID, so documents are only shown to people allowed to see tax details, and every view is logged. Upload the 1099-NEC you filed: it records the amount reported, and you&apos;re warned if that year&apos;s payments change afterwards.
            </p>
          </div>
        )}
      </section>

      <div className="mt-8" />
      <FieldGroup title="Contact">
        <FieldColumn>
          <Field label="Phone">{c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className={linkClass}>{c.phone}</a>}</Field>
        </FieldColumn>
        <FieldColumn>
          <Field label="Email">{c.email && <a href={`mailto:${c.email}`} className={linkClass}>{c.email}</a>}</Field>
        </FieldColumn>
        <FieldColumn>
          <Field label="Started">{c.startDate ? fmt.calendarDate(c.startDate) : null}</Field>
        </FieldColumn>
        <FieldColumn>
          <Field label="Added">
            {fmt.calendarDate(c.createdAt.slice(0, 10))}
            {c.createdByName && <span className="text-muted-foreground"> by {c.createdByName}</span>}
          </Field>
        </FieldColumn>
      </FieldGroup>
      {c.notes && (
        <FieldGroup title="Notes">
          <p className="col-span-full whitespace-pre-wrap">{c.notes}</p>
        </FieldGroup>
      )}
    </>
  );
}

export default function ContractorPage(props: PageProps<"/contractors/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ContractorRecord params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}
