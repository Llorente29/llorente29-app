// src/modules/conta/gestoria/q10/MandarCegidQ10.tsx
//
// Q10 · respuesta 3 · El paso 2 de «Facturas del mes»: MANDAR A CEGID todo lo cobrado, como incidencias del mes. Pinta,
// no lee nada (el plan lo hace _shared/cegidMandar.ts; las llamadas, pagina.tsx):
//   · arriba, una línea: «Listos para mandar: N clientes, X €. Parados por conceptos fijos en Cegid: M»;
//   · un solo botón grande por paso: primero «Mandar solo este para probar» (un cliente que se elige); hecho eso,
//     «Mandar los N listos»; y «Deshacer» lo mandado y aún no facturado. Cada uno, con su confirmación con contenido y
//     su frase al acabar (regla 8); el que aún no toca, apagado y con el porqué;
//   · la lista de PARADOS, como una lista de tareas: código de Cegid, nombre y los conceptos fijos que aún tiene;
//     «Volver a leer las fichas» quita los que ya están cortados;
//   · lo que no sale, con su porqué (sin cobro confirmado, sin código, sin concepto aprobado…).

import { useState } from 'react'
import type { PlanMandar } from '../../../../../supabase/functions/_shared/cegidMandar'
import { eurQ10 } from './facturasDelMes'

export interface PropsMandarQ10 {
  plan: PlanMandar | null
  /** Si la empresa puede mandar (conectada, y no es la autónoma), o el porqué de que no. */
  puede: { si: true } | { si: false; porque: string }
  /** Cuántas incidencias hay ya mandadas este mes (vivas). */
  mandadas: number
  alMandarUno: (codigo: number, avance: (f: string) => void) => Promise<string>
  alMandarTodos: (avance: (f: string) => void) => Promise<string>
  alDeshacer: () => Promise<string>
  alReleer: (avance: (f: string) => void) => Promise<string>
}

type Hecho = { estado: 'trabajando' | 'bien' | 'mal'; frase: string } | null

