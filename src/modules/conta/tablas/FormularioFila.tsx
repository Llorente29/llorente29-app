// src/modules/conta/tablas/FormularioFila.tsx
//
// El formulario de una fila propia (añadir o editar), sacado del registro. Se
// abre en la misma tabla, nunca en una ventana encima (encargo C00 §7).
// Cada campo con su etiqueta; el fallo, debajo del campo y anunciado.

import { useId, useState, type FormEvent } from 'react'
import type { CampoFormulario, DefinicionTabla, Valores } from '@/modules/conta/tablas/registro'

export interface OpcionBanco { id: string; nombre: string }

export function FormularioFila({ def, inicial, editando, bancos, titulo, guardando, onGuardar, onCancelar }: {
  def: DefinicionTabla
  inicial: Valores
  editando: boolean
  bancos: OpcionBanco[]
  titulo: string
  guardando: boolean
  onGuardar: (v: Valores) => void
  onCancelar: () => void
}) {
  const [valores, setValores] = useState<Valores>(inicial)
  const [fallos, setFallos] = useState<Record<string, string>>({})
  const base = useId()

  const enviar = (e: FormEvent) => {
    e.preventDefault()
    const f = def.validar(valores)
    setFallos(f)
    if (Object.keys(f).length === 0) onGuardar(valores)
  }

  const campo = (c: CampoFormulario) => {
    const id = `${base}-${c.clave}`
    const fallo = fallos[c.clave]
    const bloqueado = editando && c.fijoAlEditar === true
    const comun = {
      id, name: c.clave, className: 'cx-input', value: valores[c.clave] ?? '', disabled: bloqueado || guardando,
      'aria-invalid': fallo ? true : undefined,
      'aria-describedby': [c.ayuda || bloqueado ? `${id}-ayuda` : '', fallo ? `${id}-fallo` : ''].filter(Boolean).join(' ') || undefined,
      onChange: (e: { target: { value: string } }) => setValores((v) => ({ ...v, [c.clave]: e.target.value })),
    }
    const opciones = c.tipo === 'siNo' ? [{ valor: 'si', texto: 'Sí' }, { valor: 'no', texto: 'No' }]
      : c.tipo === 'opcionesBancos' ? [{ valor: '', texto: 'Ninguno' }, ...bancos.map((b) => ({ valor: b.id, texto: b.nombre }))]
      : c.opciones
    return (
      <div className="cx-campo" key={c.clave}>
        <label htmlFor={id}>{c.etiqueta}{c.obligatorio ? '' : ' (si quieres)'}</label>
        {opciones ? (
          <select {...comun}>{opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}</select>
        ) : (
          <input {...comun}
            type={c.tipo === 'fecha' ? 'date' : 'text'}
            inputMode={c.tipo === 'porcentaje' ? 'decimal' : c.tipo === 'entero' || c.tipo === 'listaDias' || c.tipo === 'listaDiasMes' ? 'numeric' : undefined}
            autoComplete="off" />
        )}
        {(c.ayuda || bloqueado) && (
          <span id={`${id}-ayuda`} className="cx-ayuda">
            {bloqueado ? 'No se cambia: para otro porcentaje, usa «Nuevo porcentaje».' : c.ayuda}
          </span>
        )}
        {fallo && <span id={`${id}-fallo`} className="cx-error" role="alert">{fallo}</span>}
      </div>
    )
  }

  return (
    <form className="cx-formulario cx-tablas-formulario" onSubmit={enviar} aria-label={titulo} noValidate>
      <h3 className="cx-tarjeta-titulo">{titulo}</h3>
      <div className="cx-formulario-fila">{def.formulario.map(campo)}</div>
      <div className="cx-pie">
        <button type="button" className="cx-boton-sec" onClick={onCancelar} disabled={guardando}>Cancelar</button>
        <button type="submit" className="cx-boton" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  )
}
