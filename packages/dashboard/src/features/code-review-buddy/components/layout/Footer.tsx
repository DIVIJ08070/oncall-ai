export function Footer() {
  return (
    <footer className="border-t border-border py-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 sm:flex-row sm:px-6">
        <span className="crt-glow font-bold uppercase tracking-[0.14em] text-ink">
          <span aria-hidden className="text-accent">
            &gt;{' '}
          </span>
          Code Review Buddy
        </span>
        <span className="text-sm uppercase tracking-[0.1em] text-ink-muted-text">
          // Built into OnCall AI &middot; {new Date().getFullYear()}
        </span>
      </div>
    </footer>
  );
}
