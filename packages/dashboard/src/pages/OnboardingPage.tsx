import { useState } from 'react';
import type { RepoRef } from '@oncall/shared';
import { useSession } from '../state/SessionContext';
import { Card } from '../components/primitives/Card';
import { Skeleton } from '../components/primitives/Skeleton';
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
    <div className="mx-auto w-full max-w-[560px] py-6 md:py-12">
      <Stepper steps={STEP_LABELS} current={step} className="mb-6" />

      <Card padded={false} className="p-6">
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
    </div>
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
