// src/modules/kds/lib/theme.ts
//
// DISPONIBILIDAD · C2 — helper de tema único para la familia de componentes
// de Disponibilidad (LocationStatusCard, ClosedBrandsCard, BrandCloseControl,
// AvailabilityBoard, AgotarProductoModal, SectionHeader). Antes cada
// componente repetía `dark ? 'bg-zinc-900 ring-1 ring-zinc-800' : 'bg-white
// border border-stone-200'` en cada elemento; ahora se calcula UNA vez por
// componente y se referencia por clave. Cero cambio visual: mismas clases
// exactas de antes, solo centralizadas.
//
// Los tokens de tailwind.config son monocromo-claro (bg-page/bg-card/
// text-primary no tienen variante oscura) — por eso el lado 'dark' (tablet)
// sigue usando la paleta zinc/stone estándar de Tailwind, no tokens nuevos.

export type Theme = 'light' | 'dark'

export interface ThemeCls {
  /** Tarjeta/superficie contenedora (LocationStatusCard, ClosedBrandsCard, panel de board). */
  card: string
  /** Fondo del panel de un modal. */
  panel: string
  /** Botón "outline" disparador (p.ej. "Cerrar marca"). */
  buttonOutline: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  /** Borde/división estándar. */
  border: string
  /** División interna más sutil (p.ej. separador de duraciones en LocationStatusCard). */
  dividerLight: string
  /** Hover de fila en listas (buscador de marca/producto). */
  hoverBg: string
  /** Superficie de un input de texto. */
  input: string
  /** Chip/botón secundario neutro (duraciones de cierre). */
  chipNeutral: string
  /** Botón de icono para cerrar (X). */
  iconButton: string
  /** Enlace de texto discreto (p.ej. "← Elegir otra marca"). */
  linkMuted: string
  /** CTA sólido de "agotar" (antes hex a medida por superficie: #b45309 en
   *  web, #D67442/#e0824f/#1a1208 en tablet). Ámbar en las dos, vía tokens/
   *  paleta estándar de Tailwind — no hex a medida. */
  ctaWarning: string
}

export function themeCls(theme: Theme): ThemeCls {
  const dark = theme === 'dark'
  return {
    card: dark ? 'bg-zinc-900 ring-1 ring-zinc-800' : 'bg-white border border-stone-200',
    panel: dark ? 'bg-zinc-900 ring-1 ring-zinc-700 text-zinc-100' : 'bg-white',
    buttonOutline: dark
      ? 'bg-zinc-900 ring-1 ring-zinc-800 text-zinc-200 hover:bg-zinc-800'
      : 'bg-white border border-stone-300 text-stone-700 hover:bg-stone-50',
    textPrimary: dark ? 'text-zinc-100' : 'text-stone-800',
    textSecondary: dark ? 'text-zinc-400' : 'text-stone-500',
    textMuted: dark ? 'text-zinc-500' : 'text-stone-400',
    border: dark ? 'border-zinc-800' : 'border-stone-200',
    dividerLight: dark ? 'border-zinc-800' : 'border-stone-100',
    hoverBg: dark ? 'hover:bg-zinc-800' : 'hover:bg-stone-50',
    input: dark
      ? 'bg-zinc-950 ring-1 ring-zinc-700 text-zinc-100 placeholder:text-zinc-600'
      : 'border border-stone-300',
    chipNeutral: dark
      ? 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
      : 'bg-stone-100 text-stone-700 hover:bg-stone-200',
    iconButton: dark ? 'text-zinc-500 hover:text-zinc-200' : 'text-stone-400 hover:text-stone-600',
    linkMuted: dark ? 'text-zinc-400 hover:text-zinc-200' : 'text-stone-500 hover:text-stone-700',
    ctaWarning: dark ? 'bg-amber-500 text-zinc-950 hover:bg-amber-400' : 'bg-warning text-white hover:opacity-90',
  }
}
