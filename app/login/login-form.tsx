"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, type LoginState } from "./actions";

export function LoginForm() {
  const { t } = useI18n();
  const next = useSearchParams().get("next") ?? "/";
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="next" value={next} />
      {state.message && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      )}
      <div className="grid content-start gap-1.5">
        <Label htmlFor="email">{t.login.email}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={state.email}
          required
          autoFocus
        />
      </div>
      <div className="grid content-start gap-1.5">
        <Label htmlFor="password">{t.login.password}</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Button type="submit" size="lg" className="mt-2 w-full" disabled={pending}>
        {pending ? t.login.submitting : t.login.submit}
      </Button>
    </form>
  );
}
