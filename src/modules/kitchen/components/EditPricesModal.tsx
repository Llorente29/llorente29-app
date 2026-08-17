// src/modules/kitchen/components/EditPricesModal.tsx
//
// FRENTE OVERRIDES — modal "Editar precios" de un producto.
// · Precio por defecto (base de la marca, menu_item.price, SIN IVA) → updateMenuItem.
//   Solo editable en "Todos los locales" -- editarlo con un local elegido tocaría
//   TODA la marca desde una pantalla que dice estar mostrando un solo local
//   (regla de Julio: nunca escribir a un ámbito distinto del que la pantalla muestra).
// · Una fila por canal: precio propio (override, SIN IVA; vacío = hereda) + 86.
//   Con "Todos los locales": el override es de marca/canal (comportamiento de
//   siempre). Con un local elegido: el override es PROPIO de ese local — la
//   cascada completa (local+canal → local → canal de marca → base) la resuelve
//   el servidor via effective_price(), aquí solo se pinta el origen que YA
//   devuelve la RPC (is_location_override / price_source) -- regla del número
//   derivado, la cifra siempre con su origen.
// · MARGEN NETO EN VIVO desde el motor menu_item_channel_economics (preview con los
//   precios tecleados): la fórmula vive en el servidor, aquí solo se muestra. Un
//   canal con varias tarifas (own_delivery/platform_delivery/pickup) trae varias
//   filas a propósito -- se agrupan (groupChannelEconomicsByChannel), el precio/86
//   son del canal (una sola fila de controles), el margen se pinta con el modo
//   dominante (más pedidos en 30d) y sub-líneas atenuadas para el resto.
//
// Selector de local: PROPIO de este modal, alimentado por useVisibleLocations —
// aislado del selector global de cabecera (activeLocationId de AppContext). Abrir
// este modal y elegir un local aquí NO cambia el scope del resto de la app.
//
// Convención de IVA idéntica a la ficha: se teclea PRECIO sin IVA, se muestra el PVP
// con IVA derivado. Sin doble criterio, sin deriva de céntimos.
//
// ─── REDISEÑO 17/08 (claude/folvy_sistema_visual_v1.md) ──────────────────────
// Solo presentación. Misma cascada, misma escritura por ámbito, mismo backend,
// misma RPC: handleSave y handleClearLocal quedan intactos byte a byte.
//
// EL BUG QUE MATA: `inherits` se calculaba contra el INPUT tecleado, así que en
// cuanto se tecleaba un carácter la etiqueta ya cantaba "precio de este local" —
// afirmaba un estado persistido que aún no existía. Ahora el estado se deriva de
// DOS fuentes (savedByChannel, que viene del RPC, vs. prices, que vive en
// pantalla) y hay TRES estados, no dos:
//   A heredado         input vacío + placeholder, borde normal, dice de dónde Y cuánto
//   B propio guardado  borde SÓLIDO tinta, píldora CLARA, botón de deshacer con su cifra
//   C tecleado         borde DISCONTINUO tinta, píldora INVERTIDA, fila marcada, el pie cuenta
// Sólido vs. discontinuo, píldora clara vs. invertida, fila limpia vs. marcada:
// tres estados y CERO color. La tesis de la marca es "el color es dinero", así que
// la única cromática fuerte de la pantalla es la salud del margen. El ámbar
// significa una sola cosa en Folvy — margen apretado —, nunca "sin guardar".
// Prueba de aceptación: desaturada a gris, la captura tiene que seguir
// distinguiendo los tres estados.

import { useState, useEffect, useMemo } from 'react'
import { X, Loader2, RotateCcw } from 'lucide-react'
import {
  getMenuItemChannelEconomics,
  setMenuItemOverride,
  clearMenuItemOverride,
  groupChannelEconomicsByChannel,
  SERVICE_TYPE_LABEL,
  type ChannelEconomics,
} from '@/modules/kitchen/services/menuOverrideService'
import { updateMenuItem } from '@/modules/kitchen/services/menuItemService'
import { useVisibleLocations } from '@/modules/multitenancy/hooks/useVisibleLocations'
import { listSalesChannels } from '@/modules/kitchen/services/channelRateService'
import { fmtNum } from '@/lib/format'

