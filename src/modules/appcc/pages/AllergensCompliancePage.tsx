// src/modules/appcc/pages/AllergensCompliancePage.tsx
//
// Matriz de cumplimiento de alérgenos (Capa 2, Fase 4) — hermana del resto
// de APPCC, no vive en la ficha de un plato porque es una vista de CONJUNTO.
// Disparada por inspección sanitaria real: la inspectora buscó una marca en
// Glovo y pidió ver los alérgenos — esta pantalla es "coge un plato y
// demuéstralo", para los ~580 a la vez.
//
// Plantilla técnica/visual: src/pages/CalendarioPage.tsx (tabla con primera
// columna sticky + overflow-x-auto) — mismo patrón, sin reinventar.
//
// Las 5 piezas del encargo, en este orden: matriz completa (imprimible vía
// exportar CSV, filtrable por marca) → qué falta → ingredientes bloqueantes
// → salud del dato → discrepancias manual-vs-heredado.
//
// Un código AUSENTE del mapa de alérgenos de un plato es "sin declarar" (el
// 5º estado UI-only) — nunca se pinta como 'free' (misma regla que
// EtiquetadoTab.tsx).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  getAllergenComplianceMatrix,
  getAllergenBlockingIngredients,
  getAllergenDataHealth,
  getAllergenDiscrepancies,
  getAccountFiscalInfo,
  type ComplianceMatrixRow,
  type BlockingIngredient,
  type DataHealthRow,
  type AllergenDiscrepancy,
  type AllergenCell,
  type AllergenSource,
} from '@/modules/kitchen/services/allergenComplianceService'
import {
  ALLERGEN_CODES,
  allergenLabel,
  allergenStateLabel,
  allergenIconUrl,
  type AllergenState,
} from '@/modules/kitchen/lib/allergens'
import { generateAllergenCompliancePdf } from '@/modules/appcc/services/allergenCompliancePdfService'
import { generateAllergenComplianceExcel } from '@/modules/appcc/services/allergenComplianceExcelService'

const CELL_TONE: Record<AllergenState, string> = {
  contains: 'bg-danger-bg text-danger',
  may_contain: 'bg-warning-bg text-warning',
  free: 'bg-success-bg text-success',
  unknown: 'bg-accent-bg text-text-secondary',
}

const CELL_LETTER: Record<AllergenState, string> = {
  contains: 'C',
  may_contain: 'T',
  free: '✓',
  unknown: '?',
}

const SOURCE_LABEL: Record<AllergenSource, string> = {
  manual: 'Manual',
  inherited: 'Heredado (Capa 2)',
  automatic: 'Automático',
  ai_enrich: 'IA sin confirmar',
}

// Leyenda de la matriz — mismos 5 estados que EtiquetadoTab.tsx ("Sin
// declarar" es el 5º, UI-only, nunca una fila real). Se reutiliza tal cual
// para la pantalla y para las líneas de cabecera del CSV exportado, así el
// CSV se explica solo fuera de la app (impreso o abierto en Excel).
const LEGEND_ITEMS: { state: AllergenState | null; label: string }[] = [
  { state: 'contains', label: 'Contiene' },
  { state: 'may_contain', label: 'Puede contener (trazas)' },
  { state: 'free', label: 'Libre de' },
  { state: 'unknown', label: 'Sin determinar' },
  { state: null, label: 'Sin declarar' },
]

