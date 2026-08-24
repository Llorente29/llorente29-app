// src/modules/kitchen/components/ProductPlacementSection.tsx
//
// Gestión de COLOCACIÓN del producto desde la ficha (sin salir de ella):
//   - MARCAS: el mismo producto/receta vendido en varias marcas (marcas
//     virtuales). Comparte la receta (coste único) y crea un menu_item por marca
//     con su PVP. Añadir copia el PVP de origen; quitar archiva el de esa marca.
//   - CATEGORÍA: asigna/cambia la categoría del producto en SU marca (1:1).
//
// El precio por canal (Glovo/Uber/JustEat/Shop) NO va aquí: es el frente de
// Overrides (menu_item_override), accionable en su sección de precios.

import { useEffect, useState } from 'react'
import { Store, MapPin, Plus, X, Loader2, Tag, Info } from 'lucide-react'
import {
  listBrandsForRecipe,
  listAccountBrands,
  addRecipeToBrand,
  archiveMenuItem,
  setMenuItemCategory,
  getMenuItemCategoryId,
  type RecipeBrandPresence,
  type AccountBrandLite,
} from '@/modules/kitchen/services/menuItemService'
import { listMenuCategories, type MenuCategory } from '@/modules/kitchen/services/menuCategoryService'
import ConfirmDialog from '@/components/ConfirmDialog'

interface Props {
  accountId: string
  menuItemId: string
  recipeItemId: string | null
  currentBrandId: string
  productName: string
  basePrice: number
  onChanged: () => void
  /** Se ha quitado de la carta el menu_item que se estaba viendo: la ficha que
   *  lo mostraba ya no tiene sujeto, así que el padre decide a dónde ir (a otro
   *  producto de la misma receta, o fuera). Sin esto, quitar el actual dejaría
   *  la pantalla mirando algo que ya no está en ninguna carta. */
  onRemovedCurrent?: () => void
}

function fmtEur(v: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v)
}

