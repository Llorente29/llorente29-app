// src/modules/kitchen/components/PublishStatusChip.tsx
//
// T2e-A — chip de ESTADO DE PUBLICACIÓN de la marca, junto al botón Publicar.
// Verde "Publicado · hace X" · ámbar "Cambios sin publicar" / "con avisos" · rojo
// "Error" · gris "Sin publicar". Al clicar abre un panel con estado POR CONEXIÓN
// y el historial reciente (modelo Otter, contextual a la marca).
//
// Se refresca al cambiar de marca y tras publicar (prop refreshKey).

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertTriangle, CircleDashed, Loader2, X, History } from 'lucide-react'
import {
  getBrandPublishStatus,
  getBrandPublishHistory,
  type BrandPublishStatus,
  type PublishHistoryEntry,
  type PublishState,
} from '@/modules/kitchen/services/publishStatusService'

interface Props {
  accountId: string
  brandId: string
  refreshKey?: number   // incrementar para forzar recarga (p. ej. tras publicar)
}

function relTime(iso: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const min = Math.round(diff / 60000)
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  if (d < 30) return `hace ${d} día${d > 1 ? 's' : ''}`
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

function chipStyle(state: PublishState): { cls: string; icon: ReactNode; label: (s: BrandPublishStatus) => string } {
  switch (state) {
    case 'published':
      return {
        cls: 'bg-green-50 border-green-200 text-green-700',
        icon: <CheckCircle2 className="w-3.5 h-3.5" />,
        label: (s) => `Publicado · ${relTime(s.lastPublishAt)}`,
      }
    case 'stale':
      return {
        cls: 'bg-amber-50 border-amber-200 text-amber-700',
        icon: <AlertTriangle className="w-3.5 h-3.5" />,
        label: () => 'Cambios sin publicar',
      }
    case 'partial':
      return {
        cls: 'bg-amber-50 border-amber-200 text-amber-700',
        icon: <AlertTriangle className="w-3.5 h-3.5" />,
        label: () => 'Publicado con avisos',
      }
    case 'error':
      return {
        cls: 'bg-red-50 border-red-200 text-red-700',
        icon: <AlertTriangle className="w-3.5 h-3.5" />,
        label: () => 'Error al publicar',
      }
    default:
      return {
        cls: 'bg-gray-50 border-gray-200 text-gray-500',
        icon: <CircleDashed className="w-3.5 h-3.5" />,
        label: () => 'Sin publicar',
      }
  }
}

function statusDot(status: string): string {
  if (status === 'ok') return 'text-green-600'
  if (status === 'error') return 'text-red-600'
  return 'text-gray-400'
}

export default function PublishStatusChip({ accountId, brandId, refreshKey }: Props) {
  const [status, setStatus] = useState<BrandPublishStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<PublishHistoryEntry[] | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getBrandPublishStatus(accountId, brandId)
      .then((s) => { if (!cancelled) setStatus(s) })
      .catch(() => { if (!cancelled) setStatus(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [accountId, brandId, refreshKey])

  // Cerrar el panel al hacer clic fuera
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && history === null) {
      setLoadingHistory(true)
      getBrandPublishHistory(accountId, brandId, 5)
        .then(setHistory)
        .catch(() => setHistory([]))
        .finally(() => setLoadingHistory(false))
    }
  }

  // Al refrescar (nueva publicación o cambio de marca) invalidamos el historial cacheado
  useEffect(() => { setHistory(null) }, [accountId, brandId, refreshKey])

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border bg-gray-50 border-gray-200 text-gray-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Estado…
      </span>
    )
  }
  if (!status) return null

  const style = chipStyle(status.state)

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border font-medium ${style.cls} hover:opacity-90`}
        title="Ver estado de publicación"
      >
        {style.icon}
        {style.label(status)}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 z-30 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200">
            <span className="text-sm font-medium text-gray-900">Estado de publicación</span>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700" aria-label="Cerrar">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-4 py-3 space-y-3 max-h-[60vh] overflow-auto">
            {/* Resumen */}
            <div className="text-xs text-gray-600">
              {status.state === 'never'
                ? 'Esta carta aún no se ha publicado.'
                : status.state === 'stale'
                  ? `Hay cambios en la carta posteriores a la última publicación (${relTime(status.lastPublishAt)}). Vuelve a publicar para enviarlos.`
                  : status.state === 'error'
                    ? 'La última publicación falló. Revisa el detalle por conexión.'
                    : `Última publicación ${relTime(status.lastPublishAt)}.`}
            </div>

            {/* Estado por conexión */}
            {status.targets.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Por conexión</div>
                <ul className="space-y-1">
                  {status.targets.map((t, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      {t.status === 'ok'
                        ? <CheckCircle2 className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${statusDot(t.status)}`} />
                        : <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${statusDot(t.status)}`} />}
                      <span className="min-w-0">
                        <span className="font-medium text-gray-800">{t.connectionName ?? t.externalCatalogId}</span>
                        {t.publishedAt && t.status === 'ok' && (
                          <span className="text-gray-400"> · {relTime(t.publishedAt)}</span>
                        )}
                        {t.status === 'error' && t.errorText && (
                          <span className="block text-red-600 break-words">{t.errorText}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Historial */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1 flex items-center gap-1">
                <History className="w-3 h-3" /> Historial
              </div>
              {loadingHistory ? (
                <div className="text-xs text-gray-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> cargando…</div>
              ) : history && history.length > 0 ? (
                <ul className="space-y-1">
                  {history.map((h) => {
                    const ok = h.status === 'done'
                    const partial = h.status === 'partial'
                    return (
                      <li key={h.id} className="flex items-center gap-2 text-xs">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? 'bg-green-500' : partial ? 'bg-amber-500' : 'bg-red-500'}`} />
                        <span className="text-gray-600">{relTime(h.requestedAt)}</span>
                        <span className="text-gray-400">·</span>
                        <span className={ok ? 'text-green-700' : partial ? 'text-amber-700' : 'text-red-700'}>
                          {ok ? 'Publicado' : partial ? 'Con avisos' : 'Error'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <div className="text-xs text-gray-400">Sin publicaciones previas.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
