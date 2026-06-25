// src/modules/integrations/pages/ConnectorDetailPage.tsx
//
// Detalle / configuración de un conector. Patrón LISTA+DETALLE por estado (como
// Kitchen): recibe connector + accountConnector + onBack; no usa router params.
// La monta el Marketplace cuando se selecciona un conector.
//
// Renderiza un FORMULARIO DINÁMICO desde connector.configSchema:
//   - campos type:'secret'  → se cifran en Vault (vía Edge Function). Enmascarados.
//   - resto (text/number/boolean) → config no sensible (account_connector.config).
//
// Guardar → si NO existe conexión todavía, la CREA (upsertAccountConnector) y
// luego guarda credenciales en ella. Así un conector de tipo 'credentials' se
// activa al configurar, sin paso previo de "solicitar".
//
// El secreto NUNCA se muestra una vez guardado: el estado se lee como booleano
// (hasCredentials). Para cambiarlo, se re-introduce.

import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Loader2, ShieldCheck, Trash2 } from 'lucide-react'
import ConnectorAvatar from '@/modules/integrations/components/ConnectorAvatar'
import {
  saveConnectorCredentials,
  getConnectorCredentialsStatus,
  clearConnectorCredentials,
} from '@/modules/integrations/services/connectorCredentialsService'
import { upsertAccountConnector } from '@/modules/integrations/services/connectorService'
import type {
  Connector,
  AccountConnector,
  ConnectorConfigField,
} from '@/types/integrations'

const DIRECTION_LABEL: Record<string, string> = {
  inbound: 'Recibe datos',
  outbound: 'Envía datos',
  bidirectional: 'Bidireccional',
}

interface ConnectorDetailPageProps {
  connector: Connector
  accountConnector: AccountConnector | null // null si aún no hay conexión creada
  accountId: string                          // cuenta activa (para crear la conexión)
  locationId: string | null                  // local activo (Catcher es por local)
  createdBy?: string | null
  createdByName?: string | null
  onBack: () => void
  onChanged?: () => void
}

