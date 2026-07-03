// src/modules/shop/cart/ShopCartContext.tsx
//
// Estado del carrito de Folvy Shop. Multimarca con una sola entrega. Regla dura
// "mismo local = una entrega" (patrón Otter Multi-Store / Glovo / Uber).
//
// MULTI-LOCAL (01/07): el carrito ya NO fija "el primer local de la marca". En su
// lugar mantiene los LOCALES CANDIDATOS = intersección de los locales donde operan
// TODAS las marcas del carrito. El local concreto (locationId) se ELIGE en el
// checkout: en recogida lo elige el cliente entre los candidatos; a domicilio lo
// resuelve la zona que cubre su dirección. Si solo hay un candidato, se fija solo.
//
// Persistente en localStorage por slug.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ConfiguredLine } from '@/modules/shop/components/DishConfigModal'
import { toOrderLine, type OrderLine } from '@/modules/shop/services/dishConfigService'

// ── Modelo ──────────────────────────────────────────────────────────────

export interface CartLine {
  lineId: string
  brandId: string
  brandName: string
  brandLocationIds: string[]     // locales donde opera la marca de esta línea (para recalcular candidatos)
  menuItemId: string
  name: string
  photoUrl: string | null
  unitPrice: number
  quantity: number
  summary: string[]
  allergens: { code: string; nameEs: string }[]
  order: OrderLine
  discount?: number
}

export interface ShopCart {
  slug: string
  locationId: string | null            // local ELEGIDO (null = aún sin elegir / carrito vacío)
  candidateLocationIds: string[]       // locales posibles (intersección de las marcas del carrito)
  lines: CartLine[]
}

export interface CartTotals {
  itemsCount: number
  subtotal: number
  discount: number
  deliveryFee: number
  total: number
}

interface CartApi {
  cart: ShopCart
  totals: CartTotals
  addLine: (line: ConfiguredLine, brandId: string, brandName: string, brandLocationIds: string[]) => { ok: boolean; reason?: 'other_location' }
  setLineQty: (lineId: string, qty: number) => void
  removeLine: (lineId: string) => void
  clear: () => void
  canAddBrand: (brandLocationIds: string[]) => boolean
  // Fija el local elegido (checkout). Debe ser uno de los candidatos.
  setLocation: (locationId: string) => void
  // Reemplaza el carrito entero desde un reorder (Mi cuenta): fija el local del
  // pedido original y crea líneas ligeras (precio de HOY vía dry-run). Ver F4·T1.
  replaceCart: (locationId: string, items: ReorderCartItem[]) => void
}

// Ítem mínimo para reconstruir el carrito desde un reorder. El precio unitario
// viene del dry-run (precio de hoy); el resto de metadatos de marca no viajan en
// el payload canónico (OrderLine) y no hacen falta para el checkout.
export interface ReorderCartItem {
  order: OrderLine
  name: string
  quantity: number
  unitPrice: number
  brandId?: string
  brandName?: string
  photoUrl?: string | null
}

const ShopCartContext = createContext<CartApi | null>(null)

function storageKey(slug: string): string { return `folvy-shop-cart:${slug}` }

// Intersección de dos listas de ids (orden estable del primero).
function intersect(a: string[], b: string[]): string[] {
  const setB = new Set(b)
  return a.filter((x) => setB.has(x))
}

// Candidatos = intersección de los brandLocationIds de todas las líneas.
function computeCandidates(lines: CartLine[]): string[] {
  if (lines.length === 0) return []
  let acc = lines[0].brandLocationIds ?? []
  for (let i = 1; i < lines.length; i++) acc = intersect(acc, lines[i].brandLocationIds ?? [])
  return acc
}

// Local elegido válido: si el actual sigue entre candidatos, se mantiene; si solo
// hay un candidato, ese; si no, null (a elegir en checkout).
function resolveChosen(current: string | null, candidates: string[]): string | null {
  if (current && candidates.includes(current)) return current
  if (candidates.length === 1) return candidates[0]
  return null
}

