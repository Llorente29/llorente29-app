// src/modules/conta/diseno/Campo.tsx
//
// S01 · Los campos del sistema de diseño (maqueta 3, «Lo que he leído»):
// etiqueta encima, el control, y debajo la ayuda, el aviso o el fallo en
// lenguaje normal. Uno solo para todos los tipos:
//   · Texto     — <input> de texto.
//   · Importe   — cifras a la derecha; al salir se escribe «1.234,56».
//   · Fecha     — dd/mm/aaaa con su calendario (la pieza del M01).
//   · Selector  — <select> con sus opciones.
//   · Subcuenta — «43.12» se rellena a «43000012» al salir.
//
// `Campo` pone la etiqueta y el texto de debajo y le da al control su id y su
// aria-describedby; los controles se pueden usar también sueltos (en una tabla).

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { CampoFecha } from '@/modules/conta/ui/fecha/CampoFecha'
import { expandirSubcuenta, importeDeTexto, opcionesConGuardado, textoDeImporte, type OpcionSelector } from './valores'

interface PropsControl { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }

export function Campo({ etiqueta, ayuda, aviso, error, id: idDado, children }: {
  etiqueta: string
  ayuda?: ReactNode
  aviso?: string | null
  error?: string | null
  /** Para que un enlace («Falta: el NIF») lleve hasta el campo. */
  id?: string
  children: (p: PropsControl) => ReactNode
}) {
  const auto = useId()
  const id = idDado ?? `campo-${auto}`
  const descId = `${id}-nota`
  const nota = error || aviso || ayuda
  return (
    <div className="s-campo" data-estado={error ? 'falta' : aviso ? 'duda' : undefined}>
      <label className="s-campo-etiqueta" htmlFor={id}>{etiqueta}</label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': nota ? descId : undefined })}
      {nota && (
        <div id={descId} className="s-campo-nota" role={error ? 'alert' : undefined}>{error || aviso || ayuda}</div>
      )}
    </div>
  )
}

type Entrada = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'className'>

export function Texto({ valor, alCambiar, ...resto }: Entrada & { valor: string; alCambiar: (v: string) => void }) {
  return <input {...resto} type={resto.type ?? 'text'} className="s-control" value={valor} onChange={(e) => alCambiar(e.target.value)} />
}

export function Importe({ valor, alCambiar, ...resto }: Omit<Entrada, 'type' | 'inputMode'> & { valor: string; alCambiar: (v: string) => void }) {
  return (
    <input {...resto} type="text" inputMode="decimal" autoComplete="off" className="s-control s-control-cifra s-cifra" value={valor}
      onChange={(e) => alCambiar(e.target.value)}
      onBlur={(e) => { const n = importeDeTexto(e.target.value); if (n !== null) alCambiar(textoDeImporte(n)); resto.onBlur?.(e) }} />
  )
}

export function Subcuenta({ valor, alCambiar, digitos = 8, ...resto }: Omit<Entrada, 'type' | 'inputMode'> & {
  valor: string; alCambiar: (v: string) => void; digitos?: number
}) {
  return (
    <input {...resto} type="text" inputMode="numeric" autoComplete="off" className="s-control s-cifra" value={valor}
      onChange={(e) => alCambiar(e.target.value)}
      onBlur={(e) => { const x = expandirSubcuenta(e.target.value, digitos); if (x !== e.target.value) alCambiar(x); resto.onBlur?.(e) }} />
  )
}

export function Fecha({ valor, alCambiar, ...resto }: Omit<Entrada, 'type' | 'placeholder' | 'inputMode'> & { valor: string; alCambiar: (iso: string) => void }) {
  return <CampoFecha {...resto} className="s-control" valor={valor} alCambiar={alCambiar} />
}

export function Selector({ valor, alCambiar, opciones, textoGuardado, ...resto }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'className'> & {
  valor: string; alCambiar: (v: string) => void; opciones: readonly OpcionSelector[]
  /** El nombre de lo guardado, leído de su sitio, por si ya no está en `opciones`. */
  textoGuardado?: string
}) {
  return (
    <select {...resto} className="s-control s-control-selector" value={valor} onChange={(e) => alCambiar(e.target.value)}>
      {opcionesConGuardado(valor, opciones, textoGuardado).map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
    </select>
  )
}
