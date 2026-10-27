import { LoginBackground } from "@/components/login-background";
import { Logo } from "@/components/logo";

// The sign-in pages' frame: logo and animated background around a card.
export function AuthShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main className="relative isolate flex min-h-screen flex-col bg-background">
      <LoginBackground />
      <div aria-hidden="true" className="relative h-1 bg-gradient-to-r from-brand-green to-brand-blue" />
      {/* bottom padding keeps the card clear of the cleaner on short screens */}
      <div className="relative flex flex-1 items-center justify-center p-6 pb-36 sm:pb-6">
        <div className={wide ? "w-full max-w-md" : "w-full max-w-sm"}>
          <Logo variant="stacked" className="mx-auto w-48" />
          {children}
        </div>
      </div>
    </main>
  );
}

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-6 rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-bold">{title}</h1>
      {subtitle && <p className="mt-1 mb-6 text-sm text-muted-foreground">{subtitle}</p>}
      {children}
    </div>
  );
}