function MatrixLegend() {
  return (
    <div className="border-t border-border-default px-3 py-2.5 space-y-2.5">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mb-1.5">Alérgenos</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-x-3 gap-y-1.5">
          {ALLERGEN_CODES.map((code) => (
            <div key={code} className="flex items-center gap-1.5 text-xs text-text-secondary min-w-0">
              <img src={allergenIconUrl(code)} alt="" className="w-4 h-4 shrink-0" loading="lazy" />
              <span className="truncate">{allergenLabel(code)}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mb-1.5">Estados</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-text-secondary">
          {LEGEND_ITEMS.map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              {item.state === null ? (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded border border-dashed border-border-default text-text-tertiary text-[9px]">
                  —
                </span>
              ) : (
                <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-semibold ${CELL_TONE[item.state]}`}>
                  {CELL_LETTER[item.state]}
                </span>
              )}
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function csvEscape(value: string): string {
  if (/[",\n;]/.test(value)) return '"' + value.replace(/"/g, '""') + '"'
  return value
}

function dishIsIncomplete(row: ComplianceMatrixRow): boolean {
  return ALLERGEN_CODES.some((code) => {
    const cell = row.allergens[code]
    return !cell || cell.state === 'unknown'
  })
}

function MatrixCell({ cell }: { cell?: AllergenCell }) {
  if (!cell) {
    return (
      <div
        className="w-7 h-7 mx-auto rounded-md border border-dashed border-border-default flex items-center justify-center text-text-tertiary text-[10px]"
        title="Sin declarar — nadie lo ha mirado todavía"
      >
        —
      </div>
    )
  }
  return (
    <div
      className={`w-7 h-7 mx-auto rounded-md flex items-center justify-center text-[11px] font-semibold ${CELL_TONE[cell.state]}`}
      title={`${allergenStateLabel(cell.state)} · ${SOURCE_LABEL[cell.source]}`}
    >
      {CELL_LETTER[cell.state]}
    </div>
  )
}

export default function AllergensCompliancePage() {
  const navigate = useNavigate()
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const { locations } = useApp()

  const [matrix, setMatrix] = useState<ComplianceMatrixRow[]>([])
  const [matrixError, setMatrixError] = useState<string | null>(null)
  const [blocking, setBlocking] = useState<BlockingIngredient[]>([])
  const [blockingError, setBlockingError] = useState<string | null>(null)
  const [health, setHealth] = useState<DataHealthRow[]>([])
  const [healthError, setHealthError] = useState<string | null>(null)
  const [discrepancies, setDiscrepancies] = useState<AllergenDiscrepancy[]>([])
  const [discrepanciesError, setDiscrepanciesError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [brandFilter, setBrandFilter] = useState<string>('')
  const [pdfGenerating, setPdfGenerating] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [excelGenerating, setExcelGenerating] = useState(false)
  const [excelError, setExcelError] = useState<string | null>(null)

  useEffect(() => {
    if (accountsLoading) return
    if (!activeAccountId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.allSettled([
      getAllergenComplianceMatrix(activeAccountId),
      getAllergenBlockingIngredients(activeAccountId),
      getAllergenDataHealth(activeAccountId),
      getAllergenDiscrepancies(activeAccountId),
    ]).then(([m, b, h, d]) => {
      if (cancelled) return
      if (m.status === 'fulfilled') { setMatrix(m.value); setMatrixError(null) }
      else setMatrixError(m.reason instanceof Error ? m.reason.message : 'Error cargando la matriz.')
      if (b.status === 'fulfilled') { setBlocking(b.value); setBlockingError(null) }
      else setBlockingError(b.reason instanceof Error ? b.reason.message : 'Error cargando ingredientes bloqueantes.')
      if (h.status === 'fulfilled') { setHealth(h.value); setHealthError(null) }
      else setHealthError(h.reason instanceof Error ? h.reason.message : 'Error cargando salud del dato.')
      if (d.status === 'fulfilled') { setDiscrepancies(d.value); setDiscrepanciesError(null) }
      else setDiscrepanciesError(d.reason instanceof Error ? d.reason.message : 'Error cargando discrepancias.')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [activeAccountId, accountsLoading])

  const brandOptions = useMemo(() => {
    const set = new Set<string>()
    matrix.forEach((r) => r.brands.forEach((b) => set.add(b)))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [matrix])

  const filteredMatrix = useMemo(() => {
    if (!brandFilter) return matrix
    return matrix.filter((r) => r.brands.includes(brandFilter))
  }, [matrix, brandFilter])

  const incompleteCount = useMemo(
    () => filteredMatrix.filter(dishIsIncomplete).length,
    [filteredMatrix],
  )

  function exportCsv() {
    // Leyenda como cabecera del propio CSV (líneas sueltas, no forman parte
    // de la tabla) — así el fichero se explica solo abierto en Excel o
    // impreso, sin depender de haber visto la pantalla antes.
    const legendLines: string[][] = [
      ['Leyenda'],
      ...LEGEND_ITEMS.map((item) => [item.label]),
      [],
    ]
    const header = ['Plato', 'Tipo', 'Marcas', ...ALLERGEN_CODES.map((c) => allergenLabel(c))]
    const rows = filteredMatrix.map((r) => [
      r.recipeName,
      r.recipeType,
      r.brands.join('; '),
      ...ALLERGEN_CODES.map((code) => {
        const cell = r.allergens[code]
        return cell ? allergenStateLabel(cell.state) : 'Sin declarar'
      }),
    ])
    const csv = [...legendLines, header, ...rows]
      .map((cols) => cols.map(csvEscape).join(','))
      .join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `alergenos_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Contexto común a PDF y Excel: identidad fiscal (accounts.legal_name/cif,
  // misma fuente que purchaseOrderPdf.ts) + alcance (marcas/locales
  // realmente incluidos en ESTE export, respeta el filtro de marca activo)
  // + fecha ya formateada dos veces (visible / para nombre de fichero).
  async function buildReportScope() {
    if (!activeAccountId) throw new Error('No hay cuenta activa.')
    const account = await getAccountFiscalInfo(activeAccountId)
    const now = new Date()
    return {
      account,
      brandCount: brandFilter ? 1 : brandOptions.length,
      locationCount: locations.filter((l) => l.active).length,
      generatedAtLabel: now.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }),
      // Sin regex de clase de caracteres con guion/dos puntos entre corchetes:
      // Tailwind escanea el código fuente buscando "[propiedad:valor]" (sintaxis
      // de propiedad arbitraria) y ese patrón literal rompía la build de CSS.
      generatedAtFilename: now.toISOString().slice(0, 16).replaceAll('-', '').replaceAll(':', '').replaceAll('T', ''),
    }
  }

  async function exportPdf() {
    if (pdfGenerating) return
    setPdfGenerating(true)
    setPdfError(null)
    try {
      const scope = await buildReportScope()
      const { blob, filename } = generateAllergenCompliancePdf({
        ...scope,
        rows: filteredMatrix,
        blocking,
        discrepancies,
        health,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      setPdfError(e instanceof Error ? e.message : 'No se pudo generar el PDF.')
    } finally {
      setPdfGenerating(false)
    }
  }

  async function exportExcel() {
    if (excelGenerating) return
    setExcelGenerating(true)
    setExcelError(null)
    try {
      const scope = await buildReportScope()
      generateAllergenComplianceExcel({
        ...scope,
        rows: filteredMatrix,
        blocking,
        health,
      })
    } catch (e: unknown) {
      setExcelError(e instanceof Error ? e.message : 'No se pudo generar el Excel.')
    } finally {
      setExcelGenerating(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 flex items-center gap-2 text-sm text-text-secondary">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando alérgenos…
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-4xl font-display text-text-primary mb-1">Alérgenos</h1>
          <p className="text-base text-text-secondary">
            Los 14 de declaración obligatoria (Reglamento UE 1169/2011), por plato a la venta.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {brandOptions.length > 1 && (
            <select
              value={brandFilter}
              onChange={(e) => setBrandFilter(e.target.value)}
              className="text-sm border border-border-default rounded-lg bg-card text-text-primary px-2.5 py-2 cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">Todas las marcas</option>
              {brandOptions.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={exportCsv}
            disabled={filteredMatrix.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-medium border border-border-default text-text-primary bg-card hover:bg-page disabled:opacity-50 transition-colors"
          >
            <Download className="w-4 h-4" /> Exportar CSV
          </button>
          <button
            type="button"
            onClick={exportExcel}
            disabled={filteredMatrix.length === 0 || excelGenerating}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-medium border border-border-default text-text-primary bg-card hover:bg-page disabled:opacity-50 transition-colors"
          >
            {excelGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            {excelGenerating ? 'Generando…' : 'Exportar Excel'}
          </button>
          <button
            type="button"
            onClick={exportPdf}
            disabled={filteredMatrix.length === 0 || pdfGenerating}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-medium border border-border-default text-text-primary bg-card hover:bg-page disabled:opacity-50 transition-colors"
          >
            {pdfGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {pdfGenerating ? 'Generando…' : 'Exportar PDF'}
          </button>
        </div>
      </div>
      {pdfError && <div className="p-2.5 rounded-lg bg-danger-bg text-danger text-xs">{pdfError}</div>}
      {excelError && <div className="p-2.5 rounded-lg bg-danger-bg text-danger text-xs">{excelError}</div>}

      {/* Matriz completa */}
      <div className="bg-card border border-border-default rounded-lg">
        {matrixError ? (
          <div className="p-4 text-sm text-danger">{matrixError}</div>
        ) : filteredMatrix.length === 0 ? (
          <div className="p-6 text-center text-sm text-text-secondary">
            {matrix.length === 0 ? 'Ningún plato a la venta todavía.' : 'Ninguna marca coincide con el filtro.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-page">
              <tr>
                <th className="px-3 py-2 text-left sticky left-0 z-20 bg-page border-r border-border-default min-w-[220px]">
                  Plato
                </th>
                {ALLERGEN_CODES.map((code) => (
                  <th
                    key={code}
                    className="px-1 py-2 text-center w-11 text-[10px] text-text-secondary font-medium"
                    title={allergenLabel(code)}
                  >
                    <img
                      src={allergenIconUrl(code)}
                      alt={allergenLabel(code)}
                      className="w-5 h-5 mx-auto mb-0.5"
                      loading="lazy"
                    />
                    {allergenLabel(code).slice(0, 3)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredMatrix.map((row) => (
                <tr key={row.recipeItemId} className="border-b border-border-default">
                  <td className="px-3 py-2 align-middle sticky left-0 z-10 bg-card border-r border-border-default">
                    <button
                      type="button"
                      onClick={() => navigate('/kitchen/recetas?recipe=' + row.recipeItemId + '&tab=etiquetado')}
                      className="text-left hover:underline"
                    >
                      <div className="font-medium text-text-primary truncate max-w-[200px]">{row.recipeName}</div>
                      {row.brands.length > 0 && (
                        <div className="text-[10px] text-text-secondary truncate max-w-[200px]">
                          {row.brands.join(', ')}
                        </div>
                      )}
                    </button>
                  </td>
                  {ALLERGEN_CODES.map((code) => (
                    <td key={code} className="px-1 py-1.5 border-l border-border-default">
                      <MatrixCell cell={row.allergens[code]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        {filteredMatrix.length > 0 && !matrixError && <MatrixLegend />}
      </div>

      {/* Qué falta */}
      <div className="bg-card border border-border-default rounded-lg p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-1.5 flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 text-text-secondary" /> Qué falta
        </h3>
        {matrixError ? (
          <p className="text-sm text-text-secondary">La matriz no cargó — ver el error de arriba.</p>
        ) : filteredMatrix.length === 0 ? (
          <p className="text-sm text-text-secondary">
            {matrix.length === 0 ? 'Ningún plato a la venta todavía.' : 'Ninguna marca coincide con el filtro.'}
          </p>
        ) : incompleteCount === 0 ? (
          <p className="text-sm text-success">
            Los {filteredMatrix.length} platos{brandFilter ? ` de ${brandFilter}` : ''} tienen los 14 alérgenos con
            declaración real (ni "sin declarar" ni "sin determinar").
          </p>
        ) : (
          <p className="text-sm text-text-secondary">
            <span className="font-semibold text-warning">{incompleteCount}</span> de {filteredMatrix.length} platos
            {brandFilter ? ` de ${brandFilter}` : ''} tienen al menos un alérgeno sin declarar o sin determinar. La
            causa suele ser un ingrediente concreto — ver "Ingredientes bloqueantes" debajo.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Ingredientes bloqueantes */}
        <div className="bg-card border border-border-default rounded-lg p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-1.5">Ingredientes bloqueantes</h3>
          <p className="text-xs text-text-secondary mb-3">
            Dato incompleto o "sin determinar" — completa su ficha y la herencia se actualiza sola en los platos que
            lo usan.
          </p>
          {blockingError && (
            <div className="p-2 rounded-md bg-danger-bg text-danger text-xs mb-2">{blockingError}</div>
          )}
          {blocking.length === 0 && !blockingError ? (
            <p className="text-sm text-text-secondary">Ningún ingrediente bloqueante — buena señal.</p>
          ) : (
            <ul className="space-y-1.5 max-h-72 overflow-y-auto">
              {blocking.map((b) => (
                <li key={b.ingredientId} className="flex items-center justify-between gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => navigate('/kitchen?item=' + b.ingredientId)}
                    className="text-text-primary hover:underline text-left truncate"
                  >
                    {b.ingredientName}
                  </button>
                  <span className="text-xs text-text-secondary font-mono shrink-0">
                    {b.dishCount} plato{b.dishCount === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Salud del dato */}
        <div className="bg-card border border-border-default rounded-lg p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-1.5">Salud del dato</h3>
          <p className="text-xs text-text-secondary mb-3">
            "IA sin confirmar" no tiene el mismo valor legal que una declaración manual o de ficha técnica —
            revísalas antes de confiar en ellas ante una inspección.
          </p>
          {healthError && (
            <div className="p-2 rounded-md bg-danger-bg text-danger text-xs mb-2">{healthError}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {(['ingrediente', 'plato'] as const).map((scope) => {
              const rows = health.filter((h) => h.scope === scope)
              const total = rows.reduce((s, r) => s + r.rowCount, 0)
              return (
                <div key={scope} className="border border-border-default rounded-md p-2.5">
                  <div className="text-[10px] font-medium text-text-secondary uppercase tracking-wide mb-1.5">
                    {scope === 'ingrediente' ? 'Ingrediente' : 'Plato (heredado)'}
                  </div>
                  {rows.length === 0 ? (
                    <div className="text-xs text-text-tertiary">Sin datos.</div>
                  ) : (
                    <ul className="space-y-1">
                      {rows.map((r) => (
                        <li key={r.source} className="flex items-center justify-between text-xs">
                          <span className="text-text-secondary">{SOURCE_LABEL[r.source]}</span>
                          <span className="font-mono text-text-primary">{r.rowCount}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-1.5 pt-1.5 border-t border-border-default text-xs flex justify-between font-medium">
                    <span className="text-text-secondary">Total</span>
                    <span className="font-mono text-text-primary">{total}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Discrepancias */}
      <div className="bg-card border border-border-default rounded-lg p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-1.5">Discrepancias manual vs. heredado</h3>
        <p className="text-xs text-text-secondary mb-3">
          Platos donde alguien declaró algo a mano que ya no coincide con lo que dicen hoy sus ingredientes.
        </p>
        {discrepanciesError && (
          <div className="p-2 rounded-md bg-danger-bg text-danger text-xs mb-2">{discrepanciesError}</div>
        )}
        {discrepancies.length === 0 && !discrepanciesError ? (
          <p className="text-sm text-success">
            Ninguna discrepancia — lo declarado a mano coincide con lo que dicen los ingredientes.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {discrepancies.map((d) => (
              <li key={`${d.recipeItemId}-${d.allergenCode}`} className="text-sm border border-border-default rounded-md p-2">
                <button
                  type="button"
                  onClick={() => navigate('/kitchen/recetas?recipe=' + d.recipeItemId + '&tab=etiquetado')}
                  className="font-medium text-text-primary hover:underline"
                >
                  {d.recipeName}
                </button>
                <span className="text-text-secondary"> · {allergenLabel(d.allergenCode)}: </span>
                declarado <span className="font-medium text-text-primary">{allergenStateLabel(d.declaredState)}</span>,{' '}
                heredaría <span className="font-medium text-warning">{allergenStateLabel(d.wouldInherit)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
