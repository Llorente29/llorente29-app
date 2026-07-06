// src/modules/social/pages/SocialDirectivesPage.tsx
//
// Directivas del módulo Folvy Social (Pieza 6). Tú diriges, la máquina ejecuta.
// Tres modos: Empujar una marca/plato · Tematizar el día · Post a medida.
// La directiva la respeta el agente en su próxima publicación (regla R0).
// Cedidas: aunque las empujes, salen SIEMPRE anónimas (línea roja).

import { useEffect, useState } from 'react'
import { useApp } from '@/context/AppContext'
import {
  createDirective, listDirectives, cancelDirective, listBrands, listDishes,
  type DirectiveKind, type DirectiveRow, type BrandRow, type DishRow,
} from '@/modules/social/services/socialService'

const KIND_LABEL: Record<DirectiveKind, string> = { push: 'Empujar', context: 'Contexto', custom: 'A medida' }
const inputStyle: React.CSSProperties = { width: '100%', fontSize: 14, padding: 9, borderRadius: 8, border: '1px solid var(--color-border-default, #ddd)' }
const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary, #555)', marginBottom: 4, display: 'block' }

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} style={{
    fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 999, cursor: 'pointer',
    border: '1px solid var(--color-border-default, #ddd)',
    background: active ? 'var(--color-accent, #1E3A5F)' : 'transparent',
    color: active ? '#fff' : 'var(--color-text-secondary, #666)',
  }}>{children}</button>
}

