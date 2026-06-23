// src/modules/supply/pages/CtbNotifyPage.tsx
//
// COMUNICAR A CTB — cola de oficina. Recepciones a nombre de un proveedor del
// grupo Cloudtown que hay que comunicar al cedente (foto del albarán al grupo de
// WhatsApp de la EMPRESA). El dolor real es el OLVIDO → la cola no se vacía sola.
//
// Las que tienen DIFERENCIAS van en rojo y arriba (CTB: "si hay diferencias las
// comunicas; si no, te haces cargo"). "Enviar" abre el compartir nativo con el
// albarán + un texto ya redactado (con la cuña sutil "folvy.app"); luego se marca
// "Enviado" y sale de la cola. El envío es manual a propósito (no hay canal
// oficial robusto a grupos de WhatsApp); la cola garantiza que no se olvide.

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Send, ExternalLink, Check, AlertTriangle, PackageCheck } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  listCtbQueue, markCtbSent, getCtbReceiptFileUrl, buildCtbMessage,
  type CtbNotifyItem, type CtbNotifyStatus,
} from '@/modules/supply/services/ctbNotifyService'

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(value))
}

export default function CtbNotifyPage() {
  const { activeAccountId, accountsLoading } = useActiveAccount()
  const [tab, setTab] = useState<CtbNotifyStatus>('pendiente')
  const [items, setItems] = useState<CtbNotifyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 6000)
    return () => clearTimeout(t)
  }, [flash])

  useEffect(() => {
    if (accountsLoading) return
    if (!activeAccountId) { setItems([]); setLoading(false); return }
    let cancelled = false
    setLoading(true); setError(null)
    listCtbQueue(activeAccountId, tab)
      .then(rows => { if (!cancelled) setItems(rows) })
      .catch(err => { if (!cancelled) { setError(err instanceof Error ? err.message : 'Error cargando la cola.'); setItems([]) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeAccountId, accountsLoading, tab, reloadTick])

  const pendingCount = useMemo(() => items.filter(i => i.status === 'pendiente').length, [items])

  // Compartir: intenta el compartir NATIVO con el albarán adjunto; si no se puede
  // (PC sin Web Share de ficheros), copia el texto y abre el albarán para adjuntarlo
  // a mano. NO marca enviado solo (no podemos saber si llegó al grupo) → el usuario
  // pulsa "Marcar enviado" tras mandarlo.
  async function handleShare(item: CtbNotifyItem) {
    setBusyId(item.id); setError(null)
    try {
      const msg = buildCtbMessage(item)
      const url = item.rawDocumentUrl ? await getCtbReceiptFileUrl(item.rawDocumentUrl) : null

      const nav = navigator as Navigator & {
        share?: (data: unknown) => Promise<void>
        canShare?: (data: unknown) => boolean
      }

      // 1) Compartir nativo con el albarán como fichero (móvil moderno).
      if (url && nav.share && nav.canShare) {
        try {
          const resp = await fetch(url)
          const blob = await resp.blob()
          const ext = blob.type.includes('pdf') ? 'pdf' : 'jpg'
          const file = new File([blob], `albaran-${item.receiptCode ?? 'recepcion'}.${ext}`, { type: blob.type })
          if (nav.canShare({ files: [file] })) {
            await nav.share({ files: [file], text: msg })
            setFlash('Compartido. Cuando lo hayas enviado al grupo, marca "Enviado".')
            return
          }
        } catch { /* cae al fallback de abajo */ }
      }

      // 2) Compartir nativo solo-texto (móvil sin compartir de ficheros).
      if (nav.share) {
        try {
          await nav.share({ text: msg })
          if (url) window.open(url, '_blank')
          setFlash('Texto compartido. Adjunta el albarán abierto y marca "Enviado".')
          return
        } catch { /* cae al fallback de abajo */ }
      }

      // 3) PC: copia el texto + abre el albarán para arrastrarlo al grupo.
      try { await navigator.clipboard.writeText(msg) } catch { /* sin portapapeles */ }
      if (url) window.open(url, '_blank')
      setFlash('Mensaje copiado. Pégalo en el grupo de CTB y adjunta el albarán abierto. Luego marca "Enviado".')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo preparar el envío.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleMarkSent(item: CtbNotifyItem) {
    setBusyId(item.id); setError(null)
    try {
      await markCtbSent(item.id)
      setFlash('Marcado como enviado a CTB.')
      setReloadTick(t => t + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo marcar como enviado.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleViewAlbaran(item: CtbNotifyItem) {
    if (!item.rawDocumentUrl) return
    const url = await getCtbReceiptFileUrl(item.rawDocumentUrl)
    if (url) window.open(url, '_blank')
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-display font-medium text-text-primary">Comunicar a CTB</h2>
        <p className="text-sm text-text-secondary mt-0.5">
          Recepciones de Cloudtown por comunicar al grupo. Las que tienen diferencias van primero.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setTab('pendiente')}
          className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-base ${
            tab === 'pendiente' ? 'bg-accent text-text-on-accent border-accent' : 'bg-card text-text-secondary border-border-default hover:bg-page'
          }`}>
          Pendientes{tab === 'pendiente' && pendingCount > 0 ? ` · ${pendingCount}` : ''}
        </button>
        <button
          onClick={() => setTab('enviado')}
          className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-base ${
            tab === 'enviado' ? 'bg-accent text-text-on-accent border-accent' : 'bg-card text-text-secondary border-border-default hover:bg-page'
          }`}>
          Enviadas
        </button>
      </div>

      {flash && <div className="p-3 rounded-md bg-success-bg text-success border border-success/20 text-sm">{flash}</div>}
      {error && <div className="p-3 rounded-md bg-danger-bg text-danger border border-danger/20 text-sm">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-text-secondary">
          <Loader2 size={18} className="animate-spin" /> Cargando…
        </div>
      ) : items.length === 0 ? (
        <div className="p-8 rounded-lg border border-dashed border-border-default text-center">
          <PackageCheck size={30} className="mx-auto text-text-secondary mb-2" />
          <p className="text-sm font-medium text-text-primary">
            {tab === 'pendiente' ? 'Nada pendiente de comunicar a CTB' : 'Sin recepciones enviadas'}
          </p>
          <p className="text-xs text-text-secondary mt-1">
            {tab === 'pendiente'
              ? 'Al confirmar una recepción de Cloudtown aparecerá aquí.'
              : 'Las que vayas enviando se listarán en esta pestaña.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {items.map(item => {
            const diff = item.hasDifferences
            return (
              <li key={item.id}
                className={`p-4 rounded-lg border ${diff ? 'border-danger/50 bg-danger-bg' : 'border-border-default bg-card'}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-text-primary">{item.supplierName ?? 'Cloudtown'}</span>
                      {diff && (
                        <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-danger/30 bg-card text-danger">
                          <AlertTriangle size={12} /> Con diferencias
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-secondary mt-0.5">
                      {item.locationName ? `${item.locationName} · ` : ''}
                      {item.supplierDocNumber ? `Albarán ${item.supplierDocNumber} · ` : ''}
                      {formatDate(item.receiptDate)}
                      {item.receiptCode ? ` · ${item.receiptCode}` : ''}
                    </p>
                    {item.status === 'enviado' && (
                      <p className="text-[11px] text-success mt-1">
                        Enviado{item.sentByName ? ` por ${item.sentByName}` : ''}{item.sentAt ? ` · ${formatDate(item.sentAt)}` : ''}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {item.rawDocumentUrl && (
                      <button type="button" onClick={() => handleViewAlbaran(item)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page transition-base">
                        <ExternalLink size={14} /> Albarán
                      </button>
                    )}
                    {item.status === 'pendiente' && (
                      <>
                        <button type="button" disabled={busyId === item.id} onClick={() => handleShare(item)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
                          {busyId === item.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Enviar
                        </button>
                        <button type="button" disabled={busyId === item.id} onClick={() => handleMarkSent(item)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium border border-success/30 bg-card text-success hover:bg-success-bg disabled:opacity-50 transition-base">
                          <Check size={14} /> Marcar enviado
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
