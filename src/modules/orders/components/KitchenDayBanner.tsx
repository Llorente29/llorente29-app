// src/modules/orders/components/KitchenDayBanner.tsx
//
// Banner del día del KPI de cocina. Arriba de Pedidos, visible para la cocina, en
// las DOS superficies (sesión y Estación por token). COLECTIVO, nunca por persona.
//
//   🍳 Media de hoy: X min · N pedidos · objetivo Y min
//
// Verde si la media está bajo objetivo, ámbar si por encima (indica cuánto falta).
// GUARDA DE MUESTRA MÍNIMA: con pocos "Listo" pulsados (banner.suficiente=false) NO
// muestra media — mostraría una mentira que además premiaría no pulsar el botón —
// sino "aún sin datos suficientes · N de M marcados". El agregado (media, guarda,
// objetivo) lo calcula la RPC kitchen_day_banner server-side; aquí solo se pinta.

import type { KitchenDayBanner } from '../services/ordersFeedService'

export default function KitchenDayBannerBar({ banner }: { banner: KitchenDayBanner | null }) {
  if (!banner) return null

  // Sin muestra suficiente: honesto, neutro, sin media.
  if (!banner.suficiente || banner.mediana_min == null) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-default bg-page text-text-secondary text-[13.5px] font-bold">
        <span aria-hidden>🍳</span>
        <span>
          Aún sin datos suficientes
          <span className="font-semibold text-text-secondary"> · {banner.n_medidos} de {banner.n_elegibles} pedidos marcados</span>
        </span>
      </div>
    )
  }

  const good = banner.bajo_objetivo === true
  const over = banner.objetivo_min != null ? Math.max(0, Math.round(banner.mediana_min - banner.objetivo_min)) : null
  const cls = good
    ? 'border-success/30 bg-success-bg text-success'
    : 'border-warning/40 bg-warning-bg text-warning'

  return (
    <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[13.5px] font-bold ${cls}`}>
      <span aria-hidden>🍳</span>
      <span className="flex items-center gap-1.5 flex-wrap">
        <span>Media de hoy:</span>
        <b className="font-display text-[16px] tabular-nums">{banner.mediana_min} min</b>
        <span className="font-semibold opacity-90">· {banner.n_medidos} pedidos</span>
        {banner.objetivo_min != null && (
          <span className="font-semibold opacity-90">· objetivo {banner.objetivo_min} min</span>
        )}
        {!good && over != null && over > 0 && (
          <span className="font-extrabold">· {over} min por encima</span>
        )}
      </span>
    </div>
  )
}
