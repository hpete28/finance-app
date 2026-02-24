/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"DM Serif Display"', 'serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        void: {
          50:  '#f0f4ff',
          100: '#e0eaff',
          200: '#c5d5ff',
          300: '#99b4ff',
          400: '#6b8cf9',
          500: '#4563f0',
          600: '#2e46e6',
          700: '#2234c9',
          800: '#1c2aa3',
          900: '#1a2780',
          950: '#111827',
        },
        surface: {
          50:  '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          800: '#1e293b',
          850: '#172033',
          900: '#0f172a',
          950: '#080d1a',
        },
        emerald: {
          400: '#34d399',
          500: '#10b981',
        },
        amber: {
          400: '#fbbf24',
        },
        rose: {
          400: '#fb7185',
          500: '#f43f5e',
        }
      },
      animation: {
        'slide-up': 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in':  'fadeIn 0.2s ease-out',
        'bar-fill': 'barFill 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        slideUp: {
          from: { opacity: 0, transform: 'translateY(16px)' },
          to:   { opacity: 1, transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: 0 },
          to:   { opacity: 1 },
        },
        barFill: {
          from: { width: '0%' },
        }
      }
    }
  },
  plugins: [],
}
