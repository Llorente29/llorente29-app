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
import { Loader2, Send, ExternalLink, Check, AlertTriangle, PackageCheck, PackageX } from 'lucide-react'
import { useActiveAccount } from '@/modules/multitenancy/hooks/useActiveAccount'
import {
  listCtbQueue, markCtbSent, getCtbReceiptFileUrl, buildCtbMessage, esReclamacionDePedido,
  listCtbDifferences, lineaDeDiferencia, type CtbDifference,
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
  // Tras compartir, esta fila ofrece "¿Enviado? → Sí" en el momento real.
  const [confirmSentId, setConfirmSentId] = useState<string | null>(null)
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

  // Panel de revisión: lo que se va a mandar, antes de mandarlo.
  const [revision, setRevision] = useState<null | {
    item: CtbNotifyItem
    difs: CtbDifference[]
    texto: string
  }>(null)

  const pendingCount = useMemo(() => items.filter(i => i.status === 'pendiente').length, [items])

  // Compartir: intenta el compartir NATIVO con el albarán adjunto; si no se puede
  // (PC sin Web Share de ficheros), copia el texto y abre el albarán para adjuntarlo
  // a mano. NO marca enviado solo (no podemos saber si llegó al grupo) → el usuario
  // pulsa "Marcar enviado" tras mandarlo.
  /**
   * PASO PREVIO OBLIGATORIO (01/09). Hasta hoy `buildCtbMessage` se ejecutaba
   * dentro del clic y el texto se iba directo a nav.share(): Folvy no lo
   * enseñaba nunca. Con el mensaje pasando de una línea a una reclamación con
   * importes, eso deja de valer. Ahora se compone, se ENSEÑA, se puede editar,
   * y lo envía una persona. Ningún texto llega a un proveedor sin que alguien
   * lo haya leído.
   */
  async function abrirRevision(item: CtbNotifyItem) {
    setBusyId(item.id); setError(null)
    try {
      // Una reclamación de pedido no tiene albarán del que sacar diferencias.
      const difs = item.goodsReceiptId ? await listCtbDifferences(item.goodsReceiptId) : []
      setRevision({ item, difs, texto: buildCtbMessage(item, difs) })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se han podido leer las diferencias.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleShare(item: CtbNotifyItem, msg: string) {
    setBusyId(item.id); setError(null)
    try {
      setRevision(null)
      // Una reclamación de pedido no tiene albarán que adjuntar: va sólo texto.
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
            setConfirmSentId(item.id)
            setFlash('Compartido. Confirma abajo cuando lo hayas enviado al grupo.')
            return
          }
        } catch { /* cae al fallback de abajo */ }
      }

      // 2) Compartir nativo solo-texto (móvil sin compartir de ficheros).
      if (nav.share) {
        try {
          await nav.share({ text: msg })
          if (url) window.open(url, '_blank')
          setConfirmSentId(item.id)
          setFlash('Texto compartido. Adjunta el albarán y confirma abajo cuando lo hayas enviado.')
          return
        } catch { /* cae al fallback de abajo */ }
      }

      // 3) PC: copia el texto + abre el albarán para arrastrarlo al grupo.
      try { await navigator.clipboard.writeText(msg) } catch { /* sin portapapeles */ }
      if (url) window.open(url, '_blank')
      setConfirmSentId(item.id)
      setFlash(item.rawDocumentUrl
        ? 'Mensaje copiado. Pégalo en el grupo de CTB y adjunta el albarán; confirma abajo cuando lo hayas enviado.'
        : 'Mensaje copiado. Pégalo en el grupo de CTB; confirma abajo cuando lo hayas enviado.')
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
      setConfirmSentId(null)
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
          Recepciones de Cloudtown por comunicar al grupo, y reclamaciones de lo que falta de un pedido.
          Las que tienen diferencias van primero.
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
            {tab === 'pendiente' ? 'Nada pendiente de comunicar a CTB' : 'Nada enviado todavía'}
          </p>
          <p className="text-xs text-text-secondary mt-1">
            {tab === 'pendiente'
              ? 'Aparecerá aquí al confirmar una recepción de Cloudtown, o al reclamar lo que falta de un pedido.'
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
                      {/* ENCARGO CODE (21/08) — una entrada de la cola puede ser
                          una RECEPCIÓN que comunicar o una RECLAMACIÓN de lo que
                          falta de un pedido. Se dice cuál es: si no, quien la
                          abre no sabe qué está mandando. */}
                      {esReclamacionDePedido(item) ? (
                        <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-warning/40 bg-card text-warning">
                          <PackageX size={12} /> Reclamación
                        </span>
                      ) : diff ? (
                        <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-danger/30 bg-card text-danger">
                          <AlertTriangle size={12} /> Con diferencias
                        </span>
                      ) : null}
                    </div>
                    {esReclamacionDePedido(item) ? (
                      <p className="text-xs text-text-secondary mt-0.5">
                        {item.locationName ? `${item.locationName} · ` : ''}
                        Pedido {item.orderCode ?? '—'}
                        {item.faltan === null
                          ? ' · no se ha podido leer qué falta'
                          : ` · falta${item.faltan.length === 1 ? '' : 'n'} ${item.faltan.length} artículo${item.faltan.length === 1 ? '' : 's'}`}
                      </p>
                    ) : (
                      <p className="text-xs text-text-secondary mt-0.5">
                        {item.locationName ? `${item.locationName} · ` : ''}
                        {item.supplierDocNumber ? `Albarán ${item.supplierDocNumber} · ` : ''}
                        {formatDate(item.receiptDate)}
                        {item.receiptCode ? ` · ${item.receiptCode}` : ''}
                      </p>
                    )}
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
                      confirmSentId === item.id ? (
                        <>
                          <span className="text-sm text-text-secondary mr-1">¿Enviado al grupo?</span>
                          <button type="button" disabled={busyId === item.id} onClick={() => handleMarkSent(item)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium bg-success text-white hover:opacity-90 disabled:opacity-50 transition-base">
                            {busyId === item.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Sí, enviado
                          </button>
                          <button type="button" disabled={busyId === item.id} onClick={() => setConfirmSentId(null)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium border border-border-default bg-card hover:bg-page disabled:opacity-50 transition-base">
                            Aún no
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" disabled={busyId === item.id} onClick={() => void abrirRevision(item)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium bg-accent text-text-on-accent hover:opacity-90 disabled:opacity-50 transition-base">
                            {busyId === item.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Enviar
                          </button>
                          <button type="button" disabled={busyId === item.id} onClick={() => handleMarkSent(item)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium border border-success/30 bg-card text-success hover:bg-success-bg disabled:opacity-50 transition-base">
                            <Check size={14} /> Marcar enviado
                          </button>
                        </>
                      )
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* ══ PANEL DE REVISIÓN ══════════════════════════════════════════════
          La puerta que hace aceptable que esto salga: se compone, se enseña,
          se puede editar, y lo envía una persona. Lo que se manda es lo que
          hay en el cuadro de texto, no lo que compuso el programa. */}
      {revision && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-card w-full sm:max-w-2xl sm:rounded-xl rounded-t-xl max-h-[92vh] overflow-y-auto">
            <div className="px-4 py-3 border-b border-border-default flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-bold text-text-primary">Revisa antes de enviar</h2>
                <p className="text-xs text-text-secondary truncate">
                  {revision.item.supplierName ?? 'CTB'} · {revision.item.supplierDocNumber ?? revision.item.receiptCode ?? ''}
                </p>
              </div>
              <button type="button" onClick={() => setRevision(null)}
                className="shrink-0 text-text-secondary hover:text-text-primary px-2 py-1">Cerrar</button>
            </div>

            {/* Lo que el cálculo vio, TODO, sin filtrar: es una pantalla que se
                abre a propósito. El mensaje lleva solo las reclamables; lo demás
                está aquí y se puede añadir a mano. */}
            {revision.difs.length > 0 && (() => {
              const porClase = (c: CtbDifference['clase']) => revision.difs.filter(d => d.clase === c)
              const fuera = [...porClase('ruido'), ...porClase('no_comparable')]
              return (
                <div className="px-4 py-3 border-b border-border-default">
                  <p className="text-xs text-text-secondary">
                    <b className="text-text-primary">{porClase('diferencia').length}</b> {porClase('diferencia').length === 1 ? 'diferencia' : 'diferencias'} en el mensaje
                    {porClase('ruido').length > 0 && ` · ${porClase('ruido').length} por debajo del umbral`}
                    {porClase('no_comparable').length > 0 && ` · ${porClase('no_comparable').length} sin cantidad en el papel, no comparadas`}
                    {porClase('solo_nota').length > 0 && ` · ${porClase('solo_nota').length} con nota y sin diferencia`}
                  </p>
                  {fuera.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {fuera.map(d => (
                        <div key={d.linea} className="flex items-start gap-2 text-xs">
                          <span className="flex-1 text-text-secondary">{lineaDeDiferencia(d)}</span>
                          <button type="button"
                            onClick={() => setRevision(r => r && ({ ...r, texto: `${r.texto}\n· ${lineaDeDiferencia(d)}` }))}
                            className="shrink-0 px-2 py-0.5 rounded border border-border-default text-text-primary hover:bg-page">
                            Añadir
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })()}

            <div className="px-4 py-3">
              <label className="text-xs text-text-secondary">Mensaje que se va a enviar (editable)</label>
              <textarea
                value={revision.texto}
                onChange={e => setRevision(r => r && ({ ...r, texto: e.target.value }))}
                rows={14}
                className="mt-1 w-full rounded-md border border-border-default bg-page p-3 text-sm text-text-primary font-mono leading-relaxed"
              />
            </div>

            <div className="px-4 py-3 border-t border-border-default flex gap-2 justify-end">
              <button type="button" onClick={() => setRevision(null)}
                className="min-h-touch px-4 rounded-md text-sm font-medium border border-border-default bg-card text-text-primary hover:bg-page">
                Cancelar
              </button>
              <button type="button"
                disabled={busyId === revision.item.id || revision.texto.trim() === ''}
                onClick={() => void handleShare(revision.item, revision.texto)}
                className="min-h-touch px-4 rounded-md text-sm font-bold bg-accent text-text-on-accent hover:bg-accent-hover disabled:opacity-50">
                Enviar esto
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
