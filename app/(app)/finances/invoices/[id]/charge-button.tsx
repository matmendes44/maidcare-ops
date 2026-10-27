"use client";

import { startTransition, useActionState, useState } from "react";
import { CreditCard, HandCoins } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "cn";
import type { CardOnFile } from "../../data";
import { chargeInvoice, type ChargeInvoiceState } from "../actions";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const quickPicks = ["Cash", "Check", "Zelle", "Venmo"];

export function ChargeButton({
  id,
  amountCents,
  isDraft,
  cards,
}: {
  id: number;
  amountCents: number;
  isDraft: boolean;
  cards: CardOnFile[];
}) {
  const usable = cards.filter((c) => !c.isExpired);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"card" | "external">(usable.length ? "card" : "external");
  const [cardId, setCardId] = useState(usable[0]?.id ?? "");
  const [paidWith, setPaidWith] = useState("");
  // one per attempt: a double click or resend replays the same attempt, while
  // trying again after an answer (say, another card after a decline) is new
  const [token, setToken] = useState("");
  const [state, run, pending] = useActionState<ChargeInvoiceState, FormData>(async (prev, formData) => {
    const result = await chargeInvoice(id, prev, formData);
    setToken(crypto.randomUUID());
    return result;
  }, {});
  const amount = money.format(amountCents / 100);
  const card = usable.find((c) => c.id === cardId);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => run(formData));
  }

  const option = (active: boolean) =>
    cn(
      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
      active ? "border-brand-blue bg-brand-blue/5" : "hover:bg-muted/50",
    );

  return (
    <>
      <Button
        className="bg-amber-400 text-amber-950 hover:bg-amber-300 dark:bg-amber-400 dark:text-amber-950 dark:hover:bg-amber-300"
        disabled={pending}
        onClick={() => {
          setToken(crypto.randomUUID());
          setOpen(true);
        }}
      >
        <HandCoins aria-hidden="true" />
        {pending ? "Charging…" : "Charge"}
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <AlertDialogContent className="data-[size=default]:max-w-md data-[size=default]:sm:max-w-md">
          <form onSubmit={onSubmit} className="grid gap-4">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="method" value={method} />
            {/* the amount shown here; the server refuses to collect anything else */}
            <input type="hidden" name="expectedCents" value={amountCents} />
            <AlertDialogHeader>
              <AlertDialogTitle>Charge {amount}</AlertDialogTitle>
              <AlertDialogDescription>
                {isDraft
                  ? "This draft is finalized (given its invoice number) first. The customer isn't emailed."
                  : "The customer isn't emailed."}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="grid gap-2" role="radiogroup" aria-label="How it's paid">
              <div className={option(method === "card")} onClick={() => usable.length > 0 && setMethod("card")}>
                <input
                  type="radio"
                  name="choice"
                  aria-label="Card on file"
                  className="mt-1 accent-brand-blue"
                  checked={method === "card"}
                  disabled={usable.length === 0}
                  onChange={() => setMethod("card")}
                />
                <span className="grid min-w-0 flex-1 gap-2">
                  <span className="flex items-center gap-2 font-medium">
                    <CreditCard className="size-4 text-muted-foreground" aria-hidden="true" />
                    Card on file
                  </span>
                  {cards.length === 0 ? (
                    <span className="text-sm text-muted-foreground">This customer has no card saved in Stripe.</span>
                  ) : (
                    method === "card" && (
                      <span className="grid gap-1">
                        {cards.map((c) => (
                          <label
                            key={c.id}
                            className={cn("flex items-center gap-2 text-sm", c.isExpired ? "text-muted-foreground" : "cursor-pointer")}
                          >
                            <input
                              type="radio"
                              name="paymentMethodId"
                              value={c.id}
                              className="accent-brand-blue"
                              checked={cardId === c.id}
                              disabled={c.isExpired}
                              onChange={() => setCardId(c.id)}
                            />
                            <span className="font-medium tabular-nums">{c.label}</span>
                            <span className="text-muted-foreground">
                              {c.isExpired ? `expired ${c.expires}` : `exp ${c.expires}`}
                              {c.isDefault && " · default"}
                            </span>
                          </label>
                        ))}
                      </span>
                    )
                  )}
                </span>
              </div>

              <div className={option(method === "external")} onClick={() => setMethod("external")}>
                <input
                  type="radio"
                  name="choice"
                  aria-label="Paid another way"
                  className="mt-1 accent-brand-blue"
                  checked={method === "external"}
                  onChange={() => setMethod("external")}
                />
                <span className="grid min-w-0 flex-1 gap-2">
                  <span className="flex items-center gap-2 font-medium">
                    <HandCoins className="size-4 text-muted-foreground" aria-hidden="true" />
                    Paid another way
                  </span>
                  {method === "external" && (
                    <span className="grid gap-3">
                      <span className="grid content-start gap-1.5">
                        <Label htmlFor="paidWith">Paid with</Label>
                        <Input
                          id="paidWith"
                          name="paidWith"
                          value={paidWith}
                          onChange={(e) => setPaidWith(e.target.value)}
                          placeholder="e.g. Cash, Check, Zelle"
                          maxLength={60}
                          autoComplete="off"
                        />
                        <span className="flex flex-wrap gap-1.5">
                          {quickPicks.map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => setPaidWith(p)}
                              className={cn(
                                "rounded-md border px-2 py-0.5 text-[0.8rem] transition-colors hover:bg-secondary",
                                paidWith === p && "border-brand-blue bg-brand-blue/10",
                              )}
                            >
                              {p}
                            </button>
                          ))}
                        </span>
                      </span>
                      <span className="grid content-start gap-1.5">
                        <Label htmlFor="reference">Reference (optional)</Label>
                        <Input id="reference" name="reference" placeholder="e.g. #1042" maxLength={80} autoComplete="off" />
                      </span>
                    </span>
                  )}
                </span>
              </div>
            </div>

            {state.message && (
              <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {state.message}
              </p>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                type="submit"
                disabled={pending || (method === "card" ? !card : !paidWith.trim())}
                className="bg-amber-400 text-amber-950 hover:bg-amber-300"
              >
                {pending ? "Working…" : method === "card" ? `Charge ${amount}${card ? ` to ${card.label}` : ""}` : `Mark ${amount} paid`}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
