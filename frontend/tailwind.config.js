/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // App Surfaces
        bg: 'var(--bg)',
        app: 'var(--bg)',
        surface: {
          DEFAULT: 'var(--surface)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
          hover: 'var(--surface-2)',
        },
        border: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
          focus: 'var(--accent)',
        },
        hair: 'var(--hair)',
        divider: 'var(--divider)',

        // Typography Colors
        text: {
          DEFAULT: 'var(--text)',
          2: 'var(--text-2)',
          muted: 'var(--muted)',
          placeholder: 'var(--placeholder)',
        },
        muted: 'var(--muted)',
        placeholder: 'var(--placeholder)',

        // Brand & Actions
        ink: 'var(--ink)',
        accent: {
          DEFAULT: 'var(--accent)',
          soft: 'var(--accent-soft)',
        },
        primary: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent)',
          active: 'var(--accent)',
          light: 'var(--accent-soft)',
          subtle: 'var(--accent-soft)',
        },

        // Status Colors (meaning only)
        success: {
          DEFAULT: 'var(--success)',
          text: 'var(--success-text)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          text: 'var(--warning-text)',
          soft: 'var(--warning-soft)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          text: 'var(--danger-text)',
          soft: 'var(--danger-soft)',
          bg: 'var(--danger-soft)',
        },
        'neutral-dot': 'var(--neutral-dot)',
        'chart-out': 'var(--chart-out)',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      borderRadius: {
        card: 'var(--r-card)',
        control: 'var(--r-control)',
        small: 'var(--r-small)',
        inner: 'var(--r-inner)',
        pill: 'var(--r-pill)',
      },
      boxShadow: {
        card: 'var(--sh-card)',
        'card-hover': 'var(--sh-card-hover)',
        btn: 'var(--sh-btn)',
        pop: 'var(--sh-pop)',
        soft: 'var(--sh-card)',
        elevated: 'var(--sh-pop)',
      },
      transitionDuration: {
        fast: '150ms',
        card: '200ms',
        sheet: '250ms',
      },
      transitionTimingFunction: {
        sheet: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
    },
  },
  plugins: [],
}
