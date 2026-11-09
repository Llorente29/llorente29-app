// src/portal/App.tsx
//
// GP · Tarea 3 · La entrada del portal del cliente (portal.html):
//   1. Con ?token_hash (el enlace del correo): lo canjea y entra.
//   2. Sin sesión: «Entrar» pide el enlace por correo (sin contraseña).
//   3. Con sesión: a qué clientes tiene acceso (conta_portal_entrada). Con uno,
//      entra; con varios, elige (y se recuerda en este navegador).
//   4. Con ?vuelta=<operación> (vuelve del banco o del pago): pregunta en qué ha
//      quedado y lo dice arriba (regla 8).

import { useEffect, useState, type FormEvent } from 'react'
import { accion, canjear, entrar, leer, sb } from './cliente'
import type { Aviso } from './comun'
import type { ClienteDeEntrada } from './tipos'
import { Portal } from './Portal'

const RECORDAR = 'sumied-portal-cliente'
const recordado = () => { try { return localStorage.getItem(RECORDAR) } catch { return null } }
const recordar = (id: string) => { try { localStorage.setItem(RECORDAR, id) } catch { /* sin almacén */ } }

type Estado = { fase: 'cargando' } | { fase: 'fuera'; nota: string | null } | { fase: 'sin_acceso'; correo: string }
  | { fase: 'elegir'; clientes: ClienteDeEntrada[]; yo: string } | { fase: 'dentro'; c: ClienteDeEntrada; clientes: ClienteDeEntrada[]; yo: string }

export function App() {
  const [e, setE] = useState<Estado>({ fase: 'cargando' })
  const [aviso, setAviso] = useState<Aviso | null>(null)

  useEffect(() => {
    void (async () => {
      const q = new URLSearchParams(window.location.search)
      let nota: string | null = null
      const token = q.get('token_hash')
      if (token) nota = await canjear(token)
      const vuelta = q.get('vuelta')
      if (token || vuelta) window.history.replaceState(null, '', window.location.pathname + window.location.hash)
      const { data } = sb ? await sb.auth.getSession() : { data: { session: null } }
      if (!data.session) { setE({ fase: 'fuera', nota }); return }
      const yo = String(data.session.user.email ?? '')
      try {
        const r = await leer<{ clientes: ClienteDeEntrada[] }>('conta_portal_entrada')
        if (!r.clientes.length) { setE({ fase: 'sin_acceso', correo: yo }); return }
        if (vuelta && /^[0-9a-f-]{36}$/i.test(vuelta)) {
          const s = await accion('seguir', { operacion: vuelta }).catch(() => null)
          if (s?.frase) setAviso({ tipo: s.estado === 'hecha' ? 'ok' : s.ok ? 'info' : 'mal', texto: s.frase })
        }
        const elegido = r.clientes.find((c) => c.cliente_id === recordado()) ?? (r.clientes.length === 1 ? r.clientes[0] : null)
        setE(elegido ? { fase: 'dentro', c: elegido, clientes: r.clientes, yo } : { fase: 'elegir', clientes: r.clientes, yo })
      } catch (x) { setE({ fase: 'fuera', nota: (x as Error).message }) }
    })()
  }, [])

  if (e.fase === 'cargando') return <div className="pt-cargando" role="status">Entrando…</div>
  if (e.fase === 'fuera') return <Entrar nota={e.nota} />
  if (e.fase === 'sin_acceso') return (
    <div className="pt-entrada">
      <h1 className="pt-h1">Sin acceso</h1>
      <div className="pt-aviso info"><span>{e.correo} no tiene acceso a ningún espacio de cliente. Si es un error, pídele a tu gestoría que te invite.</span></div>
      <button type="button" className="pt-boton sec" onClick={async () => { await sb?.auth.signOut(); window.location.reload() }}>Entrar con otro correo</button>
    </div>
  )
  if (e.fase === 'elegir') return (
    <div className="pt-entrada">
      <h1 className="pt-h1">¿Qué empresa?</h1>
      <div className="pt-lista">
        {e.clientes.map((c) => (
          <button type="button" key={c.cliente_id} className="pt-fila" style={{ background: 'transparent', border: 0, textAlign: 'left' }} onClick={() => { recordar(c.cliente_id); setE({ fase: 'dentro', c, clientes: e.clientes, yo: e.yo }) }}>
            <div className="pt-fila-texto"><b>{c.cliente}</b><span>Con {c.gestoria.nombre}</span></div>
          </button>
        ))}
      </div>
    </div>
  )
  return <Portal c={e.c} yo={e.yo} otros={e.clientes.length} avisoInicial={aviso} cambiar={() => setE({ fase: 'elegir', clientes: e.clientes, yo: e.yo })} />
}

function Entrar({ nota }: { nota: string | null }) {
  const [correo, setCorreo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [hecho, setHecho] = useState<{ frase: string; enlace?: string } | null>(null)
  const pedir = async (ev: FormEvent) => {
    ev.preventDefault()
    setEnviando(true)
    try {
      const r = await entrar(correo)
      setHecho({ frase: r.frase ?? 'Si ese correo tiene acceso, te llega un enlace para entrar en un minuto.', enlace: typeof r.enlace === 'string' ? r.enlace : undefined })
    } catch (x) { setHecho({ frase: (x as Error).message }) } finally { setEnviando(false) }
  }
  return (
    <div className="pt-entrada">
      <h1 className="pt-h1">Tu espacio de cliente</h1>
      <div className="pt-nota" style={{ fontSize: 14 }}>Escribe tu correo y te mandamos un enlace para entrar, sin contraseña.</div>
      {nota && <div className="pt-aviso mal" role="alert"><span>{nota}</span></div>}
      <form className="pt-tarjeta" onSubmit={pedir}>
        <label className="pt-campo">Tu correo<input type="email" inputMode="email" autoComplete="email" required value={correo} onChange={(x) => setCorreo(x.target.value)} /></label>
        <button type="submit" className="pt-boton" disabled={enviando || !correo}>{enviando ? 'Mandando…' : 'Mandarme el enlace'}</button>
      </form>
      {hecho && <div className="pt-aviso ok" role="status"><span>{hecho.frase}{hecho.enlace && <> (Fuera de producción: <a href={hecho.enlace}>entrar ya</a>.)</>}</span></div>}
      <div className="pt-nota" style={{ textAlign: 'center' }}>Funciona con Sumied</div>
    </div>
  )
}
