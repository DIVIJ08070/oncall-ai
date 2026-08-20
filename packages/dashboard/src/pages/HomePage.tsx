import { useEffect } from 'react';
import { NightShift } from '../experience/NightShift';

/**
 * Public home page at `/` — the dark cursor-spotlight hero. The console lives
 * under `/dashboard`; this screen sets the tone and routes people in.
 */
export function HomePage() {
  useEffect(() => {
    document.title = 'OnCall AI — Your AI incident responder';
    return () => {
      document.title = 'OnCall AI';
    };
  }, []);

  return <NightShift />;
}
