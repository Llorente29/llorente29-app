// src/modules/supply/components/ImportZonesModal.tsx
//
// AL1 — Importar la asignación zona↔artículo desde un Excel.
//
// Flujo: subir .xlsx/.csv (columnas Artículo · Zona · Principal) → se casa por
// NOMBRE normalizado (sin acentos, sin mayúsculas) contra los artículos y las
// zonas existentes → preview con los que casan y los que no → asignar solo los
// que casan. Lo que no casa NO se inventa: se omite y se lista para revisar.
// (Fiel a Folvy: "propone, humano confirma"; cero falsos positivos.)
//
// El casado es EXACTO sobre el nombre normalizado; no hay aproximación
// automática (meter un artículo en la zona equivocada en silencio sería peor que
// dejarlo fuera). Filas con Zona vacía se omiten (huérfano deliberado).

import { useEffect, useMemo, useState } from 'react'
import { X, Loader2, Check, AlertTriangle, UploadCloud, FileSpreadsheet } from 'lucide-react'
import { parseAssignmentFile, type ParsedAssignmentRow } from '@/modules/supply/lib/storageZonesIo'
import { assignItemsToZones, type ZoneCoverage } from '@/modules/supply/services/storageZonesService'
import { listInventoryItems } from '@/modules/supply/services/storageAreaService'

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

type RowStatus = 'ok' | 'no_item' | 'no_zone' | 'skip'

interface PreviewRow extends ParsedAssignmentRow {
  itemId: string | null
  zoneId: string | null
  status: RowStatus
}

