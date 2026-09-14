// src/modules/social/pages/SocialSettingsPage.tsx
//
// Ajustes del módulo Folvy Social.
//  - Palanca de fase del lanzamiento (apetito → comunidad → conversión).
//  - Panel N2 (imagen con IA): encender/tope/peso mood + biblioteca de escenas editable.

import { useEffect, useState } from 'react'
import { useApp } from '@/context/AppContext'
import { getPhase, setPhase, getEstadoDeLasCuentas, type LaunchPhase } from '@/modules/social/services/socialService'
import {
  comoEstaLaCuenta, elTonoDeLaCuenta, laCuentaAtras, elRenglonDeLaCaducidad,
  loUltimoQueSalio, REDES, type CuentaDeRed,
} from '@/modules/social/lib/laFichaDeLaCuenta'
import N2SettingsPanel from '@/modules/social/components/N2SettingsPanel'

const PHASES: { key: LaunchPhase; title: string; desc: string }[] = [
  { key: 'apetito', title: 'Apetito', desc: 'Solo despiertas hambre. El agente publica contenido, pero no vende. Ideal para arrancar.' },
  { key: 'comunidad', title: 'Comunidad', desc: 'Construyes audiencia. Sigues sin ofertas: comunidad primero, venta después.' },
  { key: 'conversion', title: 'Conversión', desc: 'Enciendes las ofertas. El agente empieza a anunciar promos reales para convertir.' },
]

/** La fecha como la lee una persona, no como la escribe una base de datos. */
function laFechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function SocialSettingsPage() {
  const { activeAccountId } = useApp()
  const [phase, setPhaseState] = useState<LaunchPhase | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmTo, setConfirmTo] = useState<LaunchPhase | null>(null)
  const [saved, setSaved] = useState(false)
  const [cuentas, setCuentas] = useState<CuentaDeRed[]>([])

  useEffect(() => {
    if (!activeAccountId) return
    let alive = true
    setLoading(true); setError(null)
    getPhase(activeAccountId)
      .then(p => { if (alive) setPhaseState(p) })
      .catch(e => { if (alive) setError(e?.message ?? 'No se pudo cargar la fase') })
      .finally(() => { if (alive) setLoading(false) })
    getEstadoDeLasCuentas(activeAccountId)
      .then(c => { if (alive) setCuentas(c) })
      // Si la ficha no carga, la pantalla NO se queda en blanco ni finge que
      // todo va bien: se queda sin panel y la fase sigue funcionando.
      .catch(() => { if (alive) setCuentas([]) })
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
    if (target === 'conversion') { setConfirmTo(target); return }
    void apply(target)
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <header style={{ marginBottom: 20 }}>
        <h1 className="font-display" style={{ fontSize: 26, fontWeight: 600, color: 'var(--color-text-primary, #1a1a1a)' }}>Ajustes</h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary, #666)', marginTop: 4 }}>
          Fase del lanzamiento y ajustes de imagen con IA.
        </p>
      </header>

      {/* ── LAS CUENTAS Y SUS LLAVES ─────────────────────────────────────
          Esto no existía. La llave de Instagram estuvo muerta nueve días y
          veinte horas (04/09 → 13/09) y no había ninguna pantalla donde
          verlo: lo único que quedaba era el mensaje de Meta dentro de cinco
          publicaciones fallidas. Va lo PRIMERO porque si no se puede
          publicar, lo demás de esta pantalla da igual. */}
      <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text-primary, #1a1a1a)', marginBottom: 4 }}>Las cuentas</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #666)', marginTop: 0, marginBottom: 14 }}>
        Dónde publica el agente, y si la llave de cada una sigue valiendo.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
        {cuentas.map(c => {
          const tono = elTonoDeLaCuenta(c)
          const fondo = tono === 'malo' ? '#fdecea' : tono === 'aviso' ? '#fff6e5'
            : tono === 'ok' ? '#e7f5ec' : 'var(--color-bg-muted, #f4f4f4)'
          const borde = tono === 'malo' ? '#f0c6c2' : tono === 'aviso' ? '#f0dcb4'
            : tono === 'ok' ? '#bfe3cd' : 'var(--color-border-default, #e5e5e5)'
          const urgente = laCuentaAtras(c)
          return (
            <div key={c.red} style={{ padding: 14, borderRadius: 12, background: fondo, border: `1px solid ${borde}` }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text-primary, #1a1a1a)' }}>
                {REDES[c.red] ?? c.red}
              </div>
              <p style={{ fontSize: 13, margin: '6px 0 0', color: 'var(--color-text-primary, #333)' }}>
                {comoEstaLaCuenta(c, laFechaCorta)}
              </p>
              {/* Lo que interrumpe va destacado; la fecha va siempre debajo. */}
              {urgente && (
                <p style={{ fontSize: 13, fontWeight: 600, margin: '6px 0 0', color: '#b3261e' }}>{urgente}</p>
              )}
              {loUltimoQueSalio(c, laFechaCorta) && (
                <p style={{ fontSize: 12, margin: '6px 0 0', color: 'var(--color-text-secondary, #666)' }}>
                  {loUltimoQueSalio(c, laFechaCorta)}
                </p>
              )}
              {elRenglonDeLaCaducidad(c, laFechaCorta) && (
                <p style={{ fontSize: 12, margin: '4px 0 0', color: 'var(--color-text-secondary, #777)' }}>
                  {elRenglonDeLaCaducidad(c, laFechaCorta)}
                </p>
              )}
            </div>
          )
        })}
      </div>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text-primary, #1a1a1a)', marginBottom: 4 }}>Fase del lanzamiento</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #666)', marginTop: 0, marginBottom: 14 }}>
        Decide cuánto empuja el canal: desde solo dar hambre hasta vender.
      </p>

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

      {/* N2 · imagen con IA */}
      <N2SettingsPanel />
    </div>
  )
}
