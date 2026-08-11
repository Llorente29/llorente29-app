// src/modules/pos/pages/TpvSalePage.tsx
//
// ENCARGO TPV T1 — pantalla de venta mostrador/para llevar (§2.1). Layout
// táctil: selector de marca, carril de categorías + rejilla de productos,
// panel de cuenta con total vivo, pop-up de modificadores/combo al tocar un
// producto con configuración, cantidad/nota/eliminar por línea, y los 3
// botones de la venta (Guardar cuenta / Comandar / Cobrar) + Entregado para
// cuentas ya cobradas. Lista de cuentas abiertas para recuperarlas.
//
// Principio rector: el camino del cajero es abrir → tocar → cobrar. Cero
// conceptos nuevos. Todo lo que no sea eso (nota de cocina, marca, canal) es
// secundario y discreto.

import { useEffect, useMemo, useState } from 'react'
import {
  Loader2, Plus, Minus, Trash2, ArrowLeft,
  Banknote, CreditCard, ClipboardList, Save, PackageCheck, ListChecks, MonitorOff,
} from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useOperativeLocation } from '@/modules/supply/hooks/useOperativeLocation'
import { listCategoriesWithProducts, type CatalogCategory, type CatalogProduct } from '@/modules/kitchen/services/brandCatalogService'
import {
  listPosBrandsForLocation, upsertPosSale, listOpenPosTickets, listChargedPendingDeliveryTickets,
  type PosBrand, type PosChannelKind, type OpenPosTicket, type PosLinePayload,
} from '@/modules/pos/services/posSaleService'
import PosItemConfigModal, { type PosConfiguredLine } from '@/modules/pos/components/PosItemConfigModal'
import PosLineNoteModal from '@/modules/pos/components/PosLineNoteModal'
import type { OrderLine } from '@/modules/shop/services/dishConfigService'

interface CartLine {
  key: string                 // clave local (no persiste)
  orderLine: OrderLine
  kitchenNote: string | null
  unitPrice: number
  totalPrice: number
  displayName: string
  summary: string[]
}

// Subconjunto de OpenPosTicket que handleDeliver necesita — así puede
// tomar tanto una fila del panel "Cuentas" como la venta recién cobrada
// (que aún no tiene status/orderStatus/total de vuelta del servidor
// re-formateados como OpenPosTicket, solo lo que upsertPosSale devolvió).
interface DeliverableTicket {
  id: string
  posShortCode: string | null
  brandId: string | null
  lines: PosLinePayload[]
}

// eslint-disable-next-line no-restricted-syntax -- n es un cálculo local (líneas/carrito), nunca dato crudo del servidor
function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' €' }

// T1.c (11/08): mismo token que /estacion y el kiosco KDS (kds_device_token
// en localStorage) — si esta tablet ya está pareada como estación, la venta
// queda trazada a ese dispositivo. Se lee una sola vez al montar; no hay
// pantalla de vinculación aquí (a diferencia de /estacion), el TPV vende
// igual sin token, solo pierde trazabilidad de dispositivo.
const DEVICE_TOKEN_KEY = 'kds_device_token'
function readDeviceToken(): string | null {
  try { return window.localStorage.getItem(DEVICE_TOKEN_KEY) } catch { return null }
}

