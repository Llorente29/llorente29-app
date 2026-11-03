// src/modules/multitenancy/components/InvitacionesMias.tsx
//
// DM1 · Accesos 1 (03/11/2026). Tablero 7 de «Accesos e invitaciones»: quien
// ya tiene usuario ve sus invitaciones pendientes arriba del selector de
// empresa, con «Aceptar» y «Ahora no». Al aceptar, la empresa entra en su lista
// (la página se recarga para leerla: mis_empresas). Solo SUS invitaciones: las
// de su correo (mis_invitaciones / invitacion_aceptar, con su sesión).

import { useState } from 'react'
import { NOMBRE_PERMISO, aceptarInvitaciones, type MiInvitacion } from '../services/invitacionesService'

const fecha = (iso: string) => {
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString() ? 'hoy' : `el ${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}`
}

export function InvitacionesMias({ invitaciones }: { invitaciones: MiInvitacion[] }) {
  const [ocultas, setOcultas] = useState<string[]>([])
  const [ocupada, setOcupada] = useState<string | null>(null)
  const [hecho, setHecho] = useState('')
  const [error, setError] = useState('')
  const visibles = invitaciones.filter((i) => !ocultas.includes(i.id))
  if (visibles.length === 0 && !hecho && !error) return null

  async function aceptar(i: MiInvitacion) {
    setError(''); setOcupada(i.id)
    try {
      const nombres = await aceptarInvitaciones([i.id])
      setHecho(`Ya entras en ${nombres.join(' y ') || i.empresa}. La tienes en tu lista de empresas.`)
      setOcultas((o) => [...o, i.id])
      window.setTimeout(() => window.location.reload(), 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setOcupada(null)
    }
  }

  return (
    <div className="s-invitaciones" data-prueba="mis-invitaciones">
      {visibles.map((i) => (
        <div key={i.id} className="s-invitaciones-una">
          <span><strong>Te invitan a {i.empresa}</strong> como {NOMBRE_PERMISO[i.rol] ?? i.rol}.{i.invita ? ` Te invitó ${i.invita} ${fecha(i.creada_at)}.` : ''}</span>
          <span className="s-invitaciones-acciones">
            <button type="button" className="s-boton s-boton-principal" disabled={ocupada !== null} data-prueba="invitacion-aceptar"
              onClick={() => { void aceptar(i) }}>{ocupada === i.id ? 'Aceptando…' : 'Aceptar'}</button>
            <button type="button" className="s-boton s-boton-secundario" disabled={ocupada !== null}
              onClick={() => setOcultas((o) => [...o, i.id])}>Ahora no</button>
          </span>
        </div>
      ))}
      {hecho && <p className="s-invitaciones-hecho" role="status" data-prueba="invitacion-aceptada">{hecho}</p>}
      {error && <p className="s-invitar-error" role="alert">{error}</p>}
    </div>
  )
}
