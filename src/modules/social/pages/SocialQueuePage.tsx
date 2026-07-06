// src/modules/social/pages/SocialQueuePage.tsx
//
// Cola del módulo Folvy Social (completa).
// Lectura · acciones (aprobar/editar/regenerar/descartar) · publicación (IG auto +
// reintentar; TikTok/FB asistido) · auto-refresco · "Generar ahora" (dispara el agente).

import { useEffect, useRef, useState } from 'react'
import { useApp } from '@/context/AppContext'
import {
  listQueue, approvePost, unapprovePost, discardPost, retryPost,
  updateContent, requeueImage, regenerateCopy, markPublished,
  copyCaption, downloadImage, requestGeneration,
  type SocialPostRow,
} from '@/modules/social/services/socialService'

const NETWORK_LABEL: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook' }
const STATUS_LABEL: Record<string, string> = { draft: 'Borrador', approved: 'Aprobado', scheduled: 'Programado', publishing: 'Publicando', error: 'Error' }

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'accent' | 'warn' | 'ok' }) {
  const bg = tone === 'accent' ? 'var(--color-accent-bg, #eef2f7)' : tone === 'warn' ? '#fdecea' : tone === 'ok' ? '#e7f5ec' : 'var(--color-bg-muted, #f2f2f2)'
  const fg = tone === 'accent' ? 'var(--color-accent, #1E3A5F)' : tone === 'warn' ? '#b3261e' : tone === 'ok' ? '#1a7f4b' : 'var(--color-text-secondary, #666)'
  return <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 999, background: bg, color: fg }}>{children}</span>
}

type BtnVariant = 'primary' | 'ghost' | 'danger'
function Btn({ children, onClick, variant = 'ghost', disabled }: { children: React.ReactNode; onClick?: () => void; variant?: BtnVariant; disabled?: boolean }) {
  const base: React.CSSProperties = { fontSize: 13, fontWeight: 600, padding: '6px 12px', borderRadius: 8, cursor: disabled ? 'default' : 'pointer', border: '1px solid transparent', opacity: disabled ? 0.5 : 1, background: 'transparent' }
  const styles: Record<BtnVariant, React.CSSProperties> = {
    primary: { ...base, background: 'var(--color-accent, #1E3A5F)', color: '#fff' },
    ghost: { ...base, border: '1px solid var(--color-border-default, #ddd)', color: 'var(--color-text-primary, #333)' },
    danger: { ...base, border: '1px solid #f0c6c2', color: '#b3261e' },
  }
  return <button style={styles[variant]} onClick={onClick} disabled={disabled}>{children}</button>
}

