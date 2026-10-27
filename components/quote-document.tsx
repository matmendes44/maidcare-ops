import { Check, Minus } from "lucide-react";
import { Logo } from "@/components/logo";
import { cn } from "cn";
import type { QuoteContent } from "@/lib/quotes/content";

// An estimate laid out like the ones MaidCare has always sent: logo and
// number, the green company band, who it's for, blue and green section bands,
// checklists and price tables. Always on white, like paper, also in dark mode
// and when printed.

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const BLUE = "#2f7cf6";
const GREEN = "#4caf3f";

function Band({ color, title, price }: { color: string; title: string; price?: string }) {
  return (
    <div className="mt-6 flex items-center justify-between gap-4 px-4 py-2.5 font-bold text-white uppercase" style={{ background: color }}>
      <span>{title}</span>
      {price && <span className="shrink-0 normal-case">{price}</span>}
    </div>
  );
}

const Label = ({ children, className = "mt-5" }: { children: React.ReactNode; className?: string }) => (
  <p className={cn(className, "text-[0.75rem] font-bold tracking-wide uppercase")} style={{ color: BLUE }}>
    {children}
  </p>
);

export function QuoteDocument({
  number,
  date,
  validUntil,
  company,
  preparedFor,
  content,
  selected,
}: {
  number: number;
  date: string; // already formatted
  validUntil?: string; // already formatted
  company: { legalName: string; address: string; phone: string; shortName: string };
  preparedFor: { name: string; address: string | null; phone?: string | null; email?: string | null };
  content: QuoteContent;
  // after acceptance: the option and add-ons chosen, highlighted
  selected?: { optionId: string; addOnIds: string[] };
}) {
  const many = content.options.length > 1;
  const single = !many ? content.options[0] : null;
  const withRecurring = content.options.some((o) => o.recurringCents != null);
  const checklist = content.included.columns.length <= 1;
  const optionsFirst = many && Boolean(content.intro);

  const optionsTable = many && (
    <>
      <Band color={optionsFirst ? BLUE : GREEN} title={optionsFirst ? content.title : "Choose your option"} />
      {content.intro && <p className="mt-3 px-3 text-sm font-semibold">{content.intro}</p>}
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-[0.72rem] font-semibold tracking-wide text-[#6b7280] uppercase">
            <th className="px-3 py-2">Option</th>
            <th className="hidden px-3 py-2 sm:table-cell">{optionsFirst ? "First visit includes" : "Areas covered"}</th>
            <th className="px-3 py-2 text-right">{withRecurring ? "First visit" : "Price"}</th>
            {withRecurring && <th className="px-3 py-2 text-right">After</th>}
          </tr>
        </thead>
        <tbody>
          {content.options.map((o, i) => {
            const chosen = selected?.optionId === o.id;
            return (
              <tr key={o.id} className={cn("border-b", i % 2 === 1 && "bg-[#f3f4f6]", chosen && "outline-2 -outline-offset-2 outline-[#4caf3f]")}>
                <td className="px-3 py-3 font-semibold">
                  {o.name}
                  {chosen && <span className="ml-2 rounded bg-[#4caf3f] px-1.5 py-0.5 text-[0.65rem] font-bold text-white uppercase">Chosen</span>}
                  {o.description && <span className="mt-0.5 block text-[0.8rem] font-normal text-[#6b7280] sm:hidden">{o.description}</span>}
                </td>
                <td className="hidden px-3 py-3 text-[#6b7280] sm:table-cell">{o.description}</td>
                <td className="px-3 py-3 text-right text-base font-bold whitespace-nowrap" style={{ color: withRecurring ? BLUE : undefined }}>
                  {money(o.priceCents)}
                </td>
                {withRecurring && <td className="px-3 py-3 text-right text-base font-bold whitespace-nowrap">{o.recurringCents != null ? money(o.recurringCents) : "—"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );

  return (
    <article className="mx-auto w-full max-w-3xl bg-white px-5 py-8 text-[#1a2433] shadow-sm sm:px-10 print:max-w-none print:px-0 print:py-0 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <Logo variant="stacked" className="w-28" />
        <div className="text-right">
          <p className="text-4xl font-extrabold tracking-tight" style={{ color: BLUE }}>
            ESTIMATE
          </p>
          <dl className="mt-1 grid grid-cols-[auto_auto] justify-end gap-x-6 gap-y-0.5 text-sm">
            <dt className="font-semibold text-[#6b7280]">Estimate #</dt>
            <dd>{number}</dd>
            <dt className="font-semibold text-[#6b7280]">Date</dt>
            <dd>{date}</dd>
            {validUntil && (
              <>
                <dt className="font-semibold text-[#6b7280]">Valid until</dt>
                <dd>{validUntil}</dd>
              </>
            )}
          </dl>
        </div>
      </header>

      <div className="mt-6 px-4 py-2 text-lg font-bold text-white" style={{ background: GREEN }}>
        {company.legalName}
      </div>
      <p className="bg-[#f3f4f6] px-4 py-1.5 text-[0.8rem]">
        {company.address} • Phone: {company.phone}
      </p>

      <Label>Prepared for</Label>
      <p className="text-lg font-bold">{preparedFor.name}</p>
      <p className="text-sm text-[#6b7280]">{[preparedFor.address, preparedFor.phone, preparedFor.email].filter(Boolean).join(" • ")}</p>

      {optionsFirst ? optionsTable : <Band color={BLUE} title={content.title} price={single ? money(single.priceCents) : undefined} />}
      {/* the price breakdown stays on the staff side; the customer sees what's covered */}
      {content.areas.length > 0 && (
        <div className="px-3">
          <Label className={optionsFirst ? "mt-5" : "mt-3"}>Areas covered</Label>
          {content.areas.map((a) => (
            <p key={a} className="mt-1 text-sm">
              {a}
            </p>
          ))}
        </div>
      )}

      {content.addOns.length > 0 &&
        content.addOns.map((a) => {
          const chosen = selected?.addOnIds.includes(a.id);
          return (
            <div key={a.id} className="mt-5">
              <div className={cn("flex items-center justify-between gap-3 bg-[#e8f0fe] px-4 py-2 font-bold uppercase", chosen && "outline-2 -outline-offset-2 outline-[#4caf3f]")}>
                <span>
                  {a.name}
                  {chosen && <span className="ml-2 rounded bg-[#4caf3f] px-1.5 py-0.5 text-[0.65rem] text-white">Chosen</span>}
                </span>
                <span className="shrink-0" style={{ color: BLUE }}>
                  {a.kind === "on_request" ? "+" : ""}
                  {money(a.priceCents)}
                </span>
              </div>
              {a.description && <p className="mt-1.5 px-4 text-sm">{a.description}</p>}
            </div>
          );
        })}

      {content.included.tasks.length > 0 &&
        (checklist ? (
          <div className="px-3">
            <Label>What&apos;s included</Label>
            <ul className="mt-2 grid gap-x-6 gap-y-2 bg-[#f3f4f6] px-4 py-4 text-sm sm:grid-cols-3">
              {content.included.tasks.map((t) => (
                <li key={t.label} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0" style={{ color: GREEN }} aria-hidden="true" />
                  {t.label}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <Band color={GREEN} title={`What's included: ${content.included.columns.join(" vs. ")}`} />
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[0.72rem] font-semibold tracking-wide text-[#6b7280] uppercase">
                  <th className="px-3 py-2">Task</th>
                  {content.included.columns.map((c) => (
                    <th key={c} className="px-3 py-2 text-center">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {content.included.tasks.map((t, i) => (
                  <tr key={t.label} className={cn("border-b", i % 2 === 1 && "bg-[#f3f4f6]")}>
                    <td className="px-3 py-1.5">{t.label}</td>
                    {t.marks.map((m, j) => (
                      <td key={j} className="px-3 py-1.5 text-center">
                        {m ? <Check className="mx-auto size-4" style={{ color: GREEN }} aria-label="Included" /> : <Minus className="mx-auto size-4 text-[#c4c9d0]" aria-label="Not included" />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ))}

      {!optionsFirst && optionsTable}

      {content.recurring.length > 0 && (
        <>
          <Band color={GREEN} title={content.recurringTitle} />
          {content.recurringIntro && <p className="mt-3 px-3 text-sm font-semibold">{content.recurringIntro}</p>}
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[0.72rem] font-semibold tracking-wide text-[#6b7280] uppercase">
                <th className="px-3 py-2">Plan</th>
                <th className="hidden px-3 py-2 sm:table-cell">What&apos;s included</th>
                {content.recurring.some((r) => r.when) && <th className="px-3 py-2">When</th>}
                <th className="px-3 py-2 text-right">Per visit</th>
              </tr>
            </thead>
            <tbody>
              {content.recurring.map((r, i) => (
                <tr key={`${r.name}-${i}`} className={cn("border-b", i % 2 === 1 && "bg-[#f3f4f6]")}>
                  <td className="px-3 py-3 font-semibold">
                    {r.name}
                    {r.description && <span className="mt-0.5 block text-[0.8rem] font-normal text-[#6b7280] sm:hidden">{r.description}</span>}
                  </td>
                  <td className="hidden px-3 py-3 text-[#6b7280] sm:table-cell">{r.description}</td>
                  {content.recurring.some((x) => x.when) && <td className="px-3 py-3">{r.when}</td>}
                  <td className="px-3 py-3 text-right text-base font-bold whitespace-nowrap">{money(r.priceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {content.notes.map((n) => (
        <p key={n} className="mt-3 px-3 text-[0.8rem] text-[#6b7280] italic">
          {n}
        </p>
      ))}

      <p className="mt-8 text-center text-sm font-semibold" style={{ color: GREEN }}>
        Ready to book or have questions? Call or text {company.phone}. Thank you for considering {company.shortName}!
      </p>
    </article>
  );
}
