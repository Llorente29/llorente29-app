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
import { diaMesCorto, eurosExactos } from '@/modules/conta/lib/formato'
import type { Destino } from '@/modules/conta/lib/conciliacion'
import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import {
  PILDORA, asientoQueSeCrea, confirmable, destinoDelReparto, facturasDe, quienEs, repartir, textoDelBanco, type FacturaParaCasar,
} from '@/modules/conta/lib/conciliarVista'

export interface CuentasDiferencia { c626: string; c669: string; c769: string }

export interface PanelProps {
  m: MovimientoBanco
  facturas: readonly FacturaParaCasar[]
  /** La 572 del banco del movimiento, y las otras cuentas tuyas (para un traspaso). */
  cuenta572: string | null
  otrosBancos: { id: string; nombre: string; cuenta: string | null }[]
  nombres: Readonly<Record<string, string>>
  cuentasDiferencia: CuentasDiferencia
  ocupado: boolean
  alConfirmarPropuesta: () => void
  alConfirmar: (destino: Destino, porque: string, que: string) => void
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

  // El destino que se enseña en «Ver el asiento que se crea»: lo que está elegido, o lo que propongo.
  const destinoVisto: Destino | null = reparto && !reparto.noSePuede ? destinoDelReparto(fs, reparto) : ((m.propuesta?.destino as Destino | null | undefined) ?? null)
  const lineas = destinoVisto ? asientoQueSeCrea(m, destinoVisto, p.cuenta572) : null
  const origen = m.propuesta?.origen ? PILDORA[m.propuesta.origen] ?? null : null

  const alternarFactura = (id: string) => setElegidas((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]))

  return (
    <aside className="cxc-panel" aria-label={`El movimiento de ${quienEs(m)}`}>
      <div className="cxc-panel-cabeza">
        <div>
          <h3>{quienEs(m)}</h3>
          <span className="cx-ayuda">{diaMesCorto(m.fecha)}{m.tipo ? ` · ${m.tipo}` : ''}</span>
        </div>
        <span className={`cxc-panel-importe${m.importeCent > 0 ? ' cxb-entra' : ''}`}>{eurosExactos(m.importeCent / 100)}</span>
        <button type="button" className="cxc-cerrar" onClick={p.alCerrar} aria-label="Cerrar el panel">×</button>
      </div>

      <section className="cxc-bloque" aria-label="Lo que dice el banco">
        <h4>Lo que dice el banco, tal cual</h4>
        <p className="cxc-banco-literal">{textoDelBanco(m) || '—'}</p>
      </section>

      {m.estado === 'casado' && m.casado && (
        <section className="cxc-bloque" aria-label="Casado">
          <h4>{m.casado.porQuien === 'folvy' ? 'Lo casé yo' : 'Lo casaste tú'}</h4>
          <p><strong>{m.casado.asientoConcepto ?? m.propuesta?.que ?? 'Casado'}</strong></p>
          <p className="cx-ayuda">{m.casado.porque}</p>
          <div className="cxc-acciones">
            {m.casado.asientoId && <button type="button" className="cx-boton-sec" onClick={p.alVerAsiento}>Abrir el asiento</button>}
            <button type="button" className="cx-boton-sec" disabled={p.ocupado} onClick={p.alDeshacer}>{p.ocupado ? 'Deshaciendo…' : 'Deshacer'}</button>
          </div>
        </section>
      )}

      {sinCasar && m.propuesta?.que && (
        <section className="cxc-bloque" aria-label="Lo que propongo">
          <h4>Lo que propongo</h4>
          <p className="cxc-propuesta">
            {origen && <span className="cxc-pildora">{origen}</span>}
            <strong>{m.propuesta.que}</strong>
          </p>
          {m.porque && <p className="cx-ayuda">{m.porque}</p>}
          {m.propuesta.facturaSinAprobar && <p className="cxc-ambar-texto">Factura sin aprobar: confirmar el pago no la aprueba.</p>}
          {(m.propuesta.alternativas ?? []).length > 0 && (
            <div className="cxc-acciones">
              {m.propuesta.alternativas!.map((a) => (
                <button key={a.etiqueta} type="button" className="cx-boton-sec" disabled={p.ocupado}
                  onClick={() => p.alConfirmar(a.destino as unknown as Destino, `Lo dijiste tú: ${a.etiqueta}.`, a.etiqueta)}>{a.etiqueta}</button>
              ))}
            </div>
          )}
          {confirmable(m) && !reparto && (
            <div className="cxc-acciones"><button type="button" className="cx-boton" disabled={p.ocupado} onClick={p.alConfirmarPropuesta}>{p.ocupado ? 'Confirmando…' : 'Sí, es esto'}</button></div>
          )}
        </section>
      )}

      {sinCasar && pago && (
        <section className="cxc-bloque" aria-label="Facturas pendientes">
          <h4>{lista.length ? `Facturas pendientes de ${lista[0].proveedor}` : 'Facturas pendientes'}</h4>
          {lista.length === 0 && <p className="cx-ayuda">No encuentro facturas sin pagar de {quienEs(m)}.</p>}
          <ul className="cxc-facturas">
            {lista.map((f) => {
              const r = reparto?.facturas.find((x) => x.id === f.id)
              return (
                <li key={f.id}>
                  <label className="cxb-check">
                    <input type="checkbox" checked={elegidas.includes(f.id)} onChange={() => alternarFactura(f.id)} />
                    <span>
                      <strong>{f.numero ?? 'Sin número'}</strong> <span className="cx-ayuda">del {diaMesCorto(f.fecha)}</span>
                      {f.enRevision && <span className="cxc-pildora cxc-pildora-ambar">sin aprobar</span>}
                      <span className="cx-ayuda cxc-factura-pie">
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
            <div className="cxc-queda" role="status">
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
          {reparto?.noSePuede && <p className="cxc-ambar-texto">{reparto.noSePuede}</p>}
          <div className="cxc-acciones">
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
        <details className="cxc-bloque cxc-otra-cosa">
          <summary>¿Es otra cosa?</summary>
          <div className="cxc-acciones cxc-acciones-columna">
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
        <details className="cxc-bloque">
          <summary>Ver el asiento que se crea</summary>
          <table className="cxc-asiento">
            <thead><tr><th>Cuenta</th><th className="cxb-der">Debe</th><th className="cxb-der">Haber</th></tr></thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td>{cuentaLegible(p.nombres, l.cuenta)}</td>
                  <td className="cx-cifra cxb-der">{l.debeCent ? eurosExactos(l.debeCent / 100) : ''}</td>
                  <td className="cx-cifra cxb-der">{l.haberCent ? eurosExactos(l.haberCent / 100) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="cx-ayuda">Queda propuesto en contabilidad: lo validas allí o se valida solo si es seguro.</p>
        </details>
      )}
    </aside>
  )
}
