// src/modules/kitchen/pages/KitchenCasadoPage.tsx
//
// Cockpit "Casado" — frente de trazabilidad ítem↔escandallo. UN solo sitio,
// en lenguaje de cocina, que responde "¿está cada plato bien casado y qué
// hago?" de un vistazo. No añade lógica de casado nueva: traduce y ordena
// por impacto lo que ya construyó el backend (menu_item_link_health).
//
// 5 estados humanos (Bien / Para revisar / Falta escandallo / Falta precio /
// Sin casar) vía classifyMenuItemLink — nunca la jerga técnica en pantalla.
// El eje es recipe_item.type (dish vs raw), no nombre/categoría/juicio de
// cocina. Un plato "Bien" nunca queda bloqueado: Cambiar/Quitar siempre
// visibles; cambiar la receta de un aprobado lo devuelve a "Para revisar"
// (lo hace la RPC set_menu_item_recipe; aquí solo se avisa y se refresca).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Check, ChefHat, Clock, Euro, Link2, Loader2, Plus, RefreshCw, Search, X } from 'lucide-react'
import { fmtMoney, fmtInt } from '@/lib/format'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { listBrandsWithCatalog, type CatalogBrand } from '@/modules/kitchen/services/brandCatalogService'
import { getMenuItemUnitsSold, type MenuItemUnitsSold } from '@/modules/kitchen/services/menuEngineeringService'
import {
  getMenuItemLinkHealth,
  setMenuItemRecipe,
  clearMenuItemRecipe,
  approveMenuItemLink,
  createDishAndLinkToMenuItem,
  classifyMenuItemLink,
  type MenuItemLinkHealthRow,
  type LinkHumanState,
} from '@/modules/kitchen/services/menuLinkService'
import RecipeLinkPickerModal from '@/modules/kitchen/components/RecipeLinkPickerModal'
import CatalogProductDetailPage from '@/modules/kitchen/pages/CatalogProductDetailPage'
import ConfirmDialog from '@/components/ConfirmDialog'

