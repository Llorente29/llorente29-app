// src/modules/conta/gestoria/portal/PortalPendiente.tsx
//
// GP · Tarea 4 (Code 3, 09/11/2026) · LO DEL PORTAL EN «LO QUE TIENES QUE
// HACER» (Clientes de la gestoría): mensajes de clientes sin leer, lo que piden
// (altas, bajas y avisos) y lo que han subido sin buzón. Una lectura
// (conta_portal_pendiente). Cada tarjeta lleva a la pestaña «Portal» de la
// ficha del cliente. No esconde nada (regla 7): si hay, sale con su número.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { leerPendientePortal, type PendientePortal } from './datos'
import { tarjetasDelPortal } from './pendiente'

export interface PropsPortalPendiente {
  cuenta: string
  /** Las otras tareas de «Lo que tienes que hacer»: con 0 y nada del portal, dice «Nada pendiente.». */
  otras: number
  rutaFicha: (cliente: string) => string
  leer?: () => Promise<PendientePortal>
}

export function PortalPendiente(p: PropsPortalPendiente) {
  const [d, setD] = useState<PendientePortal | null>(null)
  const [error, setError] = useState(false)
  const leer = p.leer
  useEffect(() => { void (leer ? leer() : leerPendientePortal(p.cuenta)).then(setD, () => setError(true)) }, [p.cuenta, leer])
  if (error) return <p className="g4-hecho" role="alert">No se ha podido leer lo pendiente del portal de tus clientes.</p>
  if (!d) return p.otras ? null : <p className="g4-pequeno" style={{ fontSize: 14 }} aria-busy="true">Mirando el portal de tus clientes…</p>
  const tarjetas = tarjetasDelPortal(d)
  if (!tarjetas.length) return p.otras ? null : <p className="g4-nada">Nada pendiente.</p>
  return (
    <div className="g4-tareas" data-pantalla="portal-pendiente">
      {tarjetas.map((t) => (
        <div key={t.id} className="g4-tarea" data-tono={t.tono}>
          <div className="g4-tarea-cabeza"><div className="g4-tarea-n">{t.n}</div><div className="g4-tarea-titulo">{t.titulo} · portal</div></div>
          {t.clientes.slice(0, 4).map((c) => (
            <Link key={c.id} to={p.rutaFicha(c.id)} className="g4-tarea-texto" style={{ textDecoration: 'none' }}><b style={{ color: 'var(--g4-tinta)' }}>{c.nombre}</b> · {c.que} →</Link>
          ))}
          {t.clientes.length > 4 && <div className="g4-tarea-texto">Y {t.clientes.length - 4} clientes más: los ves en su ficha, pestaña «Portal».</div>}
        </div>
      ))}
    </div>
  )
}
