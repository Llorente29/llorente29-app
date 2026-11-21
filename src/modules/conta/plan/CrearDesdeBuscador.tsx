// src/modules/conta/plan/CrearDesdeBuscador.tsx
//
// X20 (21/11) · Desde cualquier buscador de cuentas (BuscarCuentaHoja), cuando lo buscado no está: «No está:
// crear la 43000006» lleva a las mismas dos casillas (SubcuentaRapida), sin salir de donde se está. Si se buscó
// un número, ese es el código (la raíz, la siguiente libre); si se buscó un nombre, ese es el nombre. Al
// crearla, la elige.

import { useState } from 'react'
import { useLeer } from '@/modules/conta/libros/contexto'
import { leerCodigo } from '@/modules/conta/lib/subcuentaRapida'
import { cargarPlan } from '@/modules/conta/services/planService'
import { SubcuentaRapida, type Creada } from './SubcuentaRapida'

export function CrearDesdeBuscador({ accountId, companyId, q, quien, alCrear }: {
  accountId: string | null; companyId: string; q: string; quien: string | null; alCrear: (c: Creada) => void
}) {
  const [abierta, setAbierta] = useState(false)
  const plan = useLeer(accountId ? () => cargarPlan(accountId, companyId) : null, `${accountId}:${companyId}:plan-crear`)
  const p = plan.datos
  if (!p) return <p className="s-hoja-buscar-nada">{plan.error ? `No se ha podido leer el plan: ${plan.error}` : 'Mirando el plan…'}</p>
  const esNumero = /^[\d.\s]+$/.test(q)
  const lectura = esNumero ? leerCodigo(q, { digitos: p.digitos, serie: p.serie, cuentas: p.cuentas }) : null
  if (!abierta) {
    const texto = lectura?.tipo === 'nueva' ? `No está: crear la ${lectura.codigo}` : esNumero ? 'No está: crearla' : `No está: crear «${q}»`
    return <button type="button" className="s-boton s-boton-enlace" onClick={() => setAbierta(true)}>{texto}</button>
  }
  return (
    <SubcuentaRapida companyId={companyId} digitos={p.digitos} serie={p.serie} cuentas={p.cuentas} quien={quien} enventana foco
      inicial={lectura?.tipo === 'nueva' ? lectura.codigo : esNumero ? q : ''} inicialNombre={esNumero ? '' : q} alCrear={alCrear} />
  )
}
