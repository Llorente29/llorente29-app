// src/modules/kds/components/BrandCloseControl.tsx
//
// FASE B · CAP. B — Cerrar marca. Botón que abre un selector de marca +
// cierre (duración) / reapertura, reutilizando la MISMA maquinaria de
// disponibilidad (set_brand_status(_by_token) -> availability-dispatch en
// modo batch). Nunca toca los productos compartidos (stock_group) de la
// marca: solo los ref por-marca.
//
// El selector SOLO lista marcas con presencia real en HubRise (catálogo Fase
// 2 o mapeo bridge utilizable) — las cedidas (solo Last, sin catálogo
// HubRise) quedan fuera: cerrarlas sería una promesa falsa (Folvy no escribe
// en Last, y availability-dispatch no tendría catálogo que tocar). Doble
// puerta vía la MISMA RPC (brands_for_closure) para oficina y tablet.

import { useCallback, useEffect, useState } from 'react'
import { Store, Search, Lock, Unlock, Loader2, AlertTriangle, X } from 'lucide-react'
import {
  getBrandStatus, setBrandStatus, setBrandStatusByToken, listBrandsForClosure,
  type BrandOption, type BrandStatus,
} from '../services/kdsService'
import { themeCls } from '../lib/theme'
import ReasonSelect from './ReasonSelect'
import { reasonCodeParam, type ReasonCode } from '../lib/reasonCode'

interface Props {
  accountId?: string | null   // oficina (sesión)
  token?: string | null       // tablet
  dark?: boolean
}

const DURATIONS: { label: string; minutes: number | null }[] = [
  { label: '30 min', minutes: 30 },
  { label: '1 hora', minutes: 60 },
  { label: '2 horas', minutes: 120 },
  { label: '4 horas', minutes: 240 },
  { label: 'Hasta que reabra a mano', minutes: null },
]

