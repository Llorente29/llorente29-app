// src/modules/conta/impuestos/despacho/ClienteTrimestre.tsx
//
// P01 · Al pulsar un cliente en «Impuestos de tus clientes» se abre su
// trimestre. Lo definitivo es la pantalla del 303 de C (maqueta_303_v2), en
// cuanto acepte la empresa por la ruta (lo pide Julio a C); mientras, el
// calendario de esa empresa, que ya mira el permiso de la asesoría
// (conta_impuesto_calendario · conta_impuesto_puede_ver).

import { Link, useParams } from 'react-router-dom'
import { rutaImpuestos } from '@/config/navegacion'
import { Calendario } from '../Calendario'

export function ClienteTrimestre() {
  const { empresa } = useParams<{ empresa: string }>()
  if (!empresa) return null
  return (
    <div className="s-pantalla s-despacho-cliente-pagina">
      <p className="s-despacho-volver"><Link to={rutaImpuestos('clientes')}>‹ Impuestos de tus clientes</Link></p>
      <Calendario companyId={empresa} />
    </div>
  )
}
