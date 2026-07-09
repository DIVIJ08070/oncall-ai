import { Plug } from 'lucide-react';
import { PagePlaceholder } from './PagePlaceholder';

/**
 * `/onboarding` route — owned by C14 (GitHub sign-in → repo select → integration
 * snippet → connected state). C14 replaces this placeholder body. Kept in its own
 * file so C13/C14/C15 build in parallel with zero shared-file collisions.
 */
export function OnboardingPage() {
  return (
    <PagePlaceholder
      icon={Plug}
      title="Connect"
      chunk="C14"
      description="The GitHub sign-in → repo select → integration-snippet onboarding flow lands with C14."
    />
  );
}
