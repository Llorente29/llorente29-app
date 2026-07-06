// src/modules/social/pages/SocialQueuePage.tsx
//
// Cola del módulo Folvy Social (Pieza 1, solo lectura).
// Muestra los borradores que propone el agente: preview de la imagen compuesta,
// caption, hashtags, el MOTIVO del agente (transparencia) y el estado.
// Las acciones (aprobar / descartar / editar / regenerar) llegan en la Pieza 2.

import { useEffect, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { listQueue, type SocialPostRow } from '@/modules/social/services/socialService'

const NETWORK_LABEL: Record<string, string> = {
  instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook',
}
const STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador', approved: 'Aprobado', scheduled: 'Programado',
  publishing: 'Publicando', error: 'Error',
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'accent' | 'warn' }) {
  const styles: React.CSSProperties = {
    fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 999,
    background: tone === 'accent' ? 'var(--color-accent-bg, #eef2f7)'
      : tone === 'warn' ? '#fdecea' : 'var(--color-bg-muted, #f2f2f2)',
    color: tone === 'accent' ? 'var(--color-accent, #1E3A5F)'
      : tone === 'warn' ? '#b3261e' : 'var(--color-text-secondary, #666)',
  }
  return <span style={styles}>{children}</span>
}

export default function SocialQueuePage() {
  const { activeAccountId } = useApp()
  const [rows, setRows] = useState<SocialPostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeAccountId) return
    let alive = true
    setLoading(true); setError(null)
    listQueue(activeAccountId)
      .then(r => { if (alive) setRows(r) })
      .catch(e => { if (alive) setError(e?.message ?? 'No se pudo cargar la cola') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [activeAccountId])

  return (
    <div>
      <header style={{ marginBottom: 20 }}>
        <h1 className="font-display" style={{ fontSize: 26, fontWeight: 600, color: 'var(--color-text-primary, #1a1a1a)' }}>
          Cola
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary, #666)', marginTop: 4 }}>
          Contenido que propone el agente. Revísalo y, en el siguiente paso, apruébalo o descártalo.
        </p>
      </header>

      {loading && (
        <p style={{ color: 'var(--color-text-secondary, #666)' }}>Cargando la cola…</p>
      )}

      {error && !loading && (
        <div style={{ padding: 16, borderRadius: 12, background: '#fdecea', color: '#b3261e' }}>
          No se pudo cargar la cola: {error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div style={{
          padding: 40, borderRadius: 14, textAlign: 'center',
          border: '1px dashed var(--color-border-default, #e5e5e5)',
          color: 'var(--color-text-secondary, #666)',
        }}>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: 'var(--color-text-primary, #1a1a1a)' }}>
            Todavía no hay nada en la cola
          </p>
          <p style={{ fontSize: 14 }}>
            Cuando el agente proponga contenido, aparecerá aquí para que lo revises.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {rows.map(row => (
          <article key={row.id} style={{
            display: 'flex', gap: 16, padding: 16, borderRadius: 14,
            background: 'var(--color-bg-surface, #fff)',
            border: '1px solid var(--color-border-default, #e5e5e5)',
          }}>
            {/* Preview de la imagen (4:5) */}
            <div style={{ flex: '0 0 168px' }}>
              {row.payload.image_url ? (
                <img
                  src={row.payload.image_url}
                  alt={row.payload.star_item ?? 'Preview'}
                  style={{ width: 168, height: 210, objectFit: 'cover', borderRadius: 10, display: 'block', background: '#f2f2f2' }}
                />
              ) : (
                <div style={{
                  width: 168, height: 210, borderRadius: 10, background: '#f2f2f2',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, color: 'var(--color-text-secondary, #888)', textAlign: 'center', padding: 8,
                }}>
                  {row.payload.image_level && row.payload.image_level !== 'N1'
                    ? 'Imagen en preparación…'
                    : 'Sin imagen'}
                </div>
              )}
            </div>

            {/* Contenido */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <Badge tone="accent">{NETWORK_LABEL[row.network] ?? row.network}</Badge>
                <Badge tone={row.status === 'error' ? 'warn' : 'neutral'}>{STATUS_LABEL[row.status] ?? row.status}</Badge>
                {row.payload.directive && <Badge tone="accent">Dirigido por ti</Badge>}
                {row.payload.template === 'oferta' && <Badge tone="warn">Oferta</Badge>}
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-text-secondary, #999)' }}>
                  {new Date(row.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                </span>
              </div>

              <p style={{ fontSize: 14, color: 'var(--color-text-primary, #1a1a1a)', whiteSpace: 'pre-wrap', margin: 0 }}>
                {row.payload.copy ?? '—'}
              </p>

              {row.payload.hashtags && row.payload.hashtags.length > 0 && (
                <p style={{ fontSize: 13, color: 'var(--color-accent, #1E3A5F)', marginTop: 6 }}>
                  {row.payload.hashtags.join(' ')}
                </p>
              )}

              {row.reason && (
                <p style={{
                  fontSize: 12, color: 'var(--color-text-secondary, #888)', marginTop: 10,
                  paddingTop: 10, borderTop: '1px solid var(--color-border-default, #eee)', fontStyle: 'italic',
                }}>
                  {row.reason}
                </p>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
