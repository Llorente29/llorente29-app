// src/modules/appcc/pages/ReportsPage.tsx
// Pantalla para generar informes PDF APPCC: controles, incidencias, inspector completo.
// Bloque E: añadidos botones "Vista previa" además de "Descargar PDF".

import { useEffect, useMemo, useState } from 'react'
import { Download, FileText, AlertTriangle, ClipboardList, Loader2, Eye } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import {
  generateControlsReportPdf,
  generateIncidentsReportPdf,
  generateInspectorReportPdf,
  generateDailySummaryPdf,
  type PdfPreviewResult,
  type PdfExportOptions,
} from '@/modules/appcc/services/pdfExportService'
import ReportPreviewModal from '@/components/ReportPreviewModal'
import type { Location } from '@/types'

type ReportType = 'controls' | 'incidents' | 'inspector' | 'daily'

interface ReportOption {
  id: ReportType
  icon: typeof FileText
  title: string
  desc: string
}

const REPORT_OPTIONS: ReportOption[] = [
  { id: 'inspector', icon: ClipboardList, title: 'Informe inspector', desc: 'Controles + incidencias + acciones correctoras. El que pide Sanidad.' },
  { id: 'controls', icon: FileText, title: 'Informe de controles', desc: 'Todos los checklists completados en el periodo.' },
  { id: 'incidents', icon: AlertTriangle, title: 'Informe de incidencias', desc: 'Incidencias con estado y acciones correctoras.' },
  { id: 'daily', icon: Download, title: 'Resumen de un día', desc: 'Resumen de todos los controles de una fecha concreta.' },
]

