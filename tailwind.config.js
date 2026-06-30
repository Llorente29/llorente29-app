/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Superficies (lienzo frío y nítido) ──
        'page': '#F6F7F8',
        'card': '#FFFFFF',
        'border-default': '#E9EBED',

        // ── Texto ──
        'text-primary': '#15171A',   // tinta
        'text-secondary': '#6B7077', // gris frío legible
        'text-on-accent': '#FFFFFF',

        // ── Acción / marca (rebrand 30/06/2026: tinta monocroma) ──
        // El acento de acción es la TINTA. Botones primary, tabs activos,
        // focus, énfasis. Sustituye al azul tinta anterior.
        'accent': {
          DEFAULT: '#15171A',
          hover: '#2A2D33',
          bg: '#EEEFF1',
        },
        // 'terracota' se JUBILA como color, pero se conserva el TOKEN apuntando
        // a tinta para que los cientos de usos existentes (bg-terracota,
        // text-terracota, terracota-bg) hereden la marca nueva sin tocar JSX.
        // Renombrado fino terracota→accent = pulido posterior, no urgente.
        'terracota': {
          DEFAULT: '#15171A',
          hover: '#2A2D33',
          bg: '#F1F2F4',
        },

        // ── Semánticos = el trío del MARGEN (la tesis: el color es dinero) ──
        'success': {           // verde: gana dinero / hecho
          DEFAULT: '#1F9D6B',
          bg: '#E7F4EE',
        },
        'warning': {           // ámbar: margen ajustado / atención
          DEFAULT: '#C2890F',
          bg: '#FAF0D8',
        },
        'danger': {            // rojo: pierde / error
          DEFAULT: '#E0492E',
          bg: '#FBE8E3',
        },
      },
      fontFamily: {
        // Display → Space Grotesk (grotesca moderna). Fallback a Inter para
        // degradar limpio si la webfont aún no ha cargado (nunca a serif).
        display: ['"Space Grotesk"', 'Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
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
        'sm': '0 1px 2px rgba(21, 23, 26, 0.04)',
        'md': '0 2px 8px rgba(21, 23, 26, 0.06)',
        'lg': '0 8px 24px rgba(21, 23, 26, 0.08)',
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
