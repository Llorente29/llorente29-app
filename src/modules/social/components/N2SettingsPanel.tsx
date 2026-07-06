// src/modules/social/components/N2SettingsPanel.tsx
//
// Panel de Ajustes de N2 (Gemini viste el fondo). El cliente manda, reversible:
//  - Encender/apagar N2, tope diario de imágenes, peso del ambiente (mood).
//  - Biblioteca de escenas EDITABLE (evolutiva): activar/desactivar, editar prompt/etiqueta,
//    subir/bajar peso, añadir las tuyas, borrar. "Personalizar mi biblioteca" copia las globales.

import { useEffect, useState } from 'react'
import { useApp } from '@/context/AppContext'
import {
  getN2Config, setN2Config, listScenes, seedAccountScenes,
  createScene, updateScene, deleteScene,
  type N2Config, type SceneRow,
} from '@/modules/social/services/socialService'

const card: React.CSSProperties = { padding: 16, borderRadius: 12, border: '1px solid var(--color-border-default, #e5e5e5)', background: 'var(--color-bg-surface, #fff)' }
const inp: React.CSSProperties = { fontSize: 14, padding: 8, borderRadius: 8, border: '1px solid var(--color-border-default, #ddd)' }
const lbl: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary, #555)' }

function Btn({ children, onClick, primary, danger, disabled }: any) {
  return <button onClick={onClick} disabled={disabled} style={{
    fontSize: 13, fontWeight: 600, padding: '6px 12px', borderRadius: 8, cursor: disabled ? 'default' : 'pointer',
    border: danger ? '1px solid #f0c6c2' : primary ? 'none' : '1px solid var(--color-border-default, #ddd)',
    background: primary ? 'var(--color-accent, #1E3A5F)' : 'transparent',
    color: primary ? '#fff' : danger ? '#b3261e' : 'var(--color-text-primary, #333)', opacity: disabled ? 0.5 : 1,
  }}>{children}</button>
}

