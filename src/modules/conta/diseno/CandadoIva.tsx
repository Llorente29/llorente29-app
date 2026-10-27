// src/modules/conta/diseno/CandadoIva.tsx
//
// V04 · Respuesta 5 · El candado del IVA presentado: el icono junto al mes o al
// trimestre, y las franjas que lo explican en la ficha. El texto va siempre al
// lado del icono (es decorativo) y lo da quien lo pinta, con los textos de la
// base (lib/ivaPresentado.ts: textosCandado y mensajePresentado).

import { Icono } from './Icono'

/** El candado pequeño: «🔒 IVA presentado 20/10». Con `corto`, el texto solo para el lector de pantalla. */
export function CandadoIva({ texto, titulo, corto = false }: { texto: string; titulo: string; corto?: boolean }) {
  return (
    <span className="cx-candado-iva" data-prueba="candado-iva" title={titulo}>
      <Icono nombre="cierre" />{corto ? <span className="cx-solo-lector">{texto}</span> : texto}
    </span>
  )
}

/** La franja de la ficha: el mensaje de la base, con el candado delante. */
export function FranjaIvaPresentado({ texto }: { texto: string }) {
  return (
    <div className="cx-tarjeta cxd-franja cx-franja-iva" role="status" data-prueba="iva-presentado">
      <span><Icono nombre="cierre" /> {texto}</span>
    </div>
  )
}

/** La franja de la recibida que llegó tarde: «El 3T ya está presentado. Esta factura se deduce en el 4T.» */
export function FranjaTardia({ texto }: { texto: string }) {
  return (
    <div className="cx-tarjeta cxd-franja cx-franja-tardia" role="note" data-prueba="factura-tardia">
      <span><Icono nombre="info" /> {texto}</span>
    </div>
  )
}
