// src/modules/conta/bancos/PanelMovimiento.tsx
//
// B02 · El panel lateral del movimiento elegido (maqueta N17b): el texto del
// banco tal cual, las facturas pendientes de esa contraparte con casillas y
// lo que «queda por casar», «Buscar otra factura», «¿Es otra cosa?» (apuntar
// sin factura, traspaso, no va a contabilidad) y «Ver el asiento que se
// crea», plegado. En el móvil es una hoja a pantalla entera.
//
// Cada botón confirma con contenido o dice el fallo (regla 8): eso lo hace
// Movimientos, que es quien escribe; el panel solo dice qué se quiere.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaCompras } from '@/config/navegacion'
import { diaMesCorto, eurosExactos } from '@/modules/conta/lib/formato'
import { textoDeImporte } from '@/modules/conta/diseno'
import { AsientoQueSeCrea } from '@/modules/conta/diseno/plantillas'
import type { Destino } from '@/modules/conta/lib/conciliacion'
import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import type { RemesaParaCasar } from '@/modules/conta/services/pagosService'
import { remesaQueSePropone } from '@/modules/conta/lib/pagos'
import { MOTIVOS_DEVOLUCION, abonosQueCuadran, devolucionesQueCuadran, type ReciboDevolvible, type RemesaCobrosParaCasar } from '@/modules/conta/lib/cobros'
import {
  PILDORA, asientoQueSeCrea, confirmable, destinoDelReparto, facturasDe, quienEs, repartir, textoDelBanco, type FacturaParaCasar,
} from '@/modules/conta/lib/conciliarVista'

export interface CuentasDiferencia { c626: string; c669: string; c769: string }

export interface PanelProps {
  m: MovimientoBanco
  facturas: readonly FacturaParaCasar[]
  /** PC01 · E2 · Las remesas de pagos (Compras › Pagos) que esperan su cargo. */
  remesas?: readonly RemesaParaCasar[]
  /** La 572 del banco del movimiento, y las otras cuentas tuyas (para un traspaso). */
  cuenta572: string | null
  otrosBancos: { id: string; nombre: string; cuenta: string | null }[]
  nombres: Readonly<Record<string, string>>
  cuentasDiferencia: CuentasDiferencia
  ocupado: boolean
  alConfirmarPropuesta: () => void
  alConfirmar: (destino: Destino, porque: string, que: string) => void
  /** PC01 · E2 · Casar este cargo con una remesa entera (lineas null) o con los pagos que carga. */
  alCasarRemesa?: (remesaId: string, lineas: string[] | null) => void
  /** PC01 · E3 · Las remesas de recibos (Ventas › Cobros) que esperan su abono, y los recibos que aún pueden volver devueltos. */
  cobros?: { abonos: readonly RemesaCobrosParaCasar[]; devoluciones: readonly ReciboDevolvible[] }
  /** PC01 · E3 · Casar este abono con una remesa de recibos entera (lineas null) o con los recibos que abona. */
  alCasarAbono?: (remesaId: string, lineas: string[] | null) => void
  /** PC01 · E3 · Este cargo es la devolución de un recibo (con el motivo del banco). */
  alDevuelto?: (lineaId: string, motivo: string) => void
  alDeshacer: () => void
  alVerAsiento: () => void
  alBuscarFactura: () => void
  alApuntarSinFactura: () => void
  alApartar: () => void
  alCerrar: () => void
}

const cuentaLegible = (nombres: Readonly<Record<string, string>>, c: string) => (nombres[c] ? `${nombres[c]} · ${c}` : c)

