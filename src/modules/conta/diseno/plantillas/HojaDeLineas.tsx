// src/modules/conta/diseno/plantillas/HojaDeLineas.tsx
//
// S02 · La plantilla HOJA DE LÍNEAS (tablero 5): un asiento a mano.
//   · Cabecera con la fecha, un concepto que se copia a todas las líneas y un
//     documento opcional.
//   · Líneas con cuenta (nombre arriba y número debajo), concepto, local, debe
//     y haber. Intro pasa al siguiente campo y, en la última columna, a una
//     línea nueva; F4 busca la cuenta.
//   · Pie con los totales y «Cuadra». Debajo, el asiento dicho en palabras y,
//     si hay un movimiento del banco que encaja, el aviso de que se unirán.
//   · Ctrl Intro guarda (regla 5 del patrón: la tecla, dibujada en el botón).

import type { ReactNode } from 'react'
import { Icono } from '../Icono'

export function HojaDeLineas({ cabecera, columnas, children, totales, cuadra, alAnadir, enPalabras, aviso }: {
  /** La fecha, el concepto común y el documento. */
  cabecera: ReactNode
  columnas: readonly { titulo: string; cifra?: boolean }[]
  /** Las filas (<tr>), cada campo con data-campo-hoja. */
  children: ReactNode
  totales: { debe: string; haber: string }
  cuadra: boolean
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
          <thead><tr><th scope="col">#</th>{columnas.map((c) => <th key={c.titulo} scope="col" className={c.cifra ? 's-lista-cifra' : undefined}>{c.titulo}</th>)}</tr></thead>
          <tbody>{children}</tbody>
        </table>
        <div className="s-hoja-anadir">
          <button type="button" className="s-boton s-boton-enlace" onClick={alAnadir}><Icono nombre="nuevo" /> Añadir línea</button>
          <span className="s-hoja-ayuda">Intro pasa al siguiente campo; en la última columna, a una línea nueva. F4 busca la cuenta.</span>
        </div>
        <div className="s-hoja-pie">
          {cuadra ? <span className="s-asiento-cuadra"><Icono nombre="ok" /> Cuadra</span> : <span className="s-asiento-descuadra">No cuadra todavía</span>}
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
