// src/modules/shop/cart/ShopCartContext.tsx
//
// Estado del carrito de Folvy Shop. Multimarca con una sola entrega: el carrito
// FIJA un local con el primer plato añadido; sólo admite marcas que operen en
// ese local (regla dura "mismo local = una entrega", patrón Otter Multi-Store /
// Glovo / Uber). Persistente en localStorage por slug.
//
// Cada línea conserva además su payload canónico de pedido (`order`), generado
// al añadir desde (config + selección). Ese payload es lo que el checkout manda
// a place_shop_order para REPRECIAR en servidor y crear las líneas canónicas.
//
// ANCLAS DE DISEÑO previstas (huecos estructurales, no construidos aún; aquí
// para que enchufarlos luego no rompa nada):
//   - descuentos/promos: CartTotals.discount + por línea line.discount
//   - métodos de pago (Bizum, wallets) vía Stripe: se resuelven en el checkout,
//     el carrito sólo aporta el importe.
//   - cliente (invitado vs registrado / fidelización / datos guardados): el
//     carrito no guarda cliente; lo añade el checkout. Campo reservado abajo.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ConfiguredLine } from '@/modules/shop/components/DishConfigModal'
import { toOrderLine, type OrderLine } from '@/modules/shop/services/dishConfigService'

// ── Modelo ──────────────────────────────────────────────────────────────

export interface CartLine {
  lineId: string                 // id único de la línea (no del plato: dos config distintas = 2 líneas)
  brandId: string
  brandName: string
  menuItemId: string
  name: string
  photoUrl: string | null
  unitPrice: number
  quantity: number
  summary: string[]              // configuración elegida, líneas legibles
  allergens: { code: string; nameEs: string }[]
  order: OrderLine               // payload canónico para place_shop_order (reprecio server-side)
  discount?: number              // ANCLA promos: descuento € sobre esta línea (futuro)
}

export interface ShopCart {
  slug: string
  locationId: string | null      // local fijado (null = carrito vacío)
  lines: CartLine[]
}

export interface CartTotals {
  itemsCount: number
  subtotal: number
  discount: number               // ANCLA promos: descuento total (futuro)
  deliveryFee: number            // se rellena en checkout cuando hay dirección/zona
  total: number
}

interface CartApi {
  cart: ShopCart
  totals: CartTotals
  // brandLocationIds: locales activos de la marca que se intenta añadir (regla mismo local)
  addLine: (line: ConfiguredLine, brandId: string, brandName: string, brandLocationIds: string[]) => { ok: boolean; reason?: 'other_location' }
  setLineQty: (lineId: string, qty: number) => void
  removeLine: (lineId: string) => void
  clear: () => void
  // utilidad para la UI: ¿puedo añadir de esta marca? (mismo local)
  canAddBrand: (brandLocationIds: string[]) => boolean
}

const ShopCartContext = createContext<CartApi | null>(null)

function storageKey(slug: string): string { return `folvy-shop-cart:${slug}` }

function loadCart(slug: string): ShopCart {
  try {
    const raw = localStorage.getItem(storageKey(slug))
    if (raw) {
      const parsed = JSON.parse(raw) as ShopCart
      if (parsed && parsed.slug === slug && Array.isArray(parsed.lines)) {
        // Descarta líneas de versiones antiguas sin payload canónico (no se pueden pedir).
        const lines = parsed.lines.filter((l) => l && (l as CartLine).order != null)
        return { slug, locationId: lines.length === 0 ? null : parsed.locationId, lines }
      }
    }
  } catch { /* ignore */ }
  return { slug, locationId: null, lines: [] }
}

function saveCart(cart: ShopCart) {
  try { localStorage.setItem(storageKey(cart.slug), JSON.stringify(cart)) } catch { /* ignore */ }
}

let lineSeq = 0
function newLineId(): string { return `${Date.now()}-${lineSeq++}` }

export function ShopCartProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [cart, setCart] = useState<ShopCart>(() => loadCart(slug))

  // Persistir en cada cambio
  useEffect(() => { saveCart(cart) }, [cart])

  // Si cambia el slug (otra tienda), recargar su carrito
  useEffect(() => { setCart(loadCart(slug)) }, [slug])

  function canAddBrand(brandLocationIds: string[]): boolean {
    if (cart.locationId === null) return true               // carrito vacío: cualquier marca
    return brandLocationIds.includes(cart.locationId)        // misma entrega: la marca opera en el local fijado
  }

  function addLine(line: ConfiguredLine, brandId: string, brandName: string, brandLocationIds: string[]) {
    // Regla mismo local
    if (cart.locationId !== null && !brandLocationIds.includes(cart.locationId)) {
      return { ok: false, reason: 'other_location' as const }
    }
    setCart((prev) => {
      // Fijar local si era el primer plato: usar el local ya fijado, o el primero de la marca
      const locId = prev.locationId ?? brandLocationIds[0] ?? null
      const newLine: CartLine = {
        lineId: newLineId(),
        brandId, brandName,
        menuItemId: line.menuItemId,
        name: line.name,
        photoUrl: line.photoUrl,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        summary: line.summary,
        allergens: line.allergens.map((a) => ({ code: a.code, nameEs: a.nameEs })),
        order: toOrderLine(line.config, line.selection),
      }
      return { ...prev, locationId: locId, lines: [...prev.lines, newLine] }
    })
    return { ok: true }
  }

  function setLineQty(lineId: string, qty: number) {
    setCart((prev) => ({
      ...prev,
      lines: prev.lines.map((l) => l.lineId === lineId
        ? { ...l, quantity: Math.max(1, qty), order: { ...l.order, quantity: Math.max(1, qty) } }
        : l),
    }))
  }

  function removeLine(lineId: string) {
    setCart((prev) => {
      const lines = prev.lines.filter((l) => l.lineId !== lineId)
      return { ...prev, lines, locationId: lines.length === 0 ? null : prev.locationId }
    })
  }

  function clear() {
    setCart({ slug, locationId: null, lines: [] })
  }

  const totals = useMemo<CartTotals>(() => {
    let subtotal = 0
    let discount = 0
    let count = 0
    for (const l of cart.lines) {
      subtotal += l.unitPrice * l.quantity
      discount += (l.discount ?? 0)
      count += l.quantity
    }
    const deliveryFee = 0  // se fija en checkout con la zona/dirección
    return {
      itemsCount: count,
      subtotal,
      discount,
      deliveryFee,
      total: subtotal - discount + deliveryFee,
    }
  }, [cart])

  const api: CartApi = { cart, totals, addLine, setLineQty, removeLine, clear, canAddBrand }
  return <ShopCartContext.Provider value={api}>{children}</ShopCartContext.Provider>
}

export function useShopCart(): CartApi {
  const ctx = useContext(ShopCartContext)
  if (!ctx) throw new Error('useShopCart fuera de ShopCartProvider')
  return ctx
}
