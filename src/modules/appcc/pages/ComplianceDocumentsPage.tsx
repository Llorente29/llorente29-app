// src/modules/appcc/pages/ComplianceDocumentsPage.tsx
//
// Archivo documental de cumplimiento (T2) — hermana de AllergensCompliancePage.
// Nace de una inspección real: el inspector no pide solo fichas de alimentos,
// sino 9 familias documentales. Aquí se SUBEN y se LISTAN por familia, con un
// semáforo de "qué falta". La lectura del PDF (OCR), el enlace al ingrediente y
// el respaldo del alérgeno llegan en T3/T4.
//
// Patrón visual/tokens tomados de AllergensCompliancePage.tsx (mismo módulo).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, Upload, FileText, Trash2, Loader2, ExternalLink, X, AlertTriangle, Search, Sparkles, Link2, FileDown,
} from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  listComplianceDocuments,
  uploadComplianceDocument,
  deleteComplianceDocument,
  ocrComplianceDoc,
  searchIngredients,
  applyComplianceDocAllergens,
  listSuppliers,
  listLocations,
  coverageByFamily,
  getAccountFiscal,
  DOC_FAMILIES,
  DOC_FAMILY_LABEL,
  DOC_STATUS_LABEL,
  type ComplianceDocument,
  type DocFamily,
  type DocStatus,
  type SupplierLite,
  type LocationLite,
  type FamilyCoverage,
  type OcrResult,
  type IngredientLite,
} from '@/modules/appcc/services/complianceDocumentService'
import { allergenLabel } from '@/modules/kitchen/lib/allergens'
import {
  generateInspectionFolderPdf,
  type InspectionFolderData,
} from '@/modules/appcc/services/inspectionFolderPdfService'

const STATUS_TONE: Record<DocStatus, string> = {
  active: 'bg-success-bg text-success',
  expired: 'bg-danger-bg text-danger',
  pending_review: 'bg-warning-bg text-warning',
  pending_ocr: 'bg-warning-bg text-warning',
  superseded: 'bg-accent-bg text-text-secondary',
}

const COVERAGE_TONE: Record<FamilyCoverage['status'], string> = {
  ok: 'bg-success-bg text-success border-border-default',
  expiring: 'bg-warning-bg text-warning border-border-default',
  expired: 'bg-danger-bg text-danger border-border-default',
  missing: 'bg-accent-bg text-text-secondary border-border-default',
}

const BTN_SECONDARY =
  'inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-medium border ' +
  'border-border-default text-text-primary bg-card hover:bg-page disabled:opacity-50 transition-colors'
