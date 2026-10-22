// src/modules/conta/diseno/plantillas/Informe.tsx
//
// S02 · La plantilla INFORME (tablero 6): balance, mayor, libros de IVA.
//   · Arriba: el periodo, «comparar con» y la vista (Oficial · Detallada · Por
//     local). El informe va a todo el ancho y cada línea se despliega en sus
//     cuentas.
//   · Cada línea dice primero lo que es en palabras de calle y, al lado, su
//     nombre oficial («Compras de género · 4. Aprovisionamientos»): las
//     palabras de calle no cambian el nombre oficial (Norma del S02).
//   · Arriba, una frase de comprobación: «Cuadra con sumas y saldos…».

import { useState, type ReactNode } from 'react'
import { Icono } from '../Icono'

export function ControlesInforme({ children }: { children: ReactNode }) {
  return <div className="s-informe-controles" role="group" aria-label="Qué enseña el informe">{children}</div>
}

/** La vista: Oficial · Detallada · Por local (un grupo de botones, uno pulsado). */
export function VistaInforme<V extends string>({ vistas, actual, alCambiar }: { vistas: readonly { id: V; nombre: string }[]; actual: V; alCambiar: (v: V) => void }) {
  return (
    <div className="s-segmento" role="group" aria-label="Vista">
      {vistas.map((v) => <button key={v.id} type="button" aria-pressed={v.id === actual} onClick={() => alCambiar(v.id)}>{v.nombre}</button>)}
    </div>
  )
}

export function ComprobacionInforme({ cuadra, children }: { cuadra: boolean; children: ReactNode }) {
  return (
    <p className="s-informe-comprobacion" data-cuadra={cuadra ? 'si' : 'no'}>
      <Icono nombre={cuadra ? 'ia' : 'aviso'} /> <span>{children}</span>
    </p>
  )
}

export interface LineaInforme {
  id: string
  /** En palabras de calle. */
  calle: string
  /** Su nombre oficial, con su número («4. Aprovisionamientos»). */
  oficial: string
  valores: readonly string[]
  /** La variación, si se compara. */
  cambio?: string
  /** Una línea de total (sin desplegar, en negrita). */
  total?: boolean
  /** Sus cuentas, al desplegarla. */
  cuentas?: readonly { nombre: string; codigo: string; valores: readonly string[] }[]
}

export function TablaInforme({ columnas, lineas, etiqueta }: { columnas: readonly string[]; lineas: readonly LineaInforme[]; etiqueta: string }) {
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set())
  const alternar = (id: string) => setAbiertas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <table className="s-informe" aria-label={etiqueta}>
      <thead><tr><th scope="col">Concepto</th>{columnas.map((c) => <th key={c} scope="col" className="s-lista-cifra">{c}</th>)}</tr></thead>
      <tbody>
        {lineas.map((l) => {
          const abierta = abiertas.has(l.id)
          return [
            <tr key={l.id} data-total={l.total ? '' : undefined}>
              <th scope="row">
                {l.cuentas && l.cuentas.length > 0
                  ? <button type="button" className="s-informe-desplegar" aria-expanded={abierta} onClick={() => alternar(l.id)}>
                      <Icono nombre={abierta ? 'desplegar' : 'derecha'} /><span className="s-informe-calle">{l.calle}</span>
                    </button>
                  : <span className="s-informe-calle">{l.calle}</span>}
                <span className="s-informe-oficial"> · {l.oficial}</span>
              </th>
              {l.valores.map((v, i) => <td key={i} className="s-lista-cifra">{v}</td>)}
              {l.cambio !== undefined && <td className="s-lista-cifra">{l.cambio}</td>}
            </tr>,
            ...(abierta ? (l.cuentas ?? []).map((c) => (
              <tr key={`${l.id}-${c.codigo}`} className="s-informe-cuenta">
                <th scope="row"><span>{c.nombre}</span> <span className="s-campo-ficha-codigo">{c.codigo}</span></th>
                {c.valores.map((v, i) => <td key={i} className="s-lista-cifra">{v}</td>)}
                {l.cambio !== undefined && <td />}
              </tr>
            )) : []),
          ]
        })}
      </tbody>
    </table>
  )
}
