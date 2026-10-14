// src/marca/EntrarMarca.tsx
//
// La entrada con marca (maqueta N18 «Entrar», C06): a la izquierda el logo y
// el nombre de la marca, «Entra en tu contabilidad», correo, contraseña y
// «Entrar» en azul; a la derecha, en menta, las cuatro frases de la marca; y
// el pie con su dirección y los enlaces legales. Todo sale de la marca
// (supabase/functions/_shared/marcas.ts): aquí no hay un nombre escrito.
//
// La lógica de entrar es la de LoginPage (signIn + check-account-status):
// mismos mensajes, mismo cierre de sesión si la cuenta no está activa. Lo que
// cambia es a dónde va: al Inicio de contabilidad, que es todo lo que hay.
//
// «He olvidado la contraseña» se queda en esta misma pantalla y manda el correo
// CON LA MARCA (edge function conta-contrasena), no el de Supabase. Confirma
// en pantalla lo que ha hecho, sin decir si el correo existe (regla 8).

import '@fontsource-variable/geist'
import './entrar.css'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../modules/multitenancy/hooks/useAuth'
import { checkAccountStatus } from '../services/accountStatusService'
import { supabase } from '../lib/supabase'
import { MARCA } from './marca'
import { LadoMarca, LogoMarca, PieLegal } from './PiezasMarca'

type Modo = 'entrar' | 'olvido'

export default function EntrarMarca({ modoInicial = 'entrar' }: { modoInicial?: Modo }) {
  const [modo, setModo] = useState<Modo>(modoInicial)
  return (
    <div className="mx-entrar">
      <div className="mx-izquierda">
        <LogoMarca />
        {modo === 'entrar' ? <Entrar alOlvidar={() => setModo('olvido')} /> : <Olvido alVolver={() => setModo('entrar')} />}
        <PieLegal className="mx-pie" />
      </div>
      <LadoMarca />
    </div>
  )
}

function Entrar({ alOlvidar }: { alOlvidar: () => void }) {
  const navigate = useNavigate()
  const { signIn, signOut } = useAuth()
  const [correo, setCorreo] = useState('')
  const [clave, setClave] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setFallo(null)
    const email = correo.trim().toLowerCase()
    if (!email.includes('@')) { setFallo('Escribe tu correo.'); return }
    if (!clave) { setFallo('Escribe tu contraseña.'); return }
    setEnviando(true)
    const r = await signIn(email, clave)
    if (!r.ok) { setFallo(errorDeEntrada(r.error)); setEnviando(false); return }
    try {
      const estado = await checkAccountStatus()
      if (estado.status === 'ok') { navigate('/conta/inicio', { replace: true }); return }
      await signOut()
      setFallo(estado.message ?? 'Tu acceso no está disponible. Habla con quien te invitó.')
    } catch {
      await signOut()
      setFallo('No se ha podido comprobar tu cuenta. Vuelve a intentarlo en unos segundos.')
    }
    setClave('')
    setEnviando(false)
  }

  return (
    <form className="mx-formulario" onSubmit={entrar} noValidate>
      <div className="mx-titulos">
        <h1 className="mx-titulo">{MARCA.entrar.titulo}</h1>
        <span className="mx-subtitulo">{MARCA.entrar.subtitulo}</span>
      </div>
      <label className="mx-campo">Correo
        <input className="mx-input" type="email" autoComplete="email" value={correo} onChange={(e) => setCorreo(e.target.value)} disabled={enviando} />
      </label>
      <label className="mx-campo">Contraseña
        <input className="mx-input" type="password" autoComplete="current-password" value={clave} onChange={(e) => setClave(e.target.value)} disabled={enviando} />
      </label>
      {fallo && <div className="mx-fallo" role="alert">{fallo}</div>}
      <button type="submit" className="mx-boton" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      <span className="mx-nota">
        ¿Primera vez? Abre el enlace de la invitación que te llegó por correo.{' '}
        <button type="button" className="mx-enlace" onClick={alOlvidar}>He olvidado la contraseña</button>
      </span>
    </form>
  )
}

function Olvido({ alVolver }: { alVolver: () => void }) {
  const [correo, setCorreo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)

  async function pedir(e: FormEvent) {
    e.preventDefault()
    setFallo(null)
    const email = correo.trim().toLowerCase()
    if (!email.includes('@')) { setFallo('Escribe tu correo.'); return }
    if (!supabase) { setFallo('No hay conexión con el servidor.'); return }
    setEnviando(true)
    const { data, error } = await supabase.functions.invoke('conta-contrasena', { body: { correo: email, marca: MARCA.id } })
    setEnviando(false)
    if (error) { setFallo('No se ha podido pedir. Comprueba la conexión y vuelve a intentarlo.'); return }
    setHecho(`${(data as { mensaje?: string } | null)?.mensaje ?? 'Si ese correo tiene acceso, le llegará un enlace en unos minutos.'} Mira también en el correo no deseado.`)
  }

  return (
    <form className="mx-formulario" onSubmit={pedir} noValidate>
      <div className="mx-titulos">
        <h1 className="mx-titulo">Pon una contraseña nueva</h1>
        <span className="mx-subtitulo">Te mando un enlace a tu correo para que elijas otra.</span>
      </div>
      <label className="mx-campo">Correo
        <input className="mx-input" type="email" autoComplete="email" value={correo} onChange={(e) => setCorreo(e.target.value)} disabled={enviando || !!hecho} />
      </label>
      {fallo && <div className="mx-fallo" role="alert">{fallo}</div>}
      {hecho && <div className="mx-hecho" role="status">{hecho}</div>}
      {!hecho && <button type="submit" className="mx-boton" disabled={enviando}>{enviando ? 'Pidiendo…' : 'Mandarme el enlace'}</button>}
      <span className="mx-nota"><button type="button" className="mx-enlace" onClick={alVolver}>Volver a entrar</button></span>
    </form>
  )
}

function errorDeEntrada(e: string): string {
  const m = e.toLowerCase()
  if (m.includes('invalid login credentials') || m.includes('user not found')) return 'Correo o contraseña incorrectos.'
  if (m.includes('too many requests') || m.includes('rate limit')) return 'Demasiados intentos. Espera unos minutos.'
  if (m.includes('network') || m.includes('fetch')) return 'Sin conexión. Comprueba tu internet y vuelve a probar.'
  return 'No se ha podido entrar. Vuelve a intentarlo.'
}