export default function SocialQueuePage() {
  const { activeAccountId } = useApp()
  const [rows, setRows] = useState<SocialPostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmDiscardId, setConfirmDiscardId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCopy, setEditCopy] = useState('')
  const [editTags, setEditTags] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  const editingRef = useRef<string | null>(null)
  editingRef.current = editingId

  async function refetch() {
    if (!activeAccountId) return
    if (editingRef.current) return
    try { setRows(await listQueue(activeAccountId)) } catch { /* silencioso */ }
  }

  useEffect(() => {
    if (!activeAccountId) return
    let alive = true
    setLoading(true); setError(null)
    listQueue(activeAccountId)
      .then(r => { if (alive) setRows(r) })
      .catch(e => { if (alive) setError(e?.message ?? 'No se pudo cargar la cola') })
      .finally(() => { if (alive) setLoading(false) })
    const iv = setInterval(() => { void refetch() }, 20000)
    return () => { alive = false; clearInterval(iv) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId])

  function patchRow(id: string, patch: Partial<SocialPostRow>) { setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r))) }
  function patchPayload(id: string, patch: Partial<SocialPostRow['payload']>) { setRows(rs => rs.map(r => (r.id === id ? { ...r, payload: { ...r.payload, ...patch } } : r))) }
  async function run(id: string, fn: () => Promise<void>, revert?: () => void) {
    setBusyId(id); setActionError(null)
    try { await fn() } catch (e: any) { revert?.(); setActionError(e?.message ?? 'La acción falló') } finally { setBusyId(null) }
  }

  async function onGenerate() {
    if (!activeAccountId || generating) return
    setGenerating(true); setActionError(null)
    try {
      await requestGeneration(activeAccountId)
      for (const ms of [2000, 3500]) { await new Promise(r => setTimeout(r, ms)); await refetch() }
    } catch (e: any) {
      setActionError(e?.message ?? 'No se pudo generar')
    } finally { setGenerating(false) }
  }

  function onApprove(row: SocialPostRow) { const prev = row.status; patchRow(row.id, { status: 'approved' }); void run(row.id, () => approvePost(row.id), () => patchRow(row.id, { status: prev })) }
  function onUnapprove(row: SocialPostRow) { const prev = row.status; patchRow(row.id, { status: 'draft' }); void run(row.id, () => unapprovePost(row.id), () => patchRow(row.id, { status: prev })) }
  function onRetry(row: SocialPostRow) { const prev = row.status; patchRow(row.id, { status: 'approved', last_error: null }); void run(row.id, () => retryPost(row.id), () => patchRow(row.id, { status: prev })) }
  function onDiscard(row: SocialPostRow) { setConfirmDiscardId(null); const snap = rows; setRows(rs => rs.filter(r => r.id !== row.id)); void run(row.id, () => discardPost(row.id), () => setRows(snap)) }
  function onMarkPublished(row: SocialPostRow) { const snap = rows; setRows(rs => rs.filter(r => r.id !== row.id)); void run(row.id, () => markPublished(row.id), () => setRows(snap)) }

  function startEdit(row: SocialPostRow) { setEditingId(row.id); setEditCopy(row.payload.copy ?? ''); setEditTags((row.payload.hashtags ?? []).join(' ')) }
  function onSaveEdit(row: SocialPostRow) {
    const tags = editTags.split(/\s+/).map(t => t.trim()).filter(Boolean)
    const copy = editCopy
    patchPayload(row.id, { copy, hashtags: tags }); setEditingId(null)
    void run(row.id, () => updateContent(row.id, copy, tags))
  }
  function onRequeueImage(row: SocialPostRow) { patchPayload(row.id, { image_level: 'N1-pendiente' }); void run(row.id, () => requeueImage(row.id)) }
  function onRegenCopy(row: SocialPostRow) { void run(row.id, async () => { const nc = await regenerateCopy(row.id); patchPayload(row.id, { copy: nc }) }) }
  async function onCopy(row: SocialPostRow) {
    try { await copyCaption(row.payload); setCopiedId(row.id); setTimeout(() => setCopiedId(c => (c === row.id ? null : c)), 1500) }
    catch { setActionError('No se pudo copiar el caption') }
  }
  function onDownload(row: SocialPostRow) {
    if (!row.payload.image_url) { setActionError('Este post aún no tiene imagen'); return }
    const name = `foodint-${(row.payload.star_item ?? 'post').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`
    void run(row.id, () => downloadImage(row.payload.image_url!, name))
  }

  return (
    <div>
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <h1 className="font-display" style={{ fontSize: 26, fontWeight: 600, color: 'var(--color-text-primary, #1a1a1a)' }}>Cola</h1>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary, #666)', marginTop: 4 }}>
            Contenido que propone el agente. Apruébalo, edítalo o descártalo. Instagram se publica solo al aprobar; en TikTok y Facebook, copia el caption y la imagen.
          </p>
        </div>
        <button onClick={() => void onGenerate()} disabled={generating} style={{
          flex: '0 0 auto', fontSize: 14, fontWeight: 600, padding: '9px 16px', borderRadius: 8,
          border: 'none', background: 'var(--color-accent, #1E3A5F)', color: '#fff',
          cursor: generating ? 'default' : 'pointer', opacity: generating ? 0.6 : 1,
        }}>{generating ? 'Generando…' : 'Generar ahora'}</button>
      </header>

      {actionError && <div style={{ marginBottom: 12, padding: 12, borderRadius: 10, background: '#fdecea', color: '#b3261e', fontSize: 13 }}>{actionError}</div>}

      {loading && <p style={{ color: 'var(--color-text-secondary, #666)' }}>Cargando la cola…</p>}
      {error && !loading && <div style={{ padding: 16, borderRadius: 12, background: '#fdecea', color: '#b3261e' }}>No se pudo cargar la cola: {error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div style={{ padding: 40, borderRadius: 14, textAlign: 'center', border: '1px dashed var(--color-border-default, #e5e5e5)', color: 'var(--color-text-secondary, #666)' }}>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: 'var(--color-text-primary, #1a1a1a)' }}>Todavía no hay nada en la cola</p>
          <p style={{ fontSize: 14 }}>Pulsa «Generar ahora» o espera a que el agente proponga contenido.</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {rows.map(row => {
          const busy = busyId === row.id
          const editing = editingId === row.id
          const assisted = row.network !== 'instagram'
          return (
            <article key={row.id} style={{ display: 'flex', gap: 16, padding: 16, borderRadius: 14, background: 'var(--color-bg-surface, #fff)', border: '1px solid var(--color-border-default, #e5e5e5)' }}>
              <div style={{ flex: '0 0 168px' }}>
                {row.payload.image_url ? (
                  <img src={row.payload.image_url} alt={row.payload.star_item ?? 'Preview'} style={{ width: 168, height: 210, objectFit: 'cover', borderRadius: 10, display: 'block', background: '#f2f2f2' }} />
                ) : (
                  <div style={{ width: 168, height: 210, borderRadius: 10, background: '#f2f2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--color-text-secondary, #888)', textAlign: 'center', padding: 8 }}>
                    {row.payload.image_level && row.payload.image_level !== 'N1' ? 'Imagen en preparación…' : 'Sin imagen'}
                  </div>
                )}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                  <Badge tone="accent">{NETWORK_LABEL[row.network] ?? row.network}</Badge>
                  <Badge tone={row.status === 'error' ? 'warn' : row.status === 'approved' ? 'ok' : 'neutral'}>{STATUS_LABEL[row.status] ?? row.status}</Badge>
                  {row.payload.directive && <Badge tone="accent">Dirigido por ti</Badge>}
                  {row.payload.template === 'oferta' && <Badge tone="warn">Oferta</Badge>}
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-text-secondary, #999)' }}>
                    {new Date(row.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                  </span>
                </div>

                {editing ? (
                  <div>
                    <textarea value={editCopy} onChange={e => setEditCopy(e.target.value)} rows={4} style={{ width: '100%', fontSize: 14, padding: 10, borderRadius: 8, border: '1px solid var(--color-border-default, #ddd)', resize: 'vertical' }} />
                    <input value={editTags} onChange={e => setEditTags(e.target.value)} placeholder="#hashtags separados por espacios" style={{ width: '100%', marginTop: 8, fontSize: 13, padding: 8, borderRadius: 8, border: '1px solid var(--color-border-default, #ddd)' }} />
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <Btn variant="primary" onClick={() => onSaveEdit(row)} disabled={busy}>Guardar</Btn>
                      <Btn onClick={() => setEditingId(null)} disabled={busy}>Cancelar</Btn>
                    </div>
                  </div>
                ) : (
                  <>
                    <p style={{ fontSize: 14, color: 'var(--color-text-primary, #1a1a1a)', whiteSpace: 'pre-wrap', margin: 0 }}>{row.payload.copy ?? '—'}</p>
                    {row.payload.hashtags && row.payload.hashtags.length > 0 && (
                      <p style={{ fontSize: 13, color: 'var(--color-accent, #1E3A5F)', marginTop: 6 }}>{row.payload.hashtags.join(' ')}</p>
                    )}
                    {row.reason && (
                      <p style={{ fontSize: 12, color: 'var(--color-text-secondary, #888)', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--color-border-default, #eee)', fontStyle: 'italic' }}>{row.reason}</p>
                    )}
                    {row.status === 'error' && row.last_error && (
                      <p style={{ fontSize: 12, color: '#b3261e', marginTop: 8 }}>Error al publicar: {row.last_error}</p>
                    )}

                    {row.status === 'publishing' ? (
                      <p style={{ fontSize: 12, color: 'var(--color-text-secondary, #999)', marginTop: 12 }}>Publicándose…</p>
                    ) : row.status === 'error' ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                        <Btn variant="primary" onClick={() => onRetry(row)} disabled={busy}>Reintentar</Btn>
                        <Btn onClick={() => startEdit(row)} disabled={busy}>Editar</Btn>
                        <Btn variant="danger" onClick={() => onDiscard(row)} disabled={busy}>Descartar</Btn>
                      </div>
                    ) : row.status === 'approved' ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
                        {assisted ? (
                          <>
                            <Btn variant="primary" onClick={() => onCopy(row)} disabled={busy}>{copiedId === row.id ? 'Copiado ✓' : 'Copiar caption'}</Btn>
                            <Btn onClick={() => onDownload(row)} disabled={busy}>Descargar imagen</Btn>
                            <Btn onClick={() => onMarkPublished(row)} disabled={busy}>Marcar como publicado</Btn>
                          </>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #777)' }}>Se publicará en Instagram automáticamente.</span>
                        )}
                        <Btn onClick={() => onUnapprove(row)} disabled={busy}>Volver a borrador</Btn>
                        <Btn variant="danger" onClick={() => onDiscard(row)} disabled={busy}>Descartar</Btn>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                        <Btn variant="primary" onClick={() => onApprove(row)} disabled={busy}>Aprobar</Btn>
                        <Btn onClick={() => startEdit(row)} disabled={busy}>Editar</Btn>
                        <Btn onClick={() => onRegenCopy(row)} disabled={busy}>Regenerar texto</Btn>
                        <Btn onClick={() => onRequeueImage(row)} disabled={busy}>Regenerar imagen</Btn>
                        {confirmDiscardId === row.id ? (
                          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                            <span style={{ fontSize: 13, color: '#b3261e' }}>¿Descartar?</span>
                            <Btn variant="danger" onClick={() => onDiscard(row)} disabled={busy}>Sí, descartar</Btn>
                            <Btn onClick={() => setConfirmDiscardId(null)} disabled={busy}>No</Btn>
                          </span>
                        ) : (
                          <Btn variant="danger" onClick={() => setConfirmDiscardId(row.id)} disabled={busy}>Descartar</Btn>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