function loadCart(slug: string): ShopCart {
  try {
    const raw = localStorage.getItem(storageKey(slug))
    if (raw) {
      const parsed = JSON.parse(raw) as ShopCart
      if (parsed && parsed.slug === slug && Array.isArray(parsed.lines)) {
        // Descarta líneas antiguas sin payload canónico o sin brandLocationIds (no pedibles/no enrutar).
        const lines = parsed.lines.filter((l) => l && (l as CartLine).order != null && Array.isArray((l as CartLine).brandLocationIds))
        const candidates = computeCandidates(lines)
        return { slug, lines, candidateLocationIds: candidates, locationId: resolveChosen(parsed.locationId ?? null, candidates) }
      }
    }
  } catch { /* ignore */ }
  return { slug, locationId: null, candidateLocationIds: [], lines: [] }
}

function saveCart(cart: ShopCart) {
  try { localStorage.setItem(storageKey(cart.slug), JSON.stringify(cart)) } catch { /* ignore */ }
}

let lineSeq = 0
function newLineId(): string { return `${Date.now()}-${lineSeq++}` }

export function ShopCartProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [cart, setCart] = useState<ShopCart>(() => loadCart(slug))

  useEffect(() => { saveCart(cart) }, [cart])
  useEffect(() => { setCart(loadCart(slug)) }, [slug])

  // ¿Comparte esta marca al menos un local con los candidatos actuales?
  function canAddBrand(brandLocationIds: string[]): boolean {
    if (cart.lines.length === 0) return true
    return intersect(cart.candidateLocationIds, brandLocationIds).length > 0
  }

  function addLine(line: ConfiguredLine, brandId: string, brandName: string, brandLocationIds: string[]) {
    if (cart.lines.length > 0 && intersect(cart.candidateLocationIds, brandLocationIds).length === 0) {
      return { ok: false, reason: 'other_location' as const }
    }
    setCart((prev) => {
      const newLine: CartLine = {
        lineId: newLineId(),
        brandId, brandName,
        brandLocationIds,
        menuItemId: line.menuItemId,
        name: line.name,
        photoUrl: line.photoUrl,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        summary: line.summary,
        allergens: line.allergens.map((a) => ({ code: a.code, nameEs: a.nameEs })),
        order: toOrderLine(line.config, line.selection),
      }
      const lines = [...prev.lines, newLine]
      const candidates = computeCandidates(lines)
      return { ...prev, lines, candidateLocationIds: candidates, locationId: resolveChosen(prev.locationId, candidates) }
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
      const candidates = computeCandidates(lines)
      return { ...prev, lines, candidateLocationIds: candidates, locationId: resolveChosen(prev.locationId, candidates) }
    })
  }

  function clear() {
    setCart({ slug, locationId: null, candidateLocationIds: [], lines: [] })
  }

  function setLocation(locationId: string) {
    setCart((prev) => (prev.candidateLocationIds.includes(locationId) ? { ...prev, locationId } : prev))
  }

  // Reorder (Mi cuenta): sustituye el carrito por las líneas del pedido original,
  // fijando su local. Cada línea se ancla a ese local (brandLocationIds=[locationId])
  // para que candidatos y la regla "mismo local" queden consistentes; el checkout
  // revalida zona/precio como en un pedido normal.
  function replaceCart(locationId: string, items: ReorderCartItem[]) {
    const lines: CartLine[] = items.map((it) => ({
      lineId: newLineId(),
      brandId: it.brandId ?? '',
      brandName: it.brandName ?? '',
      brandLocationIds: [locationId],
      menuItemId: it.order.menuItemId,
      name: it.name,
      photoUrl: it.photoUrl ?? null,
      unitPrice: it.unitPrice,
      quantity: it.quantity,
      summary: [],
      allergens: [],
      order: { ...it.order, quantity: it.quantity },
    }))
    setCart({ slug, locationId, candidateLocationIds: [locationId], lines })
  }

  const totals = useMemo<CartTotals>(() => {
    let subtotal = 0, discount = 0, count = 0
    for (const l of cart.lines) {
      subtotal += l.unitPrice * l.quantity
      discount += (l.discount ?? 0)
      count += l.quantity
    }
    return { itemsCount: count, subtotal, discount, deliveryFee: 0, total: subtotal - discount }
  }, [cart])

  const api: CartApi = { cart, totals, addLine, setLineQty, removeLine, clear, canAddBrand, setLocation, replaceCart }
  return <ShopCartContext.Provider value={api}>{children}</ShopCartContext.Provider>
}

export function useShopCart(): CartApi {
  const ctx = useContext(ShopCartContext)
  if (!ctx) throw new Error('useShopCart fuera de ShopCartProvider')
  return ctx
}
