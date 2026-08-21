import { useEffect } from 'react';
import { FuturisticHome } from '../components/landing/FuturisticHome';

/**
 * Public home page at `/` — the futuristic product-shell landing (glass sidebar,
 * live terrain hero). The console lives under `/dashboard`; this screen sets the
 * tone and routes people in. (`SpotlightHero` stays on disk as the revert path.)
 */
export function HomePage() {
  useEffect(() => {
    document.title = 'OnCall AI — Your AI incident responder';
    return () => {
      document.title = 'OnCall AI';
    };
  }, []);

  return <FuturisticHome />;
}
