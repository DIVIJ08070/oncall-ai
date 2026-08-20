import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CustomRule } from '../lib/types';

interface RulesState {
  rules: CustomRule[];
  addRule(rule: Omit<CustomRule, 'id' | 'enabled'>): void;
  updateRule(id: string, patch: Partial<Omit<CustomRule, 'id'>>): void;
  toggleRule(id: string): void;
  deleteRule(id: string): void;
}

/** Custom review rules, persisted to localStorage. No default rules. */
export const useRulesStore = create<RulesState>()(
  persist(
    (set) => ({
      rules: [],

      addRule: (rule) =>
        set((state) => ({
          rules: [...state.rules, { ...rule, id: crypto.randomUUID(), enabled: true }],
        })),

      updateRule: (id, patch) =>
        set((state) => ({
          rules: state.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        })),

      toggleRule: (id) =>
        set((state) => ({
          rules: state.rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
        })),

      deleteRule: (id) =>
        set((state) => ({ rules: state.rules.filter((r) => r.id !== id) })),
    }),
    {
      name: 'code-review-buddy-rules',
      version: 1,
      // Accept any previously-stored version; `merge` below sanitizes the shape.
      migrate: (persisted) => persisted as RulesState,
      // Defensive rehydrate: a hand-edited / older localStorage blob must never
      // white-screen the page. Keep only well-formed rules; drop the rest.
      merge: (persisted, current) => {
        const raw = (persisted as { rules?: unknown } | undefined)?.rules;
        const rules = Array.isArray(raw)
          ? (raw.filter(
              (r): r is CustomRule =>
                !!r &&
                typeof r === 'object' &&
                typeof (r as CustomRule).id === 'string' &&
                typeof (r as CustomRule).description === 'string' &&
                ((r as CustomRule).severity === 'warning' ||
                  (r as CustomRule).severity === 'error') &&
                typeof (r as CustomRule).enabled === 'boolean',
            ) as CustomRule[])
          : [];
        return { ...current, rules };
      },
    },
  ),
);
