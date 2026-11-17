// src/modules/conta/documentos/PreguntaAntesDelInicio.tsx
//
// N03 · La ventana de una factura de antes del día en que la empresa empezó en Sumied. Es la
// de confirmar que ya usa Sumied (la de «Descartar con motivo»), con el texto aprobado por
// Julio, palabra por palabra: la primera frase en negrita (el título de la ventana), la
// pregunta debajo y los dos botones del mismo tamaño y el mismo peso, uno al lado del otro.
// Ningún botón es el de por defecto, y cerrar la ventana (Esc, el fondo o ✕) no contesta: la
// factura se queda como estaba, sin contabilizar.

import { useState } from 'react'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { laPregunta, type AntesDelInicio } from './antesDelInicio'

export function PreguntaAntesDelInicio({ a, fallo, alCerrar, alYaEstaba, alEsNueva }: {
  a: AntesDelInicio; fallo: string | null; alCerrar: () => void; alYaEstaba: () => Promise<void>; alEsNueva: () => Promise<void>
}) {
  const t = laPregunta(a)
  const [ocupado, setOcupado] = useState(false)
  const contestar = (f: () => Promise<void>) => { setOcupado(true); void f().finally(() => setOcupado(false)) }
  return (
    <Dialogo titulo={t.negrita} alCerrar={alCerrar} cerrable sinBotonPorDefecto>
      <p style={{ margin: 0 }} data-prueba="pregunta-antes">{t.pregunta}</p>
      {fallo && <p className="cx-error" role="alert">{fallo}</p>}
      <div className="cx-pie cxr-dos-iguales">
        <button type="button" className="cx-boton-sec" disabled={ocupado} onClick={() => contestar(alYaEstaba)}>{t.si}</button>
        <button type="button" className="cx-boton-sec" disabled={ocupado} onClick={() => contestar(alEsNueva)}>{t.no}</button>
      </div>
    </Dialogo>
  )
}