export default function TpvSalePage({ onExit }: { onExit: () => void }) {
  const { activeAccountId } = useActiveAccount()
  const { operativeLocationId, isResolved, blocker, canChoose, chooseOptions, setManualLocation, loading: locLoading } = useOperativeLocation()
  const [deviceToken] = useState<string | null>(readDeviceToken)

  const [brands, setBrands] = useState<PosBrand[]>([])
  const [brandId, setBrandId] = useState<string | null>(null)
  const [categories, setCategories] = useState<CatalogCategory[]>([])
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null)
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [cart, setCart] = useState<CartLine[]>([])
  const [saleId, setSaleId] = useState<string | null>(null)
  const [channelKind, setChannelKind] = useState<PosChannelKind>('counter')
  const [configItem, setConfigItem] = useState<CatalogProduct | null>(null)
  // T1.d (11/08): tocar una línea del carrito abre su nota de cocina — cubre
  // también productos simples, que nunca pasan por PosItemConfigModal.
  const [noteEditKey, setNoteEditKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const [openTickets, setOpenTickets] = useState<OpenPosTicket[]>([])
  const [pendingDelivery, setPendingDelivery] = useState<OpenPosTicket[]>([])
  const [showTickets, setShowTickets] = useState(false)
  const [payMethodPick, setPayMethodPick] = useState(false)
  // T1.d (11/08): tras Cobrar, el "Entregado" de esa venta se ofrece aquí
  // mismo, a un toque — sin obligar a abrir el panel "Cuentas" para
  // encontrarla en "Cobradas, pendientes de entregar".
  const [chargedTicket, setChargedTicket] = useState<DeliverableTicket | null>(null)

  // ── Marcas del local ──
  useEffect(() => {
    if (!activeAccountId || !operativeLocationId) return
    let cancelled = false
    listPosBrandsForLocation(activeAccountId, operativeLocationId)
      .then(bs => { if (!cancelled) { setBrands(bs); if (bs.length > 0 && !brandId) setBrandId(bs[0].id) } })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Error cargando marcas.') })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, operativeLocationId])

  // ── Carta de la marca elegida ──
  useEffect(() => {
    if (!activeAccountId || !brandId) { setCategories([]); return }
    let cancelled = false
    setLoadingCatalog(true)
    listCategoriesWithProducts(activeAccountId, brandId)
      .then(cats => {
        if (cancelled) return
        setCategories(cats)
        setActiveCategoryId(cats[0]?.id ?? null)
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Error cargando la carta.') })
      .finally(() => { if (!cancelled) setLoadingCatalog(false) })
    return () => { cancelled = true }
  }, [activeAccountId, brandId])

  // ── Cuentas abiertas / pendientes de entregar ──
  function reloadTickets() {
    if (!activeAccountId || !operativeLocationId) return
    listOpenPosTickets(activeAccountId, operativeLocationId).then(setOpenTickets).catch(() => setOpenTickets([]))
    listChargedPendingDeliveryTickets(activeAccountId, operativeLocationId).then(setPendingDelivery).catch(() => setPendingDelivery([]))
  }
  useEffect(reloadTickets, [activeAccountId, operativeLocationId])

  const visibleProducts = useMemo(() => {
    const cat = categories.find(c => c.id === activeCategoryId)
    return (cat?.products ?? []).filter(p => p.isActive && p.isAvailable)
  }, [categories, activeCategoryId])

  const cartTotal = useMemo(() => cart.reduce((s, l) => s + l.totalPrice, 0), [cart])

  function addSimpleLine(p: CatalogProduct) {
    const orderLine: OrderLine = { menuItemId: p.id, name: p.name, productType: p.productType, quantity: 1, modifiers: [], combo: [] }
    setCart(prev => [...prev, {
      key: `${p.id}-${Date.now()}`, orderLine, kitchenNote: null,
      unitPrice: p.price, totalPrice: p.price, displayName: p.shortName ?? p.name, summary: [],
    }])
  }

  function handleProductTap(p: CatalogProduct) {
    if (p.productType === 'combo' || p.modifierGroupCount > 0) {
      setConfigItem(p)
    } else {
      addSimpleLine(p)
    }
  }

  function handleConfigured(product: CatalogProduct, line: PosConfiguredLine) {
    setCart(prev => [...prev, {
      key: `${product.id}-${Date.now()}`, orderLine: line.orderLine, kitchenNote: line.kitchenNote,
      unitPrice: line.unitPrice, totalPrice: line.totalPrice, displayName: product.shortName ?? product.name,
      summary: line.summary,
    }])
    setConfigItem(null)
  }

  function changeQty(key: string, delta: number) {
    setCart(prev => prev.map(l => {
      if (l.key !== key) return l
      const q = Math.max(1, l.orderLine.quantity + delta)
      return { ...l, orderLine: { ...l.orderLine, quantity: q }, totalPrice: l.unitPrice * q }
    }))
  }

  function removeLine(key: string) {
    setCart(prev => prev.filter(l => l.key !== key))
  }

  function loadTicket(t: OpenPosTicket) {
    // T1.d (11/08): antes recuperar una cuenta pisaba silenciosamente
    // cualquier línea sin guardar que hubiera en pantalla. Ahora se avisa.
    if (cart.length > 0) {
      const ok = window.confirm(
        `Hay ${cart.length} línea(s) sin guardar en pantalla. Si recuperas ${t.posShortCode ?? 'esta cuenta'} se descartan. ¿Continuar?`
      )
      if (!ok) return
    }
    setSaleId(t.id)
    setBrandId(t.brandId ?? brandId)
    setCart(t.lines.map((l, i) => ({
      key: `${l.menuItemId}-${i}-${Date.now()}`, orderLine: l, kitchenNote: l.kitchenNote,
      unitPrice: l.unitPrice, totalPrice: l.totalPrice, displayName: l.name, summary: l.summary ?? [],
    })))
    setChargedTicket(null)
    setShowTickets(false)
    setFlash(`Cuenta ${t.posShortCode ?? ''} recuperada.`)
  }

  async function runAction(action: 'save' | 'command' | 'charge', paymentMethod?: 'cash' | 'card') {
    if (!activeAccountId || !operativeLocationId) return
    if (cart.length === 0) { setError('La cuenta no tiene líneas.'); return }
    setSaving(true); setError(null)
    try {
      const lines: PosLinePayload[] = cart.map(l => ({
        ...l.orderLine, kitchenNote: l.kitchenNote, unitPrice: l.unitPrice, totalPrice: l.totalPrice, summary: l.summary,
      }))
      const res = await upsertPosSale({
        saleId, accountId: activeAccountId, locationId: operativeLocationId, brandId,
        channelKind, lines, action, paymentMethod, deviceToken,
      })
      // T1.d (11/08): las 3 acciones cierran el ciclo en pantalla — el
      // carrito ya no se queda "vivo" tras Guardar/Comandar (el bug real que
      // describe el encargo: el siguiente cliente heredaba las líneas del
      // anterior). Para seguir editando una cuenta guardada/comandada, se
      // recupera desde "Cuentas" (loadTicket ya soporta eso).
      if (action === 'save') setFlash(`Cuenta guardada · ${res.posShortCode ?? ''} — recupérala desde "Cuentas" para seguir editándola.`)
      if (action === 'command') setFlash(`Comandado · ${res.posShortCode ?? ''} — ya está en cocina.`)
      if (action === 'charge') {
        setFlash(null)
        setPayMethodPick(false)
        setChargedTicket({ id: res.saleId, posShortCode: res.posShortCode, brandId, lines })
      }
      setCart([]); setSaleId(null)
      reloadTickets()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error en el TPV.')
    } finally {
      setSaving(false)
    }
  }

  // "Entregado" actúa sobre una cuenta YA COBRADA que puede no ser la que hay
  // en pantalla — se le pasan sus propias líneas (t.lines), nunca el carrito
  // en curso (evita el bug de mandar p_lines=[] o las de otra cuenta). Sirve
  // tanto para el banner de "recién cobrada" (a un toque) como para la fila
  // del panel "Cuentas" → "Cobradas, pendientes de entregar".
  async function handleDeliver(t: DeliverableTicket) {
    if (!activeAccountId || !operativeLocationId) return
    setSaving(true); setError(null)
    try {
      await upsertPosSale({
        saleId: t.id, accountId: activeAccountId, locationId: operativeLocationId,
        brandId: t.brandId, channelKind, lines: t.lines, action: 'deliver',
      })
      setFlash(`Entregado ${t.posShortCode ?? ''} — stock descontado.`)
      if (chargedTicket?.id === t.id) setChargedTicket(null)
      reloadTickets()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error marcando Entregado.')
    } finally {
      setSaving(false)
    }
  }

  // ── Bloqueo de local ──
  if (locLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-page"><Loader2 className="animate-spin text-text-secondary" size={28} /></div>
  }
  if (!isResolved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page p-6">
        <div className="max-w-sm text-center space-y-4">
          <p className="text-text-primary font-medium">{blocker}</p>
          {canChoose && (
            <select
              className="w-full px-3 py-2.5 border border-border-default rounded-lg bg-card text-text-primary"
              onChange={e => setManualLocation(e.target.value)}
              defaultValue=""
            >
              <option value="" disabled>Elige un local…</option>
              {chooseOptions.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          )}
          <button onClick={onExit} className="text-sm text-text-secondary underline">Volver</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-page flex flex-col">
      {/* Cabecera */}
      <div className="flex items-center gap-3 px-4 py-3 bg-card border-b border-border-default shrink-0">
        <button onClick={onExit} className="w-9 h-9 rounded-full flex items-center justify-center text-text-secondary hover:bg-page transition-base" aria-label="Salir">
          <ArrowLeft size={20} />
        </button>
        <select
          value={brandId ?? ''} onChange={e => setBrandId(e.target.value)}
          className="flex-1 min-w-0 px-3 py-2 text-base font-medium border border-border-default rounded-lg bg-page text-text-primary"
        >
          {brands.length === 0 && <option value="">Sin marcas activas en este local</option>}
          {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button
          onClick={() => { const next = !showTickets; setShowTickets(next); if (next) reloadTickets() }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-border-default bg-card hover:bg-page transition-base shrink-0"
        >
          <ListChecks size={16} /> Cuentas ({openTickets.length}{pendingDelivery.length > 0 ? ` +${pendingDelivery.length}` : ''})
        </button>
        {!deviceToken && (
          // Discreto a propósito (T1.c): no bloquea la venta, solo lo hace
          // visible para quien mire la pantalla — un TPV que no sabe desde
          // qué dispositivo vende es algo que el dueño debería poder notar.
          <span
            title="Esta pantalla no está vinculada a un dispositivo Folvy — la venta se registra igual, sin trazabilidad de dispositivo. Vincular en Ajustes de pedidos → Dispositivos."
            className="hidden sm:inline-flex items-center gap-1 text-xs text-text-tertiary shrink-0"
          >
            <MonitorOff size={14} /> Sin dispositivo
          </span>
        )}
      </div>

      {error && <div className="px-4 py-2 bg-danger-bg text-danger text-sm border-b border-danger/20">{error}</div>}
      {flash && (
        <div className="px-4 py-2 bg-success-bg text-success text-sm border-b border-success/20 flex items-center justify-between">
          <span>{flash}</span>
          <button onClick={() => setFlash(null)} className="text-xs underline">cerrar</button>
        </div>
      )}
      {chargedTicket && (
        <div className="px-4 py-3 bg-success-bg border-b border-success/20 flex items-center justify-between gap-3">
          <span className="text-sm text-success font-medium">Cobrado · {chargedTicket.posShortCode ?? ''} — márcala Entregado cuando salga.</span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => void handleDeliver(chargedTicket)}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="animate-spin" size={15} /> : <PackageCheck size={15} />} Entregado
            </button>
            <button onClick={() => setChargedTicket(null)} className="text-xs text-text-secondary underline">Ahora no</button>
          </div>
        </div>
      )}

      {showTickets ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">Cuentas abiertas</h3>
          {openTickets.length === 0 && <p className="text-sm text-text-tertiary">Sin cuentas guardadas o comandadas sin cobrar.</p>}
          {openTickets.map(t => (
            <button key={t.id} onClick={() => loadTicket(t)}
              className="w-full text-left p-4 rounded-xl border border-border-default bg-card hover:border-accent transition-base flex items-center justify-between">
              <span>
                <span className="block font-semibold text-text-primary">{t.posShortCode ?? 'Cuenta'}</span>
                <span className="block text-xs text-text-secondary">{t.lines.length} línea(s) · {t.orderStatus === 'accepted' ? 'Comandado' : 'Guardado'}</span>
              </span>
              <span className="font-semibold text-text-primary">{eur(t.total)}</span>
            </button>
          ))}

          <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide pt-3">Cobradas, pendientes de entregar</h3>
          {pendingDelivery.length === 0 && <p className="text-sm text-text-tertiary">Ninguna.</p>}
          {pendingDelivery.map(t => (
            <div key={t.id} className="w-full p-4 rounded-xl border border-warning/30 bg-warning-bg flex items-center justify-between gap-3">
              <span>
                <span className="block font-semibold text-text-primary">{t.posShortCode ?? 'Cuenta'}</span>
                <span className="block text-xs text-text-secondary">{eur(t.total)} · cobrado</span>
              </span>
              <button
                onClick={() => void handleDeliver(t)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50"
              >
                <PackageCheck size={15} /> Entregado
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Categorías + productos */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex gap-2 px-3 py-2.5 overflow-x-auto bg-card border-b border-border-default shrink-0">
              {categories.map(c => (
                <button
                  key={c.id} onClick={() => setActiveCategoryId(c.id)}
                  className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-base ${activeCategoryId === c.id ? 'bg-accent text-text-on-accent' : 'bg-page text-text-secondary hover:text-text-primary'}`}
                >
                  {c.emoji ? `${c.emoji} ` : ''}{c.name}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {loadingCatalog ? (
                <div className="flex items-center justify-center py-16"><Loader2 className="animate-spin text-text-secondary" size={24} /></div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {visibleProducts.map(p => {
                    const brandColor = brands.find(b => b.id === brandId)?.color ?? '#7A5A12'
                    return (
                      <button
                        key={p.id} onClick={() => handleProductTap(p)}
                        className="rounded-2xl border border-border-default bg-card overflow-hidden text-left hover:border-accent transition-base active:scale-[0.98] shadow-sm"
                      >
                        {p.photoUrl ? (
                          <img src={p.photoUrl} alt="" className="w-full h-24 object-cover" />
                        ) : (
                          <div className="w-full h-24 flex items-center justify-center" style={{ backgroundColor: `${brandColor}22` }}>
                            <span className="text-sm font-bold text-center px-2" style={{ color: brandColor }}>{p.shortName ?? p.name}</span>
                          </div>
                        )}
                        <div className="p-2.5">
                          <p className="text-sm font-medium text-text-primary truncate">{p.shortName ?? p.name}</p>
                          <p className="text-sm font-semibold text-text-secondary">{eur(p.price)}</p>
                        </div>
                      </button>
                    )
                  })}
                  {!loadingCatalog && visibleProducts.length === 0 && (
                    <p className="col-span-full text-center text-sm text-text-tertiary py-10">Sin productos en esta categoría.</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Panel de cuenta */}
          <div className="w-[340px] shrink-0 bg-card border-l border-border-default flex flex-col">
            <div className="px-4 py-3 border-b border-border-default">
              <div className="flex gap-2">
                <button onClick={() => setChannelKind('counter')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-base ${channelKind === 'counter' ? 'bg-accent text-text-on-accent' : 'bg-page text-text-secondary'}`}>Mostrador</button>
                <button onClick={() => setChannelKind('takeaway')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-base ${channelKind === 'takeaway' ? 'bg-accent text-text-on-accent' : 'bg-page text-text-secondary'}`}>Para llevar</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
              {cart.length === 0 && <p className="text-sm text-text-tertiary text-center py-10">La cuenta está vacía.</p>}
              {cart.map(l => (
                <div key={l.key} className="p-3 rounded-xl border border-border-default bg-page">
                  <button type="button" onClick={() => setNoteEditKey(l.key)} className="w-full text-left">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-text-primary flex-1 min-w-0">{l.displayName}</span>
                      <span className="text-sm font-semibold text-text-primary shrink-0">{eur(l.totalPrice)}</span>
                    </div>
                    {l.summary.length > 0 && (
                      <p className="text-xs text-text-secondary mt-0.5 leading-snug">{l.summary.join(' · ')}</p>
                    )}
                    {l.kitchenNote ? (
                      <p className="text-xs text-warning mt-0.5 font-medium">Nota: {l.kitchenNote}</p>
                    ) : (
                      <p className="text-xs text-text-tertiary mt-0.5">+ Añadir nota de cocina</p>
                    )}
                  </button>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-2">
                      <button onClick={() => changeQty(l.key, -1)} className="w-7 h-7 rounded-full border border-border-default flex items-center justify-center text-text-secondary hover:bg-card"><Minus size={13} /></button>
                      <span className="min-w-[1.4em] text-center text-sm font-semibold text-text-primary">{l.orderLine.quantity}</span>
                      <button onClick={() => changeQty(l.key, 1)} className="w-7 h-7 rounded-full border border-border-default flex items-center justify-center text-text-secondary hover:bg-card"><Plus size={13} /></button>
                    </div>
                    <button onClick={() => removeLine(l.key)} className="text-text-tertiary hover:text-danger transition-base" aria-label="Eliminar"><Trash2 size={15} /></button>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-4 py-3 border-t border-border-default space-y-2.5">
              <div className="flex items-center justify-between text-base font-semibold text-text-primary">
                <span>Total</span><span>{eur(cartTotal)}</span>
              </div>

              {!payMethodPick ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => void runAction('save')} disabled={saving || cart.length === 0}
                      className="inline-flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50 transition-base">
                      <Save size={16} /> Guardar
                    </button>
                    <button onClick={() => void runAction('command')} disabled={saving || cart.length === 0}
                      className="inline-flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50 transition-base">
                      <ClipboardList size={16} /> Comandar
                    </button>
                  </div>
                  <button onClick={() => setPayMethodPick(true)} disabled={saving || cart.length === 0}
                    className="w-full py-4 rounded-xl text-base font-semibold bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
                    Cobrar
                  </button>
                </>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => void runAction('charge', 'cash')} disabled={saving}
                    className="inline-flex items-center justify-center gap-1.5 py-4 rounded-xl text-sm font-semibold bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50">
                    {saving ? <Loader2 className="animate-spin" size={16} /> : <Banknote size={16} />} Efectivo
                  </button>
                  <button onClick={() => void runAction('charge', 'card')} disabled={saving}
                    className="inline-flex items-center justify-center gap-1.5 py-4 rounded-xl text-sm font-semibold bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50">
                    {saving ? <Loader2 className="animate-spin" size={16} /> : <CreditCard size={16} />} Tarjeta
                  </button>
                  <button onClick={() => setPayMethodPick(false)} className="col-span-2 text-xs text-text-secondary underline py-1">Cancelar</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {configItem && activeAccountId && operativeLocationId && (
        <PosItemConfigModal
          accountId={activeAccountId} locationId={operativeLocationId} menuItemId={configItem.id}
          onClose={() => setConfigItem(null)}
          onAdd={line => handleConfigured(configItem, line)}
        />
      )}

      {noteEditKey && (() => {
        const l = cart.find(c => c.key === noteEditKey)
        if (!l) return null
        return (
          <PosLineNoteModal
            displayName={l.displayName}
            initialNote={l.kitchenNote}
            onClose={() => setNoteEditKey(null)}
            onSave={note => {
              setCart(prev => prev.map(c => c.key === noteEditKey ? { ...c, kitchenNote: note } : c))
              setNoteEditKey(null)
            }}
          />
        )
      })()}
    </div>
  )
}
