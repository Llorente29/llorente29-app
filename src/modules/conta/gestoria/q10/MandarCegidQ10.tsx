// src/modules/conta/gestoria/q10/MandarCegidQ10.tsx
//
// Q10 · respuestas 3 y 4 · El paso 2 de «Facturas del mes»: MANDAR A CEGID todo lo cobrado, como incidencias del mes, y
// comprobar antes de facturar que lo que hay en Cegid es exactamente lo cobrado. Pinta, no lee nada (el plan y el
// cuadre los hace _shared/cegidMandar.ts; las llamadas, pagina.tsx):
//   · el aviso de mirar el precálculo (respuesta 6: las cuotas fijas llevan «Facturar hasta 10/2026»; a un cliente nuevo
//     con cuota fija sin él no se le manda nada);
//   · DOS VUELTAS, porque la incidencia no lleva serie (la pone la «Facturación automática»): «Primero: N clientes,
//     X € → factura con la serie 1» (todo menos Contasimple; primero uno para probar, después todos) y «Después:
//     Contasimple, N clientes, X € → factura con la serie 3», apagado hasta que Sumied lee de Cegid que lo de la
//     vuelta 1 está facturado en la serie 1;
//   · EL CUADRE: Sumied lee de Cegid las incidencias del mes (las suyas y las de cualquiera) y las cruza cobro por
//     cobro con lo cobrado: «Cegid va a facturar X € en N clientes. GoCardless cobró X €. Cuadra cobro por cobro» o «No
//     cuadra: N diferencias»; el total de la serie 1 y de la 3; «Bajar en Excel», una fila por cobro. Sin «Cuadra», el
//     paso de facturar sale apagado con el porqué;
//   · «Deshacer» lo mandado y aún no facturado; y lo que no sale, con su porqué.
// Cada botón confirma con su contenido y dice al acabar qué ha hecho (regla 8).

import { useState } from 'react'
import { puertaContasimple, type Cuadre, type MandadaQ10, type PlanMandar, type SerieVuelta } from '../../../../../supabase/functions/_shared/cegidMandar'
import { eurQ10 } from './facturasDelMes'

export interface PropsMandarQ10 {
  plan: PlanMandar | null
  /** Si la empresa puede mandar (conectada, y no es la autónoma), o el porqué de que no. */
  puede: { si: true } | { si: false; porque: string }
  /** Lo mandado a Cegid este mes (conta_cegid_incidencia). */
  mandadas: MandadaQ10[]
  /** El cruce con lo que hay en Cegid; null si aún no se ha leído. */
  cuadre: Cuadre | null
  alMandarUno: (codigo: number, avance: (f: string) => void) => Promise<string>
  alMandarVuelta: (serie: SerieVuelta, avance: (f: string) => void) => Promise<string>
  alDeshacer: () => Promise<string>
  alLeerCegid: (avance: (f: string) => void) => Promise<string>
  alBajarExcel: () => string | null
  /** Respuesta 4 · «Confirmar» el concepto propuesto de lo que no lo tiene, y su frase (la guarda la página). */
  alElegir: (x: { que: 'cobro' | 'suscripcion'; gcId: string; concepto: string }) => void
  elegido: { gcId: string; estado: 'trabajando' | 'bien' | 'mal'; frase: string } | null
}

type Hecho = { estado: 'trabajando' | 'bien' | 'mal'; frase: string } | null
type Confirmar = { que: 'uno' } | { que: 'vuelta'; serie: SerieVuelta } | { que: 'deshacer' }

