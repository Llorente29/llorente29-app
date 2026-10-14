// src/marca/BienvenidaMarca.tsx
//
// «Activa tu cuenta» con la marca (C06, respuesta 4, retoque 2): el estilo de
// la entrada N18 —logo, título, campos y botón de la marca, el lado menta—,
// sin la cabecera negra de Folvy y con «Email» como en el resto. Solo pinta:
// el estado y lo que pasa al pulsar son de WelcomePage, igual con y sin marca.

import '@fontsource-variable/geist'
import './entrar.css'
import type { FormEvent } from 'react'
import { MARCA } from './marca'
import { LadoMarca, LogoMarca, PieLegal } from './PiezasMarca'

export interface PropsBienvenida {
  email: string | null
  clave: string; ponerClave: (v: string) => void
  repetida: string; ponerRepetida: (v: string) => void
  acepto: boolean; ponerAcepto: (v: boolean) => void
  corta: boolean; debil: boolean; distintas: boolean
  fallo: string | null
  enviando: boolean; preparando: boolean
  enviar: (e: FormEvent) => void
}

export default function BienvenidaMarca(p: PropsBienvenida) {
  return (
    <div className="mx-entrar">
      <div className="mx-izquierda">
        <LogoMarca />
        <form className="mx-formulario" onSubmit={p.enviar} noValidate aria-label="Activa tu cuenta">
          <div className="mx-titulos">
            <h1 className="mx-titulo">Activa tu cuenta</h1>
            <span className="mx-subtitulo">Crea tu contraseña para terminar el alta.</span>
          </div>
          {p.email && (
            <label className="mx-campo">Email
              <input className="mx-input" type="email" value={p.email} readOnly aria-readonly="true" />
            </label>
          )}
          <label className="mx-campo">Contraseña nueva
            <input className="mx-input" type="password" autoComplete="new-password" autoFocus value={p.clave}
              onChange={(e) => p.ponerClave(e.target.value)} disabled={p.enviando} />
            <span className="mx-nota mx-nota-campo">Mínimo 8 caracteres, con mayúsculas, minúsculas y números.</span>
            {p.corta && <span className="mx-aviso-campo">Demasiado corta.</span>}
            {p.debil && <span className="mx-aviso-campo">Añade mayúsculas, minúsculas y números.</span>}
          </label>
          <label className="mx-campo">Repite la contraseña
            <input className="mx-input" type="password" autoComplete="new-password" value={p.repetida}
              onChange={(e) => p.ponerRepetida(e.target.value)} disabled={p.enviando} />
            {p.distintas && <span className="mx-aviso-campo">Las contraseñas no coinciden.</span>}
          </label>
          <label className="mx-casilla">
            <input type="checkbox" checked={p.acepto} onChange={(e) => p.ponerAcepto(e.target.checked)} disabled={p.enviando} />
            <span>
              Acepto los <a href={MARCA.avisoLegal ?? '#'} target="_blank" rel="noopener noreferrer">Términos y Condiciones</a> y
              la <a href={MARCA.privacidad ?? '#'} target="_blank" rel="noopener noreferrer">Política de Privacidad</a> de {MARCA.nombre}.
            </span>
          </label>
          {p.fallo && <div className="mx-fallo" role="alert">{p.fallo}</div>}
          <button type="submit" className="mx-boton" disabled={p.enviando || p.preparando || !p.clave || !p.repetida || !p.acepto}>
            {p.enviando ? 'Activando cuenta…' : p.preparando ? 'Preparando tu cuenta…' : 'Activar cuenta'}
          </button>
          <span className="mx-nota">Una vez activada, entras con tu email y la contraseña nueva.</span>
        </form>
        <PieLegal className="mx-pie" />
      </div>
      <LadoMarca />
    </div>
  )
}