export default function ImportZonesModal({
  accountId,
  zones,
  onDone,
  onClose,
  onError,
}: {
  accountId: string
  zones: ZoneCoverage[]
  onDone: (assigned: number) => void
  onClose: () => void
  onError: (m: string) => void
}) {
  const [itemByName, setItemByName] = useState<Map<string, string>>(new Map())
  const [loadingItems, setLoadingItems] = useState(true)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [busy, setBusy] = useState(false)

  const zoneByName = useMemo(() => {
    const m = new Map<string, string>()
    for (const z of zones) m.set(norm(z.name), z.id)
    return m
  }, [zones])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const items = await listInventoryItems(accountId)
        if (cancelled) return
        const m = new Map<string, string>()
        for (const it of items) m.set(norm(it.name), it.recipeItemId)
        setItemByName(m)
      } catch (e) {
        if (!cancelled) onError(e instanceof Error ? e.message : 'Error cargando artículos.')
      } finally {
        if (!cancelled) setLoadingItems(false)
      }
    })()
    return () => { cancelled = true }
  }, [accountId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleFile(file: File) {
    setParsing(true)
    setFileName(file.name)
    onError('')
    try {
      const parsed = await parseAssignmentFile(file)
      const mapped: PreviewRow[] = parsed.map(p => {
        const itemId = itemByName.get(norm(p.articulo)) ?? null
        const zoneId = p.zona.trim() ? (zoneByName.get(norm(p.zona)) ?? null) : null
        let status: RowStatus
        if (!p.zona.trim()) status = 'skip'
        else if (!itemId) status = 'no_item'
        else if (!zoneId) status = 'no_zone'
        else status = 'ok'
        return { ...p, itemId, zoneId, status }
      })
      setRows(mapped)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo leer el Excel.')
      setRows([])
    } finally {
      setParsing(false)
    }
  }

  const counts = useMemo(() => {
    let ok = 0, problem = 0, skip = 0
    for (const r of rows) {
      if (r.status === 'ok') ok++
      else if (r.status === 'skip') skip++
      else problem++
    }
    return { ok, problem, skip }
  }, [rows])

  async function handleConfirm() {
    if (counts.ok === 0 || busy) return
    setBusy(true)
    onError('')
    try {
      // Agrupa por artículo → conjunto de zonas + principal; luego agrupa por
      // "firma" (mismas zonas + misma principal) para asignar en pocas llamadas.
      const byItem = new Map<string, { zoneIds: Set<string>; primary: string | null }>()
      for (const r of rows) {
        if (r.status !== 'ok' || !r.itemId || !r.zoneId) continue
        const entry = byItem.get(r.itemId) ?? { zoneIds: new Set<string>(), primary: null }
        entry.zoneIds.add(r.zoneId)
        if (r.principal || entry.primary === null) entry.primary = r.zoneId
        byItem.set(r.itemId, entry)
      }

      const groups = new Map<string, { itemIds: string[]; zoneIds: string[]; primary: string }>()
      for (const [itemId, e] of byItem) {
        const zoneIds = Array.from(e.zoneIds)
        const primary = e.primary && e.zoneIds.has(e.primary) ? e.primary : zoneIds[0]
        const sig = `${[...zoneIds].sort().join(',')}|${primary}`
        const g = groups.get(sig) ?? { itemIds: [], zoneIds, primary }
        g.itemIds.push(itemId)
        groups.set(sig, g)
      }

      let assigned = 0
      for (const g of groups.values()) {
        assigned += await assignItemsToZones(accountId, g.itemIds, g.zoneIds, g.primary, 'add')
      }
      onDone(assigned)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo importar.')
    } finally {
      setBusy(false)
    }
  }

  const statusCell = (r: PreviewRow) => {
    if (r.status === 'ok') return <span className="text-success inline-flex items-center gap-1"><Check size={13} /> casa</span>
    if (r.status === 'no_item') return <span className="text-warning inline-flex items-center gap-1"><AlertTriangle size={13} /> art.</span>
    if (r.status === 'no_zone') return <span className="text-warning inline-flex items-center gap-1"><AlertTriangle size={13} /> zona</span>
    return <span className="text-text-tertiary">—</span>
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start sm:items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="bg-card rounded-lg border border-border-default shadow-lg w-full max-w-lg my-8">
        <div className="px-5 py-3 border-b border-border-default flex items-center justify-between">
          <h3 className="text-base font-medium text-text-primary">Importar asignación desde Excel</h3>
          <button type="button" onClick={onClose} className="text-text-tertiary hover:text-text-primary"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {/* Subida */}
          <label className={`flex items-center gap-3 border border-border-default rounded-md px-3 py-3 cursor-pointer hover:bg-page transition-base ${loadingItems ? 'opacity-50 pointer-events-none' : ''}`}>
            {fileName
              ? <FileSpreadsheet size={20} className="text-success shrink-0" />
              : <UploadCloud size={20} className="text-text-tertiary shrink-0" />}
            <span className="flex-1 text-sm text-text-primary truncate">
              {parsing ? 'Leyendo…' : fileName ?? 'Elegir archivo .xlsx o .csv'}
            </span>
            {rows.length > 0 && <span className="text-xs text-text-secondary shrink-0">{rows.length} filas</span>}
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          </label>
          <p className="text-[11px] text-text-tertiary">
            Columnas: <span className="font-mono">Artículo</span> · <span className="font-mono">Zona</span> · <span className="font-mono">Principal</span> (opcional).
            Consejo: exporta primero para usarlo de plantilla.
          </p>

          {/* Preview */}
          {rows.length > 0 && (
            <>
              <div className="border border-border-default rounded-md overflow-hidden max-h-[42vh] overflow-y-auto">
                <div className="flex gap-2 px-3 py-2 bg-page text-[11px] uppercase tracking-wide text-text-tertiary border-b border-border-default sticky top-0">
                  <span className="flex-1">Artículo</span>
                  <span className="flex-1">Zona</span>
                  <span className="w-20 text-right">Estado</span>
                </div>
                {rows.map(r => (
                  <div key={r.rowNum}
                    className={`flex gap-2 px-3 py-2 border-t border-border-default text-sm first:border-t-0 ${r.status === 'ok' ? '' : r.status === 'skip' ? 'opacity-60' : 'bg-warning-bg'}`}>
                    <span className={`flex-1 truncate ${r.status === 'no_item' ? 'text-warning' : 'text-text-primary'}`}>{r.articulo}</span>
                    <span className={`flex-1 truncate ${r.status === 'no_zone' ? 'text-warning' : 'text-text-secondary'}`}>{r.zona || '—'}</span>
                    <span className="w-20 text-right text-xs">{statusCell(r)}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 text-[13px] flex-wrap">
                <span className="text-success inline-flex items-center gap-1"><Check size={13} /> {counts.ok} casan</span>
                {counts.problem > 0 && <span className="text-warning inline-flex items-center gap-1"><AlertTriangle size={13} /> {counts.problem} sin casar (se omiten)</span>}
                {counts.skip > 0 && <span className="text-text-tertiary">· {counts.skip} sin zona</span>}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border-default flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-3 py-2 text-sm rounded-md border border-border-default text-text-secondary hover:bg-page transition-base disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={handleConfirm} disabled={counts.ok === 0 || busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Asignar {counts.ok}
          </button>
        </div>
      </div>
    </div>
  )
}