export function MandarCegidQ10(p: PropsMandarQ10) {
  const [elegido, setElegido] = useState<number | null>(null)
  const [confirmar, setConfirmar] = useState<Confirmar | null>(null)
  const [hecho, setHecho] = useState<Hecho>(null)
  const plan = p.plan
  const v1 = plan?.vueltas['1'], v3 = plan?.vueltas['3']
  const ocupado = hecho?.estado === 'trabajando'
  const hacer = async (fn: (avance: (f: string) => void) => Promise<string>) => {
    setConfirmar(null)
    setHecho({ estado: 'trabajando', frase: 'Trabajando…' })
    try { setHecho({ estado: 'bien', frase: await fn((f) => setHecho({ estado: 'trabajando', frase: f })) }) } catch (e) { setHecho({ estado: 'mal', frase: e instanceof Error ? e.message : String(e) }) }
  }
  const uno = v1?.listos.find((x) => x.codigo === (elegido ?? v1?.listos[0]?.codigo)) ?? null
  const porQueNo = !p.puede.si ? p.puede.porque : !plan ? 'Aún no se ha leído lo de Cegid.' : null
  const vivas = p.mandadas.filter((x) => x.estado === 'mandada').length
  const primero = !p.mandadas.some((x) => x.serie === '1' && ['mandando', 'mandada', 'facturada'].includes(x.estado))
  const puerta = puertaContasimple(p.mandadas)
  const facturar = !p.cuadre ? 'Antes, lee de Cegid lo que hay para facturar y mira que cuadra con lo cobrado.'
    : !p.cuadre.cuadra ? `No cuadra: ${p.cuadre.diferencias} ${p.cuadre.diferencias === 1 ? 'diferencia' : 'diferencias'}. Mira la tabla o bájala en Excel.` : null
  const difs = p.cuadre?.filas.filter((f) => !f.cuadra) ?? []

  return (
    <section className="g4-bloque q10-mandar" aria-labelledby="q10-mandar" data-prueba="mandar">
      <h2 id="q10-mandar" className="g4-bloque-titulo">Paso 2 · Mandar a Cegid</h2>
      <p className="q10-linea">Cegid solo factura lo que manda Sumied: cada cobro confirmado, como una línea del mes de su cliente, con el texto de GoCardless. Sin cobro confirmado no se manda nada.</p>
      {porQueNo && <p className="q10-linea" data-prueba="mandar-por-que-no">{porQueNo}</p>}

      {plan && p.puede.si && v1 && v3 && (
        <>
          <p className="q10-linea" data-prueba="mandar-aviso" role="note">Antes de facturar, mira en el precálculo de Cegid que solo sale lo mandado: las cuotas fijas llevan «Facturar hasta 10/2026».</p>

          <div className="q10-paso" data-prueba="vuelta-1">
            <p className="q10-frase" data-prueba="vuelta-1-frase">{v1.frase}</p>
            {primero ? (
              <div className="q10-pasos">
                <label className="q10-linea" htmlFor="q10-uno">Primero, un cliente para probar:</label>
                <select id="q10-uno" className="g4-boton" value={uno?.codigo ?? ''} disabled={ocupado || !v1.listos.length} onChange={(e) => setElegido(Number(e.target.value))}>
                  {v1.listos.map((x) => <option key={x.codigo} value={x.codigo}>{x.codigo} · {x.nombre} · {x.lineas.length} {x.lineas.length === 1 ? 'cobro' : 'cobros'} · {eurQ10(x.totalCent)}</option>)}
                </select>
                <button type="button" className="g4-boton" data-tipo="primario" disabled={ocupado || !uno} onClick={() => setConfirmar({ que: 'uno' })}
                  title={uno ? undefined : 'No hay ningún cliente listo para mandar'}>Mandar solo este para probar</button>
                <p className="g4-pequeno">Cuando el de prueba esté bien en Cegid, se podrán mandar todos los de la serie 1.</p>
              </div>
            ) : (
              <button type="button" className="g4-boton" data-tipo="primario" disabled={ocupado || !v1.listos.length} onClick={() => setConfirmar({ que: 'vuelta', serie: '1' })}
                title={v1.listos.length ? undefined : 'No queda ningún cliente de la serie 1 por mandar'}>Mandar los {v1.listos.length} de la serie 1</button>
            )}
          </div>

          <div className="q10-paso" data-prueba="cuadre">
            <h3 className="q10-subtitulo">Antes de facturar: lo que hay en Cegid, contra lo cobrado</h3>
            <button type="button" className="g4-boton" disabled={ocupado} onClick={() => void hacer(p.alLeerCegid)}>{p.cuadre ? 'Volver a leer de Cegid' : 'Leer de Cegid lo que hay para facturar'}</button>
            {p.cuadre && (
              <>
                <p className="q10-frase" data-prueba="cuadre-frase" data-tono={p.cuadre.cuadra ? 'bien' : 'mal'}>{p.cuadre.frase}</p>
                <p className="q10-linea" data-prueba="cuadre-series">
                  Serie 1: {p.cuadre.porSerie['1'].clientes} {p.cuadre.porSerie['1'].clientes === 1 ? 'cliente' : 'clientes'}, {eurQ10(p.cuadre.porSerie['1'].cent)}.
                  {' '}Serie 3 (Contasimple): {p.cuadre.porSerie['3'].clientes} {p.cuadre.porSerie['3'].clientes === 1 ? 'cliente' : 'clientes'}, {eurQ10(p.cuadre.porSerie['3'].cent)}.
                </p>
                <button type="button" className="g4-boton" onClick={() => { const f = p.alBajarExcel(); setHecho(f ? { estado: 'bien', frase: `Bajado: ${f}.` } : { estado: 'mal', frase: 'No hay nada que bajar.' }) }}>Bajar en Excel</button>
                {difs.length > 0 && (
                  <div className="q10-tabla-caja">
                    <table className="q10-tabla" aria-label="Diferencias con Cegid">
                      <thead><tr><th>Cobro</th><th>Cliente</th><th className="q10-num">GoCardless</th><th>En Cegid</th><th className="q10-num">Cegid</th><th>Por qué</th></tr></thead>
                      <tbody>
                        {difs.map((f, i) => (
                          <tr key={`${f.gcId ?? ''}|${f.codigo ?? ''}|${i}`}>
                            <td>{f.gcId ?? '—'}{f.fecha ? <div className="g4-pequeno">{f.fecha}</div> : null}</td>
                            <td className="q10-cliente">{f.cliente ?? '—'}</td>
                            <td className="q10-num">{f.importeCent == null ? '—' : eurQ10(f.importeCent)}</td>
                            <td>{f.codigo != null ? `${f.codigo} ${f.nombreCegid ?? ''}` : '—'}{f.concepto ? <div className="g4-pequeno">{f.concepto} · serie {f.serie ?? '—'}</div> : null}</td>
                            <td className="q10-num">{f.importeCegidCent == null ? '—' : eurQ10(f.importeCegidCent)}</td>
                            <td>{f.porque}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            <p className="q10-linea" data-prueba="facturar" data-tono={facturar ? undefined : 'bien'} aria-disabled={facturar ? true : undefined}>
              {facturar ? <>Facturar en Cegid: aún no. {facturar}</> : <>Cuadra: ya se puede facturar en Cegid («Facturación automática») con la serie {puerta.abierta ? '3 lo de Contasimple' : '1'}.</>}
            </p>
          </div>

          <div className="q10-paso" data-prueba="vuelta-3">
            <p className="q10-frase" data-prueba="vuelta-3-frase">{v3.frase}</p>
            <button type="button" className="g4-boton" data-tipo="primario" disabled={ocupado || !puerta.abierta || !v3.listos.length} onClick={() => setConfirmar({ que: 'vuelta', serie: '3' })}
              title={!puerta.abierta ? puerta.porque : v3.listos.length ? undefined : 'No queda Contasimple por mandar'}>Mandar Contasimple</button>
            {!puerta.abierta && <p className="g4-pequeno" data-prueba="vuelta-3-por-que">{puerta.porque}</p>}
          </div>

          {vivas > 0 && <div><button type="button" className="g4-boton" disabled={ocupado} onClick={() => setConfirmar({ que: 'deshacer' })}>Deshacer lo mandado ({vivas})</button></div>}
        </>
      )}

      {confirmar && plan && v1 && v3 && (
        <div className="g4-bloque q10-confirmar" role="alertdialog" aria-label="Confirmar">
          {confirmar.que === 'uno' && uno && <p className="q10-linea">Se manda a Cegid el cliente {uno.codigo} ({uno.nombre}): {uno.lineas.length} {uno.lineas.length === 1 ? 'línea' : 'líneas'} de {plan.mes}, {eurQ10(uno.totalCent)}, para facturar con la serie 1. Antes se vuelve a leer su ficha en Cegid.</p>}
          {confirmar.que === 'vuelta' && (() => { const v = plan.vueltas[confirmar.serie]; return <p className="q10-linea">Se mandan a Cegid {v.listos.length} {v.listos.length === 1 ? 'cliente' : 'clientes'}, {v.lineas} {v.lineas === 1 ? 'línea' : 'líneas'} de {plan.mes}, {eurQ10(v.cent)}, para facturar con la serie {confirmar.serie}. Uno a uno; si uno falla, se para y se dice.</p> })()}
          {confirmar.que === 'deshacer' && <p className="q10-linea">{vivas === 1 ? 'Se borra en Cegid la línea que mandó Sumied este mes y aún no está facturada.' : `Se borran en Cegid las ${vivas} líneas que mandó Sumied este mes y aún no están facturadas.`} Las ya facturadas no se tocan.</p>}
          <div className="g4-cabecera-acciones">
            <button type="button" className="g4-boton" data-tipo="primario" onClick={() => {
              const c = confirmar
              void hacer(c.que === 'uno' ? (a) => p.alMandarUno(uno!.codigo, a) : c.que === 'vuelta' ? (a) => p.alMandarVuelta(c.serie, a) : () => p.alDeshacer())
            }}>Sí, adelante</button>
            <button type="button" className="g4-boton" onClick={() => setConfirmar(null)}>No, volver</button>
          </div>
        </div>
      )}
      {hecho && <p className="q10-linea" data-prueba="mandar-hecho" data-tono={hecho.estado === 'bien' ? 'bien' : hecho.estado === 'mal' ? 'mal' : undefined}
        role={hecho.estado === 'mal' ? 'alert' : 'status'}>{hecho.frase}</p>}

      {p.elegido && <p className="q10-linea" data-prueba="elegido" data-tono={p.elegido.estado === 'bien' ? 'bien' : p.elegido.estado === 'mal' ? 'mal' : undefined}
        role={p.elegido.estado === 'mal' ? 'alert' : 'status'}>{p.elegido.frase}</p>}
      {plan && plan.noSalen.length > 0 && (
        <details data-prueba="no-salen">
          <summary>No salen ({plan.noSalen.length}), con su porqué</summary>
          <ul className="q10-lista">
            {plan.noSalen.map((x) => (
              <li key={x.gcId} data-porque={x.porque}>
                <span className="q10-cliente">{x.nombre ?? 'Sin ficha'}</span>
                <span className="q10-importe">{eurQ10(x.totalCent)}{x.concepto ? ` · ${x.concepto}` : ''}</span>
                <span className="q10-porque">{x.frase}</span>
                {x.propuesta && x.elegir && (
                  <span><button type="button" className="g4-boton" disabled={p.elegido?.estado === 'trabajando'}
                    onClick={() => p.alElegir({ que: x.elegir!.que, gcId: x.elegir!.gcId, concepto: x.propuesta!.codigo })}>Confirmar {x.propuesta.codigo}</button>
                    {' '}<span className="g4-pequeno">{x.propuesta.nombre}{x.elegir.que === 'suscripcion' ? ' · para esta suscripción, todos los meses' : ''}</span></span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
