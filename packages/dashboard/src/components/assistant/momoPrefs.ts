import { useEffect, useState } from 'react';

/**
 * Shared on/off preference for the Momo assistant. One localStorage key backs
 * every reader (floating widget + sidebar toggle); writes dispatch a window
 * event so all mounted consumers update live without a reload.
 *
 * Values: `null` (never asked — first-visit callout shows), `'on'`, `'off'`.
 */

export const MOMO_PREF_KEY = 'momo-assistant';
export const MOMO_PREF_EVENT = 'momo-assistant-change';

export type MomoPref = 'on' | 'off' | null;

export function readMomoPref(): MomoPref {
  try {
    const v = window.localStorage.getItem(MOMO_PREF_KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

export function writeMomoPref(value: 'on' | 'off'): void {
  try {
    window.localStorage.setItem(MOMO_PREF_KEY, value);
  } catch {
    // Storage unavailable (private mode) — the event still updates this tab.
  }
  window.dispatchEvent(new Event(MOMO_PREF_EVENT));
}

/** Live view of the preference; `set` persists and broadcasts. */
export function useMomoPref(): [MomoPref, (value: 'on' | 'off') => void] {
  const [pref, setPref] = useState<MomoPref>(() => readMomoPref());

  useEffect(() => {
    const sync = () => setPref(readMomoPref());
    window.addEventListener(MOMO_PREF_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(MOMO_PREF_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return [pref, writeMomoPref];
}
