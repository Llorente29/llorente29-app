// src/modules/integrations/pages/IntegrationsMarketplacePage.tsx
//
// Marketplace de Folvy Connect: catálogo de conectores disponibles (connector).
//
// Patrón LISTA + DETALLE por estado (como Kitchen): si hay un conector
// seleccionado, monta ConnectorDetailPage; si no, la rejilla del catálogo.
//
// Los conectores tipo 'credentials' se ACTIVAN al configurar (el detalle crea la
// conexión al guardar). Los tipo 'request' siguen el flujo de solicitud.

import { useEffect, useState } from 'react'
import { Store, Loader2, Check, Settings2 } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import { useLocationScope } from '@/modules/multitenancy/hooks/useLocationScope'
import { useApp } from '@/context/AppContext'
import {
  listConnectors,
  listAccountConnectors,
  requestConnector,
} from '@/modules/integrations/services/connectorService'
import ConnectorAvatar from '@/modules/integrations/components/ConnectorAvatar'
import ConnectorDetailPage from '@/modules/integrations/pages/ConnectorDetailPage'
import type {
  Connector,
  AccountConnector,
  ConnectorCategory,
} from '@/types/integrations'

const CATEGORY_LABEL: Record<ConnectorCategory, string> = {
  pos: 'TPV / Punto de venta',
  delivery_platform: 'Plataformas de delivery',
  logistics: 'Logística / reparto',
  payments: 'Pagos',
  reservations: 'Reservas',
  loyalty: 'Fidelización',
  reports: 'Informes',
  other: 'Otros',
}

export default function IntegrationsMarketplacePage() {
  const { activeAccountId } = useActiveAccount()
  const { resolvedLocationId } = useLocationScope()
  const { userProfile, authUserId } = useApp()

  const [connectors, setConnectors] = useState<Connector[]>([])
  const [connections, setConnections] = useState<AccountConnector[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  function loadData() {
    if (!activeAccountId) return
    setLoading(true)
    setError(null)
    Promise.all([
      listConnectors({ onlyAvailable: true }),
      listAccountConnectors({ accountId: activeAccountId }),
    ])
      .then(([cats, conns]) => { setConnectors(cats); setConnections(conns); setLoading(false) })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Error cargando el catálogo')
        setLoading(false)
      })
  }

  useEffect(() => {
    let cancelled = false
    if (!activeAccountId) return
    setLoading(true); setError(null)
    Promise.all([
      listConnectors({ onlyAvailable: true }),
      listAccountConnectors({ accountId: activeAccountId }),
    ])
      .then(([cats, conns]) => { if (cancelled) return; setConnectors(cats); setConnections(conns); setLoading(false) })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Error cargando el catálogo')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [activeAccountId])

  function connectionFor(connectorId: string): AccountConnector | undefined {
    return connections.find(c => c.connectorId === connectorId)
  }

  async function handleRequest(connector: Connector) {
    if (!activeAccountId) return
    setBusyId(connector.id)
    setError(null)
    try {
      const created = await requestConnector({
        accountId: activeAccountId,
        connectorId: connector.id,
        requestedBy: authUserId ?? null,
        createdBy: authUserId ?? null,
        createdByName: userProfile?.displayName ?? null,
      })
      setConnections(prev => [...prev.filter(c => c.id !== created.id), created])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo solicitar la integración')
    } finally {
      setBusyId(null)
    }
  }

  const selected = selectedId ? connectors.find(c => c.id === selectedId) ?? null : null
  if (selected) {
    return (
      <ConnectorDetailPage
        connector={selected}
        accountConnector={connectionFor(selected.id) ?? null}
        accountId={activeAccountId ?? ''}
        locationId={resolvedLocationId ?? null}
        createdBy={authUserId ?? null}
        createdByName={userProfile?.displayName ?? null}
        onBack={() => setSelectedId(null)}
        onChanged={loadData}
      />
    )
  }

  const byCategory = new Map<ConnectorCategory, Connector[]>()
  for (const c of connectors) {
    const list = byCategory.get(c.category) ?? []
    list.push(c)
    byCategory.set(c.category, list)
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Store size={20} className="text-accent shrink-0" />
          <h1 className="text-xl font-semibold text-text-primary">Marketplace de integraciones</h1>
        </div>
        <p className="text-sm text-text-secondary mt-1">
          Conecta Folvy con tus plataformas de delivery, tu TPV y tu logística.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="p-8 text-center text-sm text-text-secondary">Cargando catálogo…</div>
      ) : connectors.length === 0 ? (
        <div className="p-8 text-center text-sm text-text-secondary">No hay integraciones disponibles todavía.</div>
      ) : (
        <div className="space-y-6">
          {Array.from(byCategory.entries()).map(([cat, list]) => (
            <section key={cat}>
              <h2 className="text-xs uppercase tracking-wide text-text-secondary mb-2">{CATEGORY_LABEL[cat]}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {list.map(connector => {
                  const conn = connectionFor(connector.id)
                  const isConnected = conn?.status === 'connected'
                  const isRequested = conn?.status === 'requested'
                  const busy = busyId === connector.id
                  const isRequestType = connector.connectionType === 'request'
                  return (
                    <div
                      key={connector.id}
                      className="rounded-xl border border-border-default bg-card p-4 flex flex-col gap-3 hover:shadow-sm transition-base"
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedId(connector.id)}
                        className="flex items-center gap-3 text-left"
                      >
                        <ConnectorAvatar name={connector.name} code={connector.code} logoUrl={connector.logoUrl} size={48} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-text-primary truncate">{connector.name}</p>
                          {isConnected && <span className="text-[11px] text-success">Conectado</span>}
                          {isRequested && <span className="text-[11px] text-warning">Solicitado</span>}
                        </div>
                      </button>

                      {connector.description && (
                        <p className="text-xs text-text-secondary line-clamp-3">{connector.description}</p>
                      )}

                      <div className="mt-auto pt-1">
                        {isConnected ? (
                          <button
                            type="button"
                            onClick={() => setSelectedId(connector.id)}
                            className="inline-flex items-center gap-1.5 text-sm text-success"
                          >
                            <Check size={15} /> Activo · configurar
                          </button>
                        ) : isRequestType && !isRequested ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleRequest(connector)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base"
                          >
                            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                            Solicitar
                          </button>
                        ) : isRequested ? (
                          <span className="text-sm text-warning">Pendiente de activación</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setSelectedId(connector.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium bg-accent text-text-on-accent hover:opacity-90 transition-base"
                          >
                            <Settings2 size={14} /> Configurar
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="text-xs text-text-secondary border-t border-border-default pt-3">
        El catálogo es real. Las credenciales se guardan cifradas; los secretos no se vuelven a mostrar.
      </p>
    </div>
  )
}
