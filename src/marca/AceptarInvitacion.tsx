// src/marca/AceptarInvitacion.tsx
//
// DM1 · Accesos 1 (03/11/2026). Tablero 8 de «Accesos e invitaciones»
// (aprobado por Julio): /welcome?invitacion=<token>, el enlace del correo de
// «Invitar a una persona». Con el marco de la entrada con marca.
//   · Sin usuario: las empresas con su permiso, quién invita, el correo con el
//     que entrará, su contraseña (dos veces) y los términos → crea el usuario y
//     entra (invitacion-aceptar).
//   · Con usuario: que entre con el suyo y acepte en su lista de empresas
//     (tablero 7). Aquí no se acepta nada: así un enlace reenviado a otra
//     persona no le da nada a nadie.
//   · Caducada, anulada o ya aceptada: lo dice y qué hacer.

import { useEffect, useState, type FormEvent } from 'react'
import { validatePassword } from '../lib/passwordPolicy'
import { crearUsuarioYEntrar, verInvitacion, type InvitacionDelEnlace } from '../modules/multitenancy/services/invitacionesService'
import { MARCA } from './marca'
import { LadoMarca, LogoMarca, PieLegal } from './PiezasMarca'
import './tema.css'
import './entrar.css'

export default function AceptarInvitacion({ token }: { token: string }) {
  const [inv, setInv] = useState<InvitacionDelEnlace | null>(null)
  const [noVale, setNoVale] = useState('')
  const [clave, setClave] = useState('')
  const [repetida, setRepetida] = useState('')
  const [acepto, setAcepto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [fallo, setFallo] = useState('')

  useEffect(() => {
    let vivo = true
    const t = window.setTimeout(async () => {
      try { const r = await verInvitacion(token); if (vivo) setInv(r) }
      catch (e) { if (vivo) setNoVale(e instanceof Error ? e.message : String(e)) }
    }, 0)
    return () => { vivo = false; window.clearTimeout(t) }
  }, [token])

  const valida = validatePassword(clave)
  const distintas = repetida.length > 0 && repetida !== clave

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!inv) return
    setFallo('')
    if (!valida.ok) { setFallo('La contraseña necesita 8 caracteres como mínimo, con mayúsculas, minúsculas y números.'); return }
    if (distintas) { setFallo('Las contraseñas no coinciden.'); return }
    setEnviando(true)
    try {
      await crearUsuarioYEntrar(token, inv.correo, clave, acepto)
      window.location.assign('/')
    } catch (err) {
      setFallo(err instanceof Error ? err.message : String(err))
      setEnviando(false)
    }
  }

  const titulo = inv && inv.empresas.length > 1 ? `Te invitan a ${inv.empresas.length === 2 ? 'dos' : inv.empresas.length} empresas` : `Te invitan a ${inv?.empresas[0]?.nombre ?? 'una empresa'}`

  return (
    <div className="mx-entrar" data-prueba="aceptar-invitacion">
      <div className="mx-izquierda">
        <LogoMarca />
        {!inv && !noVale && <p className="mx-nota" role="status">Leyendo la invitación…</p>}
        {noVale && (
          <div className="mx-formulario">
            <h1 className="mx-titulo">Esta invitación ya no vale</h1>
            <div className="mx-fallo" role="alert" data-prueba="invitacion-no-vale">{noVale}</div>
            <a className="mx-boton" href="/login">Ir a entrar</a>
          </div>
        )}
        {inv && inv.tieneUsuario && (
          <div className="mx-formulario">
            <h1 className="mx-titulo">{titulo}</h1>
            <ListaEmpresas inv={inv} />
            <span className="mx-subtitulo">Ya tienes usuario con {inv.correo}. Entra con él y acepta la invitación arriba, en tu lista de empresas.</span>
            <a className="mx-boton" href="/login" data-prueba="invitacion-entrar">Entrar</a>
          </div>
        )}
        {inv && !inv.tieneUsuario && (
          <form className="mx-formulario" onSubmit={(e) => { void enviar(e) }} noValidate aria-label="Crear tu usuario">
            <div className="mx-titulos">
              <h1 className="mx-titulo">{titulo}</h1>
            </div>
            <ListaEmpresas inv={inv} />
            <span className="mx-subtitulo">{inv.invita ? `Te invitó ${inv.invita}. ` : ''}Entrarás con {inv.correo}.</span>
            <label className="mx-campo">Pon tu contraseña
              <input className="mx-input" type="password" autoComplete="new-password" autoFocus value={clave}
                onChange={(e) => setClave(e.target.value)} disabled={enviando} data-prueba="invitacion-clave" />
              <span className="mx-nota mx-nota-campo">Mínimo 8 caracteres, con mayúsculas, minúsculas y números.</span>
            </label>
            <label className="mx-campo">Repítela
              <input className="mx-input" type="password" autoComplete="new-password" value={repetida}
                onChange={(e) => setRepetida(e.target.value)} disabled={enviando} data-prueba="invitacion-repetida" />
              {distintas && <span className="mx-aviso-campo">Las contraseñas no coinciden.</span>}
            </label>
            <label className="mx-casilla">
              <input type="checkbox" checked={acepto} onChange={(e) => setAcepto(e.target.checked)} disabled={enviando} data-prueba="invitacion-acepto" />
              <span>
                Acepto los <a href={MARCA.avisoLegal ?? '#'} target="_blank" rel="noopener noreferrer">Términos y Condiciones</a> y
                la <a href={MARCA.privacidad ?? '#'} target="_blank" rel="noopener noreferrer">Política de Privacidad</a> de {MARCA.nombre}.
              </span>
            </label>
            {fallo && <div className="mx-fallo" role="alert">{fallo}</div>}
            <button type="submit" className="mx-boton" disabled={enviando || !clave || !repetida || !acepto} data-prueba="invitacion-crear">
              {enviando ? 'Creando tu usuario…' : 'Crear mi usuario y entrar'}
            </button>
          </form>
        )}
        <PieLegal className="mx-pie" />
      </div>
      <LadoMarca />
    </div>
  )
}

function ListaEmpresas({ inv }: { inv: InvitacionDelEnlace }) {
  return (
    <ul className="mx-invitacion-empresas" data-prueba="invitacion-empresas">
      {inv.empresas.map((e) => (
        <li key={e.nombre}><strong>{e.nombre}</strong><span className="mx-invitacion-permiso">{e.permiso}</span></li>
      ))}
    </ul>
  )
}
