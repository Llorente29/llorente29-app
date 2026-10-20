// src/modules/conta/impuestos/despacho/ClienteTrimestre.tsx
//
// P01 · La ruta vieja de «abrir un cliente» (impuestos/clientes/<empresa>). Al
// pulsar un cliente, «Impuestos de tus clientes» ya lleva directamente a su
// Trimestre (la pantalla de C, I01c, por la ruta de la empresa:
// impuestos/empresa/<id>/trimestre/<año>/<nT>), que mira el permiso de la
// asesoría (conta_impuesto_trimestre · conta_impuesto_puede_ver). Esta ruta se
// queda para que un enlace guardado no se rompa: lleva al trimestre que toca hoy.

import { Navigate, useParams } from 'react-router-dom'
import { rutaTrimestre } from '@/config/navegacion'
import { trimestreDe } from './despacho'

export function ClienteTrimestre() {
  const { empresa } = useParams<{ empresa: string }>()
  if (!empresa) return null
  const t = trimestreDe(new Date().toISOString().slice(0, 10))
  return <Navigate replace to={rutaTrimestre(t.ejercicio, t.periodo, empresa)} />
}
