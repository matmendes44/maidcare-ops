"use client";

import { createContext, startTransition, useActionState, useContext } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

type Msg = { message?: string; ok?: string; errors?: Record<string, string> };
const Pending = createContext(false);

// A small form around a server action that shows its message underneath.
// Server Components pass plain children and use <Submit> for the button
// (functions can't be passed to a Client Component); Client Components may
// pass a function of (pending, state). Doesn't clear what was typed after
// an error.
export function ActionForm({
  action,
  children,
  className,
  resetOnOk = false,
}: {
  action: (prev: Msg, formData: FormData) => Promise<Msg>;
  children: React.ReactNode | ((pending: boolean, state: Msg) => React.ReactNode);
  className?: string;
  resetOnOk?: boolean;
}) {
  const [state, run, pending] = useActionState(action, {});
  const problem = state.message ?? (state.errors ? Object.values(state.errors).join(" ") : undefined);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        startTransition(async () => {
          await run(data);
          if (resetOnOk) form.reset();
        });
      }}
      className={cn("grid gap-3", className)}
      noValidate
    >
      <Pending.Provider value={pending}>{typeof children === "function" ? children(pending, state) : children}</Pending.Provider>
      {(problem || state.ok) && (
        <p role={problem ? "alert" : "status"} className={cn("text-sm", problem ? "text-destructive" : "text-brand-green")}>
          {problem ?? state.ok}
        </p>
      )}
    </form>
  );
}

// The submit button of an ActionForm, disabled while it's saving.
export function Submit({ children, ...props }: React.ComponentProps<typeof Button>) {
  const pending = useContext(Pending);
  return (
    <Button type="submit" disabled={pending} {...props}>
      {children}
    </Button>
  );
}
