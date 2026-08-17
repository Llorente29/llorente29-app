// src/admin/pages/HubriseOpsPage.tsx
//
// Tablero de vigilancia HubRise (Fase 3, A.1 — Portal de staff, superadmin-only).
// Una llamada a hubrise_ops_dashboard(); "Verificar callback ahora" es un GET
// puntual con causa humana (el clic), nunca un bucle — ver folvy_mapa_sistema.md,
// regla permanente "ningún cron sondea GET /callback" (Trampa 15).
//
// Por qué primero: el token caído 8 días, los 401 sin rastro y el "conectado y
// mudo" fueron fallos de VISIBILIDAD, no de conexión — esta pantalla los caza
// el día 1. token_invalido y revoke_pending van arriba, siempre visibles sin
// scroll — nunca solo color, siempre icono + texto (regla de Julio).

import { useEffect, useState, useCallback } from 'react'
import { AlertTriangle, CheckCircle2, XCircle, Clock, CircleDashed, RefreshCw, Loader2 } from 'lucide-react'
import HubriseBrandCatalogPanel from '@/modules/kitchen/components/HubriseBrandCatalogPanel'
import {
  getHubriseOpsDashboard,
  verifyHubriseCallbackNow,
  type HubriseOpsDashboard,
  type HubriseOpsLocationRow,
  type HealthStatus,
  type CallbackHealthStatus,
} from '../services/hubriseOpsService'

const RED = { bg: '#FDECEC', border: '#E5A0A0', text: '#A12626' }
const AMBER = { bg: '#FDF3E3', border: '#E8C77A', text: '#8A5A00' }
const GREEN = { bg: '#EAF6EC', border: '#A9D8B4', text: '#1E6B33' }
const GRAY = { bg: '#F5F4F0', border: '#DDD8CE', text: '#666666' }

function fmtWhen(iso: string | null): string {
  if (!iso) return 'nunca'
  return new Date(iso).toLocaleString('es-ES')
}

const STATUS_LABEL: Record<HubriseOpsLocationRow['status'], string> = {
  conectado: 'Conectado',
  token_invalido: 'Token inválido',
  sin_conectar: 'Sin conectar',
  conectando: 'Conectando…',
  local_inactivo: 'Local inactivo',
}

function StatusBadge({ status }: { status: HubriseOpsLocationRow['status'] }) {
  const c = status === 'token_invalido' ? RED : status === 'conectado' ? GREEN : status === 'conectando' ? AMBER : GRAY
  const Icon = status === 'token_invalido' ? XCircle : status === 'conectado' ? CheckCircle2 : status === 'conectando' ? Clock : CircleDashed
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text }}
    >
      <Icon size={13} />
      {STATUS_LABEL[status]}
    </span>
  )
}

function HealthBadge({ value, okLabel, invalidLabel, unknownLabel }: {
  value: HealthStatus | CallbackHealthStatus
  okLabel: string
  invalidLabel: string
  unknownLabel: string
}) {
  const isBad = value === 'invalid' || value === 'missing'
  const c = value === 'ok' ? GREEN : isBad ? RED : GRAY
  const Icon = value === 'ok' ? CheckCircle2 : isBad ? XCircle : CircleDashed
  const label = value === 'ok' ? okLabel : isBad ? invalidLabel : unknownLabel
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: c.text }}>
      <Icon size={13} />
      {label}
    </span>
  )
}

function CriticalBanner({ locations }: { locations: HubriseOpsLocationRow[] }) {
  const invalid = locations.filter(l => l.status === 'token_invalido')
  const pending = locations.filter(l => l.revokePending)
  if (invalid.length === 0 && pending.length === 0) {
    return (
      <div
        className="rounded-lg p-3 mb-5 flex items-center gap-2 text-sm"
        style={{ background: GREEN.bg, border: `1px solid ${GREEN.border}`, color: GREEN.text }}
      >
        <CheckCircle2 size={16} />
        Sin tokens inválidos ni revocaciones pendientes ahora mismo.
      </div>
    )
  }
  return (
    <div className="rounded-lg p-3 mb-5" style={{ background: RED.bg, border: `1px solid ${RED.border}` }}>
      <p className="text-sm font-medium flex items-center gap-2" style={{ color: RED.text }}>
        <AlertTriangle size={16} />
        Atención inmediata
      </p>
      <ul className="text-sm mt-1.5 space-y-1" style={{ color: RED.text }}>
        {invalid.map(l => (
          <li key={`ti-${l.locationId}`}>
            <b>{l.accountName}</b> · {l.locationName} — token inválido, re-autoriza la conexión.
          </li>
        ))}
        {pending.map(l => (
          <li key={`rp-${l.locationId}`}>
            <b>{l.accountName}</b> · {l.locationName} — revocación de token pendiente (reintenta desde el asistente).
          </li>
        ))}
      </ul>
    </div>
  )
}

