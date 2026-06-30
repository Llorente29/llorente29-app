/**
 * Sistema central de marca.
 *
 * Toda la identidad visual de la app vive aquí.
 * Cambiar valores en este archivo actualiza la marca en toda la aplicación.
 *
 * Rebrand 30/06/2026 — dirección "instrumento / el color es dinero":
 * - Terracota JUBILADO. Acción = tinta monocroma.
 * - Semánticos = el trío del margen (verde gana / ámbar aprieta / rojo pierde).
 * - Superficies frías y nítidas; las fotos del plato ponen el apetito.
 * - Display: Fraunces → Space Grotesk. UI: Inter. Números: JetBrains Mono (tabular).
 * - Símbolo: "El ciclo" (anillo + punto de margen verde).
 * - Chrome: escritorio claro; oscuro solo en modo cocina (tablet).
 */

export const BRAND = {
  // ---------------------------------------------------------------
  // IDENTIDAD
  // ---------------------------------------------------------------
  name: 'Folvy',
  tagline: 'Una plataforma, toda tu operación.',
  domain: 'folvy.app',

  // ---------------------------------------------------------------
  // PALETA
  // ---------------------------------------------------------------
  colors: {
    // Superficies
    bgPage:    '#F6F7F8',  // lienzo frío — fondo general
    bgCard:    '#FFFFFF',  // tarjetas, modales, inputs
    border:    '#E9EBED',  // bordes y separadores

    // Texto
    textPrimary:   '#15171A',  // tinta — títulos, datos importantes
    textSecondary: '#6B7077',  // subtítulos, labels, hints (gris frío)
    textOnAccent:  '#FFFFFF',  // texto sobre tinta

    // Acción / marca
    accent:        '#15171A',  // tinta — botones primary, dots, focus, tabs activos
    accentHover:   '#2A2D33',  // hover de accent (lift)
    accentBg:      '#EEEFF1',  // fondo claro para badges con texto accent

    // Estados semánticos = el trío del margen
    success:       '#1F9D6B',  // verde — gana dinero / completado
    successBg:     '#E7F4EE',
    warning:       '#C2890F',  // ámbar — margen ajustado / atención
    warningBg:     '#FAF0D8',
    danger:        '#E0492E',  // rojo — pierde / error
    dangerBg:      '#FBE8E3',
  } as const,

  // ---------------------------------------------------------------
  // TIPOGRAFÍA
  // ---------------------------------------------------------------
  fonts: {
    display: '"Space Grotesk", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    sans:    '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    mono:    '"JetBrains Mono", "SF Mono", "Menlo", "Consolas", monospace',
  } as const,

  // Tamaños tipográficos en px (escala armónica)
  fontSize: {
    xs:   '11px',  // microcopy, labels muy pequeños
    sm:   '12px',  // captions, badges
    base: '14px',  // body por defecto
    md:   '16px',  // body grande, inputs
    lg:   '20px',  // h3 secciones
    xl:   '24px',  // h2
    '2xl': '30px', // h1 página
    '3xl': '36px', // hero / dashboards
  } as const,

  // Pesos (solo los que usamos)
  fontWeight: {
    regular:  400,
    medium:   500,
    semibold: 600,
  } as const,

  // ---------------------------------------------------------------
  // RADIOS (esquinas redondeadas)
  // ---------------------------------------------------------------
  radius: {
    sm: '6px',   // badges, pildoras pequeñas
    md: '8px',   // botones, inputs
    lg: '10px',  // tarjetas estándar
    xl: '14px',  // modales, contenedores grandes
    full: '999px', // avatares, pildoras
  } as const,

  // ---------------------------------------------------------------
  // ESPACIADO (escala base 4)
  // ---------------------------------------------------------------
  spacing: {
    xs:  '4px',
    sm:  '6px',
    md:  '10px',
    lg:  '14px',
    xl:  '20px',
    '2xl': '32px',
  } as const,

  // ---------------------------------------------------------------
  // SOMBRAS (sutiles, frías)
  // ---------------------------------------------------------------
  shadow: {
    sm: '0 1px 2px rgba(21, 23, 26, 0.04)',
    md: '0 2px 8px rgba(21, 23, 26, 0.06)',
    lg: '0 8px 24px rgba(21, 23, 26, 0.08)',
  } as const,

  // ---------------------------------------------------------------
  // TRANSICIONES
  // ---------------------------------------------------------------
  transition: {
    fast:   '120ms ease',
    base:   '180ms ease',
    slow:   '280ms ease',
  } as const,

  // ---------------------------------------------------------------
  // TAMAÑOS TOUCH (mínimo accesibilidad)
  // ---------------------------------------------------------------
  touch: {
    min: '44px',     // mínimo absoluto (Apple HIG)
    base: '48px',    // recomendado en móvil
  } as const,
} as const;

// ---------------------------------------------------------------
// TIPOS DERIVADOS (autocompletado TypeScript)
// ---------------------------------------------------------------
export type BrandColor = keyof typeof BRAND.colors;
export type BrandFontSize = keyof typeof BRAND.fontSize;
export type BrandRadius = keyof typeof BRAND.radius;
export type BrandSpacing = keyof typeof BRAND.spacing;