interface EditPricesModalProps {
  menuItemId: string
  accountId: string          // solo para leer sales_channel.color (ver channelDotColor)
  productName: string
  basePrice: number          // menu_item.price (SIN IVA)
  vatRate: number
  brandName?: string         // solo cabecera ("{producto} · {marca}")
  onClose: () => void
  onSaved: () => void
}

function fmtEur(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n)
}

// "9,90" | "9.90" | "" → number | null
function parseNum(s: string): number | null {
  const t = s.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// ¿El input dice LO MISMO que lo guardado? Se compara por valor, no por cadena:
// teclear "15,90" sobre un guardado "15.9" no es un cambio pendiente, y marcarlo
// como "sin guardar" sería el mismo pecado al revés (anunciar un cambio que no
// existe). Vacío contra vacío = igual; vacío contra cifra = distinto.
function sameValue(a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true
  const na = parseNum(a)
  const nb = parseNum(b)
  if (na === null || nb === null) return false
  return Math.abs(na - nb) < 0.0001
}

// Identidad de terceros, NO paleta Folvy — por eso se permite el color aquí y en
// ningún otro sitio de la fila (ver sistema visual v1 §2).
//
// 🔴 DEUDA DECLARADA (17/08) — este mapa es FALLBACK, no fuente de verdad.
// La fuente de verdad es sales_channel.color. Hoy está a NULL en las 15 filas
// de las TRES cuentas de la BBDD (Foodint, Folvy Interno, Kitchen Grill LstQ),
// verificado por consulta, así que el fallback es lo único que pinta. Y ya
// falla: «Salón» (canal de Kitchen Grill LstQ) no lo caza ninguna regex y sale
// gris. Acoplar presentación al nombre que un tenant le puso a su canal es
// deuda silenciosa, y aparece justo en el frente de Fase 0, antes de admitir
// cliente 2. Disparador: poblar sales_channel.color (escritura, en laboratorio
// primero y con consulta de contraste delante) — hecho eso, este mapa se borra.
const CHANNEL_DOT_FALLBACK: Array<[RegExp, string]> = [
  [/glovo/i, '#F5C000'],
  [/just\s*eat/i, '#FF8000'],
  [/uber/i, '#111111'],
]
function channelDotColor(name: string, colorFromDb: string | null | undefined): string {
  if (colorFromDb) return colorFromDb          // sales_channel.color manda
  for (const [re, hex] of CHANNEL_DOT_FALLBACK) if (re.test(name)) return hex
  return '#B9BDC2'   // tinta-25: canal sin identidad conocida (Mostrador, Shop, Salón…)
}

// Salud del margen — el ÚNICO color fuerte de la pantalla. Se deriva solo de
// campos que ya calcula el servidor (netMargin, foodCostStatus): aquí no se
// inventa ningún umbral de negocio.
//
// ⚠️ DECISIÓN INTERINA (17/08, aprobada por Julio como tal):
//
//   foodCostStatus === 'over' es un sustituto interino del ámbar. No es lo
//   mismo que «margen apretado»: es coste de comida por encima del objetivo.
//   Las bandas de salud del margen (dónde acaba sano y empieza aprieta) son
//   una decisión de diseño pendiente, no un detalle de implementación.
//   Consecuencia asumida: hasta que haya escandallos, el ámbar no aparece.
//
function marginTone(row: ChannelEconomics | undefined, margin: number | null): string {
  if (margin === null) return 'text-tinta-25'
  if (margin < 0) return 'text-danger'
  if (row?.foodCostStatus === 'over') return 'text-warning'
  return 'text-success'
}

export default function EditPricesModal({
  menuItemId, accountId, productName, basePrice, vatRate, brandName, onClose, onSaved,
}: EditPricesModalProps) {
  const { visibleLocations } = useVisibleLocations()
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [channels, setChannels] = useState<ChannelEconomics[]>([])
  // Baseline SIN local (marca/base) -- solo se carga con un local elegido, para
  // saber a qué cae la cascada si se borra el override del local (regla de
  // Julio: el botón "Volver a..." tiene que nombrar el destino real).
  const [brandChannels, setBrandChannels] = useState<ChannelEconomics[]>([])
  const [defaultPrice, setDefaultPrice] = useState<string>(String(basePrice ?? 0))
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [avail, setAvail] = useState<Record<string, boolean>>({})
  const [live, setLive] = useState<ChannelEconomics[]>([])
  const [saving, setSaving] = useState(false)
  const [clearingChannelId, setClearingChannelId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Color de identidad del canal, de la BBDD. Reutiliza listSalesChannels (que ya
  // lee sales_channel.color) en vez de duplicar la consulta. Si falla, el
  // fallback por nombre cubre y el modal no se rompe por un adorno.
  const [channelColors, setChannelColors] = useState<Record<string, string | null>>({})

  useEffect(() => {
    let cancelled = false
    listSalesChannels(accountId)
      .then((cs) => {
        if (cancelled) return
        const m: Record<string, string | null> = {}
        for (const c of cs) m[c.id] = c.color
        setChannelColors(m)
      })
      .catch(() => { /* fallback por nombre */ })
    return () => { cancelled = true }
  }, [accountId])

  // Carga inicial (y recarga al cambiar de local): economía por canal en su
  // estado guardado PARA ESE ÁMBITO. Con local elegido, el input de precio se
  // siembra SOLO si hay override propio de ese local (is_location_override) —
  // no con el heredado, sería confundir "propio" con "heredado".
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const loads: Array<Promise<ChannelEconomics[]>> = [
      getMenuItemChannelEconomics(menuItemId, null, selectedLocationId ?? undefined),
    ]
    if (selectedLocationId) loads.push(getMenuItemChannelEconomics(menuItemId, null, undefined))
    Promise.all(loads)
      .then(([rows, brandRows]) => {
        if (cancelled) return
        setChannels(rows)
        setLive(rows)
        setBrandChannels(brandRows ?? [])
        const p: Record<string, string> = {}
        const a: Record<string, boolean> = {}
        for (const r of rows) {
          const seedFromThisScope = selectedLocationId ? r.isLocationOverride : r.priceSource === 'override'
          p[r.channelId] = seedFromThisScope ? String(r.price) : ''
          a[r.channelId] = r.isAvailable
        }
        setPrices(p)
        setAvail(a)
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Error cargando precios') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [menuItemId, selectedLocationId])

  // ── LA FUENTE DE VERDAD DE "LO GUARDADO" ──────────────────────────────────
  // Lo que devolvió la RPC, NUNCA el contenido de un input. Misma regla de
  // siembra que el efecto de carga, así que al abrir el modal prices ===
  // savedByChannel y no hay ni un cambio pendiente fantasma. Todo el resto de
  // la UI (los tres estados, el contador del pie, si Guardar está vivo) se
  // deriva de comparar prices contra ESTO.
  const savedByChannel = useMemo(() => {
    const m: Record<string, string> = {}
    for (const r of channels) {
      const own = selectedLocationId ? r.isLocationOverride : r.priceSource === 'override'
      m[r.channelId] = own ? String(r.price) : ''
    }
    return m
  }, [channels, selectedLocationId])

  const savedAvailByChannel = useMemo(() => {
    const m: Record<string, boolean> = {}
    for (const r of channels) m[r.channelId] = r.isAvailable
    return m
  }, [channels])

  // Precio efectivo tecleado por canal (propio si lo hay, si no el por defecto
  // -- SOLO en "Todos los locales": ahí el input de base es el motor en vivo
  // de los canales sin tocar. Con un local elegido no hay input de base que
  // previsualizar contra -- el servidor ya resuelve la cascada completa con
  // p_location_id, así que un canal sin teclear simplemente no entra en el
  // mapa de preview y el servidor calcula su cascada real.
  const previewKey = useMemo(() => {
    const map: Record<string, number> = {}
    const def = selectedLocationId ? null : parseNum(defaultPrice)
    for (const ch of channels) {
      const own = parseNum(prices[ch.channelId] ?? '')
      const eff = own ?? def
      if (eff !== null) map[ch.channelId] = eff
    }
    return map
  }, [channels, prices, defaultPrice, selectedLocationId])

  // Margen en vivo: re-pregunta al motor con los precios tecleados (debounce),
  // en el MISMO ámbito (local) que se está mostrando.
  useEffect(() => {
    if (channels.length === 0) return
    const handle = setTimeout(() => {
      getMenuItemChannelEconomics(menuItemId, previewKey, selectedLocationId ?? undefined)
        .then(setLive)
        .catch(() => { /* mantener lo último bueno */ })
    }, 300)
    return () => clearTimeout(handle)
  }, [menuItemId, previewKey, channels.length, selectedLocationId])

  // Agrupado por canal -- un canal con varias tarifas (own_delivery/platform_delivery/
  // pickup) trae varias filas a propósito, no son duplicados (ver menuOverrideService).
  // Los controles de precio/86 son del canal (una fila); el margen se agrupa aparte.
  const channelGroups = useMemo(() => groupChannelEconomicsByChannel(channels), [channels])

  const liveGroupsByCh = useMemo(() => {
    const m: Record<string, ChannelEconomics[]> = {}
    for (const g of groupChannelEconomicsByChannel(live)) m[g.channelId] = g.rows
    return m
  }, [live])

  const brandByCh = useMemo(() => {
    const m: Record<string, ChannelEconomics> = {}
    for (const r of brandChannels) m[r.channelId] = r
    return m
  }, [brandChannels])

  const defNum = parseNum(defaultPrice)
  const defPvp = defNum !== null ? Math.round(defNum * (1 + (vatRate ?? 0) / 100) * 100) / 100 : null

  // Cambios pendientes. Una fila cuenta UNA vez aunque le hayas tocado precio y
  // 86; el precio base cuenta como su propia fila. Con 0 pendientes, Guardar se
  // apaga: no hay nada que escribir.
  const dirtyBase = !selectedLocationId && defNum !== null && defNum !== basePrice
  const dirtyChannelIds = useMemo(() => {
    const s = new Set<string>()
    for (const g of channelGroups) {
      const id = g.rows[0].channelId
      const typed = !sameValue(prices[id] ?? '', savedByChannel[id] ?? '')
      const toggled = (avail[id] !== false) !== (savedAvailByChannel[id] !== false)
      if (typed || toggled) s.add(id)
    }
    return s
  }, [channelGroups, prices, savedByChannel, avail, savedAvailByChannel])
  const pendingCount = dirtyChannelIds.size + (dirtyBase ? 1 : 0)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      // 1) Precio por defecto -- SOLO en "Todos los locales" (ver cabecera).
      if (!selectedLocationId && defNum !== null && defNum !== basePrice) {
        await updateMenuItem(menuItemId, { price: defNum })
      }
      // 2) Override por canal, en el ámbito que la pantalla está mostrando. Un canal
      //    con varias filas (varios service_type) escribe UNA vez -- el override es
      //    del canal, no del modo de servicio.
      for (const g of channelGroups) {
        const ch = g.rows[0]
        const p = parseNum(prices[ch.channelId] ?? '')   // null = hereda
        const a = avail[ch.channelId] !== false
        if (p === null && a) {
          await clearMenuItemOverride({ menuItemId, channelId: ch.channelId, locationId: selectedLocationId })
        } else {
          await setMenuItemOverride({ menuItemId, channelId: ch.channelId, price: p, isAvailable: a, locationId: selectedLocationId })
        }
      }
      onSaved()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error guardando precios')
      setSaving(false)
    }
  }

  // "Volver al precio de marca/base" -- acción INMEDIATA (no espera al botón
  // Guardar general): borra solo la capa del local, nunca la de marca.
  async function handleClearLocal(channelId: string) {
    if (!selectedLocationId) return
    setClearingChannelId(channelId)
    setError(null)
    try {
      await clearMenuItemOverride({ menuItemId, channelId, locationId: selectedLocationId })
      const rows = await getMenuItemChannelEconomics(menuItemId, null, selectedLocationId)
      setChannels(rows)
      setLive(rows)
      setPrices((p) => ({ ...p, [channelId]: '' }))
      const row = rows.find((r) => r.channelId === channelId)
      if (row) setAvail((a) => ({ ...a, [channelId]: row.isAvailable }))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error volviendo al precio heredado')
    } finally {
      setClearingChannelId(null)
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving, onClose])

  const scoped = !!selectedLocationId

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !saving && onClose()}>
      <div className="bg-card rounded-xl shadow-lg w-full max-w-2xl border border-border-default max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>

        {/* ── Cabecera ── */}
        <div className="flex items-start justify-between px-5 py-3.5 border-b border-border-default">
          <div>
            <h2 className="font-display text-[17px] font-semibold text-tinta tracking-[-0.02em]">Editar precios</h2>
            <p className="text-[12.5px] text-tinta-45 mt-0.5">
              {productName}{brandName ? ` · ${brandName}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Cerrar"
            className="p-1.5 -mr-1.5 rounded-lg text-tinta-25 hover:text-tinta hover:bg-lavado disabled:opacity-50">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Franja de ámbito ──────────────────────────────────────────────
            Lo más importante del rediseño. Deja de ser un desplegable entre
            campos: es una franja entera, y en ámbito de un local va en TINTA
            (oscura). El objetivo es que sea imposible teclear un precio
            creyendo que aplica a todos los locales. La señal es el contraste
            de la propia tinta, no un color de marca. */}
        {visibleLocations.length > 0 && (
          <div className={`px-5 py-3 ${scoped ? 'bg-tinta' : 'bg-page border-b border-border-default'}`}>
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`text-[9.5px] font-semibold uppercase tracking-[.1em] ${scoped ? 'text-white/55' : 'text-tinta-45'}`}>
                Aplicar a
              </span>
              <select
                value={selectedLocationId ?? ''}
                onChange={(e) => setSelectedLocationId(e.target.value || null)}
                disabled={saving}
                className={`px-2.5 py-1.5 text-[13px] rounded-lg focus:outline-none focus:ring-2 disabled:opacity-50 ${
                  scoped
                    ? 'bg-[#25282D] border border-[#383C42] text-white focus:ring-white/20'
                    : 'bg-card border border-linea-fuerte text-tinta focus:ring-tinta/15'
                }`}
              >
                <option value="">Todos los locales</option>
                {visibleLocations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <span className={`text-[12px] ${scoped ? 'text-white/70' : 'text-tinta-45'}`}>
                {scoped ? (
                  <>Solo <strong className="font-semibold text-white">este local</strong>. Los demás no se tocan.</>
                ) : (
                  <>Vale para <strong className="font-semibold text-tinta">los {visibleLocations.length} locales</strong>.</>
                )}
              </span>
            </div>
          </div>
        )}

        {/* ── Cuerpo ── */}
        <div className="px-5 py-4 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-tinta-25">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <>
              {/* ── Precio base de la marca ──
                  En ámbito de un local se bloquea, pero CON SALIDA: el enlace
                  conmuta el selector al ámbito donde sí se puede editar.
                  Bloquear sin dar salida es un callejón. */}
              <div className={`flex items-start justify-between gap-4 pb-3.5 mb-3.5 border-b border-border-default
                ${dirtyBase ? '-mx-5 px-5 bg-[#FAFBFB] border-l-[3px] border-l-tinta' : ''}`}>
                <div className="min-w-0">
                  <div className={`text-[13px] font-medium ${scoped ? 'text-tinta-45' : 'text-tinta'}`}>
                    Precio base de la marca
                  </div>
                  <div className="text-[11px] text-tinta-45 mt-0.5">
                    {scoped ? (
                      <>
                        Es de toda la marca —{' '}
                        <button type="button" onClick={() => setSelectedLocationId(null)} disabled={saving}
                          className="underline font-semibold text-tinta hover:opacity-70 disabled:opacity-40">
                          cámbialo en «Todos los locales»
                        </button>
                      </>
                    ) : (
                      'Se aplica a los canales sin precio propio'
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-3 shrink-0">
                  <div className="text-right pt-0.5">
                    <div className="text-[9.5px] uppercase tracking-[.1em] text-tinta-45">PVP cliente</div>
                    <div className="font-mono tabular-nums text-[13px] text-tinta-70">{fmtEur(defPvp)}</div>
                  </div>
                  <div>
                    <input
                      value={defaultPrice}
                      onChange={(e) => setDefaultPrice(e.target.value)}
                      inputMode="decimal"
                      disabled={scoped}
                      className={`w-[122px] px-2.5 py-1.5 text-right font-mono tabular-nums text-[13px] rounded-lg
                        focus:outline-none focus:ring-2 focus:ring-tinta/15
                        ${scoped
                          ? 'bg-lavado border border-transparent text-tinta-25'
                          : `bg-card text-tinta ${dirtyBase ? 'border-[1.5px] border-dashed border-tinta font-semibold' : 'border border-linea-fuerte'}`}`}
                    />
                    <div className="text-[9.5px] text-tinta-45 text-right mt-0.5">SIN IVA</div>
                  </div>
                </div>
              </div>

              {/* ── Canales ── */}
              {channels.length === 0 ? (
                <p className="text-sm text-tinta-45 py-4">No hay canales de venta configurados para esta marca.</p>
              ) : (
                <div>
                  <div className="-mx-5 px-5 border-l-[3px] border-transparent">
                    <div className="grid grid-cols-[1fr_122px_106px_56px] gap-3 items-center pb-1.5 text-[9.5px] uppercase tracking-[.1em] text-tinta-45">
                      <span>Canal</span>
                      <span className="text-right">{scoped ? 'Precio aquí' : 'Precio'}</span>
                      <span className="text-right">Margen</span>
                      <span className="text-right">Disp.</span>
                    </div>
                  </div>

                  {channelGroups.map((g) => {
                    const ch = g.rows[0]
                    const liveRows = liveGroupsByCh[ch.channelId] ?? []
                    const lv = liveRows[0]
                    const otherLive = liveRows.slice(1)
                    const a = avail[ch.channelId] !== false
                    const own = prices[ch.channelId] ?? ''

                    // ── LOS TRES ESTADOS ──
                    // guardado viene del RPC (savedByChannel), tecleado de comparar
                    // el input contra él. Nunca al revés.
                    const saved = savedByChannel[ch.channelId] ?? ''
                    const typed = !sameValue(own, saved)
                    const hasSaved = saved !== ''
                    const state: 'A' | 'B' | 'C' = typed ? 'C' : hasSaved ? 'B' : 'A'
                    const rowDirty = dirtyChannelIds.has(ch.channelId)

                    // Estado A: de dónde Y cuánto hereda. Con local elegido la
                    // cascada cae al baseline de marca ya cargado (brandChannels);
                    // en ámbito marca, al precio base que se esté tecleando.
                    const brandCh = brandByCh[ch.channelId]
                    const inheritsFromBrandOverride = brandCh?.priceSource === 'override'
                    const inheritedAmount = scoped ? (brandCh?.price ?? null) : defNum
                    const inheritedLabel = scoped
                      ? (inheritsFromBrandOverride ? 'precio de la marca' : 'precio base')
                      : 'precio base'

                    const hasLocalOverride = scoped && ch.isLocationOverride
                    const margin = lv?.netMargin ?? null
                    const marginPct = lv?.netMarginPct ?? null
                    const modeLabel = lv?.serviceType ? (SERVICE_TYPE_LABEL[lv.serviceType] ?? lv.serviceType) : null

                    return (
                      <div key={ch.channelId}
                        className={`-mx-5 px-5 border-l-[3px] ${rowDirty ? 'bg-[#FAFBFB] border-l-tinta' : 'border-transparent'}`}>
                        <div className="grid grid-cols-[1fr_122px_106px_56px] gap-3 items-start py-2.5 border-b border-border-default last:border-0">

                          {/* Canal */}
                          <div className="min-w-0 pt-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span aria-hidden className="w-2 h-2 rounded-[2px] shrink-0"
                                style={{ backgroundColor: channelDotColor(ch.channelName, channelColors[ch.channelId]) }} />
                              <span className="text-[13px] font-medium text-tinta truncate">{ch.channelName}</span>
                            </div>
                            {lv?.serviceType === 'own_delivery' && (lv?.orderCostsPerItem ?? 0) > 0 && (
                              <div className="text-[11px] text-tinta-45 mt-0.5 pl-4">
                                + coste de canal est. <span className="font-mono tabular-nums">{fmtEur(lv?.orderCostsPerItem)}</span>
                              </div>
                            )}
                          </div>

                          {/* Precio — los tres estados */}
                          <div>
                            <input
                              value={own}
                              onChange={(e) => setPrices((p) => ({ ...p, [ch.channelId]: e.target.value }))}
                              placeholder={inheritedAmount !== null ? fmtNum(inheritedAmount) : ''}
                              inputMode="decimal"
                              aria-label={`Precio de ${ch.channelName}`}
                              className={`w-[122px] px-2.5 py-1.5 text-right font-mono tabular-nums text-[13px] rounded-lg
                                text-tinta placeholder:text-tinta-25 placeholder:font-normal
                                focus:outline-none focus:ring-2 focus:ring-tinta/15
                                ${state === 'C'
                                  ? 'bg-[#FCFCFD] border-[1.5px] border-dashed border-tinta font-semibold'
                                  : state === 'B'
                                    ? 'bg-card border-[1.5px] border-solid border-tinta font-semibold'
                                    : 'bg-card border border-linea-fuerte'}`}
                            />

                            {state === 'A' && (
                              <div className="text-right mt-1 leading-tight">
                                <div className="text-[11px] text-tinta-45">
                                  Hereda <span className="font-mono tabular-nums text-tinta-70">{fmtEur(inheritedAmount)}</span>
                                </div>
                                <div className="text-[11px] text-tinta-45">{inheritedLabel}</div>
                              </div>
                            )}

                            {state === 'B' && (
                              <div className="text-right mt-1">
                                <span className="inline-block px-1.5 py-0.5 rounded text-[9.5px] font-semibold uppercase tracking-[.06em] bg-lavado text-tinta border border-linea-fuerte">
                                  {scoped ? 'Propio de este local' : 'Precio propio del canal'}
                                </span>
                                <div className="text-[11px] text-tinta-45 mt-0.5">
                                  PVP <span className="font-mono tabular-nums">{fmtEur(lv?.priceWithVat)}</span>
                                </div>
                              </div>
                            )}

                            {state === 'C' && (
                              <div className="text-right mt-1">
                                <span className="inline-block px-1.5 py-0.5 rounded text-[9.5px] font-semibold uppercase tracking-[.06em] bg-tinta text-white">
                                  Sin guardar
                                </span>
                              </div>
                            )}

                            {/* Deshacer: nombra la cifra de destino, no "volver al
                                precio base" a secas. Acción inmediata (ver handleClearLocal). */}
                            {hasLocalOverride && (
                              <div className="text-right mt-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleClearLocal(ch.channelId)}
                                  disabled={clearingChannelId === ch.channelId || saving}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[7px] border border-tinta bg-card text-tinta text-[11.5px] font-semibold hover:bg-lavado disabled:opacity-40"
                                >
                                  {clearingChannelId === ch.channelId
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : <RotateCcw className="w-3 h-3" />}
                                  Volver a <span className="font-mono tabular-nums">{fmtEur(inheritedAmount)}</span>
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Margen — el único color fuerte de la pantalla.
                              Modo dominante arriba (más pedidos en 30d), el resto
                              en sub-líneas; un modo con 0 pedidos se atenúa y lo dice. */}
                          <div className="text-right">
                            {modeLabel && (
                              <div className="text-[9px] uppercase tracking-[.06em] text-tinta-45 truncate">{modeLabel}</div>
                            )}
                            <div className={`font-mono tabular-nums text-[16px] font-semibold leading-tight ${marginTone(lv, margin)}`}>
                              {fmtEur(margin)}
                            </div>
                            <div className="text-[10.5px] text-tinta-45">
                              {marginPct != null ? `${marginPct}%` : ''}{lv && !lv.costAvailable ? ' · sin coste' : ''}
                            </div>
                            {otherLive.length > 0 && (
                              <div className="mt-1.5 pt-1.5 border-t border-border-default space-y-0.5">
                                {otherLive.map((o) => (
                                  <div key={`${o.channelId}-${o.serviceType ?? 'none'}`}
                                    className={`flex items-baseline justify-between gap-2 text-[10.5px] ${o.ordersLast30d === 0 ? 'opacity-[.42]' : ''}`}>
                                    <span className="text-tinta-45 truncate">
                                      {o.serviceType ? (SERVICE_TYPE_LABEL[o.serviceType] ?? o.serviceType) : '—'}
                                      {o.ordersLast30d === 0 ? ' · 0 ped.' : ''}
                                    </span>
                                    <span className="font-mono tabular-nums text-tinta-70 shrink-0">{fmtEur(o.netMargin)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Disponibilidad (86) — verde porque es dinero: el producto vende. */}
                          <div className="flex flex-col items-end gap-1 pt-1">
                            <button type="button"
                              onClick={() => setAvail((s) => ({ ...s, [ch.channelId]: !a }))}
                              role="switch" aria-checked={a}
                              aria-label={`Disponibilidad de ${ch.channelName}`}
                              className={`relative inline-flex h-[22px] w-[38px] items-center rounded-full transition-colors ${a ? 'bg-success' : 'bg-linea-fuerte'}`}>
                              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${a ? 'translate-x-[1.15rem]' : 'translate-x-0.5'}`} />
                            </button>
                            {scoped && (
                              <span className="text-[9px] text-tinta-45 text-center leading-tight">solo en<br />este local</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  <p className="text-[11px] text-tinta-45 pt-3 leading-relaxed">
                    El margen es el de contribución por plato menos los costes de pedido estimados (fija, rider, envío) en canales de reparto propio. Apagar la disponibilidad retira el plato de ese canal (86).
                  </p>
                </div>
              )}

              {error && <div className="mt-3 p-2.5 rounded-lg bg-danger-bg text-danger border border-danger/20 text-xs">{error}</div>}
            </>
          )}
        </div>

        {/* ── Pie ── */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-border-default bg-page rounded-b-xl">
          <span className={`text-[12px] ${pendingCount > 0 ? 'text-tinta font-semibold' : 'text-tinta-45'}`}>
            {pendingCount === 0
              ? 'Sin cambios sin guardar'
              : `${pendingCount} cambio${pendingCount === 1 ? '' : 's'} sin guardar`}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={saving}
              className="px-3 py-1.5 text-sm rounded-lg text-tinta-70 hover:bg-lavado disabled:opacity-50">
              Cancelar
            </button>
            <button type="button" onClick={handleSave} disabled={saving || loading || pendingCount === 0}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-lg font-medium transition-colors
                ${pendingCount === 0 || saving || loading
                  ? 'bg-lavado text-tinta-25 border border-border-default cursor-not-allowed'
                  : 'bg-tinta text-white hover:bg-accent-hover'}`}>
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Guardar cambios
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