export default function N2SettingsPanel() {
  const { activeAccountId } = useApp()
  const [cfg, setCfg] = useState<N2Config>({ n2_enabled: false, n2_daily_cap: 30, n2_mood_ratio: 5 })
  const [scenes, setScenes] = useState<SceneRow[]>([])
  const [isOwn, setIsOwn] = useState(false)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const [editId, setEditId] = useState<string | null>(null)
  const [eLabel, setELabel] = useState(''); const [ePrompt, setEPrompt] = useState(''); const [eWeight, setEWeight] = useState(1)
  const [adding, setAdding] = useState(false)
  const [nMode, setNMode] = useState<'dress' | 'mood'>('dress'); const [nLabel, setNLabel] = useState(''); const [nPrompt, setNPrompt] = useState(''); const [nWeight, setNWeight] = useState(1)

  async function reload() {
    if (!activeAccountId) return
    const [c, s] = await Promise.all([getN2Config(activeAccountId), listScenes(activeAccountId)])
    setCfg(c); setScenes(s.scenes); setIsOwn(s.isOwn)
  }
  useEffect(() => {
    if (!activeAccountId) return
    let alive = true
    setLoading(true); setErr(null)
    reload().catch(e => { if (alive) setErr(e?.message ?? 'No se pudo cargar N2') }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId])

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(null), 2000) }

  async function saveCfg(next: N2Config) {
    if (!activeAccountId) return
    const prev = cfg; setCfg(next)
    try { await setN2Config(activeAccountId, next); flash('Guardado ✓') }
    catch (e: any) { setCfg(prev); setErr(e?.message ?? 'No se pudo guardar') }
  }

  async function onPersonalize() {
    if (!activeAccountId) return
    try { const n = await seedAccountScenes(activeAccountId); await reload(); flash(`Biblioteca personalizada (${n} escenas)`) }
    catch (e: any) { setErr(e?.message ?? 'No se pudo personalizar') }
  }

  function startEdit(s: SceneRow) { setEditId(s.id); setELabel(s.label); setEPrompt(s.prompt); setEWeight(s.weight) }
  async function saveEdit(id: string) {
    try { await updateScene(id, { label: eLabel, prompt: ePrompt, weight: Math.max(1, eWeight) }); setEditId(null); await reload() }
    catch (e: any) { setErr(e?.message ?? 'No se pudo guardar la escena') }
  }
  async function toggleActive(s: SceneRow) {
    setScenes(list => list.map(x => x.id === s.id ? { ...x, is_active: !x.is_active } : x))
    try { await updateScene(s.id, { is_active: !s.is_active }) } catch (e: any) { setErr(e?.message ?? 'Error'); await reload() }
  }
  async function onDelete(id: string) {
    setScenes(list => list.filter(x => x.id !== id))
    try { await deleteScene(id) } catch (e: any) { setErr(e?.message ?? 'Error'); await reload() }
  }
  async function onAdd() {
    if (!activeAccountId || !nLabel.trim() || !nPrompt.trim()) { setErr('Pon etiqueta y prompt'); return }
    try {
      await createScene(activeAccountId, { mode: nMode, label: nLabel.trim(), prompt: nPrompt.trim(), weight: Math.max(1, nWeight) })
      setAdding(false); setNLabel(''); setNPrompt(''); setNWeight(1); setNMode('dress'); await reload(); flash('Escena añadida ✓')
    } catch (e: any) { setErr(e?.message ?? 'No se pudo añadir') }
  }

  if (loading) return <p style={{ color: 'var(--color-text-secondary, #666)', marginTop: 24 }}>Cargando N2…</p>

  const dress = scenes.filter(s => s.mode === 'dress')
  const mood = scenes.filter(s => s.mode === 'mood')

  const SceneItem = (s: SceneRow) => (
    <div key={s.id} style={{ ...card, padding: 12 }}>
      {editId === s.id ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input value={eLabel} onChange={e => setELabel(e.target.value)} style={{ ...inp, width: '100%' }} placeholder="Etiqueta" />
          <textarea value={ePrompt} onChange={e => setEPrompt(e.target.value)} rows={3} style={{ ...inp, width: '100%', resize: 'vertical' }} placeholder="Prompt para Gemini" />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={lbl}>Peso</span>
            <input type="number" min={1} value={eWeight} onChange={e => setEWeight(parseInt(e.target.value) || 1)} style={{ ...inp, width: 70 }} />
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <Btn primary onClick={() => saveEdit(s.id)}>Guardar</Btn>
              <Btn onClick={() => setEditId(null)}>Cancelar</Btn>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: s.is_active ? 'var(--color-text-primary, #1a1a1a)' : '#aaa', flex: 1, minWidth: 0 }}>
            {s.label}{!s.is_active && ' · apagada'}
          </span>
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #888)' }}>peso {s.weight}</span>
          {isOwn ? (
            <>
              <Btn onClick={() => toggleActive(s)}>{s.is_active ? 'Apagar' : 'Encender'}</Btn>
              <Btn onClick={() => startEdit(s)}>Editar</Btn>
              <Btn danger onClick={() => onDelete(s.id)}>Borrar</Btn>
            </>
          ) : <span style={{ fontSize: 12, color: '#aaa' }}>global</span>}
        </div>
      )}
    </div>
  )

  return (
    <div style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text-primary, #1a1a1a)' }}>Imagen con IA (N2)</h2>
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary, #666)', marginTop: 4, marginBottom: 16 }}>
        Gemini viste el fondo de tus fotos. En <b>vestir</b> el plato es el real, intacto; en <b>ambiente</b> la IA imagina la escena (personas, calle) y la comida es generada — contenido de marca, úsalo con mesura.
      </p>

      {err && <div style={{ marginBottom: 12, padding: 12, borderRadius: 10, background: '#fdecea', color: '#b3261e', fontSize: 13 }}>{err}</div>}
      {msg && <p style={{ fontSize: 13, color: '#1a7f4b', fontWeight: 600, marginTop: -4, marginBottom: 12 }}>{msg}</p>}

      {/* Config */}
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={cfg.n2_enabled} onChange={e => saveCfg({ ...cfg, n2_enabled: e.target.checked })} style={{ width: 18, height: 18 }} />
          <span style={{ fontSize: 15, fontWeight: 600 }}>N2 activado</span>
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary, #888)' }}>· si lo apagas, se usa la foto real sin vestir (N1)</span>
        </label>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={lbl}>Tope diario de imágenes IA</span>
            <input type="number" min={0} value={cfg.n2_daily_cap} onChange={e => setCfg({ ...cfg, n2_daily_cap: parseInt(e.target.value) || 0 })} onBlur={() => saveCfg(cfg)} style={{ ...inp, width: 100 }} />
            <span style={{ fontSize: 11, color: '#999' }}>~0,04 $/img · protege el gasto</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={lbl}>Ambiente: 1 de cada…</span>
            <input type="number" min={0} value={cfg.n2_mood_ratio} onChange={e => setCfg({ ...cfg, n2_mood_ratio: parseInt(e.target.value) || 0 })} onBlur={() => saveCfg(cfg)} style={{ ...inp, width: 100 }} />
            <span style={{ fontSize: 11, color: '#999' }}>0 = nunca ambiente (solo vestir)</span>
          </div>
        </div>
      </div>

      {/* Biblioteca */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Biblioteca de escenas</h3>
        {!isOwn && <Btn primary onClick={onPersonalize}>Personalizar mi biblioteca</Btn>}
        {isOwn && <Btn primary onClick={() => setAdding(a => !a)}>{adding ? 'Cerrar' : 'Añadir escena'}</Btn>}
      </div>
      {!isOwn && <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #888)', marginBottom: 12 }}>Estás viendo las escenas base (globales). Pulsa «Personalizar» para tener tu propia biblioteca editable.</p>}

      {adding && isOwn && (
        <div style={{ ...card, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <select value={nMode} onChange={e => setNMode(e.target.value as any)} style={inp}>
              <option value="dress">Vestir (plato real)</option>
              <option value="mood">Ambiente (IA imagina)</option>
            </select>
            <input value={nLabel} onChange={e => setNLabel(e.target.value)} placeholder="Etiqueta (ej. Playa al atardecer)" style={{ ...inp, flex: 1 }} />
            <input type="number" min={1} value={nWeight} onChange={e => setNWeight(parseInt(e.target.value) || 1)} style={{ ...inp, width: 70 }} title="Peso" />
          </div>
          <textarea value={nPrompt} onChange={e => setNPrompt(e.target.value)} rows={3} placeholder="Prompt en inglés para Gemini (describe el entorno; no la comida)" style={{ ...inp, resize: 'vertical' }} />
          <div><Btn primary onClick={onAdd}>Añadir</Btn></div>
        </div>
      )}

      <p style={{ ...lbl, marginBottom: 6 }}>Vestir · plato real ({dress.length})</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>{dress.map(SceneItem)}</div>

      <p style={{ ...lbl, marginBottom: 6 }}>Ambiente · IA imagina ({mood.length})</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{mood.map(SceneItem)}</div>
    </div>
  )
}
