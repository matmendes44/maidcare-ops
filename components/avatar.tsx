import { cn } from "cn";

// A user's profile photo, or their initial on a tinted circle without one.
export function Avatar({
  user,
  className,
}: {
  user: { id: number; name: string; avatarUpdatedAt: string | null };
  className?: string;
}) {
  const base = cn("size-8 shrink-0 rounded-full", className);
  if (user.avatarUpdatedAt) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- auth-protected route, not optimizable
      <img
        src={`/avatar/${user.id}?v=${encodeURIComponent(user.avatarUpdatedAt)}`}
        alt=""
        className={cn(base, "object-cover")}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(base, "grid place-items-center bg-secondary font-semibold text-secondary-foreground")}
    >
      {user.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
