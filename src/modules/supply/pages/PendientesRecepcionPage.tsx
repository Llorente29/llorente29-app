// src/modules/supply/pages/PendientesRecepcionPage.tsx
//
// LAS LÍNEAS QUE NADIE HA RESUELTO, POR PROVEEDOR Y CON SU IMPORTE.
//
// EL 01/09 HABÍA 66 EN FOODINT: líneas de albarán sin artículo del catálogo y
// sin marcar como "no es mercancía", con 4.022,43 € de género fuera del
// inventario y del coste. Existían desde el primer día y no había ni una
// pantalla donde verlas: solo aparecían abriendo el albarán que las contenía,
// uno a uno. Un pendiente que nadie lista es un olvido, no un pendiente.
//
// SALEN TODAS, NO SOLO LAS MARCADAS (regla 7). La tentación es filtrar por
// flagged_for_office y llamar a eso «la bandeja de pendientes»: hoy eso
// enseñaría UNA línea y escondería sesenta y cinco. La marca ordena y etiqueta;
// no decide qué existe. Esta pantalla se abre a propósito, así que no oculta
// filas — y por eso mismo lo primero que se ve es el total, para que el tamaño
// del problema no dependa de que alguien sume.

import { useEffect, useMemo, useState } from 'react'
import { Loader2, AlertTriangle, ExternalLink, Inbox } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { listPendingLines, type PendingLine } from '@/modules/supply/services/goodsReceiptService'
import { useApp } from '@/context/AppContext'

const fmtMoney = (n: number) =>
  n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })

const fmtFecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })

interface Grupo {
  supplierName: string
  lineas: PendingLine[]
  importe: number
  /** Cuántas tienen importe. Si no todas, el total del grupo es un MÍNIMO. */
  conImporte: number
}

export default function PendientesRecepcionPage() {
  const { activeAccountId } = useApp()
  const navigate = useNavigate()
  const [lineas, setLineas] = useState<PendingLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    if (!activeAccountId) return
    setLoading(true)
    listPendingLines(activeAccountId)
      .then(l => { if (!cancel) { setLineas(l); setError(null) } })
      .catch(e => { if (!cancel) setError(e instanceof Error ? e.message : 'Error cargando pendientes') })
      .finally(() => { if (!cancel) setLoading(false) })
    return () => { cancel = true }
  }, [activeAccountId])

  const { grupos, total, sinImporte, marcadas } = useMemo(() => {
    const byProv = new Map<string, Grupo>()
    for (const l of lineas) {
      const g = byProv.get(l.supplierName)
        ?? { supplierName: l.supplierName, lineas: [], importe: 0, conImporte: 0 }
      g.lineas.push(l)
      if (l.amount != null) { g.importe += l.amount; g.conImporte += 1 }
      byProv.set(l.supplierName, g)
    }
    for (const g of byProv.values()) {
      // Lo más caro arriba dentro de cada proveedor; lo que no tiene importe, al
      // final, pero NUNCA fuera: una línea sin importe puede ser la peor de todas.
      g.lineas.sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1))
    }
    return {
      grupos: [...byProv.values()].sort((a, b) => b.importe - a.importe),
      total: lineas.reduce((s, l) => s + (l.amount ?? 0), 0),
      sinImporte: lineas.filter(l => l.amount == null).length,
      marcadas: lineas.filter(l => l.flaggedForOffice).length,
    }
  }, [lineas])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-text-secondary py-10 px-4">
        <Loader2 className="animate-spin" size={18} /> Cargando pendientes…
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-text-primary">
          {error}
        </div>
      </div>
    )
  }

  if (lineas.length === 0) {
    return (
      <div className="p-4 max-w-3xl">
        <h1 className="text-xl font-bold text-text-primary mb-1">Pendientes de resolver</h1>
        <div className="mt-6 rounded-lg border border-border-default bg-card px-5 py-8 text-center">
          <Inbox size={32} className="mx-auto text-text-secondary mb-3" />
          <p className="font-semibold text-text-primary">No hay ninguna línea sin resolver.</p>
          <p className="text-sm text-text-secondary mt-1">
            Todas las líneas de albarán tienen artículo o están marcadas como «no es mercancía».
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-3xl">
      <h1 className="text-xl font-bold text-text-primary">Pendientes de resolver</h1>
      <p className="text-sm text-text-secondary mt-1">
        Líneas de albarán sin artículo del catálogo y sin marcar como «no es mercancía».
      </p>

      {/* EL TOTAL, PRIMERO. El tamaño del problema no puede depender de que
          alguien vaya sumando importes por la pantalla. */}
      <div className="mt-4 rounded-lg border border-warning/40 bg-warning-bg px-4 py-3.5">
        <div className="flex items-start gap-2.5">
          <AlertTriangle size={18} className="text-warning shrink-0 mt-0.5" />
          <div className="text-sm text-text-primary">
            <p className="font-semibold tabular-nums">
              {lineas.length} {lineas.length === 1 ? 'línea' : 'líneas'} · {fmtMoney(total)} fuera
              del inventario y del coste
            </p>
            <p className="mt-1">
              Este género se recibió y no está en ningún sitio: ni valora tu almacén ni entra en el
              coste de los platos.
              {sinImporte > 0 && (
                <>
                  {' '}<b>{fmtMoney(total)} es un mínimo</b>: {sinImporte} de las {lineas.length} no
                  traen importe en el albarán, así que el desvío real es mayor.
                </>
              )}
              {marcadas > 0 && ` ${marcadas} están marcadas como pendientes a propósito; el resto no las ha tocado nadie.`}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {grupos.map(g => (
          <section key={g.supplierName} className="rounded-lg border border-border-default bg-card overflow-hidden">
            <header className="px-4 py-2.5 border-b border-border-default flex items-baseline justify-between gap-3">
              <h2 className="font-semibold text-text-primary truncate">{g.supplierName}</h2>
              <span className="text-sm text-text-secondary tabular-nums shrink-0">
                {g.lineas.length} {g.lineas.length === 1 ? 'línea' : 'líneas'} · {fmtMoney(g.importe)}
                {g.conImporte < g.lineas.length && ' o más'}
              </span>
            </header>
            <ul className="divide-y divide-border-default">
              {g.lineas.map(l => (
                <li key={l.lineId} className="px-4 py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary truncate">{l.productName}</span>
                      {l.flaggedForOffice && (
                        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-warning-bg text-warning border border-warning/40">
                          Pendiente
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-text-secondary mt-0.5 tabular-nums">
                      {l.supplierDocNumber ?? l.receiptCode ?? 'sin nº'} · {fmtFecha(l.receiptDate)}
                      {l.docQty != null && ` · ${l.docQty} ud`}
                    </div>
                  </div>
                  <span className="text-sm tabular-nums shrink-0 text-text-primary">
                    {l.amount != null
                      ? fmtMoney(l.amount)
                      : <span className="text-text-secondary">sin importe</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => navigate(`/almacen/recepciones/${l.receiptId}/oficina`)}
                    className="shrink-0 min-h-touch px-3 rounded-md text-sm font-medium border border-border-default bg-card text-text-primary hover:bg-page transition-base inline-flex items-center gap-1.5"
                  >
                    Resolver <ExternalLink size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
