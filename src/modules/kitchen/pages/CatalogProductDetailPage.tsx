// src/modules/kitchen/pages/CatalogProductDetailPage.tsx
//
// Vista DETALLE de un producto de la carta (menu_item product_type='item').
// Patrón LISTA + DETALLE por estado, igual que KitchenItemDetailPage: recibe
// menuItemId + onBack, no usa react-router con params. La monta KitchenMenuPage.
//
// B1.1 — ESTRUCTURA NAVEGABLE: secciones apiladas con ÍNDICE STICKY lateral
// (escritorio) que sirve de navegación + atajos (scrollIntoView). Decisión de
// diseño basada en evidencia UX (Baymard/Oleksy): los tabs horizontales esconden
// contenido que el usuario no descubre; "una página con índice pegajoso" da
// overview + atajos sin perder secciones. Otter (benchmark) usa este patrón.
//
// Secciones: Datos (editable) · Precios · Modificadores (lectura) · Disponibilidad
// · Avanzado. Precios/Disponibilidad/Avanzado nacen como contenedores honestos
// "próximamente" (se rellenan en B1.2–B1.5: overrides location×canal, toggles,
// fotos, kitchen_name, datos dietéticos). En móvil el índice se reduce a chips.

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Loader2, Pencil, X, UtensilsCrossed, FileText, Tag, SlidersHorizontal, ToggleRight, Settings2 } from 'lucide-react'
import {
  getMenuItemById,
  updateMenuItem,
} from '@/modules/kitchen/services/menuItemService'
import {
  getProductModifierGroups,
  type CatalogModifierGroup,
} from '@/modules/kitchen/services/brandCatalogService'
import {
  listChannelRates,
  listSalesChannels,
  baseFromGross,
  type ChannelRate,
  type SalesChannel as SalesChannelType,
} from '@/modules/kitchen/services/channelRateService'
import { supabase } from '@/lib/supabase'
import type { MenuItem } from '@/types/kitchen'

function formatEur(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)
}

const GROUP_TYPE_LABEL: Record<string, string> = {
  choice: 'Elección',
  extras: 'Extras',
  removal: 'Quitar',
  side: 'Acompañamiento',
  cross_sell: 'Sugerencia',
  info: 'Info',
}

// Secciones del índice navegable.
const SECTIONS = [
  { id: 'datos',          label: 'Datos',          icon: FileText },
  { id: 'precios',        label: 'Precios',        icon: Tag },
  { id: 'modificadores',  label: 'Modificadores',  icon: SlidersHorizontal },
  { id: 'disponibilidad', label: 'Disponibilidad', icon: ToggleRight },
  { id: 'avanzado',       label: 'Avanzado',       icon: Settings2 },
] as const

interface CatalogProductDetailPageProps {
  menuItemId: string
  onBack: () => void
}

