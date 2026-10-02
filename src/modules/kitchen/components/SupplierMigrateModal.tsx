// src/modules/kitchen/components/SupplierMigrateModal.tsx
//
// Sacado de la antigua SuppliersPage (C01, 02/10/2026): la ficha de proveedor
// pasó a src/modules/conta y lo que solo tiene sentido con Cocina —los
// artículos que le compras y moverlos a otro proveedor— lo aporta Cocina a la
// ficha como extensión (ver ../proveedores/extensionesCocina.tsx). El
// comportamiento del diálogo no cambia.

import { useEffect, useMemo, useState } from 'react'
import { X, Check, Loader2, AlertTriangle, ArrowRightLeft, Archive } from 'lucide-react'
import {
  updateSupplier,
  previewSupplierMigration,
  migrateSupplierArticles,
  type SupplierMigrationPreview,
  type SupplierMigrationResult,
} from '@/modules/kitchen/services/purchaseFormatService'
import type { Supplier } from '@/types/kitchen'

// ─────────────────────────────────────────────────────────────────────
// Modal "Migrar artículos a otro proveedor". Origen = el proveedor abierto.
// Eliges destino → previsualización (cuántos se mueven / se fusionan) →
// confirmación reforzada → migra (modo 'fill': rellena huecos en colisiones)
// → ofrece archivar el origen, que queda vacío. La previsualización ES el
// guardián: ves exactamente qué va a pasar antes de tocar nada.
// ─────────────────────────────────────────────────────────────────────
interface SupplierMigrateModalProps {
  source: Supplier
  allSuppliers: Supplier[]
  onClose: () => void
  onArchivedSource: () => void
}

export default function SupplierMigrateModal({ source, allSuppliers, onClose, onArchivedSource }: SupplierMigrateModalProps) {
  const [destId, setDestId] = useState('')
  const [preview, setPreview] = useState<SupplierMigrationPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [result, setResult] = useState<SupplierMigrationResult | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const destinations = useMemo(
    () => allSuppliers.filter((s) => s.id !== source.id),
    [allSuppliers, source.id],
  )
  const destName = destinations.find((s) => s.id === destId)?.name ?? ''

  // Previsualiza al elegir destino (resetea la confirmación si cambia).
  useEffect(() => {
    setConfirming(false)
    if (!destId) { setPreview(null); return }
    let cancelled = false
    setPreviewing(true)
    setError(null)
    previewSupplierMigration(source.id, destId)
      .then((p) => { if (!cancelled) setPreview(p) })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'No se pudo previsualizar.')
        setPreview(null)
      })
      .finally(() => { if (!cancelled) setPreviewing(false) })
    return () => { cancelled = true }
  }, [destId, source.id])

  async function doMigrate() {
    if (!destId) return
    setMigrating(true)
    setError(null)
    try {
      const res = await migrateSupplierArticles(source.id, destId, 'fill')
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo migrar.')
    } finally {
      setMigrating(false)
    }
  }

  async function doArchiveSource() {
    setArchiving(true)
    setError(null)
    try {
      await updateSupplier(source.id, { isActive: false, archivedAt: new Date().toISOString() })
      onArchivedSource()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo archivar.')
      setArchiving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div className="bg-card w-full sm:max-w-md max-h-[95vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <div className="flex items-center gap-2 min-w-0">
            <ArrowRightLeft className="w-4 h-4 text-accent flex-shrink-0" />
            <h3 className="text-base font-medium text-text-primary truncate">Migrar artículos a otro proveedor</h3>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="text-text-secondary hover:text-text-primary transition-base">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-3 overflow-y-auto">
          {!result ? (
            <>
              <p className="text-sm text-text-secondary">
                Mover todos los artículos de <span className="font-medium text-text-primary">{source.name}</span> a otro proveedor.
              </p>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Mover a</label>
                <select
                  value={destId}
                  onChange={(e) => setDestId(e.target.value)}
                  disabled={migrating}
                  className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                >
                  <option value="">— Elige el proveedor destino —</option>
                  {destinations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {destinations.length === 0 && (
                  <p className="text-[11px] text-text-secondary mt-1">No hay otros proveedores a los que mover.</p>
                )}
              </div>

              {previewing && (
                <div className="text-sm text-text-secondary flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Calculando…
                </div>
              )}

              {preview && !previewing && (
                <div className="p-3 rounded-md bg-page border border-border-default text-sm text-text-primary space-y-1">
                  {preview.origenTotal === 0 ? (
                    <span className="text-text-secondary">Este proveedor no tiene artículos que mover.</span>
                  ) : (
                    <>
                      <div>· <span className="font-medium">{preview.migranLimpio}</span> se mueven directamente.</div>
                      {preview.colisiones > 0 && (
                        <div>· <span className="font-medium">{preview.colisiones}</span> ya existen en {destName}: se <span className="font-medium">fusionan</span> conservando los datos del destino y rellenando solo lo que le falte.</div>
                      )}
                      <div className="text-text-secondary text-xs pt-1">Se recalculará el coste de {preview.origenTotal} artículo(s) y de los platos que los usan.</div>
                    </>
                  )}
                </div>
              )}

              {confirming && preview && preview.origenTotal > 0 && (
                <div className="p-2.5 rounded-md bg-warning-bg border border-warning/30 text-xs text-text-primary flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-warning flex-shrink-0 mt-0.5" />
                  <span>Vas a mover {preview.origenTotal} artículo(s) a {destName}. ¿Confirmas?</span>
                </div>
              )}

              {error && <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">{error}</div>}
            </>
          ) : (
            <div className="space-y-3">
              <div className="p-3 rounded-md bg-success-bg text-success border border-success/20 text-sm flex items-start gap-2">
                <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>
                  Listo: {result.moved} movido(s){result.merged > 0 ? `, ${result.merged} fusionado(s)` : ''}. Costes recalculados.
                </span>
              </div>
              <p className="text-sm text-text-secondary">
                {source.name} se ha quedado sin artículos. ¿Quieres archivarlo?
              </p>
              {error && <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">{error}</div>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
          {!result ? (
            <>
              <button type="button" onClick={onClose} disabled={migrating} className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base disabled:opacity-50">
                Cancelar
              </button>
              {!confirming ? (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={!destId || previewing || !preview || preview.origenTotal === 0}
                  className="px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
                >
                  Migrar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={doMigrate}
                  disabled={migrating}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base"
                >
                  {migrating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {migrating ? 'Migrando…' : 'Sí, migrar'}
                </button>
              )}
            </>
          ) : (
            <>
              <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded-md text-text-secondary hover:bg-page transition-base">
                Cerrar
              </button>
              <button
                type="button"
                onClick={doArchiveSource}
                disabled={archiving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base"
              >
                {archiving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive size={14} />}
                {archiving ? 'Archivando…' : `Archivar ${source.name}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