export function MandarCegidQ10(p: PropsMandarQ10) {
  const [elegido, setElegido] = useState<number | null>(null)
  const [confirmar, setConfirmar] = useState<'uno' | 'todos' | 'deshacer' | null>(null)
  const [hecho, setHecho] = useState<Hecho>(null)
  const plan = p.plan
  const ocupado = hecho?.estado === 'trabajando'
  const hacer = async (fn: (avance: (f: string) => void) => Promise<string>) => {
    setConfirmar(null)
    setHecho({ estado: 'trabajando', frase: 'Trabajando…' })
    try { setHecho({ estado: 'bien', frase: await fn((f) => setHecho({ estado: 'trabajando', frase: f })) }) } catch (e) { setHecho({ estado: 'mal', frase: e instanceof Error ? e.message : String(e) }) }
  }
  const uno = plan?.listos.find((x) => x.codigo === (elegido ?? plan?.listos[0]?.codigo)) ?? null
  const porQueNo = !p.puede.si ? p.puede.porque : !plan ? 'Aún no se ha leído lo de Cegid.' : null
  const primero = p.mandadas === 0

  return (
    <section className="g4-bloque q10-mandar" aria-labelledby="q10-mandar" data-prueba="mandar">
      <h2 id="q10-mandar" className="g4-bloque-titulo">Paso 2 · Mandar a Cegid</h2>
      <p className="q10-linea">Cegid solo factura lo que manda Sumied: cada cobro confirmado, como una línea del mes de su cliente, con el texto de GoCardless. Sin cobro confirmado no se manda nada.</p>
      {plan && <p className="q10-frase" data-prueba="mandar-frase" data-tono={plan.parados.length ? undefined : 'bien'}>{plan.frase}</p>}
      {porQueNo && <p className="q10-linea" data-prueba="mandar-por-que-no">{porQueNo}</p>}

      {plan && p.puede.si && (
        <div className="q10-pasos">
          {primero ? (
            <div className="q10-paso">
              <label className="q10-linea" htmlFor="q10-uno">Primero, un cliente para probar:</label>
              <select id="q10-uno" className="g4-boton" value={uno?.codigo ?? ''} disabled={ocupado || !plan.listos.length} onChange={(e) => setElegido(Number(e.target.value))}>
                {plan.listos.map((x) => <option key={x.codigo} value={x.codigo}>{x.codigo} · {x.nombre} · {x.lineas.length} {x.lineas.length === 1 ? 'cobro' : 'cobros'} · {eurQ10(x.totalCent)}</option>)}
              </select>
              <button type="button" className="g4-boton" data-tipo="primario" disabled={ocupado || !uno} onClick={() => setConfirmar('uno')}
                title={uno ? undefined : 'No hay ningún cliente listo: todos tienen aún conceptos fijos en Cegid'}>Mandar solo este para probar</button>
            </div>
          ) : (
            <button type="button" className="g4-boton" data-tipo="primario" disabled={ocupado || !plan.listos.length} onClick={() => setConfirmar('todos')}
              title={plan.listos.length ? undefined : 'No queda ningún cliente listo'}>Mandar los {plan.listos.length} listos</button>
          )}
          {primero && <p className="g4-pequeno">Cuando el de prueba esté bien en Cegid, se podrán mandar todos los listos.</p>}
          {p.mandadas > 0 && <button type="button" className="g4-boton" disabled={ocupado} onClick={() => setConfirmar('deshacer')}>Deshacer lo mandado ({p.mandadas})</button>}
        </div>
      )}

      {confirmar && plan && (
        <div className="g4-bloque q10-confirmar" role="alertdialog" aria-label="Confirmar">
          {confirmar === 'uno' && uno && <p className="q10-linea">Se manda a Cegid el cliente {uno.codigo} ({uno.nombre}): {uno.lineas.length} {uno.lineas.length === 1 ? 'línea' : 'líneas'} de {plan.mes}, {eurQ10(uno.totalCent)}. Antes se vuelve a leer su ficha: si aún tiene conceptos fijos, no se manda.</p>}
          {confirmar === 'todos' && <p className="q10-linea">Se mandan a Cegid {plan.listos.length} clientes, {plan.listos.reduce((t, x) => t + x.lineas.length, 0)} líneas de {plan.mes}, {eurQ10(plan.listosCent)}. Uno a uno; si uno falla, se para y se dice.</p>}
          {confirmar === 'deshacer' && <p className="q10-linea">Se borran en Cegid las {p.mandadas} líneas que mandó Sumied este mes y aún no están facturadas. Las ya facturadas no se tocan.</p>}
          <div className="g4-cabecera-acciones">
            <button type="button" className="g4-boton" data-tipo="primario" onClick={() => void hacer(
              confirmar === 'uno' ? (a) => p.alMandarUno(uno!.codigo, a) : confirmar === 'todos' ? p.alMandarTodos : () => p.alDeshacer())}>Sí, adelante</button>
            <button type="button" className="g4-boton" onClick={() => setConfirmar(null)}>No, volver</button>
          </div>
        </div>
      )}
      {hecho && <p className="q10-linea" data-prueba="mandar-hecho" data-tono={hecho.estado === 'bien' ? 'bien' : hecho.estado === 'mal' ? 'mal' : undefined}
        role={hecho.estado === 'mal' ? 'alert' : 'status'}>{hecho.frase}</p>}

      {plan && plan.parados.length > 0 && (
        <div data-prueba="parados">
          <h3 className="q10-subtitulo">Aún tiene conceptos fijos en Cegid: quítalos antes ({plan.parados.length})</h3>
          <p className="q10-linea">Con conceptos fijos, la «Facturación automática» de Cegid les facturaría dos veces. Quítalos en su ficha de Cegid y vuelve a leer: los cortados salen de la lista.</p>
          <button type="button" className="g4-boton" disabled={ocupado} onClick={() => void hacer(p.alReleer)}>Volver a leer las fichas</button>
          <div className="q10-tabla-caja">
            <table className="q10-tabla" aria-label="Parados por conceptos fijos">
              <thead><tr><th>Código</th><th>Cliente</th><th>Conceptos fijos que tiene</th><th className="q10-num">Cobrado</th></tr></thead>
              <tbody>
                {plan.parados.map((x) => (
                  <tr key={x.codigo} data-codigo={x.codigo}>
                    <td>{x.codigo}</td>
                    <td className="q10-cliente">{x.nombre}</td>
                    <td>{x.conceptos.map((k) => `${k.codigo} ${k.descripcion}`.trim()).join(' · ')}</td>
                    <td className="q10-num">{x.cobros} · {eurQ10(x.totalCent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {plan && plan.noSalen.length > 0 && (
        <details data-prueba="no-salen">
          <summary>No salen ({plan.noSalen.length}), con su porqué</summary>
          <ul className="q10-lista">
            {plan.noSalen.map((x) => (
              <li key={x.gcId} data-porque={x.porque}>
                <span className="q10-cliente">{x.nombre ?? 'Sin ficha'}</span>
                <span className="q10-importe">{eurQ10(x.totalCent)}{x.concepto ? ` · ${x.concepto}` : ''}</span>
                <span className="q10-porque">{x.frase}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
