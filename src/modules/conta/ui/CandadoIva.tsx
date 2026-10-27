// src/modules/conta/ui/CandadoIva.tsx
//
// V04 · Respuesta 5 · El candado del IVA presentado: el icono junto al mes o al
// trimestre, y la franja que lo explica en la ficha. El texto va siempre al
// lado del icono (es decorativo) y es el mismo que el de la base.

import { Icono } from '@/modules/conta/diseno/Icono'
import { diaPresentado, type PeriodoPresentado } from '@/modules/conta/lib/ivaPresentado'

/** El candado pequeño: «🔒 IVA presentado 20/10». */
export function CandadoIva({ p, corto = false }: { p: PeriodoPresentado; corto?: boolean }) {
  const texto = `IVA presentado ${diaPresentado(p)}`
  return (
    <span className="cx-candado-iva" data-prueba="candado-iva" title={`El IVA ${/^[1-4]T/.test(p.periodo) ? 'del' : 'de'} ${p.nombre} ya está presentado (${diaPresentado(p)}). No se puede cambiar.`}>
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