const INPUT =
  'text-sm border border-border-default rounded-lg bg-card text-text-primary px-2.5 py-2 ' +
  'focus:outline-none focus:ring-1 focus:ring-accent'

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function baseName(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

interface PendingItem {
  key: string
  file: File
  docFamily: DocFamily
  title: string
  supplierId: string
  locationId: string
  reference: string
  issuedAt: string
  expiresAt: string
}

export default function ComplianceDocumentsPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()

  const [docs, setDocs] = useState<ComplianceDocument[]>([])
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([])
  const [locations, setLocations] = useState<LocationLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [familyFilter, setFamilyFilter] = useState<DocFamily | ''>('')
  const [search, setSearch] = useState('')

  const [pending, setPending] = useState<PendingItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [ocr, setOcr] = useState<Record<string, { loading?: boolean; result?: OcrResult; error?: string }>>({})
  const [applyDoc, setApplyDoc] = useState<{ doc: ComplianceDocument; result: OcrResult } | null>(null)
  const [ingQuery, setIngQuery] = useState('')
  const [ingResults, setIngResults] = useState<IngredientLite[]>([])
  const [ingSel, setIngSel] = useState<IngredientLite | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyMsg, setApplyMsg] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    if (!activeAccountId) return
    setLoading(true)
    setError(null)
    try {
      const [d, s, l] = await Promise.all([
        listComplianceDocuments(activeAccountId),
        listSuppliers(activeAccountId),
        listLocations(activeAccountId),
      ])
      setDocs(d)
      setSuppliers(s)
      setLocations(l)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el archivo documental.')
    } finally {
      setLoading(false)
    }
  }, [activeAccountId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!applyDoc || !activeAccountId) return
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const res = await searchIngredients(activeAccountId, ingQuery)
        if (!cancelled) setIngResults(res)
      } catch {
        if (!cancelled) setIngResults([])
      }
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [ingQuery, applyDoc, activeAccountId])

  const coverage = useMemo(() => coverageByFamily(docs), [docs])

  const supplierNameById = useMemo(
    () => new Map(suppliers.map((s) => [s.id, s.name])),
    [suppliers],
  )
  const nameOf = (id: string | null) => (id ? supplierNameById.get(id) ?? '' : '')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return docs.filter((d) => {
      if (familyFilter && d.doc_family !== familyFilter) return false
      if (!q) return true
      return (
        d.title.toLowerCase().includes(q) ||
        (d.supplier_id ? (supplierNameById.get(d.supplier_id) ?? '') : '').toLowerCase().includes(q) ||
        (d.reference ?? '').toLowerCase().includes(q)
      )
    })
  }, [docs, familyFilter, search, supplierNameById])

  const grouped = useMemo(() => {
    const map = new Map<DocFamily, ComplianceDocument[]>()
    for (const d of filtered) {
      const arr = map.get(d.doc_family) ?? []
      arr.push(d)
      map.set(d.doc_family, arr)
    }
    return DOC_FAMILIES.filter((f) => map.has(f)).map((f) => ({ family: f, items: map.get(f)! }))
  }, [filtered])

  function stageFiles(files: FileList | File[]) {
    const arr = Array.from(files)
    if (arr.length === 0) return
    setUploadError(null)
    setPending((prev) => [
      ...prev,
      ...arr.map((file) => ({
        key: crypto.randomUUID(),
        file,
        docFamily: 'food_spec' as DocFamily,
        title: baseName(file.name),
        supplierId: '',
        locationId: '',
        reference: '',
        issuedAt: '',
        expiresAt: '',
      })),
    ])
  }

  function updatePending(key: string, patch: Partial<PendingItem>) {
    setPending((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)))
  }
  function removePending(key: string) {
    setPending((prev) => prev.filter((p) => p.key !== key))
  }

  async function doUpload() {
    if (!activeAccountId || pending.length === 0) return
    const invalid = pending.find((p) => !p.title.trim())
    if (invalid) { setUploadError('Cada documento necesita un título.'); return }
    setUploading(true)
    setUploadError(null)
    const failures: string[] = []
    for (const p of pending) {
      try {
        await uploadComplianceDocument({
          accountId: activeAccountId,
          docFamily: p.docFamily,
          title: p.title,
          file: p.file,
          locationId: p.locationId || null,
          supplierId: p.supplierId || null,
          reference: p.reference || null,
          issuedAt: p.issuedAt || null,
          expiresAt: p.expiresAt || null,
        })
      } catch (e) {
        failures.push(`${p.file.name}: ${e instanceof Error ? e.message : 'error'}`)
      }
    }
    setUploading(false)
    if (failures.length > 0) setUploadError(failures.join(' · '))
    setPending((prev) => prev.filter((p) => failures.some((f) => f.startsWith(p.file.name))))
    await load()
  }

  async function onDelete(doc: ComplianceDocument) {
    if (!window.confirm(`¿Eliminar "${doc.title}"? Esta acción no se puede deshacer.`)) return
    try {
      await deleteComplianceDocument(doc)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar el documento.')
    }
  }

  async function runOcr(doc: ComplianceDocument) {
    setOcr((m) => ({ ...m, [doc.id]: { loading: true } }))
    try {
      const res = await ocrComplianceDoc(doc.id)
      setOcr((m) => ({ ...m, [doc.id]: { result: res } }))
      await load()
    } catch (e) {
      setOcr((m) => ({ ...m, [doc.id]: { error: e instanceof Error ? e.message : 'No se pudo leer el documento.' } }))
    }
  }

  function openApply(doc: ComplianceDocument, res: OcrResult) {
    setApplyDoc({ doc, result: res })
    setIngSel(null)
    setApplyMsg(null)
    setIngQuery(res.parsed.legal_name || doc.title)
  }
  function closeApply() {
    setApplyDoc(null)
    setIngResults([])
  }
  async function doApply() {
    if (!applyDoc || !ingSel) return
    setApplying(true)
    setApplyMsg(null)
    try {
      const res = await applyComplianceDocAllergens(
        applyDoc.doc.id,
        ingSel.id,
        applyDoc.result.parsed.allergens_contains ?? [],
        applyDoc.result.parsed.allergens_may_contain ?? [],
      )
      setApplyMsg(`Aplicado a "${ingSel.name}": ${res.applied_contains} contiene · ${res.applied_may_contain} trazas · ${res.applied_free} libre (con respaldo). ${res.dishes_recomputed} plato(s) recalculado(s).`)
      await load()
    } catch (e) {
      setApplyMsg(e instanceof Error ? e.message : 'No se pudo aplicar.')
    } finally {
      setApplying(false)
    }
  }

  async function exportInspectionFolder() {
    if (!activeAccountId) return
    setExporting(true)
    setError(null)
    try {
      const fiscal = await getAccountFiscal(activeAccountId)
      const supMap = new Map(suppliers.map((s) => [s.id, s.name]))
      const now = new Date()
      const data: InspectionFolderData = {
        account: { legalName: fiscal.legalName, cif: fiscal.cif },
        generatedAtLabel: now.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' }),
        generatedAtFilename: now.toISOString().slice(0, 10),
        coverage: coverage.map((c) => ({
          familyLabel: c.label, total: c.total, status: c.status, expired: c.expired, expiringSoon: c.expiringSoon,
        })),
        docs: docs
          .filter((d) => d.status !== 'superseded')
          .map((d) => ({
            family: d.doc_family,
            familyLabel: DOC_FAMILY_LABEL[d.doc_family],
            title: d.title,
            supplierName: d.supplier_id ? (supMap.get(d.supplier_id) ?? null) : null,
            reference: d.reference,
            issuedAt: d.issued_at,
            expiresAt: d.expires_at,
            reviewDueAt: d.review_due_at,
            status: d.status,
          })),
      }
      const { blob, filename } = generateInspectionFolderPdf(data)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar la carpeta de inspección.')
    } finally {
      setExporting(false)
    }
  }

  if (accountsLoading || (loading && docs.length === 0)) {
    return (
      <div className="p-4 sm:p-6 flex items-center gap-2 text-sm text-text-secondary">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando archivo documental…
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display text-text-primary mb-1">Archivo documental</h1>
          <p className="text-base text-text-secondary">
            Las fichas y documentos que un inspector puede pedir: técnicas de producto y de
            seguridad, plagas, agua, aceite, homologación de proveedores. Guarda el papel que
            respalda cada dato.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void exportInspectionFolder()}
          disabled={exporting || docs.length === 0}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-medium border border-border-default text-text-primary bg-card hover:bg-page disabled:opacity-50 transition-colors"
          title="Genera un PDF con el estado del archivo por familia, los documentos y los huecos"
        >
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
          Carpeta de inspección
        </button>
      </div>

      {error && (
        <div className="p-2.5 rounded-lg bg-danger-bg text-danger text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Semáforo: qué falta por familia */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {coverage.map((c) => (
          <button
            key={c.family}
            type="button"
            onClick={() => setFamilyFilter((prev) => (prev === c.family ? '' : c.family))}
            className={
              'text-left p-3 rounded-lg border transition-colors ' +
              COVERAGE_TONE[c.status] +
              (familyFilter === c.family ? ' ring-1 ring-accent' : '')
            }
          >
            <div className="text-xs font-medium leading-snug">{c.label}</div>
            <div className="mt-1 text-sm font-semibold">
              {c.status === 'missing'
                ? 'Sin documentos'
                : `${c.total} ${c.total === 1 ? 'documento' : 'documentos'}`}
            </div>
            {(c.expired > 0 || c.expiringSoon > 0) && (
              <div className="text-[11px] mt-0.5">
                {c.expired > 0 && <span>{c.expired} caducado(s) </span>}
                {c.expiringSoon > 0 && <span>{c.expiringSoon} por revisar</span>}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Zona de subida */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); stageFiles(e.dataTransfer.files) }}
        className={
          'rounded-lg border border-dashed p-6 text-center transition-colors ' +
          (dragOver ? 'border-accent bg-accent-bg' : 'border-border-default bg-card')
        }
      >
        <Upload className="w-6 h-6 mx-auto mb-2 text-text-secondary" />
        <p className="text-sm text-text-primary font-medium">Arrastra aquí los PDF o fotos</p>
        <p className="text-xs text-text-secondary mb-3">Puedes soltar varios a la vez.</p>
        <button type="button" className={BTN_SECONDARY} onClick={() => fileInputRef.current?.click()}>
          <FileText className="w-4 h-4" /> Elegir archivos
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => { if (e.target.files) stageFiles(e.target.files); e.target.value = '' }}
        />
      </div>

      {/* Bandeja de pendientes de subir */}
      {pending.length > 0 && (
        <div className="bg-card border border-border-default rounded-lg p-3 space-y-3">
          <div className="text-sm font-medium text-text-primary">
            {pending.length} {pending.length === 1 ? 'documento' : 'documentos'} por subir
          </div>
          {pending.map((p) => (
            <div key={p.key} className="border border-border-default rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-secondary truncate">{p.file.name}</span>
                <button type="button" onClick={() => removePending(p.key)} className="text-text-tertiary hover:text-danger">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  className={INPUT + ' w-full'}
                  placeholder="Título"
                  value={p.title}
                  onChange={(e) => updatePending(p.key, { title: e.target.value })}
                />
                <select
                  className={INPUT + ' w-full cursor-pointer'}
                  value={p.docFamily}
                  onChange={(e) => updatePending(p.key, { docFamily: e.target.value as DocFamily })}
                >
                  {DOC_FAMILIES.map((f) => (
                    <option key={f} value={f}>{DOC_FAMILY_LABEL[f]}</option>
                  ))}
                </select>
                <select
                  className={INPUT + ' w-full cursor-pointer'}
                  value={p.supplierId}
                  onChange={(e) => updatePending(p.key, { supplierId: e.target.value })}
                >
                  <option value="">Proveedor (opcional)</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <select
                  className={INPUT + ' w-full cursor-pointer'}
                  value={p.locationId}
                  onChange={(e) => updatePending(p.key, { locationId: e.target.value })}
                >
                  <option value="">Toda la cuenta</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
                <input
                  className={INPUT + ' w-full'}
                  placeholder="Referencia (opcional)"
                  value={p.reference}
                  onChange={(e) => updatePending(p.key, { reference: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-text-secondary">
                    Emitido
                    <input type="date" className={INPUT + ' w-full mt-0.5'} value={p.issuedAt}
                      onChange={(e) => updatePending(p.key, { issuedAt: e.target.value })} />
                  </label>
                  <label className="text-[11px] text-text-secondary">
                    Caduca / revisa
                    <input type="date" className={INPUT + ' w-full mt-0.5'} value={p.expiresAt}
                      onChange={(e) => updatePending(p.key, { expiresAt: e.target.value })} />
                  </label>
                </div>
              </div>
            </div>
          ))}
          {uploadError && (
            <div className="p-2.5 rounded-lg bg-danger-bg text-danger text-xs">{uploadError}</div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void doUpload()}
              disabled={uploading}
              className={
                'inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-medium border ' +
                'border-border-default text-text-primary bg-accent-bg hover:bg-page disabled:opacity-50 transition-colors'
              }
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? 'Subiendo…' : `Subir ${pending.length}`}
            </button>
            <button type="button" onClick={() => setPending([])} disabled={uploading} className={BTN_SECONDARY}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            className={INPUT + ' pl-8'}
            placeholder="Buscar por título, proveedor o referencia"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className={INPUT + ' cursor-pointer'}
          value={familyFilter}
          onChange={(e) => setFamilyFilter(e.target.value as DocFamily | '')}
        >
          <option value="">Todas las familias</option>
          {DOC_FAMILIES.map((f) => (
            <option key={f} value={f}>{DOC_FAMILY_LABEL[f]}</option>
          ))}
        </select>
      </div>

      {/* Lista por familia */}
      {grouped.length === 0 ? (
        <div className="bg-card border border-border-default rounded-lg p-8 text-center text-sm text-text-secondary">
          <Archive className="w-6 h-6 mx-auto mb-2 text-text-tertiary" />
          Todavía no hay documentos{familyFilter || search ? ' que coincidan con el filtro' : ''}.
        </div>
      ) : (
        grouped.map(({ family, items }) => (
          <div key={family} className="bg-card border border-border-default rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 bg-page border-b border-border-default text-sm font-medium text-text-primary">
              {DOC_FAMILY_LABEL[family]} <span className="text-text-tertiary font-normal">· {items.length}</span>
            </div>
            <div className="divide-y divide-border-default">
              {items.map((d) => {
                const o = ocr[d.id]
                const r = o?.result
                return (
                <div key={d.id}>
                  <div className="px-4 py-3 flex items-center gap-3">
                    <FileText className="w-4 h-4 text-text-tertiary shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-text-primary font-medium truncate">{d.title}</div>
                      <div className="text-xs text-text-secondary truncate">
                        {nameOf(d.supplier_id) ? nameOf(d.supplier_id) + ' · ' : ''}
                        {d.reference ? 'Ref. ' + d.reference + ' · ' : ''}
                        Emitido {fmtDate(d.issued_at)}
                        {d.expires_at || d.review_due_at ? ` · Caduca/revisa ${fmtDate(d.expires_at ?? d.review_due_at)}` : ''}
                      </div>
                    </div>
                    <span className={'text-[11px] px-2 py-0.5 rounded-full shrink-0 ' + STATUS_TONE[d.status]}>
                      {DOC_STATUS_LABEL[d.status]}
                    </span>
                    <button
                      type="button"
                      onClick={() => void runOcr(d)}
                      disabled={o?.loading}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-border-default text-text-primary bg-card hover:bg-page disabled:opacity-50 transition-colors shrink-0"
                      title="Leer con IA"
                    >
                      {o?.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      Leer con IA
                    </button>
                    {d.url && (
                      <a href={d.url} target="_blank" rel="noreferrer" className="text-text-secondary hover:text-text-primary shrink-0" title="Abrir">
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                    <button type="button" onClick={() => void onDelete(d)} className="text-text-tertiary hover:text-danger shrink-0" title="Eliminar">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  {(o?.loading || o?.error || r) && (
                    <div className="px-4 pb-3 text-xs">
                      {o?.loading && (
                        <div className="text-text-secondary inline-flex items-center gap-1">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Leyendo con IA…
                        </div>
                      )}
                      {o?.error && <div className="text-danger">{o.error}</div>}
                      {r && (
                        <div className="rounded-lg bg-page border border-border-default p-2.5 space-y-1.5">
                          <div className="text-text-secondary">
                            {r.parsed.legal_name ? <b className="text-text-primary">{r.parsed.legal_name}</b> : 'Lectura'}
                            {r.parsed.reference ? ` · Ref. ${r.parsed.reference}` : ''}
                            {r.parsed.manufacturer_name ? ` · ${r.parsed.manufacturer_name}` : ''}
                          </div>
                          {(r.parsed.allergens_contains?.length || r.parsed.allergens_may_contain?.length) ? (
                            <div className="flex flex-wrap gap-1 items-center">
                              {r.parsed.allergens_contains?.map((c) => (
                                <span key={c} className="px-1.5 py-0.5 rounded bg-danger-bg text-danger">
                                  {allergenLabel(c as Parameters<typeof allergenLabel>[0])}
                                </span>
                              ))}
                              {r.parsed.allergens_may_contain?.map((c) => (
                                <span key={'mc' + c} className="px-1.5 py-0.5 rounded bg-warning-bg text-warning">
                                  trazas: {allergenLabel(c as Parameters<typeof allergenLabel>[0])}
                                </span>
                              ))}
                            </div>
                          ) : d.doc_family === 'food_spec' ? (
                            <div className="text-text-tertiary">No se leyeron alérgenos.</div>
                          ) : null}
                          {r.review.needs_review && (
                            <div className="text-warning flex items-start gap-1">
                              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                              <span>{r.review.reasons.join(' · ')}</span>
                            </div>
                          )}
                          {(r.parsed.allergens_contains?.length || r.parsed.allergens_may_contain?.length) ? (
                            <button
                              type="button"
                              onClick={() => openApply(d, r)}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-border-default text-text-primary bg-accent-bg hover:bg-page transition-colors"
                            >
                              <Link2 className="w-3.5 h-3.5" /> Aplicar al ingrediente
                            </button>
                          ) : (
                            <div className="text-text-tertiary">Sin alérgenos que aplicar.</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                )
              })}
            </div>
          </div>
        ))
      )}

      {applyDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closeApply}
        >
          <div
            className="bg-card rounded-lg border border-border-default w-full max-w-md p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-display text-text-primary">Aplicar al ingrediente</h3>
              <button type="button" onClick={closeApply} className="text-text-tertiary hover:text-text-primary">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-text-secondary">
              La ficha "<b className="text-text-primary">{applyDoc.doc.title}</b>" define el perfil COMPLETO del
              ingrediente. Se marcará{' '}
              <span className="text-danger">
                contiene: {(applyDoc.result.parsed.allergens_contains ?? [])
                  .map((c) => allergenLabel(c as Parameters<typeof allergenLabel>[0])).join(', ') || '—'}
              </span>
              {applyDoc.result.parsed.allergens_may_contain?.length ? (
                <>
                  {' · '}
                  <span className="text-warning">
                    trazas: {(applyDoc.result.parsed.allergens_may_contain ?? [])
                      .map((c) => allergenLabel(c as Parameters<typeof allergenLabel>[0])).join(', ')}
                  </span>
                </>
              ) : null}
              {' · '}<span className="text-success">libre</span> del resto — todo con la ficha como respaldo. Sustituye
              las suposiciones de IA. Se recalcularán los platos que lo usan.
            </p>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                autoFocus
                className={INPUT + ' pl-8 w-full'}
                placeholder="Buscar ingrediente"
                value={ingQuery}
                onChange={(e) => { setIngQuery(e.target.value); setIngSel(null) }}
              />
            </div>
            <div className="max-h-56 overflow-y-auto border border-border-default rounded-lg divide-y divide-border-default">
              {ingResults.length === 0 ? (
                <div className="p-2.5 text-xs text-text-tertiary">Escribe para buscar un ingrediente…</div>
              ) : (
                ingResults.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => setIngSel(i)}
                    className={
                      'w-full text-left px-2.5 py-2 text-sm hover:bg-page transition-colors ' +
                      (ingSel?.id === i.id ? 'bg-accent-bg text-text-primary' : 'text-text-secondary')
                    }
                  >
                    {i.name}
                  </button>
                ))
              )}
            </div>
            {applyMsg && (
              <div className="text-xs text-text-primary bg-success-bg rounded-lg p-2.5">{applyMsg}</div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={closeApply} className={BTN_SECONDARY}>Cerrar</button>
              <button
                type="button"
                onClick={() => void doApply()}
                disabled={!ingSel || applying}
                className={
                  'inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-medium border ' +
                  'border-border-default text-text-primary bg-accent-bg hover:bg-page disabled:opacity-50 transition-colors'
                }
              >
                {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                {applying ? 'Aplicando…' : 'Aplicar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
