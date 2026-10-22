// src/modules/conta/diseno/plantillas/Informe.tsx
//
// S02 · La plantilla INFORME (tablero 6): balance, mayor, libros de IVA.
//   · Arriba: el periodo, «comparar con» y la vista (Oficial · Detallada · Por
//     local). El informe va a todo el ancho y cada línea se despliega en sus
//     cuentas.
//   · Cada línea dice primero lo que es en palabras de calle y, al lado, su
//     nombre oficial («Compras de género · 4. Aprovisionamientos»): las
//     palabras de calle no cambian el nombre oficial (Norma del S02).
//   · Arriba, una frase de comprobación: «Cuadra con sumas y saldos…». Lo que
//     no cuadra se dice ahí mismo, en ámbar: no se esconde (regla 7).
//
// S02 · PR 2 (Libros y listados): lo que los estados de verdad necesitaban y
// la muestra no — cada cuenta lleva a su Mayor, la columna del año anterior va
// en gris, la línea tiene su nivel (sangría), su marca («a crear»), su cita
// legal al pasar el ratón y una nota debajo; una cifra del lado contrario va
// en ámbar, y «Detallado» abre todas las líneas a la vez. Todo opcional: lo de
// antes se pinta igual.

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icono } from '../Icono'

export function ControlesInforme({ children }: { children: ReactNode }) {
  return <div className="s-informe-controles" role="group" aria-label="Qué enseña el informe">{children}</div>
}

/** La vista: Oficial · Detallada · Por local (un grupo de botones, uno pulsado). */
export function VistaInforme<V extends string>({ vistas, actual, alCambiar, etiqueta = 'Vista' }: {
  vistas: readonly { id: V; nombre: string }[]; actual: V; alCambiar: (v: V) => void; etiqueta?: string
}) {
  return (
    <div className="s-segmento" role="group" aria-label={etiqueta}>
      {vistas.map((v) => <button key={v.id} type="button" aria-pressed={v.id === actual} onClick={() => alCambiar(v.id)}>{v.nombre}</button>)}
    </div>
  )
}

/** La frase de comprobación. Es un estado de la página: el lector la anuncia cuando cambia. */
export function ComprobacionInforme({ cuadra, children, etiqueta }: { cuadra: boolean; children: ReactNode; etiqueta?: string }) {
  return (
    <p className="s-informe-comprobacion" data-cuadra={cuadra ? 'si' : 'no'} role="status" aria-label={etiqueta}>
      <Icono nombre={cuadra ? 'ia' : 'aviso'} /> <span>{children}</span>
    </p>
  )
}

/** Una cuenta dentro de una línea. */
export interface CuentaInforme {
  nombre: string
  codigo: string
  valores: readonly string[]
  /** A dónde lleva (su Mayor). */
  a?: string
  /** Su saldo está del lado contrario: ámbar. */
  aviso?: boolean
  /** Lo que va detrás del nombre («colocada por defecto · Completar»). */
  extra?: ReactNode
}

export interface LineaInforme {
  id: string
  /** En palabras de calle. */
  calle: string
  /**
   * Su nombre oficial, con su número («4. Aprovisionamientos»). Sin él, la
   * línea dice solo `calle`: cuando lo que hay ES el nombre oficial (las
   * partidas del PGC) no se inventan palabras de calle.
   */
  oficial?: string
  valores: readonly string[]
  /** La variación, si se compara. */
  cambio?: string
  /** Una línea de total (sin desplegar, en negrita). */
  total?: boolean
  /** Sus cuentas, al desplegarla. */
  cuentas?: readonly CuentaInforme[]
  /** 1 a 4: la sangría de la partida dentro del modelo. */
  nivel?: number
  /** Lo que va al lado del nombre (un chip «a crear»). */
  marca?: ReactNode
  /** Al pasar el ratón (la cita legal de la partida). */
  titulo?: string
  /** Una fila de nota justo debajo, en pequeño. */
  nota?: ReactNode
  /** La cifra de la línea va en ámbar (saldo del lado contrario). */
  aviso?: boolean
}

