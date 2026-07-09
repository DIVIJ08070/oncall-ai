import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../components/primitives/Card';
import { EmptyState } from '../components/primitives/EmptyState';
import { Button } from '../components/primitives/Button';

/**
 * Placeholder for routes owned by later chunks (C13 IncidentDetail, C14 Onboarding,
 * C15 DemoControl). C12 owns the route tree + shell; these pages render an
 * intentional "arriving in <chunk>" seam so navigation resolves cleanly and the
 * app shell is exercised at every route.
 */
export function PagePlaceholder({
  icon,
  title,
  chunk,
  description,
}: {
  icon: LucideIcon;
  title: string;
  chunk: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-h1 font-semibold text-ink">{title}</h1>
      <Card>
        <EmptyState
          icon={icon}
          title={`${title} — arriving in ${chunk}`}
          subtitle={description}
          action={
            <Link to="/">
              <Button variant="secondary">Back to dashboard</Button>
            </Link>
          }
        />
      </Card>
    </div>
  );
}