export function PanelMovimiento(p: PanelProps) {
  const { m } = p
  const deEsta = useMemo(() => facturasDe(m, p.facturas), [m, p.facturas])
  const propuestas = useMemo(() => {
    const d = m.propuesta?.destino as Destino | null | undefined
    return d?.tipo === 'factura_recibida' ? d.facturas.map((f) => f.id) : []
  }, [m.propuesta])
  // Las de la propuesta vienen marcadas; las demás de esa contraparte, para añadir.
  const [elegidas, setElegidas] = useState<string[]>(() => propuestas.filter((id) => deEsta.some((f) => f.id === id)))
  const [cerrar, setCerrar] = useState(false)
  const lista = useMemo(() => [...deEsta, ...p.facturas.filter((f) => propuestas.includes(f.id) && !deEsta.some((x) => x.id === f.id))], [deEsta, p.facturas, propuestas])
  const fs = elegidas.map((id) => lista.find((f) => f.id === id)!).filter(Boolean)
  const reparto = fs.length ? repartir(m, fs, p.cuentasDiferencia, cerrar) : null
  const sinCasar = m.estado !== 'casado' && m.estado !== 'ignorado'
  const pago = m.importeCent < 0
  // PC01 · E2 · Las remesas que esperan justo este cargo: la remesa entera, o un pago suyo (el banco los carga uno a uno).
  const cargo = Math.abs(m.importeCent)
  const esperan = (p.remesas ?? []).flatMap((r) => [
    ...(r.porCargarCent === cargo ? [{ clave: r.id, remesaId: r.id, codigo: r.codigo, aMano: r.aMano, porBanco: r.porBanco, lineas: null as string[] | null, texto: `${r.porBanco ? 'Pago por el banco' : r.aMano ? 'Pago a mano' : 'Remesa'} ${r.codigo}`, apoyo: r.pagos.length === 1 ? `${r.pagos[0].proveedor} · ${r.pagos[0].factura ?? 'sin número'}` : `${r.pagos.length} pagos, del ${diaMesCorto(r.fecha)}` }] : []),
    ...(r.pagos.length > 1 ? r.pagos.filter((x) => x.importeCent === cargo).map((x) => ({ clave: x.id, remesaId: r.id, codigo: r.codigo, aMano: r.aMano, porBanco: r.porBanco, lineas: [x.id], texto: `Un pago de la remesa ${r.codigo}`, apoyo: `${x.proveedor} · ${x.factura ?? 'sin número'}` })) : []),
  ])
  // Respuesta 7 · Si el cargo es lo que espera UNA sola remesa entera, Bancos la propone sola; si cuadran dos o más, se elige.
  const { propuesta: remesaPropuesta, resto: otrasEsperan } = remesaQueSePropone(esperan)
  // PC01 · E3 · Un abono: la remesa de recibos (o un recibo suyo) que espera justo ese importe.
  // Un cargo: el recibo cobrado del que puede ser la devolución (el recibo y hasta 30 € de gastos).
  const abonos = !pago && p.cobros ? abonosQueCuadran(cargo, p.cobros.abonos) : []
  const { propuesta: abonoPropuesto, resto: otrosAbonos } = remesaQueSePropone(abonos)
  const devoluciones = pago && p.cobros ? devolucionesQueCuadran(cargo, p.cobros.devoluciones) : []
  const [motivo, setMotivo] = useState<string>(MOTIVOS_DEVOLUCION[0])

  // El destino que se enseña en «Ver el asiento que se crea»: lo que está elegido, o lo que propongo.
  const destinoVisto: Destino | null = reparto && !reparto.noSePuede ? destinoDelReparto(fs, reparto) : ((m.propuesta?.destino as Destino | null | undefined) ?? null)
  const lineas = destinoVisto ? asientoQueSeCrea(m, destinoVisto, p.cuenta572) : null
  const origen = m.propuesta?.origen ? PILDORA[m.propuesta.origen] ?? null : null

  const alternarFactura = (id: string) => setElegidas((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]))

  return (
    <aside className="cxn-panel" aria-label={`El movimiento de ${quienEs(m)}`}>
      <div className="cxn-panel-cabeza">
        <div>
          <h3>{quienEs(m)}</h3>
          <span className="cx-ayuda">{diaMesCorto(m.fecha)}{m.tipo ? ` · ${m.tipo}` : ''}</span>
        </div>
        <span className={`cxn-panel-importe${m.importeCent > 0 ? ' cxb-entra' : ''}`}>{eurosExactos(m.importeCent / 100)}</span>
        <button type="button" className="cxn-cerrar" onClick={p.alCerrar} aria-label="Cerrar el panel">×</button>
      </div>

      <section className="cxn-bloque" aria-label="Lo que dice el banco">
        <h4>Lo que dice el banco, tal cual</h4>
        <p className="cxn-banco-literal">{textoDelBanco(m) || '—'}</p>
      </section>

      {m.estado === 'casado' && m.casado && (
        <section className="cxn-bloque" aria-label="Casado">
          <h4>{m.casado.porQuien === 'folvy' ? 'Lo casé yo' : 'Lo casaste tú'}</h4>
          <p><strong>{m.casado.asientoConcepto ?? m.propuesta?.que ?? 'Casado'}</strong></p>
          <p className="cx-ayuda">{m.casado.porque}</p>
          <div className="cxn-acciones">
            {m.casado.asientoId && <button type="button" className="cx-boton-sec" onClick={p.alVerAsiento}>Abrir el asiento</button>}
            <button type="button" className="cx-boton-sec" disabled={p.ocupado} onClick={p.alDeshacer}>{p.ocupado ? 'Deshaciendo…' : 'Deshacer'}</button>
          </div>
        </section>
      )}

      {sinCasar && m.propuesta?.que && (
        <section className="cxn-bloque" aria-label="Lo que propongo">
          <h4>Lo que propongo</h4>
          <p className="cxn-propuesta">
            {origen && <span className="cxn-pildora">{origen}</span>}
            <strong>{m.propuesta.que}</strong>
          </p>
          {m.porque && <p className="cx-ayuda">{m.porque}</p>}
          {m.propuesta.facturaSinAprobar && <p className="cxn-ambar-texto">Factura sin aprobar: confirmar el pago no la aprueba.</p>}
          {/* S01c · Falta la factura que nombra el banco: se sube (o llega por correo) y se casa con este pago. */}
          {m.propuesta.que.startsWith('Falta la factura') && (
            <div className="cxn-acciones"><Link className="cx-boton" to={`${rutaCompras()}?subir`}>Subir la factura</Link></div>
          )}
          {(m.propuesta.alternativas ?? []).length > 0 && (
            <div className="cxn-acciones">
              {m.propuesta.alternativas!.map((a) => (
                <button key={a.etiqueta} type="button" className="cx-boton-sec" disabled={p.ocupado}
                  onClick={() => p.alConfirmar(a.destino as unknown as Destino, `Lo dijiste tú: ${a.etiqueta}.`, a.etiqueta)}>{a.etiqueta}</button>
              ))}
            </div>
          )}
          {confirmable(m) && !reparto && (
            <div className="cxn-acciones"><button type="button" className="cx-boton" disabled={p.ocupado} onClick={p.alConfirmarPropuesta}>{p.ocupado ? 'Confirmando…' : 'Sí, es esto'}</button></div>
          )}
        </section>
      )}

      {sinCasar && pago && esperan.length > 0 && p.alCasarRemesa && (
        <section className="cxn-bloque" aria-label="Esperando este cargo" data-prueba="remesas-esperan">
          <h4>Esperando este cargo</h4>
          {remesaPropuesta && (
            <div className="cxn-remesa-propuesta" data-prueba="remesa-propuesta">
              <p><span className="cx-ayuda">Te propongo:</span> <strong>es el cargo {remesaPropuesta.porBanco ? 'del pago por el banco' : remesaPropuesta.aMano ? 'del pago a mano' : 'de la remesa'} {remesaPropuesta.codigo}</strong> <span className="cx-ayuda">{remesaPropuesta.apoyo}. Es lo único que espera justo este importe.</span></p>
              <button type="button" className="cx-boton" disabled={p.ocupado} onClick={() => p.alCasarRemesa!(remesaPropuesta.remesaId, null)}>{p.ocupado ? 'Casando…' : 'Sí, es esta'}</button>
            </div>
          )}
          {!remesaPropuesta && otrasEsperan.filter((x) => x.lineas === null).length > 1 && (
            <p className="cx-ayuda">Cuadran {otrasEsperan.filter((x) => x.lineas === null).length} remesas con este importe: elige cuál es.</p>
          )}
          {otrasEsperan.length > 0 && <ul className="cxn-facturas">
            {otrasEsperan.map((x) => (
              <li key={x.clave} className="cxn-remesa">
                <span><strong>{x.texto}</strong> <span className="cx-ayuda">{x.apoyo}</span></span>
                <button type="button" className={remesaPropuesta ? 'cx-boton-sec' : 'cx-boton'} disabled={p.ocupado} onClick={() => p.alCasarRemesa!(x.remesaId, x.lineas)}>{p.ocupado ? 'Casando…' : 'Es esto'}</button>
              </li>
            ))}
          </ul>}
          <p className="cx-ayuda">Al casarlo, las facturas quedan pagadas con su asiento (cada proveedor a su 400 contra el banco). Si el cargo es la remesa entera y sus IBAN están confirmados, el asiento se valida solo.</p>
        </section>
      )}

      {sinCasar && !pago && abonos.length > 0 && p.alCasarAbono && (
        <section className="cxn-bloque" aria-label="Esperando este abono" data-prueba="remesas-cobros-esperan">
          <h4>Esperando este abono</h4>
          {abonoPropuesto && (
            <div className="cxn-remesa-propuesta" data-prueba="abono-propuesto">
              <p><span className="cx-ayuda">Te propongo:</span> <strong>es el abono de la remesa de recibos {abonoPropuesto.codigo}</strong> <span className="cx-ayuda">{abonoPropuesto.apoyo}. Es lo único que espera justo este importe.</span></p>
              <button type="button" className="cx-boton" disabled={p.ocupado} onClick={() => p.alCasarAbono!(abonoPropuesto.remesaId, null)}>{p.ocupado ? 'Casando…' : 'Sí, es esta'}</button>
            </div>
          )}
          {otrosAbonos.length > 0 && <ul className="cxn-facturas">
            {otrosAbonos.map((x) => (
              <li key={x.clave} className="cxn-remesa">
                <span><strong>{x.texto}</strong> <span className="cx-ayuda">{x.apoyo}</span></span>
                <button type="button" className={abonoPropuesto ? 'cx-boton-sec' : 'cx-boton'} disabled={p.ocupado} onClick={() => p.alCasarAbono!(x.remesaId, x.lineas)}>{p.ocupado ? 'Casando…' : 'Es esto'}</button>
              </li>
            ))}
          </ul>}
          <p className="cx-ayuda">Al casarlo, las facturas quedan cobradas con su asiento (el banco contra la 430 de cada cliente). Un recibo se puede devolver durante 8 semanas: si llega la devolución, se casa aquí con su recibo.</p>
        </section>
      )}

      {sinCasar && pago && devoluciones.length > 0 && p.alDevuelto && (
        <section className="cxn-bloque" aria-label="¿Es un recibo devuelto?" data-prueba="devoluciones">
          <h4>¿Es un recibo devuelto?</h4>
          <label className="cx-ayuda">Motivo que da el banco{' '}
            <select value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo de la devolución">
              {MOTIVOS_DEVOLUCION.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <ul className="cxn-facturas">
            {devoluciones.map((x) => (
              <li key={x.id} className="cxn-remesa">
                <span><strong>{x.cliente} · {x.factura ?? 'sin número'}</strong> <span className="cx-ayuda">recibo de {eurosExactos(x.importeCent / 100)} de la remesa {x.remesa}{x.gastosCent ? `, con ${eurosExactos(x.gastosCent / 100)} de gastos` : ''}</span></span>
                <button type="button" className="cx-boton-sec" disabled={p.ocupado} onClick={() => p.alDevuelto!(x.id, motivo)}>{p.ocupado ? 'Casando…' : 'Sí, es su devolución'}</button>
              </li>
            ))}
          </ul>
          <p className="cx-ayuda">Al casarlo, la factura vuelve a «Por cobrar» y los gastos van a la 626. Puedes pasar el recibo otra vez en la próxima remesa.</p>
        </section>
      )}

      {sinCasar && pago && (
        <section className="cxn-bloque" aria-label="Facturas pendientes">
          <h4>{lista.length ? `Facturas pendientes de ${lista[0].proveedor}` : 'Facturas pendientes'}</h4>
          {lista.length === 0 && <p className="cx-ayuda">No encuentro facturas sin pagar de {quienEs(m)}.</p>}
          <ul className="cxn-facturas">
            {lista.map((f) => {
              const r = reparto?.facturas.find((x) => x.id === f.id)
              return (
                <li key={f.id}>
                  <label className="cxb-check">
                    <input type="checkbox" checked={elegidas.includes(f.id)} onChange={() => alternarFactura(f.id)} />
                    <span>
                      <strong>{f.numero ?? 'Sin número'}</strong> <span className="cx-ayuda">del {diaMesCorto(f.fecha)}</span>
                      {f.enRevision && <span className="cxn-pildora cxn-pildora-ambar">sin aprobar</span>}
                      <span className="cx-ayuda cxn-factura-pie">
                        quedan <span className="cx-cifra">{eurosExactos((f.totalCent - f.pagadoCent) / 100)}</span>
                        {r && <> · pagas <span className="cx-cifra">{eurosExactos(r.importeCent / 100)}</span>{r.quedaCent > 0 && <> · le quedarán <span className="cx-cifra">{eurosExactos(r.quedaCent / 100)}</span></>}</>}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          {reparto && (
            <div className="cxn-queda" role="status">
              <span>Queda por casar</span>
              <span className="cx-cifra">{eurosExactos(reparto.quedaPorCasarCent / 100)}</span>
            </div>
          )}
          {reparto?.diferencia && (
            <p className="cx-ayuda">
              {reparto.diferencia.importeCent > 0 ? 'Pagas de más' : 'Pagas de menos'} {eurosExactos(Math.abs(reparto.diferencia.importeCent) / 100)}: lo apunto en {cuentaLegible(p.nombres, reparto.diferencia.cuenta)} si confirmas.
            </p>
          )}
          {reparto?.sePuedeCerrar && (
            <label className="cxb-check">
              <input type="checkbox" checked={cerrar} onChange={(e) => setCerrar(e.target.checked)} />
              <span>Dejar la factura pagada: la diferencia va a {cuentaLegible(p.nombres, p.cuentasDiferencia.c769)}</span>
            </label>
          )}
          {reparto?.noSePuede && <p className="cxn-ambar-texto">{reparto.noSePuede}</p>}
          <div className="cxn-acciones">
            {reparto && (
              <button type="button" className="cx-boton" disabled={p.ocupado || !!reparto.noSePuede}
                onClick={() => {
                  const d = destinoDelReparto(fs, reparto)
                  const que = (d as Extract<Destino, { tipo: 'factura_recibida' }>).concepto
                  p.alConfirmar(d, `Lo dijiste tú: ${que.charAt(0).toLowerCase()}${que.slice(1)}.`, que)
                }}>
                {p.ocupado ? 'Casando…' : fs.length === 1 ? 'Casar con esta factura' : `Casar con estas ${fs.length} facturas`}
              </button>
            )}
            <button type="button" className="cx-boton-sec" onClick={p.alBuscarFactura}>Buscar otra factura</button>
          </div>
        </section>
      )}

      {sinCasar && (
        <details className="cxn-bloque cxn-otra-cosa">
          <summary>¿Es otra cosa?</summary>
          <div className="cxn-acciones cxn-acciones-columna">
            <button type="button" className="cx-boton-sec" onClick={p.alApuntarSinFactura}>Apuntar sin factura…</button>
            {p.otrosBancos.filter((b) => b.cuenta).map((b) => (
              <button key={b.id} type="button" className="cx-boton-sec" disabled={p.ocupado}
                onClick={() => p.alConfirmar(
                  { tipo: 'cuenta', concepto: `Traspaso ${m.importeCent > 0 ? 'desde' : 'a'} ${b.nombre}`, lineas: [{ cuenta: b.cuenta!, importe: Math.abs(m.importeCent) / 100 }] },
                  `Lo dijiste tú: es un traspaso ${m.importeCent > 0 ? 'desde' : 'a'} ${b.nombre}.`, `Traspaso ${m.importeCent > 0 ? 'desde' : 'a'} ${b.nombre}`)}>
                Traspaso {m.importeCent > 0 ? 'desde' : 'a'} {b.nombre}
              </button>
            ))}
            <button type="button" className="cx-boton-sec" onClick={p.alApartar}>No va a contabilidad…</button>
          </div>
        </details>
      )}

      {lineas && (
        // El asiento común (diseno/plantillas): Cuenta · Nombre · Debe · Haber, el debe arriba y los totales con «Cuadra».
        <AsientoQueSeCrea titulo="Ver el asiento que se crea" abierto={false} nivel={4}
          lineas={lineas.map((l) => ({
            codigo: l.cuenta, nombre: p.nombres[l.cuenta] ?? '',
            debe: l.debeCent ? textoDeImporte(l.debeCent / 100) : null, haber: l.haberCent ? textoDeImporte(l.haberCent / 100) : null,
          }))}
          nota="Su asiento queda propuesto y espera en «Por validar», donde lo validas." />
      )}
    </aside>
  )
}
