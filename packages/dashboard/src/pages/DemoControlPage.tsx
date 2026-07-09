import { FlaskConical } from 'lucide-react';
import { PagePlaceholder } from './PagePlaceholder';

/**
 * `/demo` route — owned by C15 (FailureModeSwitch + traffic generator + demo
 * rehearsal harness). C15 replaces this placeholder body. Kept in its own file
 * so C13/C14/C15 build in parallel with zero shared-file collisions.
 */
export function DemoControlPage() {
  return (
    <PagePlaceholder
      icon={FlaskConical}
      title="Demo controls"
      chunk="C15"
      description="The FailureModeSwitch + traffic generator that drive the victim app land with C15."
    />
  );
}
