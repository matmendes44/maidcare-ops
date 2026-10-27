// Placeholder while a page's content loads. Every page wraps its content in
// <Suspense fallback={<PageLoading />}>: with Cache Components, a page that
// reads request data (the user, their language) at its top level would block
// navigation, because the layout's own boundaries are already on screen and
// don't show a fallback again.
export function PageLoading() {
  return (
    <div aria-busy="true" className="grid gap-4">
      <div className="h-9 w-56 animate-pulse rounded-lg bg-muted" />
      <div className="h-5 w-80 max-w-full animate-pulse rounded bg-muted" />
      <div className="mt-4 h-64 animate-pulse rounded-xl bg-muted/60" />
    </div>
  );
}
