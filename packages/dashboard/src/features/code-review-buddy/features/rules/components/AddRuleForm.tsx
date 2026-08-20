import { useState } from 'react';
import type { FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../../../components/ui';
import type { RuleCategory } from '../../../lib/types';
import { useRulesStore } from '../../../store/rulesStore';

const CATEGORIES: { value: RuleCategory; label: string }[] = [
  { value: 'architecture', label: 'Architecture' },
  { value: 'folder-structure', label: 'Folder Structure' },
  { value: 'reusability', label: 'Reusability' },
  { value: 'code-hygiene', label: 'Code Hygiene' },
  { value: 'naming', label: 'Naming' },
  { value: 'custom', label: 'Custom' },
];

const SELECT_CLASSES =
  'rounded-sm border border-border bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none transition-colors focus:border-border-strong [&>option]:bg-surface';

export function AddRuleForm() {
  const addRule = useRulesStore((s) => s.addRule);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<RuleCategory>('custom');
  const [severity, setSeverity] = useState<'warning' | 'error'>('warning');

  const disabled = description.trim().length === 0;

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (disabled) return;
    addRule({ description: description.trim(), category, severity });
    setDescription('');
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-sm border border-border bg-surface-2 p-4"
    >
      <h3 className="font-medium uppercase tracking-[0.08em] text-ink">Add a rule</h3>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder='Describe the rule, e.g. "Components must live in src/components"'
        rows={3}
        className="w-full resize-y rounded-sm border border-border bg-surface-2 px-4 py-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-border-strong"
      />

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as RuleCategory)}
          aria-label="Rule category"
          className={SELECT_CLASSES}
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>

        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as 'warning' | 'error')}
          aria-label="Rule severity"
          className={SELECT_CLASSES}
        >
          <option value="warning">Warning</option>
          <option value="error">Error</option>
        </select>

        <Button type="submit" disabled={disabled} className="ml-auto">
          <Plus size={16} />
          Add Rule
        </Button>
      </div>
    </form>
  );
}