export default function SocialDirectivesPage() {
  const { activeAccountId } = useApp()
  const [mode, setMode] = useState<DirectiveKind>('push')
  const [brands, setBrands] = useState<BrandRow[]>([])
  const [dishes, setDishes] = useState<DishRow[]>([])
  const [pending, setPending] = useState<DirectiveRow[]>([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Campos del formulario (compartidos entre modos según convenga)
  const [brandId, setBrandId] = useState('')
  const [dishId, setDishId] = useState('')
  const [theme, setTheme] = useState('generico')
  const [caption, setCaption] = useState('')
  const [tags, setTags] = useState('')
  const [photoUrl, setPhotoUrl] = useState('')
  const [template, setTemplate] = useState('apetito')

  useEffect(() => {
    if (!activeAccountId) return
    listBrands(activeAccountId).then(setBrands).catch(() => {})
    void refreshPending()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId])

  useEffect(() => {
    if (!activeAccountId || !brandId) { setDishes([]); setDishId(''); return }
    listDishes(activeAccountId, brandId).then(setDishes).catch(() => setDishes([]))
  }, [activeAccountId, brandId])

  async function refreshPending() {
    if (!activeAccountId) return
    try { setPending(await listDirectives(activeAccountId)) } catch { /* silencioso */ }
  }

  const brandName = (id: string | null) => brands.find(b => b.id === id)?.name ?? null

  async function submit() {
    if (!activeAccountId) return
    setError(null); setMsg(null)
    // validación mínima por modo
    if (mode === 'push' && !brandId) { setError('Elige una marca'); return }
    if (mode === 'custom' && !caption.trim()) { setError('Escribe el texto del post'); return }
    setSaving(true)
    try {
      const hashtags = tags.split(/\s+/).map(t => t.trim()).filter(Boolean)
      await createDirective(activeAccountId, {
        kind: mode,
        brand_id: (mode === 'push' || mode === 'custom') ? (brandId || null) : null,
        menu_item_id: mode === 'push' ? (dishId || null) : null,
        theme: mode === 'context' ? theme : null,
        caption: (mode === 'context' || mode === 'custom') ? (caption.trim() || null) : null,
        hashtags: mode === 'custom' && hashtags.length ? hashtags : null,
        photo_url: mode === 'custom' ? (photoUrl.trim() || null) : null,
        template: mode === 'custom' ? template : null,
      })
      setMsg('Directiva creada. El agente la respetará en su próxima publicación.')
      setBrandId(''); setDishId(''); setCaption(''); setTags(''); setPhotoUrl(''); setTheme('generico'); setTemplate('apetito')
      void refreshPending()
      setTimeout(() => setMsg(null), 3000)
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo crear la directiva')
    } finally {
      setSaving(false)
    }
  }

  async function onCancel(id: string) {
    const snap = pending
    setPending(p => p.filter(d => d.id !== id))
    try { await cancelDirective(id) } catch { setPending(snap) }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <header style={{ marginBottom: 16 }}>
        <h1 className="font-display" style={{ fontSize: 26, fontWeight: 600, color: 'var(--color-text-primary, #1a1a1a)' }}>Directivas</h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary, #666)', marginTop: 4 }}>
          Tú marcas la intención; el agente la ejecuta con su calidad (foto, voz, margen) en la próxima publicación.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Tab active={mode === 'push'} onClick={() => setMode('push')}>Empujar una marca</Tab>
        <Tab active={mode === 'context'} onClick={() => setMode('context')}>Tematizar el día</Tab>
        <Tab active={mode === 'custom'} onClick={() => setMode('custom')}>Post a medida</Tab>
      </div>

      <div style={{ padding: 16, borderRadius: 12, border: '1px solid var(--color-border-default, #e5e5e5)', background: 'var(--color-bg-surface, #fff)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(mode === 'push' || mode === 'custom') && (
          <div>
            <label style={labelStyle}>Marca {mode === 'push' ? '(obligatoria)' : '(opcional)'}</label>
            <select value={brandId} onChange={e => setBrandId(e.target.value)} style={inputStyle}>
              <option value="">{mode === 'push' ? 'Elige una marca…' : 'Deja que el agente elija'}</option>
              {brands.map(b => (
                <option key={b.id} value={b.id}>{b.name}{b.ownership_type === 'licensed' ? ' (cedida · saldrá anónima)' : ''}</option>
              ))}
            </select>
          </div>
        )}

        {mode === 'push' && brandId && (
          <div>
            <label style={labelStyle}>Plato (opcional — si no, el más vendido)</label>
            <select value={dishId} onChange={e => setDishId(e.target.value)} style={inputStyle}>
              <option value="">El plato estrella de la marca</option>
              {dishes.map(d => <option key={d.id} value={d.id}>{d.name}{d.photo_url ? '' : ' (sin foto)'}</option>)}
            </select>
          </div>
        )}

        {mode === 'context' && (
          <>
            <div>
              <label style={labelStyle}>Contexto del día</label>
              <select value={theme} onChange={e => setTheme(e.target.value)} style={inputStyle}>
                <option value="calor">Hace calor</option>
                <option value="lluvia">Llueve</option>
                <option value="generico">Algo pasa hoy (genérico)</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Texto propio (opcional)</label>
              <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={3} placeholder="Si lo dejas vacío, el agente escribe con la voz de la marca." style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
          </>
        )}

        {mode === 'custom' && (
          <>
            <div>
              <label style={labelStyle}>Texto del post (obligatorio)</label>
              <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={4} placeholder="Escribe el caption tal cual quieres que salga." style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
            <div>
              <label style={labelStyle}>Hashtags (opcional)</label>
              <input value={tags} onChange={e => setTags(e.target.value)} placeholder="#foodint #madrid…" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>URL de foto propia (opcional)</label>
              <input value={photoUrl} onChange={e => setPhotoUrl(e.target.value)} placeholder="Si no, se usa la foto del plato de la marca." style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Estilo</label>
              <select value={template} onChange={e => setTemplate(e.target.value)} style={inputStyle}>
                <option value="apetito">Apetito</option>
                <option value="curiosidad">Curiosidad</option>
              </select>
            </div>
          </>
        )}

        {error && <p style={{ fontSize: 13, color: '#b3261e', margin: 0 }}>{error}</p>}
        {msg && <p style={{ fontSize: 13, color: '#1a7f4b', margin: 0, fontWeight: 600 }}>{msg}</p>}

        <div>
          <button onClick={() => void submit()} disabled={saving} style={{ fontSize: 14, fontWeight: 600, padding: '9px 18px', borderRadius: 8, border: 'none', background: 'var(--color-accent, #1E3A5F)', color: '#fff', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Creando…' : 'Programar para la próxima publicación'}
          </button>
        </div>
      </div>

      {/* Directivas pendientes */}
      <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 28, marginBottom: 12, color: 'var(--color-text-primary, #1a1a1a)' }}>Pendientes</h2>
      {pending.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary, #888)' }}>No hay directivas pendientes. El agente decide solo hasta que le digas algo.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pending.map(d => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10, border: '1px solid var(--color-border-default, #e5e5e5)', background: 'var(--color-bg-surface, #fff)' }}>
              <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 999, background: 'var(--color-accent-bg, #eef2f7)', color: 'var(--color-accent, #1E3A5F)' }}>{KIND_LABEL[d.kind]}</span>
              <span style={{ fontSize: 13, color: 'var(--color-text-primary, #333)', flex: 1, minWidth: 0 }}>
                {d.kind === 'push' && (brandName(d.brand_id) ?? 'Marca')}
                {d.kind === 'context' && `Tema: ${d.theme ?? '—'}`}
                {d.kind === 'custom' && (d.caption ? `«${d.caption.slice(0, 60)}${d.caption.length > 60 ? '…' : ''}»` : 'Post a medida')}
              </span>
              <button onClick={() => void onCancel(d.id)} style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 8, border: '1px solid #f0c6c2', color: '#b3261e', background: 'transparent', cursor: 'pointer' }}>Cancelar</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
