"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { useI18n } from "@/components/i18n-provider";
import { applyTheme } from "@/components/theme-watcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "cn";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-rules";
import { LOCALE_COOKIE, PREFERENCE_COOKIE_MAX_AGE, THEME_COOKIE, locales, type Locale, type Theme } from "@/lib/i18n/config";
import {
  changeEmail,
  changePassword,
  removeAvatar,
  setLocale,
  setTheme,
  uploadAvatar,
  type SettingsState,
} from "./actions";

function Feedback({ state }: { state: SettingsState }) {
  const { tr } = useI18n();
  if (state.ok)
    return (
      <p role="status" className="text-sm font-medium text-success-foreground">
        {state.ok}
      </p>
    );
  if (state.message)
    return (
      <p role="alert" className="text-sm text-destructive">
        {tr(state.message)}
      </p>
    );
  return null;
}

function Field({
  name,
  label,
  type = "text",
  autoComplete,
  hint,
  error,
}: {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  hint?: string;
  error?: string;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
      />
      {error ? (
        <p id={`${name}-error`} className="text-[0.8rem] text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="text-[0.8rem] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

// Downscales a photo in the browser (max 512px, WebP) so phone photos stay
// well under the upload limit. Falls back to the original file for formats
// the browser can't draw (e.g. HEIC outside Safari); the server reads those.
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/webp", 0.9));
  } catch {
    return file;
  }
}

export function PhotoForm({ user }: { user: { id: number; name: string; avatarUpdatedAt: string | null } }) {
  const { t } = useI18n();
  const [state, upload, uploading] = useActionState(uploadAvatar, {});
  const [removed, remove, removing] = useActionState(removeAvatar, {});
  const [clientError, setClientError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // whichever action ran last decides the message
  const [last, setLast] = useState<"upload" | "remove" | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setClientError(null);
    const blob = await shrink(file);
    // the server accepts up to 1MB per request
    if (blob.size > 950_000) {
      setClientError(t.settings.photo.tooLarge);
      return;
    }
    const formData = new FormData();
    formData.set("avatar", blob, "avatar.webp");
    setLast("upload");
    startTransition(() => upload(formData));
    if (input.current) input.current.value = "";
  }

  const busy = uploading || removing;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar user={user} className="size-20 text-2xl" />
      <div className="grid gap-2">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            {uploading ? t.settings.photo.uploading : user.avatarUpdatedAt ? t.settings.photo.change : t.settings.photo.upload}
          </Button>
          {user.avatarUpdatedAt && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setLast("remove");
                startTransition(() => remove());
              }}
            >
              {t.settings.photo.remove}
            </Button>
          )}
          <input
            ref={input}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-label={t.settings.photo.upload}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>
        {clientError ? (
          <p role="alert" className="text-sm text-destructive">
            {clientError}
          </p>
        ) : (
          <Feedback state={last === "remove" ? removed : last === "upload" ? state : {}} />
        )}
      </div>
    </div>
  );
}

export function EmailForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(changeEmail, {});
  const errors = state.errors ?? {};
  const form = useRef<HTMLFormElement>(null);
  // clear the fields once the change has gone through
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  return (
    <form
      ref={form}
      // keep what was typed if the server sends back an error
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const form = e.currentTarget;
        startTransition(async () => {
          await action(formData);
          form.querySelector<HTMLInputElement>("#currentPassword")!.value = "";
        });
      }}
      className="grid max-w-md gap-4"
      noValidate
    >
      <Field name="email" label={t.settings.email.newEmail} type="email" autoComplete="email" error={errors.email} />
      <Field
        name="currentPassword"
        label={t.settings.email.currentPassword}
        type="password"
        autoComplete="current-password"
        error={errors.currentPassword}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t.common.saving : t.settings.email.submit}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function PasswordForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(changePassword, {});
  const errors = state.errors ?? {};
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const formData = new FormData(form);
        startTransition(async () => {
          await action(formData);
          // never leave passwords sitting in the fields
          form.reset();
        });
      }}
      className="grid max-w-md gap-4"
      noValidate
    >
      <Field
        name="currentPassword"
        label={t.settings.password.current}
        type="password"
        autoComplete="current-password"
        error={errors.currentPassword}
      />
      <Field
        name="newPassword"
        label={t.settings.password.next}
        type="password"
        autoComplete="new-password"
        hint={t.settings.password.hint(MIN_PASSWORD_LENGTH)}
        error={errors.newPassword}
      />
      <Field
        name="confirmPassword"
        label={t.settings.password.confirm}
        type="password"
        autoComplete="new-password"
        error={errors.confirmPassword}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t.common.saving : t.settings.password.submit}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

function writeCookie(name: string, value: string) {
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${name}=${value}; path=/; max-age=${PREFERENCE_COOKIE_MAX_AGE}; samesite=lax${secure}`;
}

// Radio cards shared by the theme and language pickers.
function Choice({
  name,
  value,
  checked,
  onSelect,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "relative flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors hover:bg-secondary/50 has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
        checked && "border-brand-blue bg-secondary/60",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      {children}
      {checked && <Check className="ml-auto size-4 text-brand-blue" aria-hidden="true" />}
    </label>
  );
}

export function AppearancePicker({ initial }: { initial: Theme }) {
  const { t } = useI18n();
  const [theme, setThemeState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const options = [
    { value: "light", label: t.settings.appearance.light, icon: Sun },
    { value: "dark", label: t.settings.appearance.dark, icon: Moon },
    { value: "system", label: t.settings.appearance.system, hint: t.settings.appearance.systemHint, icon: Monitor },
  ] as const;

  function choose(next: Theme) {
    setThemeState(next);
    setError(null);
    // apply right away; the server saves it for other devices
    applyTheme(next);
    writeCookie(THEME_COOKIE, next);
    startTransition(async () => {
      const result = await setTheme(next);
      if (result.message) setError(result.message);
    });
  }

  return (
    <fieldset className="grid gap-2">
      <legend className="sr-only">{t.settings.appearance.title}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map(({ value, label, icon: Icon, ...rest }) => (
          <Choice key={value} name="theme" value={value} checked={theme === value} onSelect={() => choose(value)}>
            <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
            <span>
              <span className="block font-medium">{label}</span>
              {"hint" in rest && <span className="block text-[0.8rem] text-muted-foreground">{rest.hint}</span>}
            </span>
          </Choice>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function LanguagePicker() {
  const { locale, t } = useI18n();
  const [selected, setSelected] = useState<Locale>(locale);
  const [pending, setPending] = useState(false);

  function choose(next: Locale) {
    setSelected(next);
    setPending(true);
    writeCookie(LOCALE_COOKIE, next);
    document.documentElement.setAttribute("lang", next);
    startTransition(async () => {
      await setLocale(next);
      setPending(false);
    });
  }

  return (
    <fieldset className="grid gap-2" aria-busy={pending}>
      <legend className="sr-only">{t.settings.language.title}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {locales.map((l) => (
          <Choice key={l} name="locale" value={l} checked={selected === l} onSelect={() => choose(l)}>
            <span className="font-medium" lang={l}>
              {t.languages[l]}
            </span>
          </Choice>
        ))}
      </div>
    </fieldset>
  );
}