export default function ReportsPage() {
  const { locations } = useApp()
  const activeLocations = useMemo<Location[]>(() => locations.filter(l => l.active), [locations])

  const { resolvedLocationId } = useLocationScope()
  const [locationId, setLocationId] = useState<string>(activeLocations[0]?.id ?? '')
  const [reportType, setReportType] = useState<ReportType>('inspector')

  // El selector global de local manda cuando hay uno concreto; en consolidado
  // (null) mantiene la elección local (el informe se genera por un solo local).
  useEffect(() => {
    if (resolvedLocationId) setLocationId(resolvedLocationId)
  }, [resolvedLocationId])
  const [fromDate, setFromDate] = useState<string>(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return d.toISOString().slice(0, 10)
  })
  const [toDate, setToDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [singleDate, setSingleDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState<'preview' | 'download' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [preview, setPreview] = useState<PdfPreviewResult | null>(null)

  const selectedLocation = activeLocations.find(l => l.id === locationId)

  /**
   * Genera el informe en modo download o preview según el parámetro.
   * Unifica la lógica de switch entre los 4 tipos de informe.
   */
  async function runGeneration(mode: 'preview' | 'download'): Promise<PdfPreviewResult | null> {
    if (!locationId || !selectedLocation) return null
    const locInfo = { name: selectedLocation.name, address: selectedLocation.address ?? '' }
    const opts: PdfExportOptions = { mode }

    switch (reportType) {
      case 'controls':
        return await generateControlsReportPdf(locationId, fromDate, toDate, locInfo, opts)
      case 'incidents':
        return await generateIncidentsReportPdf(locationId, fromDate, toDate, locInfo, opts)
      case 'inspector':
        return await generateInspectorReportPdf(locationId, fromDate, toDate, locInfo, opts)
      case 'daily':
        return await generateDailySummaryPdf(locationId, singleDate, locInfo, opts)
    }
  }

  async function handleAction(mode: 'preview' | 'download') {
    if (!locationId || !selectedLocation) return
    setLoading(mode)
    setError(null)
    setSuccess(false)

    try {
      const result = await runGeneration(mode)
      if (mode === 'preview' && result) {
        setPreview(result)
      } else if (mode === 'download') {
        setSuccess(true)
        setTimeout(() => setSuccess(false), 3000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error generando el informe')
    } finally {
      setLoading(null)
    }
  }

  const selectedOption = REPORT_OPTIONS.find(o => o.id === reportType)

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <h1 className="text-4xl font-display text-text-primary mb-2">Informes APPCC</h1>
      <p className="text-base text-text-secondary mb-6">
        Genera documentos PDF listos para inspección de Sanidad.
      </p>

      {/* Selector de local */}
      {activeLocations.length > 1 && (
        <div className="mb-4">
          <label className="block text-sm font-semibold text-text-secondary uppercase tracking-wider mb-1">Local</label>
          <select
            value={locationId}
            onChange={e => setLocationId(e.target.value)}
            className="w-full px-4 py-3 border border-border-default rounded-lg text-base bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {activeLocations.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Tipo de informe */}
      <div className="mb-4">
        <label className="block text-sm font-semibold text-text-secondary uppercase tracking-wider mb-2">Tipo de informe</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {REPORT_OPTIONS.map(opt => {
            const Icon = opt.icon
            const isSelected = reportType === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setReportType(opt.id)}
                className={`text-left p-4 rounded-lg border-2 transition-base ${
                  isSelected
                    ? 'bg-accent-bg border-accent'
                    : 'bg-card border-border-default hover:border-accent'
                }`}
              >
                <div className="flex items-start gap-3">
                  <Icon size={20} className={isSelected ? 'text-accent' : 'text-text-secondary'} />
                  <div>
                    <p className={`font-medium text-sm ${isSelected ? 'text-accent' : 'text-text-primary'}`}>{opt.title}</p>
                    <p className="text-xs text-text-secondary mt-0.5">{opt.desc}</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Selector de fechas */}
      {reportType === 'daily' ? (
        <div className="mb-6">
          <label className="block text-sm font-semibold text-text-secondary uppercase tracking-wider mb-1">Fecha</label>
          <input
            type="date"
            value={singleDate}
            onChange={e => setSingleDate(e.target.value)}
            className="w-full px-4 py-3 border border-border-default rounded-lg text-base bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold text-text-secondary uppercase tracking-wider mb-1">Desde</label>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="w-full px-4 py-3 border border-border-default rounded-lg text-base bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-text-secondary uppercase tracking-wider mb-1">Hasta</label>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="w-full px-4 py-3 border border-border-default rounded-lg text-base bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-danger-bg border border-danger/30 text-danger text-sm">
          {error}
        </div>
      )}

      {/* Éxito */}
      {success && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-success-bg border border-success/30 text-success text-sm">
          PDF descargado correctamente.
        </div>
      )}

      {/* Botones: preview + descargar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={() => handleAction('preview')}
          disabled={!!loading || !locationId}
          className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-4 rounded-lg text-base font-semibold bg-card border-2 border-accent text-accent hover:bg-accent-bg transition-base disabled:opacity-50 min-h-[56px]"
        >
          {loading === 'preview' ? (
            <><Loader2 size={20} className="animate-spin" /> Generando…</>
          ) : (
            <><Eye size={20} /> Vista previa</>
          )}
        </button>
        <button
          type="button"
          onClick={() => handleAction('download')}
          disabled={!!loading || !locationId}
          className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-4 rounded-lg text-base font-semibold bg-accent text-text-on-accent hover:bg-accent-hover transition-base disabled:opacity-50 min-h-[56px]"
        >
          {loading === 'download' ? (
            <><Loader2 size={20} className="animate-spin" /> Generando…</>
          ) : (
            <><Download size={20} /> Descargar PDF</>
          )}
        </button>
      </div>

      <p className="text-xs text-text-secondary text-center mt-3">
        Los informes incluyen firma electrónica y son válidos para inspección sanitaria según CE 852/2004 y RD 109/2010.
      </p>

      {/* Modal de previsualización */}
      {preview && (
        <ReportPreviewModal
          preview={preview}
          title={selectedOption?.title ?? 'Informe APPCC'}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}
