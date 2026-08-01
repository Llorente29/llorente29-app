// src/modules/integrations/components/BrandDeliverySection.tsx
//
// "Reparto propio" por marca. Corrige el defecto del 2026-08-01: pedidos de
// marcas cedidas se despachaban a un repartidor por error porque
// resolve_dispatch() no miraba la marca. Este panel deja de depender de SQL
// directo para ver/cambiar el interruptor.
//
// Interruptor EFECTIVO = coalesce(own_delivery_enabled, ownership_type='own').
// null (por defecto) hereda de ownership_type; true/false es un override
// explícito. "Restaurar por defecto" vuelve a null.

import { useEffect, useMemo, useState } from 'react'
import { Bike, Loader2, AlertCircle, RotateCcw } from 'lucide-react'
import {
  listBrandDeliveryFlags,
  setBrandOwnDelivery,
  setBrandOwnDeliveryBulk,
  type BrandDeliveryFlag,
} from '@/modules/multitenancy/services/brandDeliveryService'

export default function BrandDeliverySection({ accountId }: { accountId: string }) {
  const [flags, setFlags] = useState<BrandDeliveryFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    setLoading(true)
    listBrandDeliveryFlags(accountId)
      .then(f => { if (!cancelled) setFlags(f) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Error cargando marcas.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, reloadTick])

  function toggleSelected(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function toggleOne(f: BrandDeliveryFlag) {
    setSavingId(f.id); setError(null)
    const next = !f.effectiveEnabled
    try {
      await setBrandOwnDelivery(f.id, next)
      setFlags(prev => prev.map(x => x.id === f.id ? { ...x, ownDeliveryEnabled: next, effectiveEnabled: next } : x))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setSavingId(null)
    }
  }

  async function restoreDefault(f: BrandDeliveryFlag) {
    setSavingId(f.id); setError(null)
    try {
      await setBrandOwnDelivery(f.id, null)
      setReloadTick(t => t + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo restaurar.')
    } finally {
      setSavingId(null)
    }
  }

  async function applyBulk(enabled: boolean) {
    if (selected.size === 0) return
    setBulkSaving(true); setError(null)
    try {
      await setBrandOwnDeliveryBulk(Array.from(selected), enabled)
      setSelected(new Set())
      setReloadTick(t => t + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar en bloque.')
    } finally {
      setBulkSaving(false)
    }
  }

  const allSelected = useMemo(
    () => flags.length > 0 && flags.every(f => selected.has(f.id)),
    [flags, selected],
  )
  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(flags.map(f => f.id)))
  }

  return (
    <div className="rounded-xl border border-border-default bg-card">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default">
        <Bike size={18} className="text-text-secondary" />
        <h2 className="text-sm font-semibold text-text-primary">Reparto propio por marca</h2>
        {loading && <Loader2 size={14} className="animate-spin text-text-secondary ml-auto" />}
      </div>

      <div className="px-4 py-4 space-y-3">
        <p className="text-xs text-text-secondary">
          Activado = Folvy despacha un repartidor para esta marca. Desactivado = la plataforma
          o el cedente se encarga del reparto.
        </p>

        {error && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">
            <AlertCircle size={13} /> {error}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-text-secondary flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Cargando…
          </div>
        ) : flags.length === 0 ? (
          <p className="text-sm text-text-secondary">No hay marcas activas en esta cuenta.</p>
        ) : (
          <>
            {/* Acción en bloque */}
            <div className="flex flex-wrap items-center gap-2 pb-1">
              <label className="inline-flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer select-none">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="w-4 h-4 accent-accent" />
                Seleccionar todas
              </label>
              <button type="button" disabled={selected.size === 0 || bulkSaving} onClick={() => void applyBulk(true)}
                className="px-2.5 py-1 text-xs rounded-md border border-border-default text-text-secondary hover:bg-page transition-base disabled:opacity-40">
                Activar seleccionadas
              </button>
              <button type="button" disabled={selected.size === 0 || bulkSaving} onClick={() => void applyBulk(false)}
                className="px-2.5 py-1 text-xs rounded-md border border-border-default text-text-secondary hover:bg-page transition-base disabled:opacity-40">
                Desactivar seleccionadas
              </button>
              {selected.size > 0 && (
                <span className="text-xs text-text-tertiary">{selected.size} seleccionada{selected.size === 1 ? '' : 's'}</span>
              )}
              {bulkSaving && <Loader2 size={13} className="animate-spin text-text-secondary" />}
            </div>

            <div className="space-y-2">
              {flags.map(f => {
                const inherited = f.ownDeliveryEnabled === null
                const isOwn = f.ownershipType === 'own'
                return (
                  <div key={f.id} className="flex items-center gap-3 border-t border-border-default pt-2.5">
                    <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggleSelected(f.id)}
                      className="w-4 h-4 accent-accent shrink-0" aria-label={`Seleccionar ${f.name}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-primary truncate">{f.name}</span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${isOwn ? 'bg-accent-bg text-text-primary' : 'bg-warning-bg text-warning'}`}>
                          {isOwn ? 'Propia' : 'Cedida'}
                        </span>
                        {inherited && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-page text-text-tertiary border border-border-default">
                            Por defecto
                          </span>
                        )}
                      </div>
                      {!isOwn && inherited && (
                        <p className="text-[11px] text-text-tertiary mt-0.5">
                          Las marcas cedidas no usan reparto propio por defecto. Puedes activarlo si negocias el reparto con el cedente.
                        </p>
                      )}
                    </div>
                    {savingId === f.id && <Loader2 size={13} className="animate-spin text-text-secondary shrink-0" />}
                    {!inherited && (
                      <button type="button" onClick={() => void restoreDefault(f)} disabled={savingId === f.id}
                        title="Restaurar por defecto (heredar de tipo de marca)"
                        className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-page transition-base shrink-0 disabled:opacity-40">
                        <RotateCcw size={14} />
                      </button>
                    )}
                    <button type="button" onClick={() => void toggleOne(f)} disabled={savingId === f.id}
                      role="switch" aria-checked={f.effectiveEnabled} aria-label={`Reparto propio de ${f.name}`}
                      className={`relative w-10 h-6 rounded-full shrink-0 transition-base disabled:opacity-50 ${f.effectiveEnabled ? 'bg-accent' : 'bg-page border border-border-default'}`}>
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-base ${f.effectiveEnabled ? 'translate-x-4' : ''}`} />
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