export default function ProductPlacementSection({
  accountId, menuItemId, recipeItemId, currentBrandId, productName, basePrice, onChanged,
  onRemovedCurrent,
}: Props) {
  const [presence, setPresence] = useState<RecipeBrandPresence[]>([])
  const [allBrands, setAllBrands] = useState<AccountBrandLite[]>([])
  const [cats, setCats] = useState<MenuCategory[]>([])
  const [currentCatId, setCurrentCatId] = useState<string>('')
  const [addBrandId, setAddBrandId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Quitar de carta pide confirmación: archiva el menu_item (deja de venderse)
  // y, si es el que estás viendo, además te saca de la ficha.
  const [confirmRemove, setConfirmRemove] = useState<RecipeBrandPresence | null>(null)

  async function reload() {
    setErr(null)
    try {
      const [pr, brs, cs, cat] = await Promise.all([
        recipeItemId ? listBrandsForRecipe(accountId, recipeItemId) : Promise.resolve([] as RecipeBrandPresence[]),
        listAccountBrands(accountId),
        listMenuCategories(accountId, currentBrandId),
        getMenuItemCategoryId(menuItemId).catch(() => null),
      ])
      setPresence(pr)
      setAllBrands(brs)
      setCats(cs)
      setCurrentCatId(cat ?? '')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    reload().finally(() => { if (cancelled) return })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuItemId, recipeItemId, currentBrandId, accountId])

  const presentBrandIds = new Set(presence.map((p) => p.brandId))
  const addableBrands = allBrands.filter((b) => !presentBrandIds.has(b.id))

  async function handleAdd() {
    if (!recipeItemId || addBrandId === '' || busy) return
    setBusy(true); setErr(null)
    try {
      await addRecipeToBrand({ accountId, recipeItemId, brandId: addBrandId, price: basePrice, name: productName })
      setAddBrandId('')
      await reload()
      onChanged()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Quita el producto de una carta archivando su menu_item. Antes esto se
  // negaba para la marca que estabas viendo ("no quitar la marca actual"), y
  // como la ficha SIEMPRE se abre dentro de una marca, el resultado era que
  // quitar un plato de su carta no se podía hacer desde ningún sitio.
  // Ahora sí se puede: se archiva igual y se avisa al padre para que reubique
  // la ficha, que era el problema real que aquel guard esquivaba.
  async function handleRemove(p: RecipeBrandPresence) {
    if (busy) return
    const wasCurrent = p.menuItemId === menuItemId
    setBusy(true); setErr(null)
    try {
      await archiveMenuItem(p.menuItemId)
      setConfirmRemove(null)
      if (wasCurrent && onRemovedCurrent) {
        onChanged()
        onRemovedCurrent()
        return   // la ficha se va a reubicar: no recargamos sobre un id muerto
      }
      await reload()
      onChanged()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleCategory(catId: string) {
    if (busy) return
    setBusy(true); setErr(null)
    setCurrentCatId(catId)
    try {
      await setMenuItemCategory(menuItemId, catId === '' ? null : catId)
      onChanged()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
      await reload()
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 py-3 text-sm text-stone-400"><Loader2 size={14} className="animate-spin" /> Cargando…</div>
  }

  return (
    <div className="space-y-5">
      {err && <div className="p-2.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs">{err}</div>}

      {/* MARCAS */}
      <div>
        <div className="text-[11px] uppercase tracking-wide text-stone-400 mb-2 flex items-center gap-1.5">
          <Store size={12} /> Marcas donde se vende
        </div>

        {recipeItemId ? (
          <>
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {presence.map((p) => {
                // "el que estás viendo" es ESTE menu_item, no "esta marca": la
                // misma receta puede estar dos veces en la misma marca (los
                // duplicados que deja la ingesta), y ahí hay que poder señalar
                // cuál se quita.
                const isCurrent = p.menuItemId === menuItemId
                return (
                  <span key={p.menuItemId}
                    className={`inline-flex items-center gap-2 text-sm pl-2.5 pr-1.5 py-1.5 rounded-lg ${isCurrent ? 'bg-accent/10 text-accent' : 'bg-stone-100 text-stone-700'}`}>
                    <span className="w-5 h-5 rounded bg-accent flex items-center justify-center text-white text-[10px] font-bold">
                      {p.brandName.charAt(0)}
                    </span>
                    {p.brandName}
                    <span className="text-stone-400 text-xs">{fmtEur(p.price)}</span>
                    {isCurrent && <span className="text-[10px] text-stone-400 px-1">actual</span>}
                    <button onClick={() => setConfirmRemove(p)} disabled={busy}
                      className="text-stone-400 hover:text-red-600 disabled:opacity-40"
                      title={isCurrent ? 'Quitar de esta carta' : `Quitar de ${p.brandName}`}
                      aria-label={isCurrent ? 'Quitar de esta carta' : `Quitar de ${p.brandName}`}>
                      <X size={14} />
                    </button>
                  </span>
                )
              })}
            </div>

            {addableBrands.length > 0 ? (
              <div className="flex items-center gap-2">
                <select value={addBrandId} onChange={(e) => setAddBrandId(e.target.value)} disabled={busy}
                  className="text-sm border border-stone-200 rounded-lg px-2.5 py-1.5 bg-stone-50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent">
                  <option value="">añadir a marca…</option>
                  {addableBrands.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}{b.ownershipType === 'licensed' ? ' (cedida)' : ''}</option>
                  ))}
                </select>
                <button onClick={handleAdd} disabled={busy || addBrandId === ''}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-40">
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />} Añadir
                </button>
              </div>
            ) : (
              <p className="text-xs text-stone-400">Está en todas tus marcas.</p>
            )}
            <p className="text-[11px] text-stone-400 mt-2">
              Comparten el mismo escandallo (coste único). Cada marca tiene su precio; al añadir se copia {fmtEur(basePrice)} como punto de partida.
            </p>
          </>
        ) : (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 p-3">
            <Info size={15} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              Vincula un escandallo (en «Escandallo y elaboración») para vender este producto en varias marcas: así el coste se calcula una sola vez y se comparte.
            </p>
          </div>
        )}
      </div>

      {/* CATEGORÍA */}
      <div>
        <div className="text-[11px] uppercase tracking-wide text-stone-400 mb-2 flex items-center gap-1.5">
          <Tag size={12} /> Categoría en esta marca
        </div>
        <select value={currentCatId} onChange={(e) => handleCategory(e.target.value)} disabled={busy}
          className="text-sm border border-stone-200 rounded-lg px-2.5 py-1.5 bg-stone-50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent">
          <option value="">Sin categoría</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ''}{c.name}</option>
          ))}
        </select>
      </div>

      {/* Ubicaciones (informativo; la disponibilidad por local llega en el frente de Overrides) */}
      <div>
        <div className="text-[11px] uppercase tracking-wide text-stone-400 mb-1.5 flex items-center gap-1.5">
          <MapPin size={12} /> Disponibilidad por local y canal
        </div>
        <p className="text-xs text-stone-400">Próximamente: agotar/activar y precio por local y por canal (Glovo · Uber · JustEat · Shop).</p>
      </div>

      {/* Confirmación de "quitar de carta". Se archiva el menu_item: el plato
          deja de venderse en esa carta, pero su escandallo y su histórico de
          ventas siguen intactos, y se puede volver a añadir. */}
      <ConfirmDialog
        open={confirmRemove !== null}
        title="Quitar de la carta"
        message={
          confirmRemove
            ? `¿Quitar «${productName}» de ${confirmRemove.brandName}? Dejará de venderse ahí.` +
              (confirmRemove.menuItemId === menuItemId
                ? ' Es el que estás viendo, así que saldrás de esta ficha.'
                : '') +
              ' El escandallo y las ventas ya registradas no se tocan, y puedes volver a añadirlo cuando quieras.'
            : ''
        }
        confirmLabel={busy ? 'Quitando…' : 'Quitar de la carta'}
        cancelLabel="Cancelar"
        tone="danger"
        busy={busy}
        onConfirm={() => { if (confirmRemove) void handleRemove(confirmRemove) }}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  )
}
