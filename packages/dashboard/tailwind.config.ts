import type { Config } from 'tailwindcss';

/**
 * Tailwind config — DESIGN_SPEC §2 tokens mapped to utility classes (§14).
 * Every color/shadow reads a CSS custom property defined in `src/index.css`
 * (dark on `:root`, light on `:root[data-theme="light"]`), so a single token
 * source drives both themes. Components use token classes, never raw hex.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', ':root[data-theme="dark"]'],
  theme: {
    // Breakpoints match DESIGN_SPEC §2.8 (design-verified at 375/768/1280).
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
    },
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: {
          DEFAULT: 'var(--surface)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
        },
        ink: {
          DEFAULT: 'var(--ink)',
          2: 'var(--ink-2)',
          muted: 'var(--ink-muted)',
          'muted-text': 'var(--ink-muted-text)',
        },
        border: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
        },
        grid: 'var(--grid)',
        axis: 'var(--axis)',
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          text: 'var(--accent-text)',
        },
        'focus-ring': 'var(--focus-ring)',
        scrim: 'var(--scrim)',
        // Status (reserved — always icon+label, never a chart series).
        ok: { DEFAULT: 'var(--ok)', text: 'var(--ok-text)' },
        warn: 'var(--warn)',
        serious: 'var(--serious)',
        critical: 'var(--critical)',
        silent: 'var(--silent)',
        'pr-merged': 'var(--pr-merged)',
        // Chart series + feed accents.
        'series-error': 'var(--series-error)',
        'series-lat': 'var(--series-lat)',
        conclusion: 'var(--conclusion)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      fontSize: {
        hero: ['32px', { lineHeight: '40px', fontWeight: '600' }],
        h1: ['22px', { lineHeight: '28px', fontWeight: '600' }],
        h2: ['18px', { lineHeight: '24px', fontWeight: '600' }],
        h3: ['15px', { lineHeight: '20px', fontWeight: '600' }],
        body: ['14px', { lineHeight: '20px' }],
        'body-md': ['14px', { lineHeight: '20px', fontWeight: '500' }],
        sm: ['12px', { lineHeight: '16px' }],
        label: ['11px', { lineHeight: '14px', fontWeight: '500', letterSpacing: '0.04em' }],
        mono: ['13px', { lineHeight: '20px' }],
        'mono-sm': ['12px', { lineHeight: '18px' }],
      },
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '8px',
        xl: '12px',
        pill: '999px',
      },
      boxShadow: {
        'elev-1': 'var(--elev-1)',
        'elev-2': 'var(--elev-2)',
        'elev-3': 'var(--elev-3)',
      },
      transitionDuration: {
        fast: '120ms',
        base: '180ms',
        slow: '240ms',
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(0.2, 0, 0, 1)',
        out: 'cubic-bezier(0, 0, 0.2, 1)',
      },
      zIndex: {
        header: '100',
        dropdown: '200',
        drawer: '300',
        modal: '400',
        toast: '500',
        tooltip: '600',
      },
      keyframes: {
        'enter-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulse2s: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        shimmer: {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'enter-up': 'enter-up var(--dur-base) var(--ease-out)',
        'pulse-live': 'pulse2s 2s ease-in-out infinite',
        shimmer: 'shimmer 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
