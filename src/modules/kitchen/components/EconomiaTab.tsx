// src/modules/kitchen/components/EconomiaTab.tsx
//
// Pestaña "Economía" de la ficha unificada de plato (CatalogFichaPage).
// Extraída de CatalogProductDetailPage.tsx, sección S2 "Economía por canal"
// (id="s-economia", líneas ~1566-1669). Ver plan
// C:\Users\jgcol\.claude\plans\polished-sniffing-walrus.md, Fase 4.
// Regla de oro: unificar no pierde nada — "mover, no inventar", salvo la
// exclusión ya decidida: el tile "Stock para" (siempre "—", nunca calculado)
// NO se mueve — dead, decisión ya tomada.
//
// menu_item-scoped: economía POR CANAL de este producto de venta concreto (el
// bloque cross-marca del editor de escandallo vive en Escandallo, Fase 2 —
// ver decisión de Julio del 04/08 en el plan). `item` YA viene cargado por el
// padre (CatalogFichaPage) — este componente NUNCA hace su propio
// getMenuItemById; nunca pregunta por su cuenta "¿existe/cuánto vale X?" del
// producto, todo lo que es de `item` sale de la prop. Solo carga por su cuenta
// lo que NO es parte de `item`: economía por canal (RPC) y logos de conector.

import { useEffect, useState } from 'react'
import { Bike, ShoppingBag, Store } from 'lucide-react'
import {
  getMenuItemChannelEconomics,
  type ChannelEconomics,
} from '@/modules/kitchen/services/menuOverrideService'
import {
  listSalesChannels,
  type SalesChannel as SalesChannelType,
} from '@/modules/kitchen/services/channelRateService'
import { supabase } from '@/lib/supabase'
import type { MenuItem } from '@/types/kitchen'

function fmtEur(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)
}

interface EconomiaTabProps {
  item: MenuItem
  accountId: string
  onItemChanged: () => void
}

