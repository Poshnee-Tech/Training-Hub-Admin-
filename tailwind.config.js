/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd',
          400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9',
          800: '#5b21b6', 900: '#4c1d95', 950: '#2e1065',
        },
        // Warm coffee/cream palette for the clips library.
        //
        // Namespaced `bean-*` so it cannot collide with `primary` above, which
        // every other admin page still uses. Each token resolves to a CSS
        // variable holding space-separated RGB channels, so Tailwind opacity
        // modifiers keep working (`bg-bean-card/60`) and light/dark is a single
        // variable swap rather than a per-component branch. Values live in
        // globals.css under .bean-scope and .bean-scope[data-theme='dark'].
        // Console palette shared with the agent portal. Names and values are
        // mirrored from Training-Simulator-Frontend-/tailwind.config.js so the
        // two portals resolve to the same colours — see the ported token block
        // in globals.css.
        air: {
          bg: 'rgb(var(--air-bg) / <alpha-value>)',
          bg2: 'rgb(var(--air-bg2) / <alpha-value>)',
          panel: 'rgb(var(--air-panel) / <alpha-value>)',
          line: 'rgb(var(--air-line) / <alpha-value>)',
          line2: 'rgb(var(--air-line2) / <alpha-value>)',
          signal: 'rgb(var(--air-signal) / <alpha-value>)',
          'signal-bright': 'rgb(var(--air-signal-bright) / <alpha-value>)',
          cyan: 'rgb(var(--air-cyan) / <alpha-value>)',
          live: 'rgb(var(--air-live) / <alpha-value>)',
          amber: 'rgb(var(--air-amber) / <alpha-value>)',
          mint: 'rgb(var(--air-mint) / <alpha-value>)',
          text: 'rgb(var(--air-text) / <alpha-value>)',
          muted: 'rgb(var(--air-muted) / <alpha-value>)',
          faint: 'rgb(var(--air-faint) / <alpha-value>)',
        },
        // Warm paper/brass ledger palette for the agent management section.
        // Namespaced `ledger-*` so it cannot collide with the `air` console
        // tokens every other admin page uses. Same shaped as `bean-*`: each
        // token resolves to a CSS variable of space-separated RGB channels, so
        // opacity modifiers keep working and light/dark is a single variable
        // swap. Values live in globals.css under .ledger-scope / dark variant.
        ledger: {
          bg: 'rgb(var(--ledger-bg) / <alpha-value>)',
          bg2: 'rgb(var(--ledger-bg2) / <alpha-value>)',
          panel: 'rgb(var(--ledger-panel) / <alpha-value>)',
          line: 'rgb(var(--ledger-line) / <alpha-value>)',
          line2: 'rgb(var(--ledger-line2) / <alpha-value>)',
          ink: 'rgb(var(--ledger-ink) / <alpha-value>)',
          muted: 'rgb(var(--ledger-muted) / <alpha-value>)',
          faint: 'rgb(var(--ledger-faint) / <alpha-value>)',
          brand: 'rgb(var(--ledger-brand) / <alpha-value>)',
          'brand-bright': 'rgb(var(--ledger-brand-bright) / <alpha-value>)',
          'brand-deep': 'rgb(var(--ledger-brand-deep) / <alpha-value>)',
          teal: 'rgb(var(--ledger-teal) / <alpha-value>)',
          gold: 'rgb(var(--ledger-gold) / <alpha-value>)',
          good: 'rgb(var(--ledger-good) / <alpha-value>)',
          'good-bg': 'rgb(var(--ledger-good-bg) / <alpha-value>)',
          bad: 'rgb(var(--ledger-bad) / <alpha-value>)',
          'bad-bg': 'rgb(var(--ledger-bad-bg) / <alpha-value>)',
        },
        bean: {
          bg: 'rgb(var(--bean-bg) / <alpha-value>)',
          bg2: 'rgb(var(--bean-bg-2) / <alpha-value>)',
          card: 'rgb(var(--bean-card) / <alpha-value>)',
          card2: 'rgb(var(--bean-card-2) / <alpha-value>)',
          line: 'rgb(var(--bean-line) / <alpha-value>)',
          line2: 'rgb(var(--bean-line-2) / <alpha-value>)',
          ink: 'rgb(var(--bean-ink) / <alpha-value>)',
          muted: 'rgb(var(--bean-muted) / <alpha-value>)',
          faint: 'rgb(var(--bean-faint) / <alpha-value>)',
          brand: 'rgb(var(--bean-brand) / <alpha-value>)',
          'brand-bright': 'rgb(var(--bean-brand-bright) / <alpha-value>)',
          'brand-deep': 'rgb(var(--bean-brand-deep) / <alpha-value>)',
          gold: 'rgb(var(--bean-gold) / <alpha-value>)',
          live: 'rgb(var(--bean-live) / <alpha-value>)',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
        'mono-ui': ['var(--font-mono-ui)', 'ui-monospace', 'monospace'],
        // Ledger/document voice. Named `serif-ui` rather than overriding
        // Tailwind's built-in `font-serif`, so the default utility keeps its
        // meaning and this one is only ever picked up deliberately.
        'serif-ui': ['var(--font-serif)', 'ui-serif', 'Georgia', 'serif'],
      },
      keyframes: {
        'bean-blink': { '0%, 100%': { opacity: '1' }, '50%': { opacity: '.2' } },
        'air-blink': { '0%, 100%': { opacity: '1' }, '50%': { opacity: '.2' } },
        'air-ripple': {
          '0%': { transform: 'scale(1)', opacity: '.8' },
          '100%': { transform: 'scale(1.8)', opacity: '0' },
        },
        'air-sweep': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        // Dashboard motion set. `rise` is the shared entrance (staggered per
        // card via an inline animation-delay); `eq` drives the header's
        // floor-pulse equalizer bars; `orb` drifts the ambient background
        // glows; `draw` inks a sparkline once (pathLength is normalised to 1);
        // fade-in reveals area fills and end dots after their line lands.
        'air-rise': {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'air-eq': {
          '0%, 100%': { transform: 'scaleY(0.35)' },
          '50%': { transform: 'scaleY(1)' },
        },
        'air-orb': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1)' },
          '50%': { transform: 'translate3d(0, -18px, 0) scale(1.06)' },
        },
        'air-draw': {
          from: { 'stroke-dashoffset': '1' },
          to: { 'stroke-dashoffset': '0' },
        },
        'air-fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
      animation: {
        'bean-blink': 'bean-blink 1.1s ease-in-out infinite',
        'air-blink': 'air-blink 1.6s ease-in-out infinite',
        'air-ripple': 'air-ripple 1.8s ease-out infinite',
        'air-sweep': 'air-sweep 2.4s ease-in-out infinite',
        'air-rise': 'air-rise 0.55s cubic-bezier(0.22, 0.68, 0.32, 1) both',
        'air-eq': 'air-eq 1s ease-in-out infinite',
        'air-orb': 'air-orb 9s ease-in-out infinite',
        'air-draw': 'air-draw 1.2s cubic-bezier(0.4, 0, 0.2, 1) forwards',
        'air-fade-in': 'air-fade-in 0.5s ease both',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
