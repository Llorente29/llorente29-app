/**
 * Sistema central de marca.
 *
 * Toda la identidad visual de la app vive aquí.
 * Cambiar valores en este archivo actualiza la marca en toda la aplicación.
 *
 * Decisiones de diseño (sesión 14/05/2026):
 * - Posicionamiento: premium + toque cercano español
 * - Paleta: warm white + azul tinta (sin granate vintage)
 * - Tipografía: Fraunces (display) + Inter (UI)
 * - Iconos: Lucide React
 */

export const BRAND = {
  // ---------------------------------------------------------------
  // IDENTIDAD
  // ---------------------------------------------------------------
  name: 'TBD',                         // Pendiente: Garbim, Garbis, Garbiz, Garbin, Garbie
  tagline: 'Tu cocina, en orden.',     // Slogan provisional
  domain: 'tbd.app',                   // Pendiente

  // ---------------------------------------------------------------
  // PALETA (8 colores definitivos)
  // ---------------------------------------------------------------
  colors: {
    // Superficies
    bgPage:    '#F5F4F0',  // warm white — fondo general
    bgCard:    '#FFFFFF',  // tarjetas, modales, inputs
    border:    '#E0DDD6',  // bordes y separadores warm

    // Texto
    textPrimary:   '#0C0A09',  // títulos, datos importantes
    textSecondary: '#6B6760',  // subtítulos, labels, hints (warm gray)
    textOnAccent:  '#FFFFFF',  // texto sobre fondos azul tinta

    // Marca
    accent:        '#1E3A5F',  // azul tinta — botones primary, dots, focus
    accentHover:   '#162E4A',  // hover de accent (un 12% más oscuro)
    accentBg:      '#EDECE6',  // fondo claro para badges con texto accent

    // Estados semánticos
    success:       '#3F5C2F',  // verde tierra — completado, hecho
    successBg:     '#E2E8DA',  // fondo claro para badges success
    danger:        '#A32D2D',  // rojo terroso — incidencias, errores
    dangerBg:      '#FAECEC',  // fondo claro para badges danger
    warning:       '#BA7517',  // ámbar — atención, alertas suaves
    warningBg:     '#FAEEDA',  // fondo claro para badges warning
  } as const,

  // ---------------------------------------------------------------
  // TIPOGRAFÍA
  // ---------------------------------------------------------------
  fonts: {
    display: '"Fraunces", "Iowan Old Style", "Charter", Georgia, serif',
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
  // SOMBRAS (sutiles, sin elevación excesiva)
  // ---------------------------------------------------------------
  shadow: {
    sm: '0 1px 2px rgba(12, 10, 9, 0.04)',
    md: '0 2px 8px rgba(12, 10, 9, 0.06)',
    lg: '0 8px 24px rgba(12, 10, 9, 0.08)',
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
