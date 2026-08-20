interface GlowBackgroundProps {
  className?: string;
}

/**
 * Decorative layer of blurred radial gradients for section backgrounds.
 * Purely visual — absolutely positioned, pointer-events-none, aria-hidden.
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
          background:
            'radial-gradient(closest-side, rgba(255,255,255,0.09), transparent 70%)',
          filter: 'blur(60px)',
        }}
      />
      <div
        className="absolute right-[-120px] top-1/3 h-[360px] w-[360px] rounded-full"
        style={{
          background:
            'radial-gradient(closest-side, rgba(187,204,215,0.08), transparent 70%)',
          filter: 'blur(70px)',
        }}
      />
      <div
        className="absolute bottom-[-140px] left-[-100px] h-[380px] w-[480px] rounded-full"
        style={{
          background:
            'radial-gradient(closest-side, rgba(255,255,255,0.05), transparent 70%)',
          filter: 'blur(80px)',
        }}
      />
    </div>
  );
}
