// src/modules/conta/plan/CrearDesdeBuscador.tsx
//
// X20 (21/11) · Desde cualquier buscador de cuentas (BuscarCuentaHoja), cuando lo buscado no está: «No está:
// crear la 43000006» lleva a las mismas dos casillas (SubcuentaRapida), sin salir de donde se está. Si se buscó
// un número, ese es el código (la raíz, la siguiente libre); si se buscó un nombre, ese es el nombre. Al
// crearla, la elige.
//
// X21b (Julio, 21/11) · «No está» solo si no está en el PLAN ENTERO, no en la lista filtrada del buscador
// (regla 30). Si existe pero ese buscador no la trae, lo dice con su porqué («La 43000004 · … existe, pero aquí
// solo van cuentas de gasto (6)»; la cerrada, que está cerrada). Un código que existe no se crea otra vez; un
// nombre que ya lleva otra cuenta, sí se puede crear aparte («Crear una nueva «…»»).

import { useState } from 'react'
import { useLeer } from '@/modules/conta/libros/contexto'
import { leerCodigo, textoYaEnElPlan, yaEnElPlan } from '@/modules/conta/lib/subcuentaRapida'
import { cargarPlan } from '@/modules/conta/services/planService'
import { SubcuentaRapida, type Creada } from './SubcuentaRapida'

export function CrearDesdeBuscador({ accountId, companyId, q, quien, alCrear, noVa }: {
  accountId: string | null; companyId: string; q: string; quien: string | null; alCrear: (c: Creada) => void
  /** Por qué una cuenta que existe no sale en este buscador: «solo van cuentas de gasto (6)». Sin él, «no sale en esta lista». */
  noVa?: string
}) {
  const [abierta, setAbierta] = useState(false)
  const plan = useLeer(accountId ? () => cargarPlan(accountId, companyId) : null, `${accountId}:${companyId}:plan-crear`)
  const p = plan.datos
  if (!p) return <p className="s-hoja-buscar-nada">{plan.error ? `No se ha podido leer el plan: ${plan.error}` : 'Mirando el plan…'}</p>
  const esNumero = /^[\d.\s]+$/.test(q)
  const ya = yaEnElPlan(q, p.cuentas, p.digitos)
  const lectura = esNumero ? leerCodigo(q, { digitos: p.digitos, serie: p.serie, cuentas: p.cuentas }) : null
  if (ya && !abierta) {
    return (
      <div data-prueba="existe-no-va">
        <p className="s-hoja-buscar-nada">{textoYaEnElPlan(ya, noVa ?? null)}</p>
        {!esNumero && <button type="button" className="s-boton s-boton-enlace" onClick={() => setAbierta(true)}>Crear una nueva «{q}»</button>}
      </div>
    )
  }
  if (!abierta) {
    const texto = lectura?.tipo === 'nueva' ? `No está: crear la ${lectura.codigo}` : esNumero ? 'No está: crearla' : `No está: crear «${q}»`
    return <button type="button" className="s-boton s-boton-enlace" onClick={() => setAbierta(true)}>{texto}</button>
  }
  return (
    <SubcuentaRapida companyId={companyId} digitos={p.digitos} serie={p.serie} cuentas={p.cuentas} quien={quien} enventana foco
      inicial={lectura?.tipo === 'nueva' ? lectura.codigo : esNumero ? q : ''} inicialNombre={esNumero ? '' : q} alCrear={alCrear} />
  )
}