function BrandDiffNote({ row }: { row: HubriseOpsLocationRow }) {
  if (!row.brandDiff) return null
  return (
    <div className="mt-2 rounded-md p-2.5 text-xs" style={{ background: AMBER.bg, border: `1px solid ${AMBER.border}`, color: AMBER.text }}>
      <AlertTriangle size={12} className="inline mr-1.5 -mt-0.5" />
      {row.brandsCatalogOnly.length > 0 && (
        <span>
          <b>Publica pero no atribuye:</b> {row.brandsCatalogOnly.join(', ')} — tiene catálogo publicado pero no está
          mapeada en <code>external_brand_map</code>.
          {row.brandsMappedOnly.length > 0 && ' '}
        </span>
      )}
      {row.brandsMappedOnly.length > 0 && (
        <span>
          <b>Atribuye pero no publica:</b> {row.brandsMappedOnly.join(', ')} — mapeada pero sin catálogo publicado.
        </span>
      )}
    </div>
  )
}

function CallbackCell({ row, onVerified }: { row: HubriseOpsLocationRow; onVerified: (integrationId: string, ok: boolean, outcome: string | null, error: string | null) => void }) {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; outcome: string | null; error: string | null } | null>(null)

  const canCheck = !!row.integrationId

  async function handleVerify() {
    if (!row.integrationId) return
    setChecking(true)
    setResult(null)
    try {
      const r = await verifyHubriseCallbackNow(row.integrationId)
      setResult(r)
      onVerified(row.integrationId, r.ok, r.outcome, r.error)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error verificando el callback.'
      setResult({ ok: false, outcome: null, error: msg })
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex flex-col gap-1 items-start">
      <HealthBadge value={row.callbackStatus} okLabel="Callback OK" invalidLabel="Callback ausente" unknownLabel="Callback sin verificar" />
      <span className="text-[10px]" style={{ color: GRAY.text }}>{fmtWhen(row.callbackCheckedAt)}</span>
      <button
        type="button"
        onClick={handleVerify}
        disabled={!canCheck || checking}
        className="inline-flex items-center gap-1 text-[11px] rounded-md px-2 py-1 mt-0.5 disabled:opacity-40"
        style={{ background: 'var(--color-bg-page, #F5F4F0)', border: '1px solid var(--color-border, #ddd)', color: 'var(--color-accent, #1E3A5F)' }}
        title={canCheck ? 'GET puntual contra HubRise, con causa (este clic) — no es un cron.' : 'Sin conexión que verificar.'}
      >
        {checking ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
        Verificar callback ahora
      </button>
      {result && (
        <span className="text-[10px]" style={{ color: result.ok ? GREEN.text : RED.text }}>
          {result.error ?? `Resultado: ${result.outcome ?? '?'}`}
        </span>
      )}
    </div>
  )
}

export default function HubriseOpsPage() {
  const [dashboard, setDashboard] = useState<HubriseOpsDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    getHubriseOpsDashboard()
      .then(setDashboard)
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // Refresco local del punto tocado tras "Verificar callback ahora" — sin
  // relanzar toda la RPC, solo el dato que de verdad cambió. Empareja por
  // integrationId (no locationId): una location puede tener más de una
  // conexión hubrise visible ahora (la estándar + una no estándar activa).
  function handleCallbackVerified(integrationId: string, ok: boolean, outcome: string | null) {
    if (!ok) return
    setDashboard(prev => {
      if (!prev) return prev
      return {
        ...prev,
        locations: prev.locations.map(l => l.integrationId === integrationId
          ? { ...l, callbackStatus: outcome === 'noop' || outcome === 'reregistered' ? 'ok' : 'unknown', callbackCheckedAt: new Date().toISOString() }
          : l),
      }
    })
  }

  if (loading) return <p className="text-sm" style={{ color: GRAY.text }}>Cargando tablero HubRise…</p>
  if (error) return (
    <div className="rounded-lg p-3" style={{ background: RED.bg, border: `1px solid ${RED.border}` }}>
      <p className="text-sm" style={{ color: RED.text }}>{error}</p>
    </div>
  )
  if (!dashboard) return null

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-display font-medium" style={{ color: 'var(--color-accent, #1E3A5F)' }}>HubRise — Operación</h1>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 text-xs rounded-md px-2.5 py-1.5"
          style={{ border: '1px solid var(--color-border, #ddd)', color: 'var(--color-accent, #1E3A5F)' }}
        >
          <RefreshCw size={12} /> Actualizar
        </button>
      </div>
      <p className="text-sm mb-5" style={{ color: GRAY.text }}>
        Vigilancia cruzada entre cuentas — token caído, callback ausente o marca sin atribuir, todo visible aquí sin
        entrar en Supabase. {dashboard.alerts48h > 0 && (
          <span style={{ color: AMBER.text }}>· {dashboard.alerts48h} alerta(s) HubRise en las últimas 48 h.</span>
        )}
      </p>

      <CriticalBanner locations={dashboard.locations} />

      {/* Escritoras de cuenta */}
      <div className="rounded-lg p-4 mb-6" style={{ background: '#fff', border: '1px solid var(--color-border, #e5e5e5)' }}>
        <p className="text-sm font-medium mb-3" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>Escritoras de cuenta (catálogo/inventario)</p>
        {dashboard.writers.length === 0 ? (
          <p className="text-sm" style={{ color: GRAY.text }}>Sin conexiones escritoras.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs" style={{ color: GRAY.text }}>
                  <th className="pb-2 font-medium">Cuenta</th>
                  <th className="pb-2 font-medium">Cuenta HubRise</th>
                  <th className="pb-2 font-medium">Token</th>
                  <th className="pb-2 font-medium">Comprobado</th>
                  <th className="pb-2 font-medium">Conectada desde</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.writers.map(w => (
                  <tr key={w.accountId} className="border-t" style={{ borderColor: 'var(--color-border, #eee)' }}>
                    <td className="py-2 font-medium">{w.accountName}</td>
                    <td className="py-2">{w.hubriseAccountId ?? '—'}</td>
                    <td className="py-2"><HealthBadge value={w.tokenStatus} okLabel="Vivo" invalidLabel="Caducado" unknownLabel="Sin verificar" /></td>
                    <td className="py-2 text-xs" style={{ color: GRAY.text }}>{fmtWhen(w.tokenCheckedAt)}</td>
                    <td className="py-2 text-xs" style={{ color: GRAY.text }}>{fmtWhen(w.connectedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Locations */}
      <div className="rounded-lg p-4" style={{ background: '#fff', border: '1px solid var(--color-border, #e5e5e5)' }}>
        <p className="text-sm font-medium mb-3" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>Locations conectadas (pedidos)</p>
        {dashboard.locations.length === 0 ? (
          <p className="text-sm" style={{ color: GRAY.text }}>Sin locations con rastro de HubRise.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {dashboard.locations.map(row => (
              <div
                key={`${row.locationId}-${row.integrationId ?? row.connectionName ?? 'none'}`}
                className="rounded-lg p-3"
                style={row.isStandardConnection ? { border: '1px solid var(--color-border, #eee)' } : { border: `1px solid ${AMBER.border}` }}
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>
                      {row.accountName} · {row.locationName}
                    </p>
                    {!row.isStandardConnection && (
                      <p className="text-xs font-medium mt-0.5" style={{ color: AMBER.text }}>
                        <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />
                        Conexión no estándar: {row.connectionName ?? '?'}
                      </p>
                    )}
                    <p className="text-xs" style={{ color: GRAY.text }}>
                      {row.externalLocationId ?? '—'}
                      {row.externalAccountName ? ` · ${row.externalAccountName}` : ''}
                      {row.externalLocationName ? ` (${row.externalLocationName})` : ''}
                    </p>
                  </div>
                  <StatusBadge status={row.status} />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: GRAY.text }}>Token</p>
                    <HealthBadge value={row.tokenStatus} okLabel="Vivo" invalidLabel="Caducado" unknownLabel="Sin verificar" />
                    <p className="text-[10px] mt-0.5" style={{ color: GRAY.text }}>{fmtWhen(row.tokenCheckedAt)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: GRAY.text }}>Callback</p>
                    <CallbackCell row={row} onVerified={handleCallbackVerified} />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: GRAY.text }}>Último pedido</p>
                    <p className="text-xs font-medium" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>{fmtWhen(row.lastOrderAt)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: GRAY.text }}>Revocación</p>
                    {row.revokePending ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: RED.text }}>
                        <AlertTriangle size={12} /> Pendiente
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: GRAY.text }}>—</span>
                    )}
                  </div>
                </div>

                <BrandDiffNote row={row} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Catálogos de marca — herramienta de operación, no vigilancia. Va debajo
          del tablero porque el tablero es lo que se mira; esto es lo que se usa
          cuando el tablero dice que falta algo. */}
      <div className="mt-6">
        <HubriseBrandCatalogPanel />
      </div>

      <p className="text-xs mt-4" style={{ color: '#aaa' }}>
        Generado {fmtWhen(dashboard.generatedAt)}
      </p>
    </div>
  )
}
