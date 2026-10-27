"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "cn";

type Msg = { message?: string; ok?: boolean };
type Option = { id: string; name: string; description: string; priceCents: number; recurringCents: number | null };
type AddOn = { id: string; name: string; description: string; priceCents: number };
const money = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);

// Choose, confirm it's you, tick to agree and sign; or decline. The full
// terms fold away under the one checkbox so the page stays easy to read.
export function AcceptPanel({
  accept,
  decline,
  ping,
  options,
  addOns,
  verifyKind,
  consent,
  version,
  sha,
  phone,
  taxBp,
}: {
  accept: (prev: Msg, f: FormData) => Promise<Msg>;
  decline: (prev: Msg, f: FormData) => Promise<Msg>;
  ping: () => Promise<void>;
  options: Option[];
  addOns: AddOn[];
  verifyKind: "phone" | "email" | "none";
  consent: { agreement: string; details: string[] };
  version: number;
  sha: string;
  phone: string;
  taxBp: number;
}) {
  const router = useRouter();
  const [state, run, pending] = useActionState(accept, {});
  const [declined, runDecline, declining] = useActionState(decline, {});
  const [optionId, setOptionId] = useState(options.length === 1 ? options[0].id : "");
  const [picked, setPicked] = useState<string[]>([]);
  const [showDecline, setShowDecline] = useState(false);
  const option = options.find((o) => o.id === optionId);
  const subtotal = (option?.priceCents ?? 0) + addOns.filter((a) => picked.includes(a.id)).reduce((s, a) => s + a.priceCents, 0);
  const tax = Math.round((subtotal * taxBp) / 10000);
  const total = subtotal + tax;

  // counts the view from a real browser (not link previews)
  useEffect(() => {
    ping().catch(() => {});
  }, [ping]);
  useEffect(() => {
    if (state.ok || declined.ok) router.refresh();
  }, [state.ok, declined.ok, router]);

  if (state.ok)
    return (
      <div role="status" className="grid justify-items-center gap-2 rounded-xl border border-[#4caf3f]/50 bg-white p-8 text-center text-[#1a2433]">
        <CheckCircle2 className="size-10 text-[#4caf3f]" aria-hidden="true" />
        <p className="text-xl font-bold">Thank you! Your estimate is accepted.</p>
        <p className="text-sm text-[#6b7280]">We&apos;ll call or text you soon to schedule your first visit.</p>
      </div>
    );
  if (declined.ok) return <p className="rounded-xl border bg-white p-6 text-center text-[#1a2433]">Thanks for letting us know. If anything changes, call or text {phone}.</p>;

  return (
    <div className="grid gap-4 rounded-xl border bg-white p-5 text-[#1a2433] shadow-sm sm:p-6">
      <h2 className="text-xl font-bold">Accept this estimate</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(() => run(data));
        }}
        className="grid gap-5"
      >
        <input type="hidden" name="version" value={version} />
        <input type="hidden" name="sha" value={sha} />
        {options.length > 1 ? (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold">1. Choose an option</legend>
            {options.map((o) => (
              <label key={o.id} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3", optionId === o.id ? "border-[#2f7cf6] bg-[#e8f0fe]" : "hover:bg-[#f3f4f6]")}>
                <input type="radio" name="optionId" value={o.id} checked={optionId === o.id} onChange={() => setOptionId(o.id)} className="mt-1 accent-[#2f7cf6]" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{o.name}</span>
                  {o.description && <span className="block text-sm text-[#6b7280]">{o.description}</span>}
                </span>
                <span className="text-right font-bold whitespace-nowrap">
                  {money(o.priceCents)}
                  {o.recurringCents != null && <span className="block text-[0.75rem] font-normal text-[#6b7280]">then {money(o.recurringCents)}</span>}
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <input type="hidden" name="optionId" value={optionId} />
        )}
        {addOns.length > 0 && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold">{options.length > 1 ? "2. " : ""}Optional extras</legend>
            {addOns.map((a) => (
              <label key={a.id} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border p-3", picked.includes(a.id) ? "border-[#2f7cf6] bg-[#e8f0fe]" : "hover:bg-[#f3f4f6]")}>
                <input type="checkbox" name="addOnIds" value={a.id} checked={picked.includes(a.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, a.id] : picked.filter((x) => x !== a.id))} className="mt-1 accent-[#2f7cf6]" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{a.name}</span>
                  {a.description && <span className="block text-sm text-[#6b7280]">{a.description}</span>}
                </span>
                <span className="font-bold whitespace-nowrap">+{money(a.priceCents)}</span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="grid gap-1 rounded-lg bg-[#f3f4f6] px-4 py-3">
          {option && tax > 0 && (
            <>
              <p className="flex justify-between text-sm">
                <span>Subtotal</span>
                <span className="tabular-nums">{money(subtotal)}</span>
              </p>
              <p className="flex justify-between text-sm">
                <span>Sales tax ({taxBp / 100}%)</span>
                <span className="tabular-nums">{money(tax)}</span>
              </p>
            </>
          )}
          <p className="flex items-baseline justify-between">
            <span className="font-semibold">First visit total</span>
            <span className="text-xl font-bold tabular-nums">{option ? money(total) : "Choose an option"}</span>
          </p>
        </div>

        <fieldset className="grid gap-3">
          <legend className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
            <ShieldCheck className="size-4 text-[#4caf3f]" aria-hidden="true" />
            Sign to accept
          </legend>
          {verifyKind !== "none" && (
            <div className="grid gap-1.5">
              <Label htmlFor="verify">{verifyKind === "phone" ? "Last 4 digits of your phone number on file" : "Your email address on file"}</Label>
              <Input
                id="verify"
                name="verify"
                inputMode={verifyKind === "phone" ? "numeric" : "email"}
                maxLength={verifyKind === "phone" ? 4 : 200}
                autoComplete={verifyKind === "phone" ? "off" : "email"}
                className="w-full bg-white text-[#1a2433] sm:w-60"
                required
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="signerName">Type your full name</Label>
            <Input id="signerName" name="signerName" autoComplete="name" maxLength={100} className="w-full bg-white font-serif text-lg text-[#1a2433] italic sm:w-80" required />
          </div>
          <div className="rounded-lg border bg-[#fafafa]">
            <label className="flex cursor-pointer items-start gap-3 p-3 text-sm leading-snug">
              <input type="checkbox" name="agree" required className="mt-0.5 size-5 shrink-0 accent-[#4caf3f]" />
              {consent.agreement}
            </label>
            <details className="group border-t px-3 py-2">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-[0.8rem] font-medium text-[#2f7cf6] [&::-webkit-details-marker]:hidden">
                What you&apos;re agreeing to
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <ul className="mt-2 grid list-disc gap-1.5 pl-5 text-[0.78rem] leading-relaxed text-[#4b5563]">
                {consent.details.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </details>
          </div>
        </fieldset>
        {state.message && (
          <p role="alert" className="rounded-md bg-[#fdecec] px-3 py-2 text-sm text-[#b42318]">
            {state.message}
          </p>
        )}
        <Button type="submit" disabled={pending || !option} className="h-12 bg-[#4caf3f] text-base text-white hover:bg-[#3f9634]">
          {pending ? "Accepting…" : option ? `Accept and sign · ${money(total)}` : "Choose an option to accept"}
        </Button>
      </form>

      {!showDecline ? (
        <button type="button" onClick={() => setShowDecline(true)} className="justify-self-center text-sm text-[#6b7280] underline-offset-4 hover:underline">
          Not for me? Decline this estimate
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            startTransition(() => runDecline(data));
          }}
          className="grid gap-2 border-t pt-4"
        >
          <Label htmlFor="reason">Mind telling us why? (optional)</Label>
          <NativeSelect id="reason" name="reason" defaultValue="" className="w-full bg-white text-[#1a2433] sm:w-72">
            <NativeSelectOption value="">Rather not say</NativeSelectOption>
            <NativeSelectOption value="Price">The price</NativeSelectOption>
            <NativeSelectOption value="Timing">The timing</NativeSelectOption>
            <NativeSelectOption value="Went with someone else">Went with someone else</NativeSelectOption>
            <NativeSelectOption value="Plans changed">My plans changed</NativeSelectOption>
            <NativeSelectOption value="Other">Something else</NativeSelectOption>
          </NativeSelect>
          <Textarea name="detail" rows={2} maxLength={400} placeholder="Anything else (optional)" className="bg-white text-[#1a2433]" />
          {declined.message && <p className="text-sm text-[#b42318]">{declined.message}</p>}
          <div className="flex gap-2">
            <Button type="submit" variant="outline" disabled={declining} className="bg-white text-[#1a2433]">
              Decline the estimate
            </Button>
            <Button type="button" variant="ghost" onClick={() => setShowDecline(false)} className="text-[#1a2433]">
              Never mind
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
