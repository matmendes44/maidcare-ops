"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Check, Copy, KeyRound, Users } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { regenerateRecoveryCodes, type RecoveryState } from "./actions";
import { useI18n } from "@/components/i18n-provider";

export function SecuritySection({
  enabledAt,
  codesLeft,
  canManageUsers,
}: {
  enabledAt: string | null;
  codesLeft: number;
  canManageUsers: boolean;
}) {
  const { tr, fmt } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [state, action, pending] = useActionState<RecoveryState, FormData>(regenerateRecoveryCodes, {});
  return (
    <div className="grid gap-4 text-sm">
      <p className="flex items-center gap-2">
        <KeyRound className="size-4 text-brand-green" aria-hidden="true" />
        {enabledAt
          ? tr("Two-step login is on (since {date}).", { date: fmt.date(enabledAt) })
          : tr("Two-step login isn't set up.")}
      </p>
      <p className={codesLeft <= 2 ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground"}>
        {codesLeft <= 2 ? tr("{n} of 10 recovery codes left. Make new ones soon.", { n: codesLeft }) : tr("{n} of 10 recovery codes left.", { n: codesLeft })}
      </p>
      {state.codes ? (
        <div className="grid gap-3">
          <p className="font-medium">{tr("New recovery codes. The old ones no longer work. Save these somewhere safe:")}</p>
          <ul className="grid max-w-sm grid-cols-2 gap-x-6 gap-y-1 rounded-lg border bg-muted/50 p-4 font-mono">
            {state.codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={async () => {
              await navigator.clipboard.writeText(state.codes!.join("\n"));
              setCopied(true);
            }}
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? tr("Copied") : tr("Copy codes")}
          </Button>
        </div>
      ) : open ? (
        <form action={action} className="grid max-w-sm gap-3">
          {state.message && (
            <p role="alert" className="text-destructive">
              {tr(state.message)}
            </p>
          )}
          <div className="grid content-start gap-1.5">
            <Label htmlFor="recovery-code">{tr("Current code from your authenticator app")}</Label>
            <Input id="recovery-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123 456" required />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? tr("Checking…") : tr("Make new codes")}
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tr("Cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="outline" className="w-fit" onClick={() => setOpen(true)}>
          {tr("Make new recovery codes")}
        </Button>
      )}
      {canManageUsers && (
        <Link href="/settings/users" className={buttonVariants({ variant: "outline", className: "w-fit" })}>
          <Users aria-hidden="true" />
          {tr("Manage users and roles")}
        </Link>
      )}
    </div>
  );
}
