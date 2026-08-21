import { Suspense, lazy, useEffect } from 'react';

const NightShift = lazy(() =>
  import('../experience/NightShift').then((m) => ({ default: m.NightShift })),
);

/**
 * Public home page at `/` — THE NIGHT SHIFT cinematic experience. Lazy-loaded
 * so the Three.js scene stays out of the console's bundle (brief §28); the
 * fallback is the same black the experience opens on, so the handoff is
 * invisible. The console lives under `/dashboard`.
 */
export function HomePage() {
  useEffect(() => {
    document.title = 'OnCall AI — Your AI incident responder';
    return () => {
      document.title = 'OnCall AI';
    };
  }, []);

  return (
    <Suspense fallback={<div className="min-h-screen bg-[#030303]" />}>
      <NightShift />
    </Suspense>
  );
}
