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
        surface: '#F7F8FA',
        border: '#E5E7EB',
        primary: {
          DEFAULT: '#0F766E', // Teal accent
          hover: '#0D665F',
          light: '#F0FDFA',
        },
        text: {
          DEFAULT: '#111827',
          muted: '#6B7280',
        },
        success: '#16A34A',
        warning: '#D97706', // Yellow days
        danger: '#DC2626', // Red days
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        card: '12px',
      },
      boxShadow: {
        soft: '0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px 0 rgba(0, 0, 0, 0.03)',
      }
    },
  },
  plugins: [],
}
