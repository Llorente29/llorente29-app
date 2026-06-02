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
// Guardar → connectorCredentialsService.save (Edge Function → wrappers Vault).
// El secreto NUNCA se muestra una vez guardado: el estado se lee como booleano
// (hasCredentials). Para cambiarlo, se re-introduce.
//
// Diseño: tokens del sistema, patrón visual de KitchenItemDetailPage.

import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Loader2, ShieldCheck, Trash2 } from 'lucide-react'
import ConnectorAvatar from '@/modules/integrations/components/ConnectorAvatar'
import {
  saveConnectorCredentials,
  getConnectorCredentialsStatus,
  clearConnectorCredentials,
} from '@/modules/integrations/services/connectorCredentialsService'
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
  onBack: () => void
  onChanged?: () => void // refresca la lista del Marketplace al guardar/limpiar
}

export default function ConnectorDetailPage({
  connector, accountConnector, onBack, onChanged,
}: ConnectorDetailPageProps) {
  const fields = connector.configSchema?.fields ?? []
  const secretFields = fields.filter(f => f.type === 'secret')
  const plainFields = fields.filter(f => f.type !== 'secret')

  // Valores del formulario (todos como string en el form; se castean al guardar).
  const [values, setValues] = useState<Record<string, string>>({})
  const [hasCredentials, setHasCredentials] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  // Inicializa los valores no-secretos desde account_connector.config (si hay).
  useEffect(() => {
    const initial: Record<string, string> = {}
    const cfg = (accountConnector?.config as Record<string, unknown> | null) ?? null
    for (const f of fields) {
      if (f.type === 'secret') {
        initial[f.key] = '' // los secretos nunca se precargan
      } else if (cfg && cfg[f.key] !== undefined && cfg[f.key] !== null) {
        initial[f.key] = String(cfg[f.key])
      } else {
        initial[f.key] = ''
      }
    }
    setValues(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connector.id, accountConnector?.id])

  // Estado de credenciales (¿hay secreto guardado?).
  useEffect(() => {
    if (!accountConnector?.id) { setLoadingStatus(false); return }
    let cancelled = false
    setLoadingStatus(true)
    getConnectorCredentialsStatus(accountConnector.id)
      .then(res => {
        if (cancelled) return
        if (res.ok) setHasCredentials(res.hasCredentials)
        setLoadingStatus(false)
      })
      .catch(() => { if (!cancelled) setLoadingStatus(false) })
    return () => { cancelled = true }
  }, [accountConnector?.id])

  function setField(key: string, v: string) {
    setValues(prev => ({ ...prev, [key]: v }))
  }

  // Castea un campo plano a su tipo real para guardar en config.
  function castPlain(field: ConnectorConfigField, raw: string): unknown {
    if (field.type === 'boolean') return raw === 'true'
    if (field.type === 'number') {
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    }
    return raw
  }

  async function handleSave() {
    if (!accountConnector?.id) {
      setError('Esta integración aún no está creada. Solicítala primero desde el Marketplace.')
      return
    }
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

    // Secretos: solo los que el usuario ha rellenado (si lo deja vacío y ya hay
    // credenciales, no se reenvía → se conserva el secreto actual).
    const secrets: Record<string, string> = {}
    for (const f of secretFields) {
      const v = values[f.key]?.trim()
      if (v) secrets[f.key] = v
    }
    // Config no sensible.
    const config: Record<string, unknown> = {}
    for (const f of plainFields) {
      config[f.key] = castPlain(f, values[f.key] ?? '')
    }

    try {
      // Si hay secretos nuevos, se guardan (cifrados). Si no hay secretos nuevos
      // pero sí config, igualmente llamamos a save (la Edge Function actualiza
      // config y, si no llegan secrets nuevos con credenciales ya presentes,
      // conserva el secreto). Para simplicidad: enviamos siempre.
      const res = await saveConnectorCredentials({
        accountConnectorId: accountConnector.id,
        secrets,
        config,
      })
      if (!res.ok) { setError(res.error); setSaving(false); return }
      setHasCredentials(prev => prev || Object.keys(secrets).length > 0)
      setOkMsg('Configuración guardada de forma segura.')
      // Limpiar los inputs de secreto en memoria tras guardar.
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
    if (!accountConnector?.id) return
    const ok = window.confirm(
      `¿Desconectar ${connector.name}? Se borrarán sus credenciales guardadas.`,
    )
    if (!ok) return
    setClearing(true); setError(null); setOkMsg(null)
    try {
      const res = await clearConnectorCredentials(accountConnector.id)
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

  return (
    <div className="space-y-4">
      {/* Cabecera */}
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

        {/* Formulario dinámico */}
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
                disabled={saving || loadingStatus || !accountConnector}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-base"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Guardando…' : 'Guardar configuración'}
              </button>
            </div>
          )}

          {!accountConnector && (
            <p className="text-xs text-warning border-t border-border-default pt-3">
              Esta integración aún no está activada en tu cuenta. Vuelve al Marketplace y pulsa
              su acción para crearla antes de configurar credenciales.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