export default function EconomiaTab({ item }: EconomiaTabProps) {
  const [econ, setEcon] = useState<ChannelEconomics[]>([])
  const [salesChannels, setSalesChannels] = useState<SalesChannelType[]>([])
  const [channelLogos, setChannelLogos] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      listSalesChannels(item.accountId),
      getMenuItemChannelEconomics(item.id),
    ]).then(([chs, rows]) => {
      if (cancelled) return
      setSalesChannels(chs)
      setEcon(rows)
    }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false) })
    if (supabase) {
      supabase.from('connector').select('code, logo_url').not('logo_url', 'is', null)
        .then(({ data }) => {
          if (cancelled || !data) return
          const map: Record<string, string> = {}
          for (const row of data) map[String(row.code).toLowerCase()] = row.logo_url as string
          setChannelLogos(map)
        })
    }
    return () => { cancelled = true }
  }, [item.id, item.accountId])

  const pvpSinIva = item.price ?? 0
  const vatPct = item.vatRate ?? 0
  const pvpConIva = Math.round(pvpSinIva * (1 + vatPct / 100) * 100) / 100
  const recipeCost = econ.find((e) => e.costAvailable)?.cost ?? null
  const hasCost = recipeCost != null && recipeCost > 0
  const foodCostPct = hasCost && pvpSinIva > 0 ? Math.round((recipeCost! / pvpSinIva) * 10000) / 100 : null

  let bestMargin: number | null = null
  let bestChannel = ''
  let bestMarginPct: number | null = null
  for (const e of econ) {
    if (e.netMargin == null) continue
    if (bestMargin === null || e.netMargin > bestMargin) {
      bestMargin = e.netMargin
      bestChannel = e.channelName
      bestMarginPct = e.netMarginPct
    }
  }

  const channelIcon = (slug: string | null) => {
    if (!slug) return null
    const s = slug.toLowerCase()
    if (s.includes('glovo') || s.includes('uber') || s.includes('justeat') || s.includes('just_eat')) return <Bike size={14} />
    if (s.includes('shop') || s.includes('takeaway')) return <ShoppingBag size={14} />
    return <Store size={14} />
  }

  const channelBadge = (ch: SalesChannelType) => {
    const logoUrl = ch.slug ? channelLogos[ch.slug.toLowerCase()] : null
    if (logoUrl) {
      return (
        <span className="h-11 px-3 rounded-xl bg-white border border-stone-200 flex items-center gap-2 flex-shrink-0">
          <img src={logoUrl} alt={ch.name} className="h-7 w-7 rounded object-contain" />
          <span className="text-base font-medium text-stone-800 pr-1">{ch.name}</span>
        </span>
      )
    }
    return (
      <span className="h-11 px-4 rounded-xl flex items-center gap-2 text-white text-base font-medium flex-shrink-0" style={{ backgroundColor: ch.color || '#8B8178' }}>
        {channelIcon(ch.slug)}
        {ch.name}
      </span>
    )
  }

  if (loading && econ.length === 0) {
    return <p className="text-sm text-stone-400 py-6 text-center">Cargando economía…</p>
  }

  return (
    <div>
      {/* Tiles de métrica — SIN "Stock para" (dead, decisión ya tomada) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-4">
        <div className="bg-stone-50 rounded-lg px-4 py-3">
          <div className="text-[10px] font-medium text-stone-400 tracking-widest uppercase mb-1">PVP cliente</div>
          <div className="font-mono text-lg font-medium">{fmtEur(pvpConIva)}</div>
          <div className="text-[11px] text-stone-400">IVA {vatPct}% incluido</div>
        </div>
        <div className="bg-stone-50 rounded-lg px-4 py-3">
          <div className="text-[10px] font-medium text-stone-400 tracking-widest uppercase mb-1">Food cost</div>
          <div className={`font-mono text-lg font-medium ${hasCost ? 'text-[#BA7517]' : 'text-stone-300'}`}>{hasCost ? fmtEur(recipeCost) : '—'}</div>
          <div className="text-[11px] text-stone-400">{hasCost ? `${foodCostPct}% del PVP` : 'Pendiente de escandallo'}</div>
        </div>
        <div className="bg-stone-50 rounded-lg px-4 py-3">
          <div className="text-[10px] font-medium text-stone-400 tracking-widest uppercase mb-1">Mejor margen</div>
          <div className={`font-mono text-lg font-medium ${bestMargin != null ? 'text-success' : 'text-stone-300'}`}>{bestMargin != null ? fmtEur(bestMargin) : '—'}</div>
          <div className="text-[11px] text-stone-400">{bestChannel ? `${bestChannel} · ${bestMarginPct}%` : 'Configura un canal'}</div>
        </div>
      </div>

      {/* Barras de margen por canal — del motor menu_item_channel_economics */}
      {econ.length > 0 ? (
        <div className="space-y-6">
          {econ.map((e) => {
            const ch = salesChannels.find((s) => s.id === e.channelId)
            const badge = ch
              ? channelBadge(ch)
              : <span className="h-11 px-4 rounded-xl flex items-center text-stone-800 text-base font-medium bg-stone-100 flex-shrink-0">{e.channelName}</span>
            const noRate = e.serviceType == null && e.commissionPct == null
            if (noRate) {
              return (
                <div key={e.channelId} className="flex items-center gap-2.5 border border-dashed border-stone-200 rounded-[10px] px-5 py-4 text-sm text-stone-400">
                  {badge} · sin configurar
                </div>
              )
            }
            const price = e.price
            const cost = e.costAvailable ? (e.cost ?? 0) : 0
            const commAmt = e.commissionAmount ?? 0
            const orderCost = e.orderCostsPerItem ?? 0
            const margin = e.netMargin ?? 0
            const marginPct = e.netMarginPct ?? 0
            const hasOrderCosts = e.serviceType === 'own_delivery' && orderCost > 0
            const costPct = e.costAvailable && price > 0 ? Math.round((cost / price) * 100) : 0
            const commPctBar = price > 0 ? Math.round((commAmt / price) * 100) : 0
            const transPctBar = price > 0 ? Math.round((orderCost / price) * 100) : 0
            const marginPctBar = Math.max(0, 100 - costPct - commPctBar - transPctBar)

            return (
              <div key={e.channelId}>
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2.5">{badge}</div>
                  <div className="text-right">
                    <span className={`font-mono text-xl font-medium ${margin >= 0 ? 'text-success' : 'text-danger'}`}>{fmtEur(margin)}</span>
                    <div className="text-[12px] text-stone-400">{marginPct}% del PVP{!e.costAvailable ? ' · sin food cost' : ''}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-[12px] text-stone-500">
                  {e.costAvailable && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#A68B6B]" /> Food cost {fmtEur(e.cost)}</span>}
                  {e.commissionPct != null && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#4A6A8A]" /> Comisión {e.commissionPct}% ({fmtEur(commAmt)})</span>}
                  {hasOrderCosts && (
                    <span className="flex items-center gap-1.5 cursor-help"
                      title={`Coste de reparto propio por pedido: coste del rider${e.ownCourierCost != null ? ` (${fmtEur(e.ownCourierCost)})` : ''} + comisión fija${e.commissionFixed != null ? ` (${fmtEur(e.commissionFixed)})` : ''} − envío que paga el cliente${e.ownCustomerFee != null ? ` (${fmtEur(e.ownCustomerFee)})` : ''}, sin IVA, repartido entre ~2 platos por pedido. Es una estimación hasta tener ventas reales.`}>
                      <span className="w-2 h-2 rounded-sm bg-[#8BADC4]" /> Canal ≈{fmtEur(orderCost)} <span className="text-stone-300">ⓘ</span>
                    </span>
                  )}
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-[#7CB663]" /> Margen {fmtEur(margin)}</span>
                </div>
                <div className="h-7 rounded-lg overflow-hidden flex bg-[#ECEAE4]">
                  {e.costAvailable && costPct > 0 && <div className="h-full bg-[#A68B6B] transition-all duration-500" style={{ width: `${costPct}%` }} />}
                  {commPctBar > 0 && <div className="h-full bg-[#4A6A8A] transition-all duration-500" style={{ width: `${commPctBar}%` }} />}
                  {transPctBar > 0 && <div className="h-full bg-[#8BADC4] transition-all duration-500" style={{ width: `${transPctBar}%` }} />}
                  <div className="h-full bg-[#7CB663] transition-all duration-500" style={{ width: `${marginPctBar}%` }} />
                </div>
              </div>
            )
          })}
          {econ.some((e) => e.serviceType === 'own_delivery') && (
            <p className="text-[12px] text-stone-400 leading-relaxed pt-3 border-t border-stone-200">
              En los canales de reparto propio, el coste de canal = comisión fija + coste del rider − envío que paga el cliente (sin IVA), por pedido, repartido entre ~2 platos. Es una estimación; Folvy la afinará con el número real de platos por pedido cuando haya más ventas. El margen mostrado ya lo descuenta.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-stone-500">No hay canales configurados.</p>
      )}

      {/* Target food cost — lee item.targetFoodCostPct, NO lo edita (el input
          editable vive en la pestaña Ficha; comparten el mismo `item` por
          prop, así que no hay ventana de desincronización). */}
      <p className="text-[12px] text-stone-500 mt-4 pt-3 border-t border-stone-200">
        {item.targetFoodCostPct != null
          ? `Target FC: ${item.targetFoodCostPct}% · ${foodCostPct != null ? (foodCostPct <= item.targetFoodCostPct ? 'Dentro del objetivo' : 'Fuera del objetivo') : 'sin food cost para comparar'}`
          : 'Sin target de food cost configurado.'}
      </p>
    </div>
  )
}
