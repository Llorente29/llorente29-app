// src/modules/conta/diseno/plantillas/HojaDeLineas.tsx
//
// S02 · La plantilla HOJA DE LÍNEAS (tablero 5): un asiento a mano.
//   · Cabecera con la fecha, un concepto que se copia a todas las líneas y un
//     documento opcional.
//   · Líneas con cuenta (nombre arriba y número debajo), concepto, local, debe
//     y haber. Intro pasa al siguiente campo y, en la última columna, a una
//     línea nueva; F4 busca la cuenta (BuscarCuentaHoja).
//   · Pie con los totales y «Cuadra». Debajo, el asiento dicho en palabras y,
//     si hay un movimiento del banco que encaja, el aviso de que se unirán.
//   · Ctrl Intro guarda (regla 5 del patrón: la tecla, dibujada en el botón).
//
// S02 · PR 2 (el asiento a mano, la primera pantalla que la usa de verdad):
//   · una columna puede ir sin título visible (`oculta`: la de «Quitar»), pero
//     el lector de pantalla lo oye;
//   · `textoCuadre` dice cuánto falta y dónde («No cuadra: faltan 21,00 € en el
//     Haber»), no solo «No cuadra todavía»: es lo que hace falta para arreglarlo;
//   · BuscarCuentaHoja, la lista de F4, que la página pinta debajo del campo.
//   · En el móvil (plantillas.css), cada línea es una tarjeta con la etiqueta
//     de cada campo encima (data-titulo en la celda).

import { useId, useState, type ReactNode } from 'react'
import { Icono } from '../Icono'
import { buscarCuentasHoja, type CuentaHoja } from './valores'

export function HojaDeLineas({ cabecera, columnas, children, totales, cuadra, textoCuadre, alAnadir, enPalabras, aviso }: {
  /** La fecha, el concepto común y el documento. */
  cabecera: ReactNode
  /** `oculta`: sin título visible (la de «Quitar»); el lector lo dice igual. */
  columnas: readonly { titulo: string; cifra?: boolean; oculta?: boolean }[]
  /** Las filas (<tr>), cada campo con data-campo-hoja. */
  children: ReactNode
  totales: { debe: string; haber: string }
  cuadra: boolean
  /** Lo que dice el pie cuando no cuadra (cuánto falta y dónde). Sin él, «No cuadra todavía». */
  textoCuadre?: string
  alAnadir: () => void
  /** El asiento dicho en palabras. */
  enPalabras?: ReactNode
  /** «El banco ya tiene un cargo de … sin casar: al guardar, Sumied los une». */
  aviso?: ReactNode
}) {
  return (
    <div className="s-hoja">
      <div className="s-hoja-cabecera">{cabecera}</div>
      <div className="s-hoja-lineas">
        <table className="s-hoja-tabla" aria-label="Las líneas del asiento">
          <thead>
            <tr>
              <th scope="col">#</th>
              {columnas.map((c) => (
                <th key={c.titulo} scope="col" className={c.cifra ? 's-lista-cifra' : undefined}>
                  {c.oculta ? <span className="s-oculto">{c.titulo}</span> : c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
        <div className="s-hoja-anadir">
          <button type="button" className="s-boton s-boton-enlace" onClick={alAnadir}><Icono nombre="nuevo" /> Añadir línea</button>
          <span className="s-hoja-ayuda">Intro pasa al siguiente campo; en la última columna, a una línea nueva. F4 busca la cuenta.</span>
        </div>
        <div className="s-hoja-pie" role="status" aria-live="polite">
          {cuadra ? <span className="s-asiento-cuadra"><Icono nombre="ok" /> Cuadra</span> : <span className="s-asiento-descuadra">{textoCuadre ?? 'No cuadra todavía'}</span>}
          <span className="s-hoja-totales"><span>Totales</span><span className="s-cifra">{totales.debe}</span><span className="s-cifra">{totales.haber}</span></span>
        </div>
      </div>
      {(enPalabras || aviso) && (
        <section className="s-hoja-palabras" aria-label="Dicho en palabras">
          <h2><Icono nombre="ia" /> Dicho en palabras</h2>
          {enPalabras && <p>{enPalabras}</p>}
          {aviso && <p className="s-hoja-aviso">{aviso}</p>}
        </section>
      )}
    </div>
  )
}

/**
 * F4 · La lista para buscar la cuenta, debajo del campo: se filtra al escribir;
 * ↑ ↓ e Intro eligen, Esc vuelve al campo. Las teclas no salen de aquí (Intro
 * no pasa de campo en la hoja mientras se busca).
 */
export function BuscarCuentaHoja({ cuentas, inicial, alElegir, alCerrar }: {
  cuentas: readonly CuentaHoja[]
  inicial: string
  alElegir: (c: CuentaHoja) => void
  /** `volver`: con Esc, el foco vuelve al campo; si se sale pulsando en otro sitio, no se le quita. */
  alCerrar: (volver: boolean) => void
}) {
  const [q, setQ] = useState(inicial)
  const [i, setI] = useState(0)
  const r = buscarCuentasHoja(cuentas, q)
  const id = useId()
  return (
    <div className="s-hoja-buscar" role="dialog" aria-label="Buscar la cuenta">
      <input className="s-control" autoFocus value={q} aria-label="Número o nombre de la cuenta" role="combobox" aria-expanded="true" aria-controls={id}
        aria-activedescendant={r[i] ? `${id}-${i}` : undefined}
        onChange={(e) => { setQ(e.target.value); setI(0) }}
        onBlur={() => alCerrar(false)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(r.length - 1, x + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)) }
          else if (e.key === 'Enter') { e.preventDefault(); if (r[i]) alElegir(r[i]) }
          else if (e.key === 'Escape') { e.preventDefault(); alCerrar(true) }
        }} />
      <ul id={id} role="listbox" className="s-hoja-buscar-lista">
        {r.length === 0 && <li className="s-hoja-buscar-nada">Ninguna cuenta se llama así.</li>}
        {r.map((c, k) => (
          <li key={c.codigo} id={`${id}-${k}`} role="option" aria-selected={k === i} onMouseDown={(e) => { e.preventDefault(); alElegir(c) }}>
            <span className="s-cifra">{c.codigo}</span> <span>{c.nombre}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
