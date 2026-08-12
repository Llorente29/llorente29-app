// src/modules/pos/pages/TpvSalePage.tsx
//
// ENCARGO TPV T1 — pantalla de venta mostrador/para llevar (§2.1), con el
// sistema de diseño del TPV aplicado encima (T1.f, 11/08 —
// folvy_tpv_sistema_diseno_20260811.md). Tema oscuro propio (.tpv-root,
// src/modules/pos/theme/tpvTokens.css) — no toca el tema claro del resto
// del admin. Solo presentación: mismos RPC, mismos datos, mismo
// comportamiento que T1.d (ver ese historial para la lógica de negocio).
//
// 4 anchuras en un solo árbol de componentes (los breakpoints por defecto
// de Tailwind — md:768 lg:1024 xl:1280 — caen justo donde el documento los
// pone, no hizo falta breakpoint custom):
//   <768 (móvil/comandero): catálogo O cuenta a pantalla completa,
//     conmutador fijo abajo (mobileView).
//   768-1023 (tablet vertical): catálogo siempre visible + barra de total
//     siempre visible + panel de cuenta completo desplegable (cartSheetOpen).
//   1024-1279 (tablet horizontal, FORMATO DE REFERENCIA) y ≥1280
//     (escritorio): 3 columnas fijas, cuenta siempre visible a la derecha.
//
// Principio rector: el camino del cajero es abrir → tocar → cobrar. Cero
// conceptos nuevos. Todo lo que no sea eso (nota de cocina, marca, canal) es
// secundario y discreto.

import { useEffect, useMemo, useState } from 'react'
import {
  Loader2, Plus, Minus, Trash2, ArrowLeft,
  Banknote, CreditCard, ClipboardList, Save, PackageCheck, ListChecks, MonitorOff,
  UtensilsCrossed, Clock, User, X,
} from 'lucide-react'
import { supabase, isSupabaseEnabled } from '@/lib/supabase'
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
import '@/modules/pos/theme/tpvTokens.css'

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

