import { AlertTriangle } from 'lucide-react';

interface ErrorMessageProps {
  message: string;
  className?: string;
}

export function ErrorMessage({ message, className }: ErrorMessageProps) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 ${className ?? ''}`}
    >
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-400" />
      <span>{message}</span>
    </div>
  );
}
