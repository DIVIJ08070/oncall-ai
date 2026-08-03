import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { LandingScreen } from '../components/landing/LandingScreen';

/** Full-screen animated 404 for unknown routes, matching the home-page brand. */
export function NotFoundPage() {
  useEffect(() => {
    document.title = '404 - Page Not Found';
    return () => {
      document.title = 'OnCall AI';
    };
  }, []);

  return (
    <LandingScreen
      giantText="404"
      heading="Oops, something went wrong!"
      cta={{ label: 'Back to Home', to: '/', icon: ArrowLeft }}
    />
  );
}
