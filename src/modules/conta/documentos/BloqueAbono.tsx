// src/modules/conta/documentos/BloqueAbono.tsx
//
// S01h · Lo propio de un abono en su ficha (maqueta aprobada por Julio, 31/10):
// qué anula y qué lo sustituye, y en dos piezas el IVA (resta en el 303) y el
// pago (compensa lo que anula o queda a tu favor). Las cifras van en el bloque
// de importes de siempre, sin signo.
import { Link } from 'react-router-dom'
import { rutaRevisarFactura } from '@/config/navegacion'
import { textoAnula, textoIva, textoPago, type LoQueAnula } from '@/modules/conta/documentos/abono'

/** Lo que anula lo lee la página (leerLoQueAnula) y lo comparte con «Pago», para que los dos digan lo mismo. */
export function BloqueAbono({ a, total, base, cuota, fechaAsiento }: {
  a: { datos: LoQueAnula | null; error: string | null }; total: number; base: number; cuota: number; fechaAsiento: string | null
}) {
  if (a.error) return <p className="cxf-error" role="status">{a.error}</p>
  if (!a.datos) return null
  const anula = textoAnula(a.datos, total)
  const iva = textoIva(fechaAsiento, base, cuota)
  const pago = textoPago(a.datos, total)
  return (
    <>
      {anula && (
        <section className="s-bloque-ficha cxab-anula" data-ligado={a.datos.anulada ? 'si' : 'no'} aria-label="Lo que anula" data-prueba="abono-anula">
          <span className="cxab-etiqueta">{a.datos.anulada ? 'ANULA' : 'RECTIFICA'}</span>
          <strong>{anula.titulo}</strong>
          <p className="s-apoyo">{anula.detalle}</p>
          {a.datos.anulada && <Link to={rutaRevisarFactura(a.datos.anulada.id)}>Ver la factura</Link>}
        </section>
      )}
      <div className="cxab-dos">
        <section className="s-bloque-ficha" aria-label="IVA" data-prueba="abono-iva">
          <strong>{iva.titulo}</strong>
          <p className="s-apoyo">{iva.detalle}</p>
        </section>
        <section className="s-bloque-ficha" aria-label="Pago" data-prueba="abono-pago">
          <strong>{pago.titulo}</strong>
          <p className="s-apoyo">{pago.detalle}</p>
        </section>
      </div>
    </>
  )
}