const HUMAN_RANK: Record<LinkHumanState, number> = {
  sin_casar: 0, falta_escandallo: 1, falta_precio: 2, para_revisar: 3, bien: 4,
}
const HUMAN_ICON: Record<LinkHumanState, typeof AlertTriangle> = {
  sin_casar: AlertTriangle, falta_escandallo: ChefHat, falta_precio: Euro, para_revisar: Clock, bien: Check,
}
const HUMAN_CLASSES: Record<LinkHumanState, { text: string; badge: string; dot: string }> = {
  sin_casar: { text: 'text-red-700', badge: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
  falta_escandallo: { text: 'text-orange-700', badge: 'bg-orange-50 text-orange-700 border-orange-200', dot: 'bg-orange-500' },
  falta_precio: { text: 'text-orange-700', badge: 'bg-orange-50 text-orange-700 border-orange-200', dot: 'bg-orange-500' },
  para_revisar: { text: 'text-amber-700', badge: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  bien: { text: 'text-green-700', badge: 'bg-green-50 text-green-800 border-green-200', dot: 'bg-green-500' },
}

export default function KitchenCasadoPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [brands, setBrands] = useState<CatalogBrand[]>([])
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null)
  const [loadingBrands, setLoadingBrands] = useState(true)

  const [rows, setRows] = useState<MenuItemLinkHealthRow[]>([])
  const [sales, setSales] = useState<Map<string, MenuItemUnitsSold>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [onlyProblems, setOnlyProblems] = useState(true)
  const [search, setSearch] = useState('')

  // Ficha de producto como sub-vista local (patrón lista+detalle, igual que
  // el Menú) — abierta al hacer clic en una fila o al entrar con ?item=ID
  // (enlace desde la ficha del escandallo, ver RecipeEditorPage).
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  useEffect(() => {
    const item = searchParams.get('item')
    if (item) setSelectedProductId(item)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Picker de escandallo (Asignar/Cambiar) — una fila a la vez.
  const [pickerFor, setPickerFor] = useState<{ menuItemId: string; itemName: string; wasApproved: boolean } | null>(null)
  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    if (accountsLoading || !activeAccountId) return
    let cancelled = false
    setLoadingBrands(true)
    listBrandsWithCatalog(activeAccountId)
      .then((bs) => {
        if (cancelled) return
        setBrands(bs)
        if (bs.length > 0 && !selectedBrandId) setSelectedBrandId(bs[0].id)
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoadingBrands(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, accountsLoading])

  function load() {
    if (!activeAccountId || !selectedBrandId) return
    setLoading(true)
    setError(null)
    const from = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
    Promise.all([
      getMenuItemLinkHealth(activeAccountId, selectedBrandId),
      getMenuItemUnitsSold(selectedBrandId, from).catch((e: unknown) => {
        console.warn('KitchenCasadoPage: fallo cargando ventas de la marca', e)
        return [] as MenuItemUnitsSold[]
      }),
    ])
      .then(([health, unitsSold]) => {
        setRows(health)
        const m = new Map<string, MenuItemUnitsSold>()
        for (const s of unitsSold) m.set(s.menuItemId, s)
        setSales(m)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo cargar el casado.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, selectedBrandId])

  const counts = useMemo(() => {
    let bien = 0, revisar = 0, faltaEscandallo = 0, faltaPrecio = 0, sinCasar = 0
    for (const r of rows) {
      switch (classifyMenuItemLink(r).human) {
        case 'bien': bien++; break
        case 'para_revisar': revisar++; break
        case 'falta_escandallo': faltaEscandallo++; break
        case 'falta_precio': faltaPrecio++; break
        case 'sin_casar': sinCasar++; break
      }
    }
    return { bien, revisar, faltaEscandallo, faltaPrecio, sinCasar }
  }, [rows])

  const filtered = useMemo(() => {
    let out = rows
    if (onlyProblems) out = out.filter((r) => classifyMenuItemLink(r).human !== 'bien')
    const q = search.trim().toLowerCase()
    if (q !== '') {
      out = out.filter((r) =>
        r.itemName.toLowerCase().includes(q) ||
        (r.recipeName ?? '').toLowerCase().includes(q))
    }
    return [...out].sort((a, b) => {
      const ra = HUMAN_RANK[classifyMenuItemLink(a).human]
      const rb = HUMAN_RANK[classifyMenuItemLink(b).human]
      if (ra !== rb) return ra - rb
      const va = sales.get(a.menuItemId)?.revenue ?? 0
      const vb = sales.get(b.menuItemId)?.revenue ?? 0
      return vb - va
    })
  }, [rows, onlyProblems, search, sales])

  function handleProductBack() {
    setSelectedProductId(null)
    if (searchParams.has('item')) {
      const next = new URLSearchParams(searchParams)
      next.delete('item')
      setSearchParams(next, { replace: true })
    }
    load()
  }

  function openPicker(row: MenuItemLinkHealthRow) {
    setRowError(null)
    setPickerFor({
      menuItemId: row.menuItemId,
      itemName: row.itemName,
      wasApproved: classifyMenuItemLink(row).human === 'bien',
    })
  }

  async function handleChoose(recipeItemId: string) {
    if (!pickerFor) return
    setRowBusy(pickerFor.menuItemId)
    setRowError(null)
    try {
      await setMenuItemRecipe(pickerFor.menuItemId, recipeItemId)
      setPickerFor(null)
      load()
    } catch (e: unknown) {
      setRowError(e instanceof Error ? e.message : 'No se pudo asignar el escandallo.')
    } finally {
      setRowBusy(null)
    }
  }

  async function handleCreateFromPicker() {
    if (!pickerFor || !activeAccountId) return
    setRowBusy(pickerFor.menuItemId)
    setRowError(null)
    try {
      await createDishAndLinkToMenuItem(activeAccountId, pickerFor.menuItemId, pickerFor.itemName)
      setPickerFor(null)
      load()
    } catch (e: unknown) {
      setRowError(e instanceof Error ? e.message : 'No se pudo crear el escandallo.')
    } finally {
      setRowBusy(null)
    }
  }

  async function handleCreateDirect(row: MenuItemLinkHealthRow) {
    if (!activeAccountId) return
    setRowBusy(row.menuItemId)
    setRowError(null)
    try {
      await createDishAndLinkToMenuItem(activeAccountId, row.menuItemId, row.itemName)
      load()
    } catch (e: unknown) {
      setRowError(e instanceof Error ? e.message : 'No se pudo crear el escandallo.')
    } finally {
      setRowBusy(null)
    }
  }

  async function handleApprove(menuItemId: string) {
    setRowBusy(menuItemId)
    setRowError(null)
    try {
      await approveMenuItemLink(menuItemId)
      load()
    } catch (e: unknown) {
      setRowError(e instanceof Error ? e.message : 'No se pudo aprobar.')
    } finally {
      setRowBusy(null)
    }
  }

  async function handleClearConfirmed() {
    if (!confirmClear) return
    setRowBusy(confirmClear.id)
    setRowError(null)
    try {
      await clearMenuItemRecipe(confirmClear.id)
      setConfirmClear(null)
      load()
    } catch (e: unknown) {
      setRowError(e instanceof Error ? e.message : 'No se pudo quitar el escandallo.')
      setConfirmClear(null)
    } finally {
      setRowBusy(null)
    }
  }

  if (selectedProductId) {
    return (
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <CatalogProductDetailPage menuItemId={selectedProductId} onBack={handleProductBack} />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-2xl font-semibold text-gray-900">Casado</h1>
        {brands.length > 0 && (
          <select
            value={selectedBrandId ?? ''}
            onChange={(e) => setSelectedBrandId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-medium bg-white"
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
      </div>
      <p className="text-sm text-gray-600 mb-4">
        ¿Está cada plato bien casado con su receta? Aquí lo ves de un vistazo y lo arreglas sin salir de esta pantalla.
      </p>

      {/* Cabecera: 5 contadores en lenguaje llano */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 mb-5 flex items-center gap-6 flex-wrap">
        <div>
          <div className="text-3xl font-bold tabular-nums text-green-700">{counts.bien}</div>
          <div className="text-sm text-gray-600">Bien</div>
        </div>
        <div>
          <div className="text-3xl font-bold tabular-nums text-amber-700">{counts.revisar}</div>
          <div className="text-sm text-gray-600">Para revisar</div>
        </div>
        <div>
          <div className="text-3xl font-bold tabular-nums text-orange-700">{counts.faltaEscandallo}</div>
          <div className="text-sm text-gray-600">Falta escandallo</div>
        </div>
        <div>
          <div className="text-3xl font-bold tabular-nums text-orange-700">{counts.faltaPrecio}</div>
          <div className="text-sm text-gray-600">Falta precio</div>
        </div>
        <div>
          <div className="text-3xl font-bold tabular-nums text-red-700">{counts.sinCasar}</div>
          <div className="text-sm text-gray-600">Sin casar</div>
        </div>
      </div>

      {(error || rowError) && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error ?? rowError}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="inline-flex items-center gap-1.5 text-sm text-gray-700">
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300" />
            Solo lo que hay que arreglar
          </label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar plato o receta…"
              className="pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white w-56" />
          </div>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 border border-gray-200 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-60">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {accountsLoading || loadingBrands ? (
        <div className="flex items-center gap-2 text-gray-500 text-sm p-6">
          <Loader2 size={16} className="animate-spin" /> Cargando…
        </div>
      ) : brands.length === 0 ? (
        <p className="text-sm text-gray-500 p-6">Aún no hay catálogo en esta cuenta.</p>
      ) : loading ? (
        <div className="flex items-center gap-2 text-gray-500 text-sm p-6">
          <Loader2 size={16} className="animate-spin" /> Revisando el casado…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center">
          <div className="text-3xl mb-2">🟢</div>
          <p className="text-emerald-900 font-medium">
            {onlyProblems ? 'Nada pendiente de revisar en esta marca.' : 'No hay platos que coincidan.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((row) => {
            const meta = classifyMenuItemLink(row)
            const cls = HUMAN_CLASSES[meta.human]
            const HumanIcon = HUMAN_ICON[meta.human]
            const s = sales.get(row.menuItemId)
            const busy = rowBusy === row.menuItemId
            return (
              <div key={row.menuItemId} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <button onClick={() => setSelectedProductId(row.menuItemId)} className="font-medium text-gray-900 hover:underline text-left truncate block">
                      {row.itemName}
                    </button>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {row.recipeName ? (
                        <button
                          onClick={() => navigate('/kitchen/recetas?recipe=' + row.recipeItemId)}
                          className="hover:underline text-gray-600"
                        >
                          {row.recipeName}
                        </button>
                      ) : 'sin receta'}
                      {row.cost != null ? ` · ${fmtMoney(row.cost)}` : ''}
                      {' · '}
                      {s ? `${fmtMoney(s.revenue)} vendidos (${fmtInt(s.unitsSold)} ud, 30 d)` : 'sin ventas en 30 d'}
                    </div>
                    <p className="text-sm text-gray-700 mt-1.5">{meta.text}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border shrink-0 ${cls.badge}`}>
                    <HumanIcon size={11} /> {meta.label}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 mt-3">
                  {meta.human === 'sin_casar' && (
                    <>
                      <button onClick={() => openPicker(row)} disabled={busy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60">
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Asignar receta
                      </button>
                      <button onClick={() => handleCreateDirect(row)} disabled={busy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                        <Plus size={14} /> Crear receta
                      </button>
                    </>
                  )}
                  {meta.human === 'para_revisar' && (
                    <>
                      <button onClick={() => handleApprove(row.menuItemId)} disabled={busy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60">
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Es correcto
                      </button>
                      <button onClick={() => openPicker(row)} disabled={busy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                        <Link2 size={14} /> Cambiar receta
                      </button>
                    </>
                  )}
                  {meta.human === 'falta_escandallo' && (
                    <button onClick={() => row.recipeItemId && navigate('/kitchen/recetas?recipe=' + row.recipeItemId)} disabled={busy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60">
                      <ChefHat size={14} /> Montar escandallo
                    </button>
                  )}
                  {meta.human === 'falta_precio' && (
                    <button onClick={() => row.recipeItemId && navigate('/kitchen?item=' + row.recipeItemId)} disabled={busy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60">
                      <Euro size={14} /> Poner precio
                    </button>
                  )}
                  {meta.human === 'bien' && (
                    <>
                      <button onClick={() => openPicker(row)} disabled={busy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                        <Link2 size={14} /> Cambiar receta
                      </button>
                      <button onClick={() => setConfirmClear({ id: row.menuItemId, name: row.itemName })} disabled={busy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60">
                        <X size={14} /> Quitar
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {pickerFor && (
        <RecipeLinkPickerModal
          accountId={activeAccountId ?? ''}
          itemName={pickerFor.itemName}
          wasApproved={pickerFor.wasApproved}
          busy={rowBusy === pickerFor.menuItemId}
          error={rowError}
          onChoose={handleChoose}
          onCreateNew={handleCreateFromPicker}
          onClose={() => setPickerFor(null)}
        />
      )}

      <ConfirmDialog
        open={confirmClear !== null}
        title="Quitar escandallo"
        message={confirmClear ? `«${confirmClear.name}» quedará sin coste y sin descontar del almacén hasta que le asignes otra receta.` : ''}
        confirmLabel="Quitar"
        tone="danger"
        busy={confirmClear !== null && rowBusy === confirmClear.id}
        onConfirm={handleClearConfirmed}
        onCancel={() => setConfirmClear(null)}
      />
    </div>
  )
}