// Botón de categoría (Tarea B.2): icono + texto, ≥82px. Mismo marcado para
// el carril horizontal (móvil/tablet vertical) y el vertical (tablet
// horizontal/escritorio) — solo cambia el contenedor que lo envuelve.
function CategoryButton({ cat, active, onClick }: { cat: CatalogCategory; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 w-[92px] lg:w-full min-h-tpv-cat rounded-tpv border flex flex-col items-center justify-center gap-1 px-1.5 py-2 text-center transition-base ${
        active ? 'bg-tpv-accent border-tpv-accent text-white' : 'bg-tpv-surface-2 border-tpv-line text-tpv-txt'
      }`}
    >
      {cat.emoji && <span className="text-2xl leading-none" aria-hidden>{cat.emoji}</span>}
      <span className="text-xs font-bold leading-tight line-clamp-2">{cat.name}</span>
    </button>
  )
}

export default function TpvSalePage({ onExit }: { onExit: () => void }) {
  const { activeAccountId, activeAccount } = useActiveAccount()
  const { operativeLocationId, isResolved, blocker, canChoose, chooseOptions, setManualLocation, loading: locLoading } = useOperativeLocation()
  const [deviceToken] = useState<string | null>(readDeviceToken)
  const [locationName, setLocationName] = useState<string | null>(null)

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

  // T1.f: <768 muestra catálogo O cuenta, nunca los dos — conmutador fijo
  // abajo. 768-1023 muestra el catálogo siempre y la cuenta como panel
  // inferior desplegable (cartSheetOpen), con el total siempre visible.
  const [mobileView, setMobileView] = useState<'catalog' | 'cart'>('catalog')
  const [cartSheetOpen, setCartSheetOpen] = useState(false)

  // ── Nombre del local (Tarea B.1: cabecera con local + cuenta) ──
  useEffect(() => {
    if (!operativeLocationId || !isSupabaseEnabled || !supabase) { setLocationName(null); return }
    let cancelled = false
    Promise.resolve(supabase.from('locations').select('name').eq('id', operativeLocationId).single())
      .then(({ data }) => { if (!cancelled) setLocationName((data?.name as string | undefined) ?? null) })
      .catch(() => { if (!cancelled) setLocationName(null) })
    return () => { cancelled = true }
  }, [operativeLocationId])

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
  // ENCARGO CODE (12/08): pasa operativeLocationId para que isAvailable
  // refleje product_availability real del local, no la columna muerta
  // menu_item.is_available — mismo fix que fix/tpv-disponibilidad-real,
  // portado aquí porque esta rama pinta su propia rejilla (atenuado +
  // "SIN STOCK" en vez de ocultar) sobre el mismo listCategoriesWithProducts.
  useEffect(() => {
    if (!activeAccountId || !brandId) { setCategories([]); return }
    let cancelled = false
    setLoadingCatalog(true)
    listCategoriesWithProducts(activeAccountId, brandId, operativeLocationId)
      .then(cats => {
        if (cancelled) return
        setCategories(cats)
        setActiveCategoryId(cats[0]?.id ?? null)
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Error cargando la carta.') })
      .finally(() => { if (!cancelled) setLoadingCatalog(false) })
    return () => { cancelled = true }
  }, [activeAccountId, brandId, operativeLocationId])

  // ── Cuentas abiertas / pendientes de entregar ──
  function reloadTickets() {
    if (!activeAccountId || !operativeLocationId) return
    listOpenPosTickets(activeAccountId, operativeLocationId).then(setOpenTickets).catch(() => setOpenTickets([]))
    listChargedPendingDeliveryTickets(activeAccountId, operativeLocationId).then(setPendingDelivery).catch(() => setPendingDelivery([]))
  }
  useEffect(reloadTickets, [activeAccountId, operativeLocationId])

  // Tarea B.3: "agotado → atenuado + etiqueta, NO desaparece" — ya no se
  // filtra por isAvailable (antes sí, se ocultaba directamente). Solo se
  // sigue ocultando lo archivado/inactivo (isActive), que es otra cosa.
  const visibleProducts = useMemo(() => {
    const cat = categories.find(c => c.id === activeCategoryId)
    return (cat?.products ?? []).filter(p => p.isActive)
  }, [categories, activeCategoryId])

  const cartTotal = useMemo(() => cart.reduce((s, l) => s + l.totalPrice, 0), [cart])
  const cartCount = useMemo(() => cart.reduce((s, l) => s + l.orderLine.quantity, 0), [cart])

  function addSimpleLine(p: CatalogProduct) {
    const orderLine: OrderLine = { menuItemId: p.id, name: p.name, productType: p.productType, quantity: 1, modifiers: [], combo: [] }
    setCart(prev => [...prev, {
      key: `${p.id}-${Date.now()}`, orderLine, kitchenNote: null,
      unitPrice: p.price, totalPrice: p.price, displayName: p.shortName ?? p.name, summary: [],
    }])
  }

  function handleProductTap(p: CatalogProduct) {
    if (!p.isAvailable) return
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
    setMobileView('catalog')
    setCartSheetOpen(false)
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
        // T1.f (§5 del sistema de diseño): "ningún mensaje afirma un
        // resultado que no se haya verificado" — no se dice "stock
        // descontado" desde aquí, el cliente no lo ha comprobado.
        setFlash(null)
        setPayMethodPick(false)
        setChargedTicket({ id: res.saleId, posShortCode: res.posShortCode, brandId, lines })
      }
      setCart([]); setSaleId(null)
      setMobileView('catalog'); setCartSheetOpen(false)
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
      setFlash(`Entregado ${t.posShortCode ?? ''}.`)
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
    return <div className="tpv-root min-h-screen flex items-center justify-center bg-tpv-bg"><Loader2 className="animate-spin text-tpv-txt-2" size={28} /></div>
  }
  if (!isResolved) {
    return (
      <div className="tpv-root min-h-screen flex items-center justify-center bg-tpv-bg p-6">
        <div className="max-w-sm text-center space-y-4">
          <p className="text-tpv-txt font-medium">{blocker}</p>
          {canChoose && (
            <select
              className="w-full min-h-tap px-3 border border-tpv-line rounded-tpv bg-tpv-surface-2 text-tpv-txt"
              onChange={e => setManualLocation(e.target.value)}
              defaultValue=""
            >
              <option value="" disabled>Elige un local…</option>
              {chooseOptions.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          )}
          <button onClick={onExit} className="min-h-tap-small text-sm text-tpv-txt-2 underline">Volver</button>
        </div>
      </div>
    )
  }

  // ── Cuerpo del panel de cuenta (Tarea B.4) — compartido por las 3
  // presentaciones (aside fijo en tablet-horizontal/escritorio, sheet
  // desplegable en tablet-vertical, pantalla completa en móvil): mismo
  // contenido, solo cambia el contenedor que lo envuelve. ──
  function cartPanelBody(showCloseButton: boolean, onClose?: () => void) {
    return (
      <>
        <div className="flex items-center justify-between px-4 py-3 border-b border-tpv-line shrink-0">
          <div className="flex gap-2 flex-1">
            <button onClick={() => setChannelKind('counter')} className={`flex-1 min-h-tap-small rounded-tpv text-sm font-bold transition-base ${channelKind === 'counter' ? 'bg-tpv-accent text-white' : 'bg-tpv-surface-2 text-tpv-txt-2'}`}>Mostrador</button>
            <button onClick={() => setChannelKind('takeaway')} className={`flex-1 min-h-tap-small rounded-tpv text-sm font-bold transition-base ${channelKind === 'takeaway' ? 'bg-tpv-accent text-white' : 'bg-tpv-surface-2 text-tpv-txt-2'}`}>Para llevar</button>
          </div>
          {showCloseButton && (
            <button onClick={onClose} aria-label="Cerrar cuenta" className="w-10 h-10 rounded-full flex items-center justify-center text-tpv-txt-2 hover:bg-tpv-surface-2 ml-2 shrink-0"><X size={20} /></button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 min-h-0">
          {cart.length === 0 && <p className="text-sm text-tpv-txt-2 text-center py-10">La cuenta está vacía.</p>}
          {cart.map(l => (
            <div key={l.key} className="p-3 rounded-tpv border border-tpv-line bg-tpv-surface-2">
              <button type="button" onClick={() => setNoteEditKey(l.key)} className="w-full text-left">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-tpv-name font-bold text-tpv-txt flex-1 min-w-0">{l.displayName}</span>
                  <span className="text-tpv-line-price font-extrabold text-tpv-txt shrink-0">{eur(l.totalPrice)}</span>
                </div>
                {l.summary.length > 0 && (
                  <p className="text-tpv-mod text-tpv-txt-2 mt-0.5 leading-snug">{l.summary.join(' · ')}</p>
                )}
                {l.kitchenNote ? (
                  <div className="mt-1.5 pl-2.5 border-l-4 border-tpv-note bg-tpv-note/10 rounded py-1">
                    <p className="text-xs font-extrabold uppercase text-tpv-note">{l.kitchenNote}</p>
                  </div>
                ) : (
                  <p className="text-xs text-tpv-txt-2 mt-1">+ Añadir nota de cocina</p>
                )}
              </button>
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-2">
                  <button onClick={() => changeQty(l.key, -1)} className="min-w-tap-small min-h-tap-small rounded-tpv border border-tpv-line flex items-center justify-center text-tpv-txt-2 hover:bg-tpv-surface"><Minus size={16} /></button>
                  <span className="min-w-[1.6em] text-center text-base font-extrabold text-tpv-txt">{l.orderLine.quantity}</span>
                  <button onClick={() => changeQty(l.key, 1)} className="min-w-tap-small min-h-tap-small rounded-tpv border border-tpv-line flex items-center justify-center text-tpv-txt-2 hover:bg-tpv-surface"><Plus size={16} /></button>
                </div>
                <button onClick={() => removeLine(l.key)} aria-label="Eliminar" className="min-w-tap-small min-h-tap-small rounded-tpv flex items-center justify-center text-tpv-txt-2 hover:text-tpv-danger hover:bg-tpv-danger/10 transition-base"><Trash2 size={18} /></button>
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-tpv-line space-y-2.5 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-tpv-txt-2">Total</span>
            <b className="text-tpv-total font-extrabold text-tpv-txt">{eur(cartTotal)}</b>
          </div>

          {!payMethodPick ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => void runAction('save')} disabled={saving || cart.length === 0}
                  className="inline-flex items-center justify-center gap-1.5 min-h-tap rounded-tpv text-sm font-bold border border-tpv-line bg-tpv-surface-2 text-tpv-txt hover:bg-tpv-surface disabled:opacity-50 transition-base">
                  <Save size={17} /> Guardar
                </button>
                <button onClick={() => void runAction('command')} disabled={saving || cart.length === 0}
                  className="inline-flex items-center justify-center gap-1.5 min-h-tap rounded-tpv text-sm font-bold border border-tpv-line bg-tpv-surface-2 text-tpv-txt hover:bg-tpv-surface disabled:opacity-50 transition-base">
                  <ClipboardList size={17} /> Comandar
                </button>
              </div>
              {/* Cobrar aislado (§3 anti-patrón 8: mínimo un botón de separación
                  entre acciones frecuentes y una crítica) — fila propia, sin
                  vecino destructivo. */}
              <button onClick={() => setPayMethodPick(true)} disabled={saving || cart.length === 0}
                className="w-full min-h-tap-critical rounded-tpv text-lg font-extrabold bg-tpv-ok text-white hover:opacity-90 disabled:opacity-50 transition-base">
                💶 COBRAR
              </button>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => void runAction('charge', 'cash')} disabled={saving}
                className="inline-flex items-center justify-center gap-1.5 min-h-tap-critical rounded-tpv text-base font-extrabold bg-tpv-ok text-white hover:opacity-90 disabled:opacity-50">
                {saving ? <Loader2 className="animate-spin" size={18} /> : <Banknote size={18} />} Efectivo
              </button>
              <button onClick={() => void runAction('charge', 'card')} disabled={saving}
                className="inline-flex items-center justify-center gap-1.5 min-h-tap-critical rounded-tpv text-base font-extrabold bg-tpv-ok text-white hover:opacity-90 disabled:opacity-50">
                {saving ? <Loader2 className="animate-spin" size={18} /> : <CreditCard size={18} />} Tarjeta
              </button>
              <button onClick={() => setPayMethodPick(false)} className="col-span-2 min-h-tap-small text-sm font-bold text-tpv-txt-2 underline">Cancelar cobro</button>
            </div>
          )}
        </div>
      </>
    )
  }

  return (
    <div className="tpv-root min-h-screen bg-tpv-bg text-tpv-txt flex flex-col overflow-hidden">
      {/* Cabecera — Tarea B.1: local + cuenta a la izquierda (antes solo se
          veía la marca, y Julio no sabía en qué cuenta estaba trabajando). */}
      <header className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 bg-tpv-surface border-b border-tpv-line shrink-0">
        <button onClick={onExit} className="w-10 h-10 rounded-full flex items-center justify-center text-tpv-txt-2 hover:bg-tpv-surface-2 transition-base shrink-0" aria-label="Salir">
          <ArrowLeft size={20} />
        </button>
        <div className="flex flex-col leading-tight min-w-0 shrink-0 max-w-[36vw] sm:max-w-none">
          <b className="text-base sm:text-lg font-extrabold text-tpv-txt truncate">{locationName ?? '—'}</b>
          <span className="text-[10px] sm:text-xs font-bold text-tpv-txt-2 uppercase tracking-wide truncate">
            {activeAccount?.name ?? ''}{activeAccount?.isInternal ? ' · laboratorio' : ''}
          </span>
        </div>
        <select
          value={brandId ?? ''} onChange={e => setBrandId(e.target.value)}
          className="min-h-tap-small px-2.5 sm:px-3 text-sm font-bold border border-tpv-line rounded-tpv bg-tpv-surface-2 text-tpv-txt shrink-0 max-w-[30vw] sm:max-w-none"
        >
          {brands.length === 0 && <option value="">Sin marcas</option>}
          {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <div className="flex-1" />
        {!deviceToken && (
          <span
            title="Esta pantalla no está vinculada a un dispositivo Folvy — la venta se registra igual, sin trazabilidad de dispositivo. Vincular en Ajustes de pedidos → Dispositivos."
            className="hidden md:inline-flex items-center gap-1.5 min-h-tap-small px-3 rounded-tpv border border-tpv-warn bg-tpv-warn/15 text-tpv-warn text-xs font-bold shrink-0"
          >
            <MonitorOff size={14} /> Sin dispositivo
          </span>
        )}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            onClick={() => setShowTickets(false)}
            className={`inline-flex items-center gap-1.5 min-h-tap-small px-2.5 sm:px-3 rounded-tpv text-xs sm:text-sm font-bold border transition-base ${!showTickets ? 'bg-tpv-accent border-tpv-accent text-white' : 'bg-tpv-surface-2 border-tpv-line text-tpv-txt-2'}`}
          >
            <UtensilsCrossed size={16} /> Vender
          </button>
          <button
            onClick={() => { setShowTickets(true); reloadTickets() }}
            className={`inline-flex items-center gap-1.5 min-h-tap-small px-2.5 sm:px-3 rounded-tpv text-xs sm:text-sm font-bold border transition-base ${showTickets ? 'bg-tpv-accent border-tpv-accent text-white' : 'bg-tpv-surface-2 border-tpv-line text-tpv-txt-2'}`}
          >
            <ListChecks size={16} /> Cuentas
            <span className="bg-tpv-note text-black text-xs font-extrabold rounded-full px-1.5">
              {openTickets.length}{pendingDelivery.length > 0 ? `+${pendingDelivery.length}` : ''}
            </span>
          </button>
        </div>
      </header>

      {error && <div className="px-4 py-2 bg-tpv-danger text-white text-sm font-bold border-b border-tpv-line">{error}</div>}
      {flash && (
        <div className="px-4 py-2 bg-tpv-ok text-white text-sm font-bold border-b border-tpv-line flex items-center justify-between">
          <span>{flash}</span>
          <button onClick={() => setFlash(null)} className="text-xs underline shrink-0 ml-3">cerrar</button>
        </div>
      )}
      {chargedTicket && (
        <div className="px-4 py-3 bg-tpv-ok/15 border-b border-tpv-ok flex items-center justify-between gap-3">
          <span className="text-sm text-tpv-txt font-bold">Cobrado · {chargedTicket.posShortCode ?? ''}</span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => void handleDeliver(chargedTicket)}
              disabled={saving}
              className="inline-flex items-center gap-1.5 min-h-tap-small px-4 rounded-tpv text-sm font-bold bg-tpv-ok text-white disabled:opacity-50"
            >
              {saving ? <Loader2 className="animate-spin" size={15} /> : <PackageCheck size={15} />} Entregado
            </button>
            <button onClick={() => setChargedTicket(null)} className="min-h-tap-small px-2 text-xs text-tpv-txt-2 underline">Ahora no</button>
          </div>
        </div>
      )}

      {showTickets ? (
        /* ── Tarea C: Cuentas — tarjetas, no listado de texto ── */
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex gap-2 mb-3 overflow-x-auto">
            <span className="min-h-tap-small px-4 rounded-tpv bg-white text-black text-sm font-extrabold flex items-center gap-2 shrink-0">
              Abiertas <span className="bg-black/10 rounded-full px-2 text-xs">{openTickets.length}</span>
            </span>
            <span className="min-h-tap-small px-4 rounded-tpv bg-tpv-surface-2 border border-tpv-line text-tpv-txt-2 text-sm font-extrabold flex items-center gap-2 shrink-0">
              Por entregar <span className="bg-black/20 rounded-full px-2 text-xs">{pendingDelivery.length}</span>
            </span>
          </div>

          {openTickets.length === 0 && pendingDelivery.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-tpv-txt-2 text-center">
              <span className="text-4xl">✓</span>
              <p className="text-sm">Sin cuentas abiertas — todo cobrado.</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {openTickets.map(t => {
              const minutes = Math.floor((Date.now() - new Date(t.openedAt).getTime()) / 60000)
              const overThreshold = minutes >= 30 // umbral fijo por ahora — configurable por local es T1.e/T2, no T1.f (presentación)
              return (
                <article key={t.id} className={`rounded-tpv border border-tpv-line bg-tpv-surface p-4 flex flex-col gap-3 ${t.orderStatus === 'accepted' ? 'border-l-8 border-l-tpv-warn' : 'border-l-8 border-l-tpv-accent'}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-tpv-code font-extrabold text-tpv-txt">{t.posShortCode ?? 'Cuenta'}</span>
                    <span className="text-tpv-amount font-extrabold text-tpv-txt">{eur(t.total)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-tpv border px-2.5 py-1 text-xs font-bold ${overThreshold ? 'border-tpv-warn text-tpv-warn bg-tpv-warn/15' : 'border-tpv-line text-tpv-txt-2 bg-tpv-surface-2'}`}>
                      <Clock size={13} /> {minutes} min
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-tpv border border-tpv-line bg-tpv-surface-2 px-2.5 py-1 text-xs font-bold text-tpv-txt-2">
                      🍽 {t.lineCount ?? '—'} líneas
                    </span>
                    {t.createdByName && (
                      <span className="inline-flex items-center gap-1.5 rounded-tpv border border-tpv-line bg-tpv-surface-2 px-2.5 py-1 text-xs font-bold text-tpv-txt-2">
                        <User size={13} /> {t.createdByName}
                      </span>
                    )}
                  </div>
                  <span className={`inline-flex items-center gap-1.5 self-start rounded-tpv px-2.5 py-1.5 text-xs font-extrabold ${t.orderStatus === 'accepted' ? 'bg-tpv-warn/20 text-tpv-warn' : 'bg-tpv-surface-2 text-tpv-txt-2'}`}>
                    {t.orderStatus === 'accepted' ? '🔥 Comandada · sin cobrar' : '💾 Guardada · no enviada a cocina'}
                  </span>
                  <div className="flex gap-2">
                    <button onClick={() => loadTicket(t)} className="flex-1 min-h-tap rounded-tpv border border-tpv-line bg-tpv-surface-2 text-tpv-txt text-sm font-bold hover:bg-tpv-surface transition-base">↩︎ Recuperar</button>
                  </div>
                </article>
              )
            })}

            {pendingDelivery.map(t => (
              <article key={t.id} className="rounded-tpv border border-tpv-line bg-tpv-surface p-4 flex flex-col gap-3 border-l-8 border-l-tpv-ok">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-tpv-code font-extrabold text-tpv-txt">{t.posShortCode ?? 'Cuenta'}</span>
                  <span className="text-tpv-amount font-extrabold text-tpv-txt">{eur(t.total)}</span>
                </div>
                {/* Verde como TEXTO pequeño no llega a 4,5:1 (misma familia de
                    problema que "blanco sobre --ok", medido por Julio 11/08) —
                    el semántico va en el fondo/tinte, el texto en blanco. */}
                <span className="inline-flex items-center gap-1.5 self-start rounded-tpv px-2.5 py-1.5 text-xs font-extrabold bg-tpv-ok/25 text-white">
                  ✓ Cobrada · falta entregar
                </span>
                <button
                  onClick={() => void handleDeliver(t)} disabled={saving}
                  className="min-h-tap-critical rounded-tpv bg-tpv-ok text-white text-base font-extrabold hover:opacity-90 disabled:opacity-50 transition-base"
                >
                  📦 Entregado
                </button>
              </article>
            ))}
          </div>
        </div>
      ) : (
        /* ── Tarea B: Vender ── */
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
          {/* Categorías — carril superior <lg, rail izquierdo ≥lg */}
          <nav className={`lg:hidden flex gap-2 px-3 py-2 overflow-x-auto bg-tpv-surface border-b border-tpv-line shrink-0 ${mobileView === 'cart' ? 'hidden' : ''}`}>
            {categories.map(c => (
              <CategoryButton key={c.id} cat={c} active={activeCategoryId === c.id} onClick={() => setActiveCategoryId(c.id)} />
            ))}
          </nav>
          <nav className="hidden lg:flex lg:flex-col w-[150px] shrink-0 bg-tpv-surface border-r border-tpv-line gap-2 p-2.5 overflow-y-auto">
            {categories.map(c => (
              <CategoryButton key={c.id} cat={c} active={activeCategoryId === c.id} onClick={() => setActiveCategoryId(c.id)} />
            ))}
          </nav>

          {/* Catálogo — a pantalla completa <lg cuando mobileView='catalog'; siempre visible ≥lg */}
          <div className={`flex-1 overflow-y-auto p-3 min-h-0 ${mobileView === 'cart' ? 'hidden lg:block' : ''}`}>
            {loadingCatalog ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="animate-spin text-tpv-txt-2" size={24} /></div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-3">
                {visibleProducts.map(p => {
                  const familyColor = brands.find(b => b.id === brandId)?.color || 'var(--tpv-accent)'
                  const longName = (p.shortName ?? p.name).length > 20
                  return (
                    <button
                      key={p.id}
                      onClick={() => handleProductTap(p)}
                      disabled={!p.isAvailable}
                      style={{ borderLeftColor: familyColor, borderLeftWidth: 6 }}
                      className={`relative min-h-tpv-product rounded-tpv border border-tpv-line bg-tpv-surface-2 text-left p-3 flex flex-col justify-between transition-base ${longName ? 'col-span-2' : ''} ${p.isAvailable ? 'active:scale-[0.98]' : 'opacity-55 cursor-not-allowed'}`}
                    >
                      {!p.isAvailable && (
                        <span className="absolute top-2 right-2 bg-tpv-danger text-white text-[10px] font-extrabold uppercase rounded px-1.5 py-0.5">Sin stock</span>
                      )}
                      <span className="text-tpv-name font-bold text-tpv-txt leading-tight">{p.shortName ?? p.name}</span>
                      <span className="text-tpv-tile-price font-extrabold text-tpv-txt">{eur(p.price)}</span>
                    </button>
                  )
                })}
                {!loadingCatalog && visibleProducts.length === 0 && (
                  <p className="col-span-full text-center text-sm text-tpv-txt-2 py-10">Sin productos en esta categoría.</p>
                )}
              </div>
            )}

            {/* Tablet vertical (md-lg): barra de total siempre visible + abrir cuenta completa */}
            <div className="hidden md:flex lg:hidden fixed inset-x-0 bottom-0 items-center justify-between gap-3 px-4 py-3 bg-tpv-surface border-t border-tpv-line">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-bold text-tpv-txt-2">Total</span>
                <b className="text-tpv-amount font-extrabold text-tpv-txt">{eur(cartTotal)}</b>
              </div>
              <button onClick={() => setCartSheetOpen(true)} className="min-h-tap px-5 rounded-tpv bg-tpv-accent text-white text-sm font-extrabold">
                Ver cuenta ({cartCount})
              </button>
            </div>
          </div>

          {/* Escritorio/tablet horizontal (≥lg): cuenta siempre visible a la derecha */}
          <aside className="hidden lg:flex lg:w-[390px] lg:shrink-0 lg:flex-col bg-tpv-surface border-l border-tpv-line">
            {cartPanelBody(false)}
          </aside>

          {/* Tablet vertical (md-lg): sheet desplegable de cuenta completa */}
          {cartSheetOpen && (
            <div className="hidden md:flex lg:hidden fixed inset-0 z-40 bg-tpv-surface flex-col">
              {cartPanelBody(true, () => setCartSheetOpen(false))}
            </div>
          )}

          {/* Móvil (<md): cuenta a pantalla completa cuando mobileView='cart' */}
          {mobileView === 'cart' && (
            <div className="md:hidden flex-1 flex flex-col overflow-hidden">
              {cartPanelBody(false)}
            </div>
          )}

          {/* Móvil (<md): conmutador fijo abajo — máximo 2 acciones aquí, dentro del límite de 4 de la Tarea E */}
          <div className="md:hidden flex items-stretch gap-2 p-2 bg-tpv-surface border-t border-tpv-line shrink-0">
            <button
              onClick={() => setMobileView('catalog')}
              className={`flex-1 min-h-tap rounded-tpv text-sm font-bold flex items-center justify-center gap-2 transition-base ${mobileView === 'catalog' ? 'bg-tpv-accent text-white' : 'bg-tpv-surface-2 text-tpv-txt-2'}`}
            >
              <UtensilsCrossed size={18} /> Catálogo
            </button>
            <button
              onClick={() => setMobileView('cart')}
              className={`flex-1 min-h-tap rounded-tpv text-sm font-bold flex items-center justify-center gap-2 transition-base ${mobileView === 'cart' ? 'bg-tpv-accent text-white' : 'bg-tpv-surface-2 text-tpv-txt-2'}`}
            >
              💳 Cuenta · {eur(cartTotal)}
            </button>
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
