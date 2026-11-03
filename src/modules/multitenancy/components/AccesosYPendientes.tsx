// src/modules/multitenancy/components/AccesosYPendientes.tsx
//
// DM1 · Accesos 1 (03/11/2026). Tableros 5 y 6 de «Accesos e invitaciones»
// (aprobados por Julio el 03/11): quién tiene acceso a la empresa abierta, las
// invitaciones pendientes (reenviar y anular) y quitar el acceso a alguien,
// con su diálogo. La misma pieza en Sumied (Ajustes › Usuarios) y en Folvy
// (Configuración › Usuarios y accesos). Solo la ve un administrador: la base
// no le enseña nada a nadie más (accesos_de_cuenta, invitaciones_de_cuenta).
// Cada acción dice lo que ha pasado, con contenido (regla 8).

import { useEffect, useState } from 'react'
import { MARCA } from '@/marca/marca'
import { Boton, Chip, Dialogo, Tarjeta } from '@/modules/conta/diseno'
import {
  NOMBRE_PERMISO, accesosDeCuenta, anularInvitacion, pendientesDeCuenta, quitarAcceso, reenviarInvitacion,
  type Acceso, type Pendiente,
} from '../services/invitacionesService'
import '@/modules/conta/diseno/tokens.css'
import '@/modules/conta/diseno/diseno.css'
import './invitar.css'

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) : '')
const cuando = (iso: string | null) => {
  if (!iso) return 'aún no ha entrado'
  const d = new Date(iso)
  const hoy = new Date()
  const ayer = new Date(hoy.getTime() - 86_400_000)
  if (d.toDateString() === hoy.toDateString()) return 'entró hoy'
  if (d.toDateString() === ayer.toDateString()) return 'entró ayer'
  return `entró el ${fecha(iso)}`
}

export function AccesosYPendientes({ accountId, empresa, aviso, vuelta = 0 }: {
  accountId: string
  /** El nombre de la empresa abierta, para las frases. */
  empresa: string
  /** Lo que acaba de pasar fuera (la frase de «Invitar a una persona»). */
  aviso?: string
  /** Cambia para volver a leer (después de invitar). */
  vuelta?: number
}) {
  const [accesos, setAccesos] = useState<Acceso[] | null>(null)
  const [pendientes, setPendientes] = useState<Pendiente[] | null>(null)
  const [hecho, setHecho] = useState('')
  const [error, setError] = useState('')
  const [quitando, setQuitando] = useState<Acceso | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [leer, setLeer] = useState(0)

  useEffect(() => {
    let vivo = true
    const t = window.setTimeout(async () => {
      try {
        const [a, p] = await Promise.all([accesosDeCuenta(accountId), pendientesDeCuenta(accountId)])
        if (vivo) { setAccesos(a); setPendientes(p) }
      } catch (e) {
        if (vivo) { setAccesos([]); setPendientes([]); setError(e instanceof Error ? e.message : String(e)) }
      }
    }, 0)
    return () => { vivo = false; window.clearTimeout(t) }
  }, [accountId, vuelta, leer])

  async function hacer(clave: string, accion: () => Promise<string>) {
    setError(''); setHecho(''); setOcupado(clave)
    try { setHecho(await accion()); setLeer((v) => v + 1) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setOcupado(null) }
  }

  const activos = accesos?.filter((a) => a.activo) ?? []
  const nombreDe = (a: Acceso) => a.nombre?.trim() || a.correo
  const mensaje = hecho || aviso

  return (
    <div className="cx-colores s-raiz s-accesos" data-prueba="accesos">
      {mensaje && <p className="s-accesos-hecho" role="status" data-prueba="accesos-hecho">{mensaje}</p>}
      {error && <p className="s-invitar-error" role="alert">{error}</p>}

      <Tarjeta titulo="Con acceso" apoyo={accesos ? `${activos.length} ${activos.length === 1 ? 'persona' : 'personas'}` : 'Buscando…'}>
        <ul className="s-accesos-lista" data-prueba="accesos-con-acceso">
          {activos.map((a) => (
            <li key={a.user_id} className="s-accesos-fila">
              <span className="s-accesos-quien">
                <span className="s-accesos-nombre">{nombreDe(a)}{a.soy_yo && <span className="s-accesos-tu"> (tú)</span>}</span>
                <span className="s-accesos-nota">{a.correo} · {cuando(a.ultimo_acceso)}</span>
              </span>
              <Chip tono={a.rol === 'admin' ? 'accion' : 'neutro'}>{NOMBRE_PERMISO[a.rol] ?? a.rol}</Chip>
              {!a.soy_yo
                ? <Boton variante="enlace" className="s-accesos-quitar" data-prueba="accesos-quitar" onClick={() => setQuitando(a)}>Quitar acceso</Boton>
                : <span />}
            </li>
          ))}
        </ul>
      </Tarjeta>

      <Tarjeta titulo="Pendientes" apoyo={pendientes ? `${pendientes.length} ${pendientes.length === 1 ? 'invitación' : 'invitaciones'}` : 'Buscando…'}>
        {pendientes?.length === 0 && <p className="s-accesos-nota">No hay invitaciones esperando respuesta.</p>}
        <ul className="s-accesos-lista" data-prueba="accesos-pendientes">
          {pendientes?.map((p) => (
            <li key={p.id} className="s-accesos-fila">
              <span className="s-accesos-quien">
                <span className="s-accesos-nombre">{p.correo}</span>
                <span className="s-accesos-nota">
                  {p.invita ? `La invitó ${p.invita} el ${fecha(p.creada_at)}` : `Invitada el ${fecha(p.creada_at)}`}
                  {' · '}{p.caducada ? `caducó el ${fecha(p.caduca_at)}` : `caduca el ${fecha(p.caduca_at)}`}
                </span>
              </span>
              <Chip tono="duda">{NOMBRE_PERMISO[p.rol] ?? p.rol} · {p.caducada ? 'caducada' : 'pendiente'}</Chip>
              <span className="s-accesos-acciones">
                <Boton variante="enlace" disabled={ocupado !== null} data-prueba="pendiente-reenviar"
                  onClick={() => { void hacer(p.id, () => reenviarInvitacion(p.id, MARCA.id === 'sumied' ? 'sumied' : 'folvy')) }}>
                  {ocupado === p.id ? 'Reenviando…' : 'Reenviar'}
                </Boton>
                <Boton variante="enlace" disabled={ocupado !== null} data-prueba="pendiente-anular"
                  onClick={() => { void hacer(p.id, async () => `Invitación anulada: ${await anularInvitacion(p.id)} ya no puede entrar con ese enlace.`) }}>
                  Anular
                </Boton>
              </span>
            </li>
          ))}
        </ul>
      </Tarjeta>

      {quitando && (
        <Dialogo titulo={`¿Quitar el acceso a ${nombreDe(quitando)}?`} alCerrar={() => setQuitando(null)}
          explicacion={`Deja de entrar en ${empresa} ahora mismo. Lo que ha hecho se queda. Si entra en otras empresas, en esas sigue.`}
          acciones={(
            <>
              <Boton onClick={() => setQuitando(null)}>Cancelar</Boton>
              <Boton variante="principal" className="s-boton-peligro" data-prueba="quitar-confirmar" disabled={ocupado !== null}
                onClick={() => {
                  const q = quitando
                  setQuitando(null)
                  void hacer(q.user_id, async () => { await quitarAcceso(accountId, q.user_id); return `Acceso quitado: ${nombreDe(q)} ya no entra en ${empresa}.` })
                }}>
                Quitar el acceso
              </Boton>
            </>
          )} />
      )}
    </div>
  )
}
