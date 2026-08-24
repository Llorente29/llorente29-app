// src/modules/kitchen/components/EnCartaTab.tsx
//
// Pestaña "En carta" de la ficha unificada de plato (CatalogFichaPage).
// Fusiona, de CatalogProductDetailPage.tsx, tres secciones menu_item-scoped:
//   - S0 "Grupos del combo" (id="s-combo", líneas ~1474-1496) — solo si el
//     producto es combo. El editor en sí (`ComboEditorSection`, función local
//     antes en el mismo fichero) salió a su propio componente,
//     src/modules/kitchen/components/ComboEditorSection.tsx.
//   - S3 "Precios y disponibilidad" (id="s-precios", líneas ~1671-1826) —
//     SIMPLIFICADA (decisión ya tomada): se quita la tabla-stub de una sola
//     fila (columnas Canal/Ubicación/Precio/PVP/Margen neto pese a no poblar
//     más que "Base marca") y quedan solo los controles reales: el toggle
//     "Activo" (4 estados: disponible/oculto-por-espejo/en-espera-de-espejo/
//     agotado) y el botón "Editar precios" (EditPricesModal, reutilizado tal
//     cual).
//   - S10 "Marcas y categoría" (id="s-marcas", líneas ~1911-1922) —
//     `ProductPlacementSection`, ya es componente propio, se reutiliza tal
//     cual con las mismas props.
// Ver plan C:\Users\jgcol\.claude\plans\polished-sniffing-walrus.md, Fase 4.
// Regla de oro: unificar no pierde nada — "mover, no inventar".
//
// menu_item-scoped. `item` YA viene cargado por el padre (CatalogFichaPage) —
// este componente NUNCA hace su propio getMenuItemById. El estado
// "disponible/agotado" que pinta el toggle "Activo" lee item.isAvailable, el
// MISMO campo que ya usa la cabecera del padre para "En carta"/"Agotado" — no
// hay una segunda fuente que pueda desincronizarse. Cualquier mutación que
// cambie campos de `item` (disponibilidad, precio, marca/categoría) llama a
// onItemChanged() para que el padre refresque y el nuevo `item` baje por
// prop; solo gestiona de forma autónoma lo que NO es parte de `item`: combo
// (slots), estado de espejo, y el preview de alcance del 86.

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { getComboContext, type ComboSlotDetail } from '@/modules/kitchen/services/comboEditService'
import ComboEditorSection from '@/modules/kitchen/components/ComboEditorSection'
import ProductPlacementSection from '@/modules/kitchen/components/ProductPlacementSection'
import EditPricesModal from '@/modules/kitchen/components/EditPricesModal'
import { getMirrorState, swapMirror, type MirrorState } from '@/modules/kitchen/services/mirrorService'
import { previewScope, type ScopePreview } from '@/modules/kitchen/services/availabilityService'
import {
  setProductAvailability,
  type ProductAvailabilityResult,
} from '@/modules/kitchen/services/menuOverrideService'
import type { MenuItem } from '@/types/kitchen'

interface EnCartaTabProps {
  item: MenuItem
  accountId: string
  /** Solo para la cabecera del modal de precios ("{producto} · {marca}").
   *  Lo resuelve ya CatalogFichaPage; no se vuelve a consultar. */
  brandName?: string
  onItemChanged: () => void
  /** El producto se ha quitado de la carta: esta ficha ya no tiene sujeto.
   *  Lo resuelve el padre (saltar a otro producto de la receta, o salir). */
  onRemovedFromMenu?: () => void
}

