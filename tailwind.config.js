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
        // Auditoría externa: text-text-tertiary se usaba en 280+ sitios sin
        // existir en el theme -- Tailwind lo ignoraba en silencio (la
        // jerarquía de gris se aplanaba, sin error visible). Un tercer
        // escalón, más apagado que secondary, para metadatos/ayuda.
        'text-tertiary': '#9CA1A8',
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

        // Auditoría externa: bg-background-info/text-text-info se usaban
        // (chip de "merma" en Almacén, etiqueta de sección en el escandallo)
        // sin existir en el theme -- el chip salía invisible (texto del
        // color de fondo). Azul-marino informativo, distinto de los tres
        // semánticos del margen (no es ganar/perder, es "dato neutro").
        'background-info': '#E3E8ED',
        'text-info': '#1E3A5F',

        // ── TPV (T1.f, 11/08): tema oscuro propio, escopado a .tpv-root ──
        // Los valores viven en src/modules/pos/theme/tpvTokens.css — esto
        // solo los expone como clases de Tailwind (bg-tpv-surface,
        // text-tpv-txt-2...). No tocar sin tocar ese fichero también.
        'tpv-bg': 'var(--tpv-bg)',
        'tpv-surface': 'var(--tpv-surface)',
        'tpv-surface-2': 'var(--tpv-surface-2)',
        'tpv-line': 'var(--tpv-line)',
        'tpv-txt': 'var(--tpv-txt)',
        'tpv-txt-2': 'var(--tpv-txt-2)',
        'tpv-accent': 'var(--tpv-accent)',
        'tpv-ok': 'var(--tpv-ok)',
        'tpv-warn': 'var(--tpv-warn)',
        'tpv-danger': 'var(--tpv-danger)',
        'tpv-note': 'var(--tpv-note)',
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
        // TPV (T1.f): --tpv-radius en tpvTokens.css.
        'tpv': 'var(--tpv-radius)',
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
        // TPV (T1.f) — objetivos táctiles del sistema de diseño §1/§2.1-2.3:
        // ≥76px cualquier control, ≥96px acciones críticas, 52px suelo
        // absoluto (solo +/- de cantidad y controles de cabecera). No
        // negociable en ningún formato, tablet incluida.
        'tap': '76px',
        'tap-critical': '96px',
        'tap-small': '52px',
        // Tamaños de botón que la Tarea B pide por número exacto, no en el
        // bloque --tap del §1 pero igual de "no se escribe suelto":
        // categorías ≥82px (4.1 preámbulo), tile de producto ≥118px (4.1).
        'tpv-cat': '82px',
        'tpv-product': '118px',
      },
      spacing: {
        // Mismos valores que minHeight.tap-*/tpv-* — para que h-/w-/p-
        // (no solo min-h-) tiren del mismo número único.
        'tap': '76px',
        'tap-critical': '96px',
        'tap-small': '52px',
        'tpv-cat': '82px',
        'tpv-product': '118px',
      },
      fontSize: {
        // Tamaños de texto que el sistema de diseño fija por número exacto
        // (4.1-4.3): nombre de producto/línea 17px, precio de línea 18px,
        // precio de tile 22px, código de ticket 30px, importe de tarjeta
        // 27px, total de cuenta 38px, modificador 13px. Nombrados por rol,
        // no por tamaño, para que el componente diga QUÉ es, no cuánto mide.
        'tpv-mod': ['13px', { lineHeight: '1.35' }],
        'tpv-name': ['17px', { lineHeight: '1.2' }],
        'tpv-line-price': ['18px', { lineHeight: '1.2' }],
        'tpv-tile-price': ['22px', { lineHeight: '1.15', letterSpacing: '-0.02em' }],
        'tpv-amount': ['27px', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'tpv-code': ['30px', { lineHeight: '1', letterSpacing: '-0.02em' }],
        'tpv-total': ['38px', { lineHeight: '1', letterSpacing: '-0.03em' }],
      },
    },
  },
  plugins: [],
}
