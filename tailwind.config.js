/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'page': '#F5F4F0',
        'card': '#FFFFFF',
        'border-default': '#E0DDD6',
        'text-primary': '#0C0A09',
        'text-secondary': '#6B6760',
        'text-on-accent': '#FFFFFF',
        'accent': {
          DEFAULT: '#1E3A5F',
          hover: '#162E4A',
          bg: '#EDECE6',
        },
        'success': {
          DEFAULT: '#3F5C2F',
          bg: '#E2E8DA',
        },
        'danger': {
          DEFAULT: '#A32D2D',
          bg: '#FAECEC',
        },
        'warning': {
          DEFAULT: '#BA7517',
          bg: '#FAEEDA',
        },
      },
      fontFamily: {
        display: ['Fraunces', '"Iowan Old Style"', 'Charter', 'Georgia', 'serif'],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        'xs': ['12px', { lineHeight: '1.4' }],
        'sm': ['14px', { lineHeight: '1.5' }],
        'base': ['16px', { lineHeight: '1.5' }],
        'md': ['16px', { lineHeight: '1.5' }],
        'lg': ['20px', { lineHeight: '1.4' }],
        'xl': ['24px', { lineHeight: '1.3' }],
        '2xl': ['30px', { lineHeight: '1.2' }],
        '3xl': ['36px', { lineHeight: '1.15' }],
      },
      borderRadius: {
        'sm': '6px',
        'md': '8px',
        'lg': '10px',
        'xl': '14px',
      },
      boxShadow: {
        'sm': '0 1px 2px rgba(12, 10, 9, 0.04)',
        'md': '0 2px 8px rgba(12, 10, 9, 0.06)',
        'lg': '0 8px 24px rgba(12, 10, 9, 0.08)',
      },
      transitionDuration: {
        'fast': '120ms',
        'base': '180ms',
        'slow': '280ms',
      },
      minHeight: {
        'touch': '44px',
        'touch-base': '48px',
      },
    },
  },
  plugins: [],
}