export default function EnCartaTab({ item, accountId, brandName, onItemChanged, onRemovedFromMenu }: EnCartaTabProps) {
  // ── Combo (S0) — el producto no expone product_type en el tipo cliente;
  // se resuelve con la misma llamada que ya usaba el código viejo. ──
  const [isCombo, setIsCombo] = useState(false)
  const [comboBrandId, setComboBrandId] = useState<string | null>(null)
  const [comboSlots, setComboSlots] = useState<ComboSlotDetail[] | null>(null)

  useEffect(() => {
    let cancelled = false
    getComboContext(item.accountId, item.id)
      .then((ctx) => {
        if (cancelled) return
        setIsCombo(ctx.isCombo)
        setComboBrandId(ctx.brandId)
        setComboSlots(ctx.isCombo ? ctx.slots : null)
      })
      .catch(() => { if (!cancelled) { setIsCombo(false); setComboSlots(null) } })
    return () => { cancelled = true }
  }, [item.id, item.accountId])

  function reloadCombo() {
    getComboContext(item.accountId, item.id)
      .then((ctx) => setComboSlots(ctx.isCombo ? ctx.slots : null))
      .catch(() => {})
  }

  // ── Artículo espejo (S3) ──
  // Estado del espejo ANCLADO al producto consultado. Antes era un `mirror` a
  // secas que empezaba en null y también quedaba en null si la consulta
  // fallaba: no se distinguía "aún no sé si es un espejo" de "no lo es". Y esa
  // diferencia importa, porque el control de disponibilidad de abajo cae en la
  // rama "Agotado · reactivar" cuando `mirror` es null — así que un espejo EN
  // ESPERA (que está oculto a propósito, no agotado) ofrecía durante ese
  // instante el botón equivocado: pulsarlo intenta reactivar algo que el
  // sistema de espejos vuelve a ocultar, y parece que el botón no responde.
  const [mirrorState, setMirrorState] = useState<
    { itemId: string; value: MirrorState | null } | null
  >(null)
  const mirrorLoaded = mirrorState !== null && mirrorState.itemId === item.id
  const mirror = mirrorLoaded ? mirrorState.value : null
  const [mirrorBusy, setMirrorBusy] = useState(false)
  const [mirrorError, setMirrorError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const itemId = item.id
    getMirrorState(item.accountId, itemId)
      .then((m) => { if (!cancelled) setMirrorState({ itemId, value: m }) })
      .catch(() => { if (!cancelled) setMirrorState({ itemId, value: null }) })
    return () => { cancelled = true }
  }, [item.id, item.accountId])

  // Swap COMPLETO original <-> espejo (is_available de ambos, coherente en el
  // servidor). El swap se ejecuta SIEMPRE sobre el id del original.
  async function handleSwapMirror(useMirror: boolean) {
    if (!mirror || mirror.role === 'none') return
    const originalId = mirror.role === 'mirror' ? mirror.originalId : item.id
    if (!originalId) return
    setMirrorBusy(true)
    setMirrorError(null)
    try {
      const res = await swapMirror(item.accountId, originalId, useMirror)
      if (!res.ok) { setMirrorError('No se pudo cambiar la versión.'); return }
      onItemChanged()
      const m = await getMirrorState(item.accountId, item.id)
      setMirrorState({ itemId: item.id, value: m })
    } catch (err: unknown) {
      setMirrorError(err instanceof Error ? err.message : 'No se pudo cambiar la versión.')
    } finally {
      setMirrorBusy(false)
    }
  }

  // ── Disponibilidad / 86 (S3) ──
  const [availSaving, setAvailSaving] = useState(false)
  const [availConfirm, setAvailConfirm] = useState(false)
  const [availScope, setAvailScope] = useState<ScopePreview | null>(null)
  const [availResult, setAvailResult] = useState<ProductAvailabilityResult | null>(null)
  const [availError, setAvailError] = useState<string | null>(null)

  // Abre la confirmación de agotar y precarga el alcance real (N marcas · N
  // canales), mismo scope-preview que usan los modales "Agotar producto" de
  // Disponibilidad (web/tablet).
  function openAvailConfirm() {
    setAvailError(null)
    setAvailScope(null)
    setAvailConfirm(true)
    previewScope(item.accountId, item.id, null)
      .then(setAvailScope)
      .catch(() => setAvailScope(null))
  }

  // Marcar disponible/agotado (cascada cross-brand + empuje a canales en el servidor).
  async function handleToggleAvailability(next: boolean) {
    setAvailError(null)
    setAvailSaving(true)
    try {
      const res = await setProductAvailability(item.id, next, 'manual')
      setAvailResult(next ? null : res) // mostramos el alcance solo al agotar
      setAvailConfirm(false)
      setAvailScope(null)
      onItemChanged()
    } catch (err: unknown) {
      setAvailError(err instanceof Error ? err.message : 'Error cambiando disponibilidad')
    } finally {
      setAvailSaving(false)
    }
  }

  // ── Editar precios (S3) ──
  const [showPrices, setShowPrices] = useState(false)

  return (
    <div className="space-y-8">
      {/* S0 — Grupos del combo (solo si product_type='combo') */}
      {isCombo && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-3">
            Grupos del combo
          </h3>
          {comboSlots === null ? (
            <p className="text-sm text-stone-400">Cargando grupos…</p>
          ) : (
            <ComboEditorSection
              accountId={accountId}
              brandId={comboBrandId}
              comboItemId={item.id}
              initialSlots={comboSlots}
              onChanged={reloadCombo}
            />
          )}
        </div>
      )}

      {/* S3 — Precios y disponibilidad (tabla-stub eliminada, decisión ya
          tomada: quedan solo los controles reales). */}
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-3">
          Precios y disponibilidad
        </h3>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          {item.isAvailable ? (
            <button
              onClick={openAvailConfirm}
              disabled={availSaving}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-green-700 hover:text-green-800 disabled:opacity-50"
            >
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />
              Disponible
            </button>
          ) : !mirrorLoaded ? (
            // Todavía no sabemos si este producto es un espejo de promo. Ofrecer
            // "reactivar" aquí sería ofrecer la acción equivocada para un espejo
            // en espera, así que se espera: es un parpadeo, no un bloqueo.
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-stone-400">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-stone-200" />
              Comprobando…
            </span>
          ) : (mirror?.role === 'original' && mirror.usingMirror) ? (
            // Original oculto A PROPÓSITO porque su versión promo está activa: NO es agotado.
            <button
              onClick={() => handleSwapMirror(false)}
              disabled={mirrorBusy}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-amber-700 hover:text-amber-800 disabled:opacity-50"
            >
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" />
              {mirrorBusy ? 'Cambiando…' : 'Oculto · versión promo'}
            </button>
          ) : (mirror?.role === 'mirror' && !mirror.usingMirror) ? (
            // Esta ficha es el espejo en espera: su visibilidad la manda el swap, no el 86.
            <button
              onClick={() => handleSwapMirror(true)}
              disabled={mirrorBusy}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-amber-700 hover:text-amber-800 disabled:opacity-50"
            >
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400" />
              {mirrorBusy ? 'Cambiando…' : 'En espera · versión promo'}
            </button>
          ) : (
            <button
              onClick={() => handleToggleAvailability(true)}
              disabled={availSaving}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-stone-500 hover:text-green-700 disabled:opacity-50"
            >
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-stone-300" />
              {availSaving ? 'Reactivando…' : 'Agotado · reactivar'}
            </button>
          )}

          <button onClick={() => setShowPrices(true)} className="text-sm font-medium text-accent hover:underline">
            Editar precios
          </button>
        </div>

        {mirror && mirror.role !== 'none' && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-900">
              <Sparkles className="w-4 h-4" />
              {mirror.role === 'mirror' ? 'Esta ficha es la versión promo' : 'Versión promo (artículo espejo)'}
            </div>
            <p className="text-[12.5px] text-amber-800 mt-1 leading-snug">
              {mirror.usingMirror
                ? 'Ahora se vende la versión promo; el original está oculto a propósito (no es agotado).'
                : 'Ahora se vende el original; la versión promo está en espera.'}
            </p>
            <div className="text-[12px] text-amber-700 mt-1.5">
              Original: <strong>{mirror.originalAvailable ? 'visible' : 'oculto'}</strong>
              {' · '}Promo: <strong>{mirror.mirrorAvailable ? 'visible' : 'oculto'}</strong>
            </div>
            <div className="flex items-center gap-2 mt-2.5 flex-wrap">
              {mirror.usingMirror ? (
                <button
                  onClick={() => handleSwapMirror(false)}
                  disabled={mirrorBusy}
                  className="px-3 py-1.5 rounded-md bg-stone-800 text-white text-[13px] font-medium hover:bg-stone-900 disabled:opacity-50"
                >
                  {mirrorBusy ? 'Cambiando…' : 'Volver al original'}
                </button>
              ) : (
                <button
                  onClick={() => handleSwapMirror(true)}
                  disabled={mirrorBusy}
                  className="px-3 py-1.5 rounded-md bg-amber-600 text-white text-[13px] font-medium hover:bg-amber-700 disabled:opacity-50"
                >
                  {mirrorBusy ? 'Cambiando…' : 'Usar versión promo'}
                </button>
              )}
              {mirror.role === 'mirror' && mirror.originalName && (
                <span className="text-[11.5px] text-amber-700">Promo de «{mirror.originalName}». Ponle aquí su precio promo.</span>
              )}
            </div>
            {mirrorError && <p className="text-[12px] text-red-600 mt-2">{mirrorError}</p>}
          </div>
        )}

        {availConfirm && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="font-medium text-amber-900">¿Marcar como agotado?</p>
            <p className="text-amber-800 mt-0.5">
              Se apagará <strong>AHORA, en producción</strong>, en{' '}
              {availScope ? (
                <strong>
                  {availScope.brands} marca{availScope.brands === 1 ? '' : 's'}
                  {' · '}Last: {availScope.channelsLast ?? '—'} canal{availScope.channelsLast === 1 ? '' : 'es'}
                  {' · '}HubRise: {availScope.brandsHubrise ?? '—'} marca{availScope.brandsHubrise === 1 ? '' : 's'}
                </strong>
              ) : 'calculando alcance…'} de Glovo / Uber / JustEat. Podrás reactivarlo cuando quieras.
            </p>
            <div className="flex gap-2 mt-2.5">
              <button
                onClick={() => handleToggleAvailability(false)}
                disabled={availSaving}
                className="px-3 py-1.5 rounded-md bg-amber-600 text-white text-[13px] font-medium hover:bg-amber-700 disabled:opacity-50"
              >
                {availSaving ? 'Agotando…' : 'Sí, agotar'}
              </button>
              <button
                onClick={() => { setAvailConfirm(false); setAvailScope(null) }}
                disabled={availSaving}
                className="px-3 py-1.5 rounded-md border border-stone-300 text-[13px] font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
        {availResult && !item.isAvailable && (
          <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3 text-[13px] text-stone-600">
            Agotado en <strong>{availResult.brands}</strong> marca{availResult.brands === 1 ? '' : 's'}
            {' · '}<strong>{availResult.channels}</strong> canal{availResult.channels === 1 ? '' : 'es'}
            {' '}({availResult.affectedItems} ficha{availResult.affectedItems === 1 ? '' : 's'}).
          </div>
        )}
        {availError && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">{availError}</div>
        )}
      </div>

      {showPrices && (
        <EditPricesModal
          menuItemId={item.id}
          accountId={accountId}
          productName={item.name}
          basePrice={item.price ?? 0}
          vatRate={item.vatRate ?? 0}
          brandName={brandName}
          onClose={() => setShowPrices(false)}
          onSaved={() => { setShowPrices(false); onItemChanged() }}
        />
      )}

      {/* S10 — Marcas y categoría */}
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-3">
          Marcas y categoría
        </h3>
        <ProductPlacementSection
          accountId={accountId}
          menuItemId={item.id}
          recipeItemId={item.recipeItemId}
          currentBrandId={item.brandId}
          productName={item.name}
          basePrice={item.price}
          onChanged={onItemChanged}
          onRemovedCurrent={onRemovedFromMenu}
        />
      </div>
    </div>
  )
}
