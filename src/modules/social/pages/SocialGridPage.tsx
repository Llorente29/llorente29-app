// src/modules/social/pages/SocialGridPage.tsx
//
// Parrilla del módulo Folvy Social (Pieza 4).
// El feed real (publicados) + lo que viene (programados), en cuadrícula estilo
// Instagram, para ver la estética de conjunto. Filtro por red. Clic → detalle.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { listGrid, type SocialPostRow } from '@/modules/social/services/socialService'

const NETWORK_LABEL: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook' }
const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'facebook', label: 'Facebook' },
]

function fmt(d: string | null): string {
  if (!d) return ''
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function SocialGridPage() {
  const { activeAccountId } = useApp()
  const [rows, setRows] = useState<SocialPostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [net, setNet] = useState('all')
  const [selected, setSelected] = useState<SocialPostRow | null>(null)

  useEffect(() => {
    if (!activeAccountId) return
    let alive = true
    setLoading(true); setError(null)
    listGrid(activeAccountId)
      .then(r => { if (alive) setRows(r) })
      .catch(e => { if (alive) setError(e?.message ?? 'No se pudo cargar la parrilla') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [activeAccountId])

  const shown = useMemo(() => net === 'all' ? rows : rows.filter(r => r.network === net), [rows, net])

  return (
    <div>
      <header style={{ marginBottom: 16 }}>
        <h1 className="font-display" style={{ fontSize: 26, fontWeight: 600, color: 'var(--color-text-primary, #1a1a1a)' }}>Parrilla</h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary, #666)', marginTop: 4 }}>
          Tu feed: lo publicado y lo que viene. Así se ve Foodint de un vistazo.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setNet(f.key)} style={{
            fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
            border: '1px solid var(--color-border-default, #ddd)',
            background: net === f.key ? 'var(--color-accent, #1E3A5F)' : 'transparent',
            color: net === f.key ? '#fff' : 'var(--color-text-secondary, #666)',
          }}>{f.label}</button>
        ))}
      </div>

      {loading && <p style={{ color: 'var(--color-text-secondary, #666)' }}>Cargando la parrilla…</p>}
      {error && !loading && <div style={{ padding: 16, borderRadius: 12, background: '#fdecea', color: '#b3261e' }}>No se pudo cargar la parrilla: {error}</div>}
      {!loading && !error && shown.length === 0 && (
        <div style={{ padding: 40, borderRadius: 14, textAlign: 'center', border: '1px dashed var(--color-border-default, #e5e5e5)', color: 'var(--color-text-secondary, #666)' }}>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: 'var(--color-text-primary, #1a1a1a)' }}>Aún no hay nada aquí</p>
          <p style={{ fontSize: 14 }}>Lo que publiques o programes aparecerá en esta cuadrícula.</p>
        </div>
      )}

      {shown.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {shown.map(row => (
            <button key={row.id} onClick={() => setSelected(row)} style={{
              position: 'relative', aspectRatio: '4 / 5', border: 'none', padding: 0, cursor: 'pointer',
              borderRadius: 10, overflow: 'hidden', background: '#f2f2f2',
            }}>
              {row.payload.image_url
                ? <img src={row.payload.image_url} alt={row.payload.star_item ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#999' }}>Sin imagen</div>}
              {row.status === 'scheduled' && (
                <span style={{ position: 'absolute', top: 8, left: 8, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'rgba(0,0,0,0.65)', color: '#fff' }}>Programado</span>
              )}
              <span style={{ position: 'absolute', bottom: 8, right: 8, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'rgba(0,0,0,0.55)', color: '#fff' }}>
                {NETWORK_LABEL[row.network] ?? row.network}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Detalle */}
      {selected && (
        <div onClick={() => setSelected(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 50,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            display: 'flex', gap: 20, maxWidth: 720, width: '100%', background: 'var(--color-bg-surface, #fff)',
            borderRadius: 16, padding: 20, maxHeight: '90vh', overflow: 'auto',
          }}>
            <div style={{ flex: '0 0 240px' }}>
              {selected.payload.image_url
                ? <img src={selected.payload.image_url} alt="" style={{ width: 240, borderRadius: 12, display: 'block' }} />
                : <div style={{ width: 240, height: 300, background: '#f2f2f2', borderRadius: 12 }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 999, background: 'var(--color-accent-bg, #eef2f7)', color: 'var(--color-accent, #1E3A5F)' }}>
                  {NETWORK_LABEL[selected.network] ?? selected.network}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 999, background: selected.status === 'scheduled' ? 'var(--color-bg-muted, #f2f2f2)' : '#e7f5ec', color: selected.status === 'scheduled' ? 'var(--color-text-secondary, #666)' : '#1a7f4b' }}>
                  {selected.status === 'scheduled' ? `Programado · ${fmt(selected.scheduled_at)}` : `Publicado · ${fmt(selected.published_at)}`}
                </span>
              </div>
              <p style={{ fontSize: 14, whiteSpace: 'pre-wrap', color: 'var(--color-text-primary, #1a1a1a)', margin: 0 }}>{selected.payload.copy ?? '—'}</p>
              {selected.payload.hashtags && selected.payload.hashtags.length > 0 && (
                <p style={{ fontSize: 13, color: 'var(--color-accent, #1E3A5F)', marginTop: 8 }}>{selected.payload.hashtags.join(' ')}</p>
              )}
              {selected.reason && (
                <p style={{ fontSize: 12, color: 'var(--color-text-secondary, #888)', marginTop: 12, fontStyle: 'italic' }}>{selected.reason}</p>
              )}
              <button onClick={() => setSelected(null)} style={{ marginTop: 16, fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 8, border: '1px solid var(--color-border-default, #ddd)', background: 'transparent', cursor: 'pointer' }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