export default function CatalogProductDetailPage({ menuItemId, onBack }: CatalogProductDetailPageProps) {
  const [item, setItem] = useState<MenuItem | null>(null)
  const [groups, setGroups] = useState<CatalogModifierGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<string>('datos')

  // Economía E2 (cascada de margen): rates + canales + coste de escandallo.
  const [channelRates, setChannelRates] = useState<ChannelRate[]>([])
  const [salesChannels, setSalesChannels] = useState<SalesChannelType[]>([])
  const [recipeCost, setRecipeCost] = useState<number | null>(null)

  // Edición de datos.
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Refs a cada sección para el scroll del índice.
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getMenuItemById(menuItemId)
      .then((mi) => {
        if (cancelled) return
        if (!mi) { setError('Este producto ya no existe.'); setItem(null) }
        else setItem(mi)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error cargando el producto.')
        setItem(null)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [menuItemId])

  // Modificadores: se cargan cuando el item está disponible (necesitan accountId real).
  useEffect(() => {
    if (!item) return
    let cancelled = false
    getProductModifierGroups(item.accountId, item.id)
      .then((mgs) => { if (!cancelled) setGroups(mgs) })
      .catch(() => { if (!cancelled) setGroups([]) })
    return () => { cancelled = true }
  }, [item?.id, item?.accountId])

  // Economía E2: channel rates + canales + coste de escandallo (client-side; la
  // RPC no sirve porque hace INNER JOIN con recipe_item y 0 productos tienen escandallo).
  useEffect(() => {
    if (!item) return
    let cancelled = false
    // Channel rates + channels para la cascada de margen
    Promise.all([
      listChannelRates(item.accountId),
      listSalesChannels(item.accountId),
    ]).then(([rates, chs]) => {
      if (cancelled) return
      setChannelRates(rates)
      setSalesChannels(chs)
    }).catch(() => {})
    // Recipe cost si tiene escandallo vinculado
    if (item.recipeItemId && supabase) {
      supabase.from('recipe_item')
        .select('computed_cost')
        .eq('id', item.recipeItemId)
        .single()
        .then(({ data }) => {
          if (!cancelled && data) setRecipeCost(data.computed_cost as number | null)
        })
    } else {
      setRecipeCost(null)
    }
    return () => { cancelled = true }
  }, [item?.id, item?.accountId, item?.recipeItemId])

  // Resaltar la sección visible en el índice (scroll spy ligero).
  useEffect(() => {
    if (!item) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActiveSection(e.target.id)
        }
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    )
    SECTIONS.forEach((s) => {
      const el = sectionRefs.current[s.id]
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [item])

  function scrollToSection(id: string) {
    const el = sectionRefs.current[id]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveSection(id)
    }
  }

  async function refreshItem() {
    try {
      const fresh = await getMenuItemById(menuItemId)
      if (fresh) setItem(fresh)
    } catch (err: unknown) {
      console.error('CatalogProductDetailPage: refresco falló', err)
    }
  }

  function openEdit() {
    if (!item) return
    setName(item.name)
    setDescription(item.description ?? '')
    setPrice(String(item.price ?? ''))
    setSaveError(null)
    setEditing(true)
  }

  async function save() {
    if (!item) return
    const trimmed = name.trim()
    if (trimmed === '') { setSaveError('El nombre es obligatorio.'); return }
    const priceNum = Number(price.replace(',', '.'))
    if (!Number.isFinite(priceNum) || priceNum < 0) { setSaveError('El precio no es válido.'); return }
    setSaving(true)
    setSaveError(null)
    try {
      await updateMenuItem(item.id, {
        name: trimmed,
        description: description.trim() === '' ? null : description.trim(),
        price: priceNum,
      })
      setEditing(false)
      await refreshItem()
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  // Cabecera (botón volver) — siempre visible.
  const header = (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-base"
      >
        <ArrowLeft size={16} />
        Menú
      </button>
    </div>
  )

  if (loading) {
    return <div className="space-y-4">{header}<div className="p-8 text-center text-sm text-text-secondary">Cargando producto…</div></div>
  }
  if (error || !item) {
    return <div className="space-y-4">{header}<div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error ?? 'Producto no encontrado.'}</div></div>
  }

  return (
    <div className="space-y-4">
      {header}

      <div className="flex gap-6">
        {/* Índice navegable — sticky en escritorio */}
        <nav className="hidden lg:block w-44 shrink-0">
          <div className="sticky top-4 space-y-0.5">
            {SECTIONS.map((s) => {
              const Icon = s.icon
              const active = activeSection === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => scrollToSection(s.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-base text-left ${
                    active
                      ? 'bg-accent/10 text-accent font-medium'
                      : 'text-text-secondary hover:bg-page hover:text-text-primary'
                  }`}
                >
                  <Icon size={15} />
                  {s.label}
                </button>
              )
            })}
          </div>
        </nav>

        {/* Secciones apiladas */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Chips de salto en móvil */}
          <div className="lg:hidden flex gap-1.5 overflow-x-auto pb-1">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => scrollToSection(s.id)}
                className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap transition-base ${
                  activeSection === s.id ? 'bg-accent text-text-on-accent' : 'bg-page text-text-secondary'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* DATOS */}
          <div id="datos" ref={(el) => { sectionRefs.current['datos'] = el }} className="scroll-mt-4">
            <div className="rounded-lg border border-border-default bg-card">
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border-default">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-md bg-page flex items-center justify-center text-text-secondary shrink-0">
                    {item.photoUrl
                      ? <img src={item.photoUrl} alt="" className="w-11 h-11 rounded-md object-cover" />
                      : <UtensilsCrossed size={18} />}
                  </div>
                  <h2 className="text-lg font-display font-medium text-text-primary truncate">{item.name}</h2>
                </div>
                {!editing && (
                  <button
                    type="button"
                    onClick={openEdit}
                    className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-accent transition-base shrink-0"
                  >
                    <Pencil size={14} />
                    Editar
                  </button>
                )}
              </div>

              {!editing ? (
                <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div>
                    <div className="text-[11px] text-text-secondary">Precio base</div>
                    <div className="text-text-primary font-mono">{formatEur(item.price)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-text-secondary">Disponibilidad</div>
                    <div className="text-text-primary">{item.isAvailable ? 'Disponible' : 'Agotado'}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-text-secondary">Escandallo</div>
                    <div className="text-text-primary">{item.recipeItemId ? 'Asignado' : 'Sin escandallo'}</div>
                  </div>
                  <div className="sm:col-span-3">
                    <div className="text-[11px] text-text-secondary">Descripción</div>
                    <div className="text-text-primary">{item.description ?? '—'}</div>
                  </div>
                </div>
              ) : (
                <div className="px-4 py-3 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">Nombre</label>
                    <input
                      type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={saving}
                      className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">Precio base (€)</label>
                    <input
                      type="text" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} disabled={saving}
                      className="w-40 px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">Descripción</label>
                    <textarea
                      value={description} onChange={(e) => setDescription(e.target.value)} disabled={saving} rows={3}
                      className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                    />
                  </div>

                  {saveError && (
                    <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">{saveError}</div>
                  )}

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button" onClick={() => setEditing(false)} disabled={saving}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50"
                    >
                      <X size={14} /> Cancelar
                    </button>
                    <button
                      type="button" onClick={save} disabled={saving}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
                    >
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check size={14} />}
                      {saving ? 'Guardando…' : 'Guardar'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* PRECIOS — cascada de margen E2 */}
          <div id="precios" ref={(el) => { sectionRefs.current['precios'] = el }} className="scroll-mt-4">
            <div className="rounded-lg border border-border-default bg-card">
              <div className="px-4 py-3 border-b border-border-default">
                <h3 className="text-sm font-medium text-text-primary">Precios y margen</h3>
              </div>
              <div className="px-4 py-4 space-y-4 text-sm">
                {(() => {
                  const pvpSinIva = item.price ?? 0
                  const vatPct = item.vatRate ?? 0
                  const pvpConIva = Math.round(pvpSinIva * (1 + vatPct / 100) * 100) / 100
                  const channelName = salesChannels.find(c => c.id === item.channelId)?.name
                  const rate = channelRates.find(r => r.salesChannelId === item.channelId)
                  const commissionBase = rate?.commissionBase ?? 'pvp_con_iva'
                  const commissionBasis = commissionBase === 'pvp_sin_iva' ? pvpSinIva : pvpConIva
                  const commissionPct = rate?.commissionPct ?? null
                  const commissionAmount = commissionPct != null ? Math.round(commissionBasis * commissionPct / 100 * 100) / 100 : null
                  const commissionFixedGross = rate?.commissionFixed ?? null
                  const commissionFixedBase = baseFromGross(commissionFixedGross)
                  const courierCostBase = baseFromGross(rate?.ownCourierCost ?? null)
                  const customerFeeBase = baseFromGross(rate?.ownCustomerFee ?? null, rate?.ownCustomerFeeVatPct ?? 10)
                  const hasCost = recipeCost != null && recipeCost > 0
                  const foodCostPct = hasCost && pvpSinIva > 0 ? Math.round(recipeCost! / pvpSinIva * 10000) / 100 : null
                  // Margen unitario = PVP sin IVA - food cost - comisión %
                  const marginUnit = pvpSinIva - (hasCost ? recipeCost! : 0) - (commissionAmount ?? 0)
                  const marginUnitPct = pvpSinIva > 0 ? Math.round(marginUnit / pvpSinIva * 10000) / 100 : null
                  // Impacto por pedido (comisión fija + rider - ingreso envío)
                  const orderImpact = -(commissionFixedBase ?? 0) - (courierCostBase ?? 0) + (customerFeeBase ?? 0)
                  const hasOrderCosts = commissionFixedBase != null || courierCostBase != null || customerFeeBase != null

                  return (
                    <>
                      {/* Precios */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        <div className="text-text-secondary text-[11px]">Precio base (sin IVA)</div>
                        <div className="text-right font-mono text-text-primary">{formatEur(pvpSinIva)}</div>
                        <div className="text-text-secondary text-[11px]">PVP cliente (IVA {vatPct}%)</div>
                        <div className="text-right font-mono text-text-primary">{formatEur(pvpConIva)}</div>
                      </div>

                      <hr className="border-border-default" />

                      {/* Costes unitarios */}
                      <div>
                        <div className="text-[11px] font-medium text-text-secondary mb-2">Costes unitarios</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                          <div className="text-text-secondary text-[11px]">Escandallo (food cost)</div>
                          {hasCost ? (
                            <div className="text-right">
                              <span className="font-mono text-warning">−{formatEur(recipeCost)}</span>
                              <span className="text-[10px] text-text-secondary ml-1.5">{foodCostPct}%</span>
                            </div>
                          ) : (
                            <div className="text-right text-[11px] text-text-secondary italic">
                              {item.recipeItemId ? 'sin coste calculado' : 'sin vincular'}
                            </div>
                          )}

                          {commissionPct != null && (
                            <>
                              <div className="text-text-secondary text-[11px]">
                                Comisión {channelName ?? 'canal'} {commissionPct}%
                              </div>
                              <div className="text-right">
                                <span className="font-mono text-warning">−{formatEur(commissionAmount)}</span>
                                <span className="text-[10px] text-text-secondary ml-1.5">
                                  sobre {commissionBase === 'pvp_sin_iva' ? 'PVP' : 'PVP+IVA'}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      <hr className="border-border-default" />

                      {/* Margen unitario */}
                      <div className="grid grid-cols-2 gap-x-4">
                        <div className="text-text-primary text-xs font-medium">
                          Margen unitario{!hasCost ? ' (sin food cost)' : ''}
                        </div>
                        <div className="text-right">
                          <span className={`font-mono font-medium ${marginUnit >= 0 ? 'text-success' : 'text-danger'}`}>
                            {formatEur(marginUnit)}
                          </span>
                          {marginUnitPct != null && (
                            <span className="text-[10px] text-text-secondary ml-1.5">{marginUnitPct}%</span>
                          )}
                        </div>
                      </div>

                      {/* Costes por pedido */}
                      {hasOrderCosts && rate?.serviceType === 'own_delivery' && (
                        <>
                          <hr className="border-border-default" />
                          <div>
                            <div className="text-[11px] font-medium text-text-secondary mb-2">Costes por pedido (base, sin IVA)</div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                              {commissionFixedBase != null && (
                                <>
                                  <div className="text-text-secondary text-[11px]">Comisión fija</div>
                                  <div className="text-right font-mono text-warning">−{formatEur(commissionFixedBase)}</div>
                                </>
                              )}
                              {courierCostBase != null && (
                                <>
                                  <div className="text-text-secondary text-[11px]">Coste rider</div>
                                  <div className="text-right font-mono text-warning">−{formatEur(courierCostBase)}</div>
                                </>
                              )}
                              {customerFeeBase != null && (
                                <>
                                  <div className="text-text-secondary text-[11px]">Envío cobrado al cliente</div>
                                  <div className="text-right font-mono text-success">+{formatEur(customerFeeBase)}</div>
                                </>
                              )}
                              <div className="text-text-primary text-xs font-medium pt-1 border-t border-border-default">Impacto por pedido</div>
                              <div className={`text-right font-mono font-medium pt-1 border-t border-border-default ${orderImpact >= 0 ? 'text-success' : 'text-danger'}`}>
                                {orderImpact >= 0 ? '+' : ''}{formatEur(orderImpact)}
                              </div>
                            </div>
                          </div>
                        </>
                      )}

                      {/* Nota cuando no hay comisión configurada */}
                      {!rate && channelName && (
                        <p className="text-[11px] text-text-secondary">
                          No hay comisión configurada para {channelName}. Configúrala en Ajustes para ver el margen.
                        </p>
                      )}
                      {!channelName && !item.channelId && (
                        <p className="text-[11px] text-text-secondary">
                          Este producto no tiene canal asignado.
                        </p>
                      )}
                    </>
                  )
                })()}
              </div>
            </div>
          </div>

          {/* MODIFICADORES (lectura) */}
          <div id="modificadores" ref={(el) => { sectionRefs.current['modificadores'] = el }} className="scroll-mt-4">
            <div className="rounded-lg border border-border-default bg-card">
              <div className="px-4 py-3 border-b border-border-default">
                <h3 className="text-sm font-medium text-text-primary">Modificadores</h3>
              </div>
              {groups.length === 0 ? (
                <div className="px-4 py-3 text-sm text-text-secondary">Este producto no tiene modificadores.</div>
              ) : (
                <div className="divide-y divide-border-default">
                  {groups.map((g) => (
                    <div key={g.id} className="px-4 py-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-medium text-text-primary">{g.name}</span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-page text-text-secondary">
                          {GROUP_TYPE_LABEL[g.groupType] ?? g.groupType}
                        </span>
                        <span className="text-[11px] text-text-secondary">
                          elige {g.minSelections === g.maxSelections ? g.minSelections : `${g.minSelections}–${g.maxSelections}`}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {g.options.map((o) => (
                          <div key={o.id} className="flex items-center justify-between text-sm">
                            <span className="text-text-primary">
                              {o.name}
                              {o.isDefault && <span className="ml-2 text-[11px] text-text-secondary">(por defecto)</span>}
                            </span>
                            <span className="text-text-secondary font-mono">
                              {o.priceImpact > 0 ? `+${formatEur(o.priceImpact)}` : o.priceImpact === 0 ? 'incluido' : formatEur(o.priceImpact)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* DISPONIBILIDAD — contenedor (B1.5: toggles por canal) */}
          <div id="disponibilidad" ref={(el) => { sectionRefs.current['disponibilidad'] = el }} className="scroll-mt-4">
            <div className="rounded-lg border border-border-default bg-card">
              <div className="px-4 py-3 border-b border-border-default">
                <h3 className="text-sm font-medium text-text-primary">Disponibilidad</h3>
              </div>
              <div className="px-4 py-3 text-sm">
                <div className="text-text-primary">{item.isAvailable ? 'Disponible' : 'Agotado'}</div>
                <p className="text-[11px] text-text-secondary mt-2">
                  Activar o desactivar el producto por canal (Glovo, Uber, sala) se añadirá aquí próximamente.
                </p>
              </div>
            </div>
          </div>

          {/* AVANZADO — contenedor (B1.2/B1.3: kitchen_name, fotos, datos dietéticos) */}
          <div id="avanzado" ref={(el) => { sectionRefs.current['avanzado'] = el }} className="scroll-mt-4">
            <div className="rounded-lg border border-border-default bg-card">
              <div className="px-4 py-3 border-b border-border-default">
                <h3 className="text-sm font-medium text-text-primary">Avanzado</h3>
              </div>
              <div className="px-4 py-3 text-sm">
                <p className="text-[11px] text-text-secondary">
                  Nombre interno de cocina, fotos, datos dietéticos y estación de cocina se añadirán aquí próximamente.
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
