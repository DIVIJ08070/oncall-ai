import { useEffect } from 'react';
import { TerminalHome } from '../components/landing/TerminalHome';

/**
 * Public home page at `/` — the amber phosphor terminal landing. The console
 * lives under `/dashboard`; this screen sets the tone and routes people in.
 * (SpotlightHero remains in the tree for revert.)
 */
export function HomePage() {
  useEffect(() => {
    document.title = 'OnCall AI — Your AI incident responder';
    return () => {
      document.title = 'OnCall AI';
    };
  }, []);

  return <TerminalHome />;
}
