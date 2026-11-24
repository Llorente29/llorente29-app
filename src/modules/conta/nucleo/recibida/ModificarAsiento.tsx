// src/modules/conta/nucleo/recibida/ModificarAsiento.tsx
//
// X26 · El asiento de una recibida contabilizada mientras se modifica: las mismas líneas, con los mismos importes; en
// las de gasto, la cuenta se puede cambiar con el buscador de siempre (el plan entero, menos las del proveedor y las
// del IVA). La del proveedor y la del IVA, como estaban. Lo demás de la ficha no cambia aquí (el importe y el IVA,
// en el X26b).

import { useState } from 'react'
import { Buscador } from '../ficha/Buscador'
import { cuentasQueEncajan, type CuentaDelPlan } from '../ficha/teclas'
import { cifra } from '../ficha/textos'
import { esLineaDeGasto } from './contabilizada'

export interface ApunteModificable { posicion: number; cuenta: string; nombre: string; debe: number; haber: number }

export function ModificarAsiento({ apuntes, plan, nombre, elegidas, elegir }: {
  apuntes: readonly ApunteModificable[]
  plan: readonly CuentaDelPlan[]
  nombre: (codigo: string) => string
  elegidas: Readonly<Record<number, string>>
  elegir: (posicion: number, codigo: string) => void
}) {
  const [texto, setTexto] = useState<Record<number, string>>({})
  const deGasto = plan.filter((c) => esLineaDeGasto(c.codigo))
  return (
    <section className="kf-asiento" aria-label="El asiento que sale" data-prueba="modificar-asiento">
      <header>
        <h3>El asiento que sale</h3>
        <span className="kf-etiqueta" data-tono="ambar">Modificándolo</span>
        <span className="kf-apoyo">Los mismos importes y el mismo IVA: cambia la cuenta de cada gasto</span>
      </header>
      <table>
        <thead><tr><th>Cuenta</th><th className="kf-cifra">Debe</th><th className="kf-cifra">Haber</th></tr></thead>
        <tbody>
          {apuntes.map((a) => {
            const cuenta = elegidas[a.posicion] ?? a.cuenta
            return (
              <tr key={a.posicion} data-cuenta={cuenta}>
                <td>
                  {esLineaDeGasto(a.cuenta) ? (
                    <span className="kf-modificar-linea">
                      <Buscador id={`kf-modificar-${a.posicion}`} etiqueta={`Cuenta de la línea ${a.posicion}`} valor={texto[a.posicion] ?? cuenta} cuenta={cuenta}
                        ponerTexto={(t) => setTexto((x) => ({ ...x, [a.posicion]: t }))} lista={(t) => cuentasQueEncajan(t, deGasto, 8)}
                        texto={(c) => `${c.codigo} · ${c.nombre}`} elegir={(c) => { elegir(a.posicion, c.codigo); setTexto((x) => { const y = { ...x }; delete y[a.posicion]; return y }) }} />
                      <span className="kf-modificar-nombre">{nombre(cuenta)}</span>
                    </span>
                  ) : <>{a.cuenta} · {a.nombre}</>}
                </td>
                <td className="kf-cifra">{a.debe ? cifra(a.debe) : ''}</td>
                <td className="kf-cifra">{a.haber ? cifra(a.haber) : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
