import Link from "next/link";
import { LogOut } from "lucide-react";
import { logout } from "@/app/login/actions";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";

export async function UserMenu() {
  const [user, { t }] = await Promise.all([requireUser(), getI18n()]);
  return (
    <div className="flex shrink-0 items-center gap-2 sm:gap-3">
      <Link
        href="/settings"
        className="flex items-center rounded-full p-1 hover:bg-secondary"
        aria-label={`${user.name} · ${t.nav.settings}`}
        title={t.nav.settings}
      >
        <Avatar user={user} className="text-sm" />
      </Link>
      <form action={logout}>
        <Button type="submit" variant="outline" size="sm" aria-label={t.nav.signOut}>
          <LogOut aria-hidden="true" />
          <span className="sr-only">{t.nav.signOut}</span>
        </Button>
      </form>
    </div>
  );
}
