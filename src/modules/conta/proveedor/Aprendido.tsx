// src/modules/conta/proveedor/Aprendido.tsx
//
// El bloque verde «Lo que he aprendido de este proveedor» (N4) y su frase del
// móvil (M4). Cada línea dice QUÉ ha aprendido Folvy, POR QUÉ («Lo confirmaste
// tú 3 veces», «Así vienen todas sus facturas») y trae «Cambiar». Es lo que
// se propone en la factura siguiente; nunca se apunta nada sin confirmación
// (C01b §4). Las reglas, en lib/aprendizaje.ts.

import { Link } from 'react-router-dom'
import { useFicha } from '@/modules/conta/proveedor/contexto'
import type { Aprendido as UnAprendido } from '@/modules/conta/lib/aprendizaje'
import type { Apartado } from '@/modules/conta/lib/resumenFicha'

/** Adónde lleva «Cambiar» de cada cosa aprendida. */
const DONDE: Record<UnAprendido['campo'], { ap: Apartado; campo: string }> = {
  expense_category: { ap: 'contabilidad', campo: 'expenseCategoryId' },
  tax_rates: { ap: 'datos-fiscales', campo: 'usualTaxRateIds' },
  withholding: { ap: 'datos-fiscales', campo: 'irpfWithholdingPct' },
  payment: { ap: 'pago', campo: 'paymentMethod' },
  iban: { ap: 'pago', campo: 'iban' },
}

const VACIO = 'Aún no he aprendido nada de este proveedor. Cuando confirmes tres facturas suyas iguales, te propondré lo mismo en la siguiente; nunca lo apunto sin preguntarte.'

export function BloqueAprendido() {
  const { aprendidos, rutaApartado } = useFicha()
  return (
    <section className="cxp-aprendido" aria-labelledby="cxp-aprendido">
      <div className="cxp-aprendido-cabeza">
        <span className="cx-ia-punto" aria-hidden="true" />
        <h2 id="cxp-aprendido">Lo que he aprendido de este proveedor</h2>
      </div>
      {aprendidos.length === 0 && <p className="cxp-aprendido-vacio" style={{ margin: 0 }}>{VACIO}</p>}
      {aprendidos.map((a) => (
        <div key={a.campo} className="cxp-aprendido-fila">
          <div className="cxp-aprendido-texto">
            <span className="cxp-aprendido-que">{a.etiqueta}</span>
            <span className="cxp-aprendido-porque">{a.porque}.</span>
          </div>
          <Link className="cx-enlace" to={rutaApartado(DONDE[a.campo].ap, DONDE[a.campo].campo)} aria-label={`Cambiar: ${a.etiqueta}`}>Cambiar</Link>
        </div>
      ))}
    </section>
  )
}

/** M4: la misma información en una tarjeta verde de una frase. */
export function FraseAprendido() {
  const { aprendidos } = useFicha()
  const [primero, ...resto] = aprendidos
  return (
    <section className="cx-ia-bloque cxm-aprendido" aria-label="Lo que he aprendido de este proveedor">
      <span className="cx-ia-punto" aria-hidden="true" />
      <div className="cx-ia-texto">
        {primero ? (
          <>
            <span className="cx-ia-titulo">{primero.etiqueta}</span>
            <span className="cx-ia-porque">{[primero.porque, ...resto.map((r) => r.etiqueta)].join(' · ')}</span>
          </>
        ) : <span className="cx-ia-porque">{VACIO}</span>}
      </div>
    </section>
  )
}
