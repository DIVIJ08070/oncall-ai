import { useMomoPref } from './momoPrefs';

const MONO = "'JetBrains Mono', ui-monospace, monospace";

/**
 * Tiny "AI assistant" switch row — lives at the bottom of the UnifiedSidebar
 * so the widget stays discoverable after a "No thanks" on the first-visit
 * callout. Reads/writes the shared localStorage pref; the floating widget
 * reacts live via the momoPrefs window event.
 */
export function MomoAssistantToggle() {
  const [pref, setPref] = useMomoPref();
  const on = pref === 'on';

  return (
    <div className="flex items-center justify-between gap-3 border-t border-white/10 px-2 pt-3">
      <span
        className="text-[10px] uppercase tracking-[0.2em] text-white/45"
        style={{ fontFamily: MONO }}
      >
        AI assistant
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Toggle AI assistant"
        onClick={() => setPref(on ? 'off' : 'on')}
        className={`relative h-[18px] w-8 shrink-0 rounded-full border transition-colors ${
          on
            ? 'border-[#F16524]/60 bg-[#F16524]/70'
            : 'border-white/15 bg-white/10 hover:bg-white/15'
        }`}
      >
        <span
          className={`absolute top-[2px] h-3 w-3 rounded-full bg-white transition-all ${
            on ? 'left-[16px]' : 'left-[3px] opacity-70'
          }`}
        />
      </button>
    </div>
  );
}
