interface GlowBackgroundProps {
  className?: string;
}

/**
 * Decorative layer of blurred solid phosphor bloom circles for section
 * backgrounds. Purely visual — absolutely positioned, pointer-events-none,
 * aria-hidden. No gradients: solid accent color + blur + low opacity only.
 */
export function GlowBackground({ className }: GlowBackgroundProps) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className ?? ''}`}
    >
      <div
        className="absolute left-1/2 top-[-160px] h-[420px] w-[720px] -translate-x-1/2 rounded-full"
        style={{
          backgroundColor: 'var(--accent)',
          opacity: 0.05,
          filter: 'blur(90px)',
        }}
      />
      <div
        className="absolute right-[-120px] top-1/3 h-[360px] w-[360px] rounded-full"
        style={{
          backgroundColor: 'var(--accent)',
          opacity: 0.04,
          filter: 'blur(100px)',
        }}
      />
      <div
        className="absolute bottom-[-140px] left-[-100px] h-[380px] w-[480px] rounded-full"
        style={{
          backgroundColor: 'var(--accent)',
          opacity: 0.03,
          filter: 'blur(110px)',
        }}
      />
    </div>
  );
}
