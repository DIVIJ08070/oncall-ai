export function Footer() {
  return (
    <footer
      className="border-t border-white/10 py-8"
      style={{ fontFamily: "'Kanit', sans-serif" }}
    >
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 sm:flex-row sm:px-6">
        <span className="font-bold text-white">Code Review Buddy</span>
        <span className="text-sm text-white/50">
          Built into OnCall AI &middot; {new Date().getFullYear()}
        </span>
      </div>
    </footer>
  );
}
