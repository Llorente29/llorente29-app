// src/modules/social/pages/SocialSettingsPage.tsx
//
// Ajustes del módulo Folvy Social (Pieza 5). Palanca de fase del lanzamiento:
// apetito → comunidad → conversión. Gatea la venta: el agente solo anuncia
// ofertas en 'conversión'. Cambiar a conversión pide confirmación (a partir de
// ahí se vende de verdad).

import { useEffect, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { getPhase, setPhase, type LaunchPhase } from '@/modules/social/services/socialService'

const PHASES: { key: LaunchPhase; title: string; desc: string }[] = [
  { key: 'apetito', title: 'Apetito', desc: 'Solo despiertas hambre. El agente publica contenido, pero no vende. Ideal para arrancar.' },
  { key: 'comunidad', title: 'Comunidad', desc: 'Construyes audiencia. Sigues sin ofertas: comunidad primero, venta después.' },
  { key: 'conversion', title: 'Conversión', desc: 'Enciendes las ofertas. El agente empieza a anunciar promos reales para convertir.' },
]

export default function SocialSettingsPage() {
  const { activeAccountId } = useApp()
  const [phase, setPhaseState] = useState<LaunchPhase | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmTo, setConfirmTo] = useState<LaunchPhase | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!activeAccountId) return
    let alive = true
    setLoading(true); setError(null)
    getPhase(activeAccountId)
      .then(p => { if (alive) setPhaseState(p) })
      .catch(e => { if (alive) setError(e?.message ?? 'No se pudo cargar la fase') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [activeAccountId])

  async function apply(target: LaunchPhase) {
    if (!activeAccountId) return
    setConfirmTo(null); setSaving(true); setError(null); setSaved(false)
    const prev = phase
    setPhaseState(target)
    try {
      await setPhase(activeAccountId, target)
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e: any) {
      setPhaseState(prev ?? null); setError(e?.message ?? 'No se pudo cambiar la fase')
    } finally {
      setSaving(false)
    }
  }

  function onPick(target: LaunchPhase) {
    if (target === phase || saving) return
    if (target === 'conversion') { setConfirmTo(target); return }  // vender = confirmar
    void apply(target)
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <header style={{ marginBottom: 20 }}>
        <h1 className="font-display" style={{ fontSize: 26, fontWeight: 600, color: 'var(--color-text-primary, #1a1a1a)' }}>Ajustes</h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary, #666)', marginTop: 4 }}>
          Fase del lanzamiento. Decide cuánto empuja el canal: desde solo dar hambre hasta vender.
        </p>
      </header>

      {error && <div style={{ marginBottom: 12, padding: 12, borderRadius: 10, background: '#fdecea', color: '#b3261e', fontSize: 13 }}>{error}</div>}
      {loading && <p style={{ color: 'var(--color-text-secondary, #666)' }}>Cargando…</p>}

      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {PHASES.map(p => {
            const active = phase === p.key
            return (
              <button key={p.key} onClick={() => onPick(p.key)} disabled={saving} style={{
                textAlign: 'left', padding: 16, borderRadius: 12, cursor: active || saving ? 'default' : 'pointer',
                border: active ? '2px solid var(--color-accent, #1E3A5F)' : '1px solid var(--color-border-default, #e5e5e5)',
                background: active ? 'var(--color-accent-bg, #eef2f7)' : 'var(--color-bg-surface, #fff)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary, #1a1a1a)' }}>{p.title}</span>
                  {active && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-accent, #1E3A5F)' }}>· Fase actual</span>}
                </div>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #666)', marginTop: 4, marginBottom: 0 }}>{p.desc}</p>
              </button>
            )
          })}
        </div>
      )}

      {saved && <p style={{ fontSize: 13, color: '#1a7f4b', marginTop: 12, fontWeight: 600 }}>Fase actualizada ✓</p>}

      {confirmTo === 'conversion' && (
        <div style={{ marginTop: 16, padding: 16, borderRadius: 12, border: '1px solid #f0c6c2', background: '#fdf3f2' }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#b3261e', margin: 0 }}>¿Pasar a Conversión?</p>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #666)', marginTop: 6 }}>
            A partir de aquí el agente empezará a anunciar ofertas reales. Solo tus marcas propias; las cedidas nunca entran en ofertas.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => void apply('conversion')} disabled={saving} style={{ fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 8, border: 'none', background: 'var(--color-accent, #1E3A5F)', color: '#fff', cursor: 'pointer' }}>Sí, activar Conversión</button>
            <button onClick={() => setConfirmTo(null)} disabled={saving} style={{ fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 8, border: '1px solid var(--color-border-default, #ddd)', background: 'transparent', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
