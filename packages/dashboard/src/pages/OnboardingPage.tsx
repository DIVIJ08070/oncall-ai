import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { RepoRef } from '@oncall/shared';
import { useSession } from '../state/SessionContext';
import { Card } from '../components/primitives/Card';
import { Skeleton } from '../components/primitives/Skeleton';
import { Icon } from '../components/primitives/Icon';
import { Entrance } from '../components/motion/primitives';
import { Stepper } from '../components/onboarding/Stepper';
import { SignInStep } from '../components/onboarding/SignInStep';
import { RepoPicker } from '../components/onboarding/RepoPicker';
import { IntegrationSnippet } from '../components/onboarding/IntegrationSnippet';
import { WaitingForLogs } from '../components/onboarding/WaitingForLogs';

/**
 * OnboardingPage (`/onboarding`) — FR-15, FR-02 (DESIGN_SPEC §6.1). A single
 * centered 560px column with a 4-step Stepper and one step-card visible at a time:
 *
 *   1. Sign in with GitHub (503-graceful under `DEV_NO_AUTH`)
 *   2. Select the repository OnCall AI can open PRs against (`GET/POST /repos`)
 *   3. Install the integration snippet (`GET /integration-snippet`)
 *   4. Wait for the first log → Connected (`GET /services`, polled)
 *
 * Owned by C14. Renders inside the shared `AppShell` (C12). Uses `SessionContext`
 * read-only for the DEV badge + signed-in user signal — it does not mutate shell
 * state, keeping C13/C15 parallel work collision-free.
 */

const STEP_LABELS = ['Sign in', 'Select repo', 'Install snippet', 'Connect'];

export function OnboardingPage() {
  const { user, devMode, loading } = useSession();
  const [step, setStep] = useState(1);
  const [repo, setRepo] = useState<RepoRef | null>(null);

  return (
    <Entrance className="mx-auto flex w-full max-w-[600px] flex-col gap-6 py-6 md:py-10">
      {/* Header band — brand frame that spans all four steps */}
      <header className="flex flex-col gap-2">
        <h1 className="font-playfair text-h1 italic text-ink">Get connected</h1>
        <p className="max-w-[46ch] text-body text-ink-2">
          Four quick steps take you from GitHub sign-in to your first AI-detected
          incident — no config files, no waiting.
        </p>
      </header>

      {/* Progress — the stepper plus a mobile-friendly meta line */}
      <div className="flex flex-col gap-2.5">
        <Stepper steps={STEP_LABELS} current={step} />
        <p className="text-label uppercase tracking-wide text-ink-muted-text">
          Step {step} of {STEP_LABELS.length}
          <span className="text-ink-2"> · {STEP_LABELS[step - 1]}</span>
        </p>
      </div>

      {/* Active step */}
      <Card padded={false} className="p-6 md:p-7">
        {loading ? (
          <StepSkeleton />
        ) : step === 1 ? (
          <SignInStep devMode={devMode} user={user} onContinue={() => setStep(2)} />
        ) : step === 2 ? (
          <RepoPicker
            onSelected={(r) => {
              setRepo(r);
              setStep(3);
            }}
            onBack={() => setStep(1)}
          />
        ) : step === 3 ? (
          <IntegrationSnippet
            repo={repo}
            onContinue={() => setStep(4)}
            onBack={() => setStep(2)}
          />
        ) : (
          <WaitingForLogs repo={repo} />
        )}
      </Card>

      {/* Trust footer */}
      <p className="flex items-center justify-center gap-1.5 text-sm text-ink-muted-text">
        <Icon icon={ShieldCheck} size={14} />
        OnCall AI only ever acts on the repository you authorize.
      </p>
    </Entrance>
  );
}

function StepSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-11 w-full" rounded="rounded-md" />
    </div>
  );
}
