import { useState } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import { severityColor } from '../../../components/ui';
import type { CustomRule } from '../../../lib/types';
import { useRulesStore } from '../../../store/rulesStore';
import { AddRuleForm } from './AddRuleForm';

/** Custom rule severities map onto the shared severity palette. */
function ruleSeverityColor(severity: CustomRule['severity']): string {
  return severity === 'error' ? severityColor('high') : severityColor('medium');
}

function RuleRow({ rule }: { rule: CustomRule }) {
  const toggleRule = useRulesStore((s) => s.toggleRule);
  const deleteRule = useRulesStore((s) => s.deleteRule);
  const updateRule = useRulesStore((s) => s.updateRule);
  const color = ruleSeverityColor(rule.severity);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rule.description);
  const [draftSeverity, setDraftSeverity] = useState<CustomRule['severity']>(rule.severity);

  const startEdit = () => {
    setDraft(rule.description);
    setDraftSeverity(rule.severity);
    setEditing(true);
  };
  const save = () => {
    const description = draft.trim();
    if (description) updateRule(rule.id, { description, severity: draftSeverity });
    setEditing(false);
  };

  return (
    <li
      className={`flex items-start gap-3 rounded-sm border border-border bg-surface-2 p-4 transition-opacity ${rule.enabled ? '' : 'opacity-50'}`}
    >
      <span
        aria-hidden
        title={rule.severity}
        className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: editing ? ruleSeverityColor(draftSeverity) : color }}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-sm border border-border bg-surface-3 px-2 py-0.5 text-xs uppercase tracking-[0.08em] text-ink-2">
            {rule.category.replace('-', ' ')}
          </span>
          {editing ? (
            <select
              aria-label="Rule severity"
              value={draftSeverity}
              onChange={(e) => setDraftSeverity(e.target.value as CustomRule['severity'])}
              className="rounded-sm border border-border-strong bg-surface px-2 py-0.5 text-xs uppercase tracking-[0.08em] text-ink-2"
            >
              <option value="warning">warning</option>
              <option value="error">error</option>
            </select>
          ) : (
            <span className="text-xs uppercase tracking-[0.08em]" style={{ color }}>
              {rule.severity}
            </span>
          )}
        </div>

        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            aria-label="Rule description"
            className="mt-2 w-full resize-none rounded-sm border border-border-strong bg-surface p-2 text-sm text-ink outline-none focus:border-border-strong"
          />
        ) : (
          <p className="mt-1.5 text-sm text-ink-2">{rule.description}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {editing ? (
          <>
            <button
              type="button"
              aria-label="Save rule"
              onClick={save}
              className="rounded-sm p-1.5 text-ok transition-colors hover:bg-surface-3"
            >
              <Check size={16} />
            </button>
            <button
              type="button"
              aria-label="Cancel editing"
              onClick={() => setEditing(false)}
              className="rounded-sm p-1.5 text-ink-muted-text transition-colors hover:bg-surface-3 hover:text-ink"
            >
              <X size={16} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              role="switch"
              aria-checked={rule.enabled}
              aria-label={`${rule.enabled ? 'Disable' : 'Enable'} rule`}
              onClick={() => toggleRule(rule.id)}
              className={`relative h-5 w-9 rounded-full transition-colors ${rule.enabled ? 'bg-primary' : 'bg-surface-3'}`}
            >
              <span
                aria-hidden
                className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${rule.enabled ? 'left-[18px] bg-black' : 'left-0.5 bg-ink-muted'}`}
              />
            </button>
            <button
              type="button"
              aria-label="Edit rule"
              onClick={startEdit}
              className="rounded-sm p-1.5 text-ink-muted-text transition-colors hover:bg-surface-3 hover:text-ink"
            >
              <Pencil size={16} />
            </button>
            <button
              type="button"
              aria-label="Delete rule"
              onClick={() => deleteRule(rule.id)}
              className="rounded-sm p-1.5 text-ink-muted-text transition-colors hover:bg-surface-3 hover:text-critical"
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export function RulesManager() {
  const rules = useRulesStore((s) => s.rules);

  return (
    <div className="space-y-6">
      {rules.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border-strong bg-surface-2 p-6 text-center">
          <p className="text-ink-2">No custom rules yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted-text">
            Custom rules are extra instructions the AI checks on every review —
            for example &quot;Components must live in src/components&quot;. Add
            one below and it applies to both diff and repo reviews.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rules.map((rule) => (
            <RuleRow key={rule.id} rule={rule} />
          ))}
        </ul>
      )}

      <AddRuleForm />
    </div>
  );
}
