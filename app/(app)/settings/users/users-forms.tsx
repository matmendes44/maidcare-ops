"use client";

import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { roleLabels, roles, type Role } from "@/lib/auth/permissions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-rules";
import { addUser, resetUserTwoFactor, setDisabled, setRole, setUserPassword, signOutUser, type UserActionState } from "./actions";

function Feedback({ state }: { state: UserActionState }) {
  if (state.message) return <p role="alert" className="text-sm text-destructive">{state.message}</p>;
  if (state.ok) return <p role="status" className="text-sm text-muted-foreground">{state.ok}</p>;
  return null;
}

export function AddUserForm() {
  const [state, action, pending] = useActionState<UserActionState, FormData>(addUser, {});
  return (
    <form action={action} className="grid gap-3" key={state.ok}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid content-start gap-1.5">
          <Label htmlFor="new-name">Name</Label>
          <Input id="new-name" name="name" required maxLength={80} autoComplete="off" />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="new-email">Email</Label>
          <Input id="new-email" name="email" type="email" required autoComplete="off" />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="new-role">Role</Label>
          <NativeSelect id="new-role" name="role" defaultValue="staff" className="w-full">
            {roles.map((r) => (
              <NativeSelectOption key={r} value={r}>
                {roleLabels[r]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="new-password">Temporary password</Label>
          <Input id="new-password" name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
        </div>
      </div>
      <p className="text-[0.8rem] text-muted-foreground">
        Give them the password in person or by phone. They can change it in Settings, and set up two-step login at their first sign-in.
      </p>
      <Feedback state={state} />
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Adding…" : "Add person"}
      </Button>
    </form>
  );
}

type Row = { id: number; name: string; role: Role; isDisabled: boolean; totpEnabledAt: string | null };

export function UserActions({ user }: { user: Row }) {
  const [state, setState] = useState<UserActionState>({});
  const [pending, setPending] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const run = (fn: () => Promise<UserActionState>, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setPending(true);
    startTransition(async () => {
      setState(await fn());
      setPending(false);
    });
  };
  const [pwState, pwAction, pwPending] = useActionState<UserActionState, FormData>((prev, fd) => setUserPassword(user.id, prev, fd), {});

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <NativeSelect
          aria-label={`Role for ${user.name}`}
          size="sm"
          value={user.role}
          disabled={pending}
          onChange={(e) => run(() => setRole(user.id, e.target.value))}
        >
          {roles.map((r) => (
            <NativeSelectOption key={r} value={r}>
              {roleLabels[r]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {user.totpEnabledAt && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => resetUserTwoFactor(user.id), `Reset ${user.name}'s two-step login? They'll set it up again at their next sign-in.`)}
          >
            Reset 2FA
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => signOutUser(user.id))}>
          Sign out
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setPasswordOpen((o) => !o)}>
          Password
        </Button>
        <Button
          size="sm"
          variant={user.isDisabled ? "outline" : "destructive"}
          disabled={pending}
          onClick={() => run(() => setDisabled(user.id, !user.isDisabled), user.isDisabled ? undefined : `Disable ${user.name}? They're signed out and can't sign in.`)}
        >
          {user.isDisabled ? "Enable" : "Disable"}
        </Button>
      </div>
      {passwordOpen && (
        <form action={pwAction} className="flex flex-wrap items-center gap-2">
          <Input name="password" type="password" aria-label="New password" placeholder="New password" minLength={MIN_PASSWORD_LENGTH} required className="h-8 w-48" autoComplete="new-password" />
          <Button type="submit" size="sm" disabled={pwPending}>
            Set
          </Button>
          <Feedback state={pwState} />
        </form>
      )}
      <Feedback state={state} />
    </div>
  );
}
