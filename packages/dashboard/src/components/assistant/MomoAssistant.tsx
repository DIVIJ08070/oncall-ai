import { useEffect, useRef } from 'react';
import { useMomoPref } from './momoPrefs';

/**
 * Adventure Girl — the full shimeji mascot from the user's ai-model-game
 * project (momo-bot engine: roams the page, sits, climbs, can be dragged and
 * thrown, runs a first-visit tour, and chats). This component is only the
 * LOADER: on consent it configures the bundle and injects
 * /momo-bot/momo-bot.js, which mounts its own shadow-DOM overlay. Chat goes
 * to our server's /api/chat (Claude-first, Gemini fallback, project-aware).
 *
 * First visit shows a small choice callout; the sidebar's "AI assistant"
 * toggle flips the same preference. Turning the mascot off after it has
 * loaded reloads the page (the engine has no teardown API).
 */

interface MomoBotApi {
  ready: (cb: () => void) => void;
  say: (text: string, ms?: number) => void;
  jumpTo: (sel: string | Element) => void;
  tour: (steps: Array<{ selector?: string; text: string; ms?: number }>) => unknown;
}

declare global {
  interface Window {
    MOMO_BOT_BASE?: string;
    MOMO_BOT_API?: string;
    MomoBot?: MomoBotApi;
  }
}

const TOUR_DONE_KEY = 'oncall:momo-tour-done';

/**
 * First-visit guided tour: Adventure Girl jumps to each part of the site and
 * explains what it does (the engine's tour UI includes its own Skip button).
 * Runs once ever — the flag is set the moment the tour starts.
 */
const TOUR_STEPS: Array<{ selector?: string; text: string; ms?: number }> = [
  {
    text: 'Hey, first time here? I\u2019m Adventure Girl \u{1F9ED} Let me give you the quick tour of OnCall AI!',
    ms: 4200,
  },
  {
    selector: 'a[href="/dashboard"]',
    text: 'This is the Dashboard \u2014 live service health, error rate and latency. Your mission control.',
    ms: 4600,
  },
  {
    selector: 'a[href="/incidents"]',
    text: 'Incidents land here. When something breaks, the AI investigates the root cause and opens a GitHub PR with a fix \u2014 you just review and merge.',
    ms: 5600,
  },
  {
    selector: 'a[href="/code-review"]',
    text: 'Code Review Buddy: paste a diff, scan a repo, or watch a GitHub repo \u2014 AI reviews every pull request for you.',
    ms: 5200,
  },
  {
    selector: 'a[href="/learning"]',
    text: 'Self-Learning \u2014 my favourite! A living brain that gets smarter with every incident and review it sees.',
    ms: 5000,
  },
  {
    selector: 'a[href="/demo"]',
    text: 'Curious how it handles a real fire? Live Demo simulates an incident safely so you can watch the AI respond.',
    ms: 5200,
  },
  {
    selector: 'a[href="/onboarding"]',
    text: 'Ready to hook up your own services? The Setup Wizard starts here.',
    ms: 4400,
  },
  {
    text: 'That\u2019s the tour! Click me anytime if you have questions \u2014 I know this place inside out \u2728',
    ms: 4800,
  },
];

function maybeRunTour(): void {
  if (localStorage.getItem(TOUR_DONE_KEY)) return;
  const bot = window.MomoBot;
  if (!bot) return;
  bot.ready(() => {
    if (localStorage.getItem(TOUR_DONE_KEY)) return;
    localStorage.setItem(TOUR_DONE_KEY, '1'); // once ever, even if skipped
    // keep steps whose target actually exists and is visible right now
    const steps = TOUR_STEPS.filter((st) => {
      if (!st.selector) return true;
      const el = document.querySelector<HTMLElement>(st.selector);
      return !!el && el.offsetParent !== null;
    });
    window.setTimeout(() => bot.tour(steps), 1200);
  });
}

const MONO = "'JetBrains Mono', ui-monospace, monospace";

let injected = false;

function injectMascot(): void {
  if (injected || document.querySelector('script[data-momo-bot]')) return;
  injected = true;
  window.MOMO_BOT_BASE = '/momo-bot/';
  window.MOMO_BOT_API = '';
  const script = document.createElement('script');
  script.src = '/momo-bot/momo-bot.js';
  script.defer = true;
  script.setAttribute('data-momo-bot', '1');
  script.addEventListener('load', maybeRunTour);
  document.body.appendChild(script);
}

export function MomoAssistant() {
  const [pref, setPref] = useMomoPref();
  const wasInjected = useRef(false);

  useEffect(() => {
    if (pref === 'on') {
      injectMascot();
      wasInjected.current = true;
    } else if (pref === 'off' && (wasInjected.current || injected)) {
      // engine has no unmount — a reload cleanly removes the mascot
      window.location.reload();
    }
  }, [pref]);

  if (pref !== null) return null;

  // first visit: do you want the AI bot or not?
  return (
    <div className="fixed bottom-6 right-6 z-50 w-[290px] rounded-2xl border border-white/10 bg-black/85 p-4 shadow-2xl backdrop-blur-md">
      <div className="flex items-center gap-3">
        <img
          src="/momo-bot/characters/adventuregirl/frames/0001.png"
          alt=""
          width={44}
          height={44}
          style={{ imageRendering: 'pixelated' }}
        />
        <p className="text-sm leading-snug text-white/85">
          Hi! I&rsquo;m <span className="font-semibold text-[#FF8233]">Adventure Girl</span> —
          want me around to explore the site and answer questions?
        </p>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setPref('on')}
          className="flex-1 rounded-lg bg-[#F16524] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#FF8233]"
        >
          Yes, keep her
        </button>
        <button
          type="button"
          onClick={() => setPref('off')}
          className="flex-1 rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 transition-colors hover:text-white"
        >
          No thanks
        </button>
      </div>
      <p
        className="mt-2 text-[9px] uppercase tracking-[0.18em] text-white/30"
        style={{ fontFamily: MONO }}
      >
        change anytime in the sidebar
      </p>
    </div>
  );
}
