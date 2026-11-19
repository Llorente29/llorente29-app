// src/modules/integrations/pages/IntegrationsPage.tsx
//
// Índice de Folvy Connect: "Tus integraciones" — las conexiones de la cuenta
// (account_connector) con su estado, cruzadas con el catálogo (connector) para
// mostrar nombre/logo.
//
// REDISEÑO (visual): cada conexión muestra el LOGO real de la plataforma
// (ConnectorAvatar, con fallback a inicial+color de marca). Tokens del sistema,
// cabecera con icono lucide, tarjetas rounded-xl border bg-card.
//
// Honestidad: LISTA las conexiones reales y su estado. Si no hay conexiones,
// invita a ir al Marketplace.
//
// B01r26 (15/11): cualquier estado se pinta (estadoConexion.ts) — `down`, que
// deja una renovación fallida del token de Diez, rompía la página entera — y
// cada conexión abre SU detalle para configurarla o volver a guardar sus
// credenciales (el Marketplace abre la primera del conector, y Catcher tiene
// una por local).

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plug, Loader2, CheckCircle2, Clock, AlertTriangle, PauseCircle, Store, Unplug, HelpCircle, KeyRound } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import { useApp } from '@/context/AppContext'
import {
  listConnectors,
  listAccountConnectors,
} from '@/modules/integrations/services/connectorService'
import ConnectorAvatar from '@/modules/integrations/components/ConnectorAvatar'
import ConnectorDetailPage from '@/modules/integrations/pages/ConnectorDetailPage'
import { presentacionDeEstado, type IconoEstado, type Tono } from '@/modules/integrations/lib/estadoConexion'
import type {
  Connector,
  AccountConnector,
} from '@/types/integrations'

// Presentación de cada estado (texto + color + icono), lenguaje de color del sistema.
const ICONO: Record<IconoEstado, React.ComponentType<{ size?: number; className?: string }>> = {
  enchufe: Plug, reloj: Clock, cargando: Loader2, bien: CheckCircle2,
  alerta: AlertTriangle, pausa: PauseCircle, caida: Unplug, duda: HelpCircle,
}
const TONO: Record<Tono, string> = {
  neutro: 'text-text-secondary', aviso: 'text-warning', bien: 'text-success', mal: 'text-danger',
}

export default function IntegrationsPage() {
  const { activeAccountId } = useActiveAccount()
  const { resolvedLocationId } = useLocationScope()
  const { userProfile, authUserId } = useApp()
  const navigate = useNavigate()

  const [connectors, setConnectors] = useState<Connector[]>([])
  const [connections, setConnections] = useState<AccountConnector[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)

  useEffect(() => {
    if (!activeAccountId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      listConnectors({ onlyAvailable: false }),
      listAccountConnectors({ accountId: activeAccountId }),
    ])
      .then(([cats, conns]) => {
        if (cancelled) return
        setConnectors(cats)
        setConnections(conns)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Error cargando tus integraciones')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [activeAccountId, vuelta])

  function connectorOf(connectorId: string): Connector | undefined {
    return connectors.find(c => c.id === connectorId)
  }

  const abiertaConn = abierta ? connections.find(c => c.id === abierta) ?? null : null
  const abiertaConnector = abiertaConn ? connectorOf(abiertaConn.connectorId) : undefined
  if (abiertaConn && abiertaConnector) {
    return (
      <ConnectorDetailPage
        connector={abiertaConnector}
        accountConnector={abiertaConn}
        accountId={activeAccountId ?? ''}
        locationId={resolvedLocationId ?? null}
        createdBy={authUserId ?? null}
        createdByName={userProfile?.displayName ?? null}
        onBack={() => setAbierta(null)}
        backLabel="Tus integraciones"
        onChanged={() => setVuelta(v => v + 1)}
      />
    )
  }

  return (
    <div className="space-y-5">
      {/* Cabecera */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Plug size={20} className="text-accent shrink-0" />
            <h1 className="text-xl font-semibold text-text-primary">Tus integraciones</h1>
          </div>
          <p className="text-sm text-text-secondary mt-1">
            Las plataformas y servicios que tienes conectados a Folvy.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('marketplace')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base shrink-0"
        >
          <Store size={15} />
          Marketplace
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-sm text-text-secondary">Cargando…</div>
      ) : connections.length === 0 ? (
        <div className="rounded-xl border border-border-default bg-card p-8 text-center">
          <Plug size={28} className="text-text-secondary mx-auto mb-3" />
          <p className="text-sm text-text-primary font-medium mb-1">Aún no tienes integraciones</p>
          <p className="text-sm text-text-secondary mb-4">
            Conecta Folvy con tus plataformas de delivery, tu TPV o tu logística desde el Marketplace.
          </p>
          <button
            type="button"
            onClick={() => navigate('marketplace')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base"
          >
            <Store size={15} />
            Ir al Marketplace
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {connections.map(conn => {
            const connector = connectorOf(conn.connectorId)
            // X10: las sociedades de ERP10 se ven dentro de su conector, no como integraciones sueltas.
            if (connector?.code === 'erp10' && conn.scope === 'company') return null
            const pres = presentacionDeEstado(conn.status)
            const Icon = ICONO[pres.icono]
            return (
              <div
                key={conn.id}
                className="flex flex-wrap items-center gap-3 p-4 rounded-xl border border-border-default bg-card"
              >
                <ConnectorAvatar
                  name={connector?.name ?? 'Conector'}
                  code={connector?.code ?? ''}
                  logoUrl={connector?.logoUrl ?? null}
                  size={44}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">
                    {connector?.name ?? 'Conector'}
                  </p>
                  {conn.lastError && pres.rota && (
                    <p className="text-xs text-danger break-words">{conn.lastError}</p>
                  )}
                </div>
                <span className={`inline-flex items-center gap-1.5 text-sm ${TONO[pres.tono]}`}>
                  <Icon size={15} className={conn.status === 'connecting' ? 'animate-spin' : ''} />
                  {pres.etiqueta}
                </span>
                {connector && (
                  <button
                    type="button"
                    onClick={() => setAbierta(conn.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium transition-base shrink-0 ${pres.rota ? 'bg-accent text-text-on-accent hover:opacity-90' : 'border border-border-default text-text-primary hover:bg-page'}`}
                  >
                    <KeyRound size={15} />
                    {pres.rota ? 'Volver a guardar las credenciales' : 'Configurar'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