/** Una columna de cifras: su título, y en gris si es la de comparar (el año anterior). */
export type ColumnaInforme = string | { titulo: string; apagada?: boolean }
const tituloDe = (c: ColumnaInforme) => (typeof c === 'string' ? c : c.titulo)
const apagada = (c: ColumnaInforme | undefined) => (c !== undefined && typeof c !== 'string' && c.apagada ? '' : undefined)

export function TablaInforme({ columnas, lineas, etiqueta, concepto = 'Concepto', todasAbiertas = false }: {
  columnas: readonly ColumnaInforme[]
  lineas: readonly LineaInforme[]
  etiqueta: string
  /** El título de la primera columna. */
  concepto?: string
  /** «Detallado»: todas las líneas con sus cuentas a la vista, sin botón de desplegar. */
  todasAbiertas?: boolean
}) {
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set())
  const alternar = (id: string) => setAbiertas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const hayCambio = lineas.some((l) => l.cambio !== undefined)
  const ancho = 1 + columnas.length + (hayCambio ? 1 : 0)
  return (
    <div className="s-informe-caja">
      <table className="s-informe" aria-label={etiqueta}>
        <thead><tr><th scope="col">{concepto}</th>{columnas.map((c, i) => <th key={`${i}-${tituloDe(c)}`} scope="col" className="s-lista-cifra" data-apagada={apagada(c)}>{tituloDe(c)}</th>)}</tr></thead>
        <tbody>
          {lineas.map((l) => {
            const conCuentas = !l.total && (l.cuentas?.length ?? 0) > 0
            const abierta = conCuentas && (todasAbiertas || abiertas.has(l.id))
            return [
              <tr key={l.id} data-total={l.total ? '' : undefined} title={l.titulo}>
                <th scope="row" data-nivel={l.nivel && l.nivel > 1 ? Math.min(l.nivel, 4) : undefined}>
                  {conCuentas && !todasAbiertas
                    ? <button type="button" className="s-informe-desplegar" aria-expanded={abierta}
                        aria-label={`${abierta ? 'Ocultar' : 'Ver'} las cuentas de «${l.calle}»`} onClick={() => alternar(l.id)}>
                        <Icono nombre={abierta ? 'desplegar' : 'derecha'} /><span className="s-informe-calle">{l.calle}</span>
                      </button>
                    : <span className="s-informe-calle">{l.calle}</span>}
                  {l.oficial && <span className="s-informe-oficial"> · {l.oficial}</span>}
                  {l.marca && <> {l.marca}</>}
                </th>
                {l.valores.map((v, i) => <td key={i} className="s-lista-cifra" data-apagada={apagada(columnas[i])} data-aviso={l.aviso && i === 0 ? '' : undefined}>{v}</td>)}
                {l.cambio !== undefined && <td className="s-lista-cifra">{l.cambio}</td>}
              </tr>,
              ...(l.nota ? [<tr key={`${l.id}-nota`} className="s-informe-nota"><td colSpan={ancho}>{l.nota}</td></tr>] : []),
              ...(abierta ? (l.cuentas ?? []).map((c) => (
                <tr key={`${l.id}-${c.codigo}`} className="s-informe-cuenta">
                  <th scope="row" data-aviso={c.aviso ? '' : undefined}>
                    {c.a
                      ? <Link to={c.a}><span>{c.nombre}</span> <span className="s-campo-ficha-codigo">{c.codigo}</span></Link>
                      : <><span>{c.nombre}</span> <span className="s-campo-ficha-codigo">{c.codigo}</span></>}
                    {c.extra && <> {c.extra}</>}
                  </th>
                  {c.valores.map((v, i) => <td key={i} className="s-lista-cifra" data-apagada={apagada(columnas[i])} data-aviso={c.aviso && i === 0 ? '' : undefined}>{v}</td>)}
                  {l.cambio !== undefined && <td />}
                </tr>
              )) : []),
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}