export default function BrandCloseControl({ accountId, token, dark = false }: Props) {
  const [open, setOpen] = useState(false)
  const t = themeCls(dark ? 'dark' : 'light')
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium ${t.buttonOutline}`}
      >
        <Store size={16} /> Cerrar marca
      </button>
    )
  }
  return <BrandCloseModal accountId={accountId} token={token} dark={dark} onClose={() => setOpen(false)} />
}

function BrandCloseModal({ accountId, token, dark, onClose }: Props & { onClose: () => void }) {
  const [brands, setBrands] = useState<BrandOption[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<BrandOption | null>(null)
  const [status, setStatus] = useState<BrandStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showDurations, setShowDurations] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reasonCode, setReasonCode] = useState<ReasonCode | ''>('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    listBrandsForClosure(accountId ?? null, token)
      .then((rows) => { if (alive) setBrands(rows) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Error cargando marcas') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [accountId, token])

  const refreshStatus = useCallback(async (brandId: string) => {
    setStatusLoading(true)
    try {
      setStatus(await getBrandStatus(brandId, token))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error cargando estado')
    } finally {
      setStatusLoading(false)
    }
  }, [token])

  function pick(b: BrandOption) {
    setPicked(b)
    setError(null)
    void refreshStatus(b.id)
  }

  async function apply(minutes: number | null) {
    if (!picked) return
    setBusy(true); setError(null)
    try {
      const resumeAt = minutes !== null ? new Date(Date.now() + minutes * 60_000).toISOString() : null
      const code = reasonCodeParam(reasonCode)
      if (token) await setBrandStatusByToken(token, picked.id, 'paused', resumeAt, 'manual', code)
      else await setBrandStatus(picked.id, 'paused', resumeAt, 'manual', code)
      setShowDurations(false)
      setReasonCode('')
      await refreshStatus(picked.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cerrar la marca')
    } finally {
      setBusy(false)
    }
  }

  async function reopen() {
    if (!picked) return
    setBusy(true); setError(null)
    try {
      if (token) await setBrandStatusByToken(token, picked.id, 'normal')
      else await setBrandStatus(picked.id, 'normal')
      await refreshStatus(picked.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo reabrir la marca')
    } finally {
      setBusy(false)
    }
  }

  const filtered = brands.filter((b) => b.name.toLowerCase().includes(q.trim().toLowerCase()))
  const t = themeCls(dark ? 'dark' : 'light')

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className={`w-full max-w-sm rounded-xl overflow-hidden ${t.panel}`} onClick={(e) => e.stopPropagation()}>
        <div className={`flex items-center justify-between px-4 py-3 border-b ${t.border}`}>
          <h2 className="text-base font-semibold">Cerrar marca</h2>
          <button onClick={onClose} className={t.iconButton}>
            <X size={18} />
          </button>
        </div>

        <div className="p-4">
          {!picked ? (
            <>
              <div className="relative mb-3">
                <Search size={15} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${t.textMuted}`} />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar marca…"
                  className={`w-full pl-8 pr-3 py-2 rounded-lg text-sm ${t.input}`}
                />
              </div>
              {loading ? (
                <div className="py-6 text-center text-sm opacity-60"><Loader2 size={16} className="animate-spin inline" /></div>
              ) : brands.length === 0 ? (
                <p className={`text-sm px-1 py-4 ${t.textMuted}`}>
                  Ninguna marca de esta cuenta está conectada a HubRise todavía. Las marcas cedidas (solo Last) se gestionan en Last.
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto flex flex-col gap-1">
                  {filtered.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => pick(b)}
                      className={`text-left px-3 py-2 rounded-lg text-sm ${t.hoverBg}`}
                    >
                      {b.name}
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <p className={`text-sm px-3 py-2 ${t.textMuted}`}>Sin resultados.</p>
                  )}
                </div>
              )}
            </>
          ) : statusLoading || !status ? (
            <div className="py-6 text-center text-sm opacity-60"><Loader2 size={16} className="animate-spin inline" /></div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 mb-3">
                <span className={`w-2.5 h-2.5 rounded-full ${status.mode === 'normal' ? 'bg-success' : 'bg-danger'}`} />
                <div>
                  <p className="text-sm font-semibold">{status.brand_name}</p>
                  <p className={`text-xs ${t.textSecondary}`}>
                    {status.mode === 'normal'
                      ? 'Abierta'
                      : status.resume_at
                        ? `Cerrada hasta las ${new Date(status.resume_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
                        : 'Cerrada indefinidamente'}
                  </p>
                </div>
              </div>

              {status.mode === 'normal' ? (
                <>
                  <button
                    onClick={() => setShowDurations((v) => !v)}
                    disabled={busy}
                    className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold bg-danger text-white hover:opacity-90 disabled:opacity-50"
                  >
                    <Lock size={14} /> Cerrar {status.brand_name}
                  </button>
                  {showDurations && (
                    <>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {DURATIONS.map((d) => (
                          <button
                            key={d.label}
                            onClick={() => void apply(d.minutes)}
                            disabled={busy}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 ${t.chipNeutral}`}
                          >
                            {d.label}
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 flex items-center gap-1.5">
                        <span className={`text-xs ${t.textMuted}`}>Motivo (opcional):</span>
                        <ReasonSelect value={reasonCode} onChange={setReasonCode} theme={dark ? 'dark' : 'light'} />
                      </div>
                    </>
                  )}
                </>
              ) : (
                <button
                  onClick={() => void reopen()}
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold bg-success text-white hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />} Reabrir ahora
                </button>
              )}

              <button
                onClick={() => { setPicked(null); setStatus(null); setShowDurations(false); setReasonCode('') }}
                className={`mt-3 text-xs font-medium ${t.linkMuted}`}
              >
                ← Elegir otra marca
              </button>
            </>
          )}

          {error && (
            <div className="mt-3 flex items-center gap-1.5 text-xs text-danger">
              <AlertTriangle size={13} /> {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
