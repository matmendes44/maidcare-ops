"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cancelSignIn, confirmEnrollment, verifyTwoFactor, type TwoFactorState } from "./actions";

function Alert({ state }: { state: TwoFactorState }) {
  if (!state.message) return null;
  return (
    <div role="alert" className="grid gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {state.message}
      {state.expired && (
        <Link href="/login" className="font-medium underline underline-offset-4">
          Back to sign in
        </Link>
      )}
    </div>
  );
}

function CancelLink() {
  return (
    <form action={cancelSignIn} className="mt-4 text-center">
      <button type="submit" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        Cancel and sign in as someone else
      </button>
    </form>
  );
}

export function VerifyForm() {
  const [mode, setMode] = useState<"app" | "recovery">("app");
  const [state, action, pending] = useActionState<TwoFactorState, FormData>(verifyTwoFactor, {});
  return (
    <>
      <form action={action} className="grid gap-4">
        <input type="hidden" name="mode" value={mode} />
        <Alert state={state} />
        <div className="grid content-start gap-1.5">
          <Label htmlFor="code">{mode === "app" ? "6-digit code" : "Recovery code"}</Label>
          {mode === "app" ? (
            <Input
              key="app"
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={7}
              placeholder="123 456"
              className="text-center text-lg tracking-[0.3em] tabular-nums"
              required
              autoFocus
            />
          ) : (
            <Input key="recovery" id="code" name="code" autoComplete="off" placeholder="abcd-2345" className="text-center font-mono text-lg" required autoFocus />
          )}
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={pending || state.expired}>
          {pending ? "Checking…" : "Verify"}
        </Button>
        <button
          type="button"
          onClick={() => setMode(mode === "app" ? "recovery" : "app")}
          className="text-sm text-link underline-offset-4 hover:underline"
        >
          {mode === "app" ? "Lost your phone? Use a recovery code" : "Use the code from your authenticator app"}
        </button>
      </form>
      <CancelLink />
    </>
  );
}

export function SetupForm() {
  const [state, action, pending] = useActionState<TwoFactorState, FormData>(confirmEnrollment, {});
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  if (state.codes)
    return (
      <div className="grid gap-4">
        <p className="rounded-lg border border-brand-green/40 bg-success px-3 py-2 text-sm font-medium text-success-foreground">
          Two-step login is on.
        </p>
        <div>
          <h2 className="font-semibold">Save your recovery codes</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            If you lose your phone, each of these lets you sign in once. Keep them somewhere safe, like a password manager. They won&apos;t be
            shown again.
          </p>
        </div>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border bg-muted/50 p-4 font-mono text-[0.95rem]" aria-label="Recovery codes">
          {state.codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(state.codes!.join("\n"));
            setCopied(true);
          }}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "Copied" : "Copy codes"}
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-4 accent-brand-blue" />
          I&apos;ve saved these codes
        </label>
        <Link
          href={state.next ?? "/"}
          aria-disabled={!saved}
          className={buttonVariants({ size: "lg", className: saved ? "w-full" : "pointer-events-none w-full opacity-50" })}
        >
          Continue
        </Link>
      </div>
    );

  return (
    <>
      <form action={action} className="grid gap-4">
        <Alert state={state} />
        <div className="grid content-start gap-1.5">
          <Label htmlFor="code">Code from the app</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            placeholder="123 456"
            className="text-center text-lg tracking-[0.3em] tabular-nums"
            required
          />
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={pending || state.expired}>
          {pending ? "Checking…" : "Turn on two-step login"}
        </Button>
      </form>
      <CancelLink />
    </>
  );
}

// After too many wrong codes: the sign-in has to start again.
export function UsedUp() {
  return (
    <div className="mt-6 grid gap-4 rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-bold">Too many wrong codes</h1>
      <p role="alert" className="text-sm text-muted-foreground">
        For your security, this sign-in was stopped. Enter your password again to get a new chance.
      </p>
      <form action={cancelSignIn}>
        <Button type="submit" size="lg" className="w-full">
          Back to sign in
        </Button>
      </form>
    </div>
  );
}
