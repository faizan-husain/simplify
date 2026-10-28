/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#FFFFFF',
        surface: {
          DEFAULT: '#F8FAFC',
          hover: '#F1F5F9',
        },
        border: {
          DEFAULT: '#E2E8F0',
          focus: '#0B67F6',
        },
        primary: {
          DEFAULT: '#0B67F6', // Vibrant Electric Royal Blue (matches New Bill button)
          hover: '#0854D4',
          active: '#0642A8',
          light: '#E8F2FD',
          subtle: '#D6E7FC',
        },
        text: {
          DEFAULT: '#101828',
          muted: '#64748B',
        },
        success: '#1CB98C',
        warning: '#D97706', // Yellow days
        danger: '#DC2626', // Red days
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        card: '16px',
      },
      boxShadow: {
        soft: '0 1px 3px 0 rgba(8, 98, 236, 0.04), 0 1px 2px 0 rgba(8, 98, 236, 0.02)',
        card: '0 4px 16px -2px rgba(8, 98, 236, 0.08), 0 2px 4px -1px rgba(8, 98, 236, 0.04)',
        elevated: '0 12px 30px -4px rgba(8, 98, 236, 0.16), 0 4px 8px -2px rgba(8, 98, 236, 0.08)',
      }
    },
  },
  plugins: [],
}
