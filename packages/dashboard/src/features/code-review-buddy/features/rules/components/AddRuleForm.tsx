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
  'rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-white/30 [&>option]:bg-[#0C0C0C]';

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
      className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4"
    >
      <h3 className="font-medium text-white">Add a rule</h3>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder='Describe the rule, e.g. "Components must live in src/components"'
        rows={3}
        className="w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-white/30"
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