export default function ConnectorDetailPage({
  connector, accountConnector, accountId, locationId,
  createdBy, createdByName, onBack, onChanged,
}: ConnectorDetailPageProps) {
  const fields = connector.configSchema?.fields ?? []
  const secretFields = fields.filter(f => f.type === 'secret')
  const plainFields = fields.filter(f => f.type !== 'secret')

  // La conexión puede crearse en este componente; la guardamos en estado local.
  const [conn, setConn] = useState<AccountConnector | null>(accountConnector)

  const [values, setValues] = useState<Record<string, string>>({})
  const [hasCredentials, setHasCredentials] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  useEffect(() => { setConn(accountConnector) }, [accountConnector])

  useEffect(() => {
    const initial: Record<string, string> = {}
    const cfg = (conn?.config as Record<string, unknown> | null) ?? null
    for (const f of fields) {
      if (f.type === 'secret') {
        initial[f.key] = ''
      } else if (cfg && cfg[f.key] !== undefined && cfg[f.key] !== null) {
        initial[f.key] = String(cfg[f.key])
      } else {
        initial[f.key] = ''
      }
    }
    setValues(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connector.id, conn?.id])

  useEffect(() => {
    if (!conn?.id) { setLoadingStatus(false); return }
    let cancelled = false
    setLoadingStatus(true)
    getConnectorCredentialsStatus(conn.id)
      .then(res => {
        if (cancelled) return
        if (res.ok) setHasCredentials(res.hasCredentials)
        setLoadingStatus(false)
      })
      .catch(() => { if (!cancelled) setLoadingStatus(false) })
    return () => { cancelled = true }
  }, [conn?.id])

  function setField(key: string, v: string) {
    setValues(prev => ({ ...prev, [key]: v }))
  }

  function castPlain(field: ConnectorConfigField, raw: string): unknown {
    if (field.type === 'boolean') return raw === 'true'
    if (field.type === 'number') {
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    }
    return raw
  }

  async function handleSave() {
    // Validar requeridos.
    for (const f of fields) {
      if (f.required && f.type === 'secret' && !hasCredentials && !values[f.key]?.trim()) {
        setError(`El campo "${f.label}" es obligatorio.`); return
      }
      if (f.required && f.type !== 'secret' && !values[f.key]?.trim()) {
        setError(`El campo "${f.label}" es obligatorio.`); return
      }
    }
    setSaving(true); setError(null); setOkMsg(null)

    const secrets: Record<string, string> = {}
    for (const f of secretFields) {
      const v = values[f.key]?.trim()
      if (v) secrets[f.key] = v
    }
    const config: Record<string, unknown> = {}
    for (const f of plainFields) {
      config[f.key] = castPlain(f, values[f.key] ?? '')
    }

    try {
      // Si no existe la conexión todavía, la creamos ahora (activación al configurar).
      let connection = conn
      if (!connection) {
        connection = await upsertAccountConnector({
          accountId,
          connectorId: connector.id,
          status: 'connecting',
          scope: locationId ? 'location' : 'account',
          locationId: locationId ?? null,
          config,
          createdBy: createdBy ?? null,
          createdByName: createdByName ?? null,
        })
        setConn(connection)
      }

      const res = await saveConnectorCredentials({
        accountConnectorId: connection.id,
        secrets,
        config,
      })
      if (!res.ok) { setError(res.error); setSaving(false); return }
      setHasCredentials(prev => prev || Object.keys(secrets).length > 0)
      setOkMsg('Configuración guardada de forma segura.')
      setValues(prev => {
        const next = { ...prev }
        for (const f of secretFields) next[f.key] = ''
        return next
      })
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    if (!conn?.id) return
    const ok = window.confirm(
      `¿Desconectar ${connector.name}? Se borrarán sus credenciales guardadas.`,
    )
    if (!ok) return
    setClearing(true); setError(null); setOkMsg(null)
    try {
      const res = await clearConnectorCredentials(conn.id)
      if (!res.ok) { setError(res.error); setClearing(false); return }
      setHasCredentials(false)
      setOkMsg('Integración desconectada.')
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo desconectar.')
    } finally {
      setClearing(false)
    }
  }

  const canSave = !!accountId  // con cuenta activa ya podemos crear+guardar

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary transition-base"
      >
        <ArrowLeft size={16} />
        Marketplace
      </button>

      <div className="rounded-xl border border-border-default bg-card">
        <div className="flex items-center gap-3 px-4 py-4 border-b border-border-default">
          <ConnectorAvatar name={connector.name} code={connector.code} logoUrl={connector.logoUrl} size={52} />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-text-primary">{connector.name}</h1>
            <p className="text-xs text-text-secondary">
              {DIRECTION_LABEL[connector.direction] ?? connector.direction}
              {hasCredentials && (
                <span className="inline-flex items-center gap-1 text-success ml-2">
                  <ShieldCheck size={13} /> Credenciales guardadas
                </span>
              )}
            </p>
          </div>
        </div>

        {connector.description && (
          <p className="px-4 pt-3 text-sm text-text-secondary">{connector.description}</p>
        )}

        <div className="px-4 py-4 space-y-3">
          {fields.length === 0 ? (
            <p className="text-sm text-text-secondary">
              Este conector no requiere configuración manual.
            </p>
          ) : (
            fields.map(f => (
              <div key={f.key}>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  {f.label}{f.required ? ' *' : ''}
                </label>
                {f.type === 'boolean' ? (
                  <select
                    value={values[f.key] ?? 'false'}
                    onChange={e => setField(f.key, e.target.value)}
                    disabled={saving}
                    className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                  >
                    <option value="true">Sí</option>
                    <option value="false">No</option>
                  </select>
                ) : (
                  <input
                    type={f.type === 'secret' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                    value={values[f.key] ?? ''}
                    onChange={e => setField(f.key, e.target.value)}
                    disabled={saving}
                    placeholder={f.type === 'secret' && hasCredentials ? '•••••••• (guardado — escribe para cambiar)' : ''}
                    autoComplete="off"
                    className="w-full px-2 py-1.5 text-sm border border-border-default rounded-md bg-page text-text-primary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                  />
                )}
                {f.type === 'secret' && (
                  <p className="text-[11px] text-text-secondary mt-1 inline-flex items-center gap-1">
                    <ShieldCheck size={11} /> Se guarda cifrado. No se vuelve a mostrar.
                  </p>
                )}
              </div>
            ))
          )}

          {error && (
            <div className="p-2 rounded-md bg-danger-bg text-danger border border-danger/20 text-xs">{error}</div>
          )}
          {okMsg && (
            <div className="p-2 rounded-md bg-success-bg text-success border border-success/20 text-xs">{okMsg}</div>
          )}

          {fields.length > 0 && (
            <div className="flex items-center justify-between gap-2 pt-1">
              {hasCredentials ? (
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={clearing || saving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md text-danger hover:bg-danger-bg transition-base disabled:opacity-50"
                >
                  {clearing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Desconectar
                </button>
              ) : <span />}
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || loadingStatus || !canSave}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Guardando…' : conn ? 'Guardar configuración' : 'Conectar y guardar'}
              </button>
            </div>
          )}

          {!accountId && (
            <p className="text-xs text-warning border-t border-border-default pt-3">
              Selecciona una cuenta o local activo para configurar esta integración.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
