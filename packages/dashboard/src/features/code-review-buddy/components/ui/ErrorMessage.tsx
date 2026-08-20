import { AlertTriangle } from 'lucide-react';

interface ErrorMessageProps {
  message: string;
  className?: string;
}

export function ErrorMessage({ message, className }: ErrorMessageProps) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-sm border px-4 py-3 text-sm ${className ?? ''}`}
      style={{
        color: 'var(--critical)',
        borderColor: 'color-mix(in srgb, var(--critical) 35%, transparent)',
        backgroundColor: 'color-mix(in srgb, var(--critical) 10%, transparent)',
      }}
    >
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-critical" />
      <span>{message}</span>
    </div>
  );
}
