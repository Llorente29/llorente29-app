// src/modules/conta/gestoria/r21/FacturarMes.tsx
//
// R21 · «Facturar el mes», fiel a la maqueta aprobada (versión 1795798209-d437). Pinta, no lee nada: así se prueba y se
// captura con datos inventados. Los datos y los botones los pone pagina.tsx, con los servicios de hoy.
//   · Arriba, siempre: «Pendientes: N», que abre su lista (mes, cliente, importe, motivo y «Resolver»).
//   · Cinco pasos en orden. Uno solo activo, con un solo botón principal; los que faltan, en gris; los hechos, en verde
//     con su resultado en una línea.

import { useState, type ReactNode } from 'react'
import { euros, mesLargo, type Caso, type Cuadre, type Pasos, type SerieCegid } from '../../../../../supabase/functions/_shared/factura/facturarMes'
import type { Accion } from './armar'

export type Tono = 'trabajando' | 'bien' | 'mal'
export interface Frase { estado: Tono; frase: string }

export interface CasoVista extends Caso {
  acciones: Accion[]
  /** Lo que pasó al pulsar (verde) o por qué está en Pendientes (naranja). */
  hecho: string | null
  /** Resuelto en esta visita: ✓ con su frase, sin botones. */
  resuelto: boolean
  /** «Deshacer» solo donde se puede deshacer de verdad (lo dejado para después en esta pantalla). */
  deshacer: boolean
  /** Para «Otro concepto», «Buscar el cliente» y «Es otro cliente»: lo que se escribe a mano. */
  aMano: 'concepto' | 'cliente' | 'concepto_cliente' | null
}

export interface PendienteVista { clave: string; mes: string; cliente: string | null; importeCent: number; motivo: string }

export interface PropsFacturarMes {
  empresa: string
  mes: string
  meses: readonly { valor: string; texto: string }[]
  alCambiarMes: (m: string) => void
  pasos: Pasos
  /** Paso 1. */
  preparar: { frase: Frase | null; alPulsar: () => void }
  /** Paso 2. */
  casos: readonly CasoVista[]
  ocupado: string | null
  frases: Readonly<Record<string, Frase>>
  conceptos: readonly { codigo: string; nombre: string }[]
  alAccion: (clave: string, accion: Accion, aMano?: { concepto?: string; cliente?: number }) => void
  alDeshacer: (clave: string) => void
  alDejarTodos: () => void
  /** Paso 3. */
  cuadre: Cuadre
  mandar: { cobros: number; frase: Frase | null; alPulsar: () => void }
  /** Paso 4. */
  serie1: SerieCegid | null
  vistoBueno: Frase | null
  alCoincide: () => void
  /** Paso 5. */
  serie3: SerieCegid | null
  contasimple: { cuotas: number; cent: number; frase: Frase | null; alPulsar: () => void }
  comprobar: { frase: Frase | null; faltan: readonly { cliente: number; nombre: string | null; serie: string; totalCent: number }[] | null; alPulsar: () => void }
  pendientes: readonly PendienteVista[]
  alResolverPendiente: (clave: string) => void
}

const TITULOS = ['Preparar el mes', 'Resolver lo pendiente', 'Mandar a Cegid', 'Precalcular en Cegid y pedir el visto bueno', 'Generar las facturas']
const EXPLICA = [
  'Sumied lo lee todo solo: lo cobrado por GoCardless, el banco y la tarjeta, y los clientes y facturas de Cegid. Lo hace cada noche; este botón es para tenerlo al minuto.',
  'Solo lo que Sumied no puede decidir solo, incluidas las fichas de Cegid a las que les falta algo para emitir. Cada caso tiene su botón. Si uno no se puede resolver ahora, «Dejar para después» lo guarda en Pendientes y se sigue facturando el resto.',
  'Escribe en Cegid una línea por cada cobro. Todavía no es una factura. Solo se puede mandar si el cuadre da 0 €.',
  'Cegid calcula las facturas sin hacerlas. Comprueba que su total es el de Sumied y manda el listado a QBO.',
  'Cuando QBO da el visto bueno, Cegid emite las facturas con Verifactu. Primero la serie 1 y después Contasimple, en la serie 3. Sumied comprueba después que están todas.',
]
const n = (x: number, uno: string, varios: string) => `${x.toLocaleString('es-ES')} ${x === 1 ? uno : varios}`
const mesCorto = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`
const linea = (f: Frase | null, prueba: string) => f && <p className="r21-frase" data-prueba={prueba} data-tono={f.estado === 'trabajando' ? undefined : f.estado} role="status">{f.frase}</p>

export function FacturarMes(p: PropsFacturarMes) {
  const [verPendientes, setVerPendientes] = useState(false)
  const [abiertoPaso2, setAbiertoPaso2] = useState(false)
  const [noCoincide, setNoCoincide] = useState(false)
  const [aMano, setAMano] = useState<Record<string, { concepto: string; cliente: string }>>({})
  const { pasos, actual } = p.pasos
  const hechos = pasos.filter((x) => x.hecho).length
  const nombreMes = mesLargo(p.mes).split(' de ')[0].toLowerCase()
  const mesNum = Number(p.mes.slice(5, 7))
  const anio = p.mes.slice(0, 4)
  const quedan = p.pasos.porResolver
  const ocupado = p.ocupado !== null

  const tarjeta = (c: CasoVista) => {
    const f = p.frases[c.clave]
    const escrito = aMano[c.clave] ?? { concepto: '', cliente: '' }
    const abierto = !c.resuelto
    return (
      <div key={c.clave} id={`r21-caso-${c.clave}`} className="r21-caso" data-prueba="caso" data-clave={c.clave} data-tipo={c.tipo} data-estado={c.resuelto ? 'resuelto' : c.estado}>
        <div className="r21-tipo" data-antes={c.deMesAnterior ? 'si' : undefined}>{c.deMesAnterior && c.pendiente ? `De ${mesLargo(c.pendiente.mes).toLowerCase()} · ` : ''}{c.tipoTexto}</div>
        <div className="r21-caso-titulo">{c.frase}</div>
        {abierto && c.estado === 'por_resolver' && c.propuesta && <div className="r21-propuesta" data-prueba="propuesta"><strong>Sumied propone:</strong> {c.propuesta}</div>}
        {abierto && c.estado === 'por_resolver' && !c.propuesta && c.falta && <div className="r21-falta" data-prueba="falta">{c.falta}</div>}
        {c.hecho && (
          <div className="r21-hecho" data-prueba="caso-hecho">{c.resuelto ? '✓' : '⏸'} {c.hecho}
            {c.deshacer && <button type="button" className="r21-deshacer" disabled={ocupado} onClick={() => p.alDeshacer(c.clave)}>Deshacer</button>}</div>
        )}
        {abierto && c.aMano && (
          <div className="r21-elegir">
            {(c.aMano === 'concepto' || c.aMano === 'concepto_cliente') && (
              <select aria-label="Concepto de Cegid" value={escrito.concepto} disabled={ocupado} onChange={(e) => setAMano((m) => ({ ...m, [c.clave]: { ...escrito, concepto: e.target.value } }))}>
                <option value="">Concepto de Cegid…</option>
                {p.conceptos.map((o) => <option key={o.codigo} value={o.codigo}>{o.codigo} · {o.nombre}</option>)}
              </select>
            )}
            {(c.aMano === 'cliente' || c.aMano === 'concepto_cliente') && (
              <input aria-label="Cliente de Cegid" inputMode="numeric" size={8} placeholder="Cliente de Cegid" value={escrito.cliente} disabled={ocupado}
                onChange={(e) => setAMano((m) => ({ ...m, [c.clave]: { ...escrito, cliente: e.target.value.replace(/\D/g, '') } }))} />
            )}
          </div>
        )}
        {abierto && (
          <div className="r21-acciones">
            {c.acciones.filter((a) => !(c.estado === 'pendiente' && a.efecto.que === 'dejar')).map((a) => (
              <button key={a.id} type="button" className="r21-accion" data-principal={a.principal ? 'si' : undefined} disabled={ocupado}
                onClick={() => p.alAccion(c.clave, a, { concepto: escrito.concepto || undefined, cliente: escrito.cliente ? Number(escrito.cliente) : undefined })}>{a.texto}</button>
            ))}
          </div>
        )}
        {linea(f ?? null, 'caso-frase')}
      </div>
    )
  }

  const cuerpo: Record<number, ReactNode> = {
    1: (
      <>
        {linea(p.preparar.frase, 'preparar-frase')}
        <div className="r21-botones"><button type="button" className="r21-boton" disabled={p.preparar.frase?.estado === 'trabajando'} onClick={p.preparar.alPulsar}>Preparar {nombreMes}</button></div>
      </>
    ),
    2: (
      <>
        <div className="r21-casos" data-prueba="casos">
          {p.casos.map(tarjeta)}
          <div className="r21-quedan" data-prueba="quedan">{quedan ? `Quedan ${n(quedan, 'caso', 'casos')} por resolver.` : 'No queda nada por resolver.'}</div>
        </div>
        {quedan > 0 && (
          <div className="r21-botones">
            <button type="button" className="r21-boton" data-tipo="dejar" disabled={ocupado} onClick={p.alDejarTodos}>Dejar {quedan === 1 ? 'el 1' : `los ${quedan}`} para después y seguir</button>
            <span className="r21-nota">O resuélvelos uno a uno. Lo que se deja para después no entra en esta factura.</span>
          </div>
        )}
      </>
    ),
    3: (
      <>
        <div className="r21-cuadre" data-prueba="cuadre">
          <div><span>Cobrado de clientes en el mes (GoCardless, banco y tarjeta)</span><strong>{euros(p.cuadre.cobradoCent)}</strong></div>
          <div><span>{p.mandar.cobros > 0 ? '− Se manda a Cegid' : '− Mandado a Cegid'}</span><span>{euros(p.cuadre.mandadoCent)}</span></div>
          <div><span>− Paga facturas que ya existían</span><span>{euros(p.cuadre.pagaFacturasCent)}</span></div>
          <div><span>− Pendientes: fuera de esta factura hasta resolverlos</span><span>{euros(p.cuadre.pendientesCent)}</span></div>
          <div className="r21-diferencia" data-cuadra={p.cuadre.cuadra ? 'si' : 'no'} data-prueba="diferencia"><span>Diferencia</span><span>{euros(p.cuadre.diferenciaCent)}</span></div>
        </div>
        {!p.cuadre.cuadra && <p className="r21-frase" data-tono="mal">Hasta que la diferencia sea 0,00 €, no se manda nada: resuelve o deja para después lo que falta en el paso 2.</p>}
        {linea(p.mandar.frase, 'mandar-frase')}
        <div className="r21-botones">
          <button type="button" className="r21-boton" data-prueba="mandar" disabled={!p.pasos.puedeMandar || p.mandar.frase?.estado === 'trabajando'} onClick={p.mandar.alPulsar}>
            Mandar {n(p.mandar.cobros, 'cobro', 'cobros')} a Cegid</button>
        </div>
      </>
    ),
    4: (
      <>
        <ol className="r21-instrucciones">
          <li>En Cegid, abre <strong>Facturación › Automática</strong>.</li>
          <li>Pon <strong>Mes {mesNum}</strong>, <strong>Año {anio}</strong> y <strong>Serie 1</strong>. Deja el cliente vacío.</li>
          <li>Pulsa <strong>Precalcular facturación</strong>. Tarda unos 4 minutos. <span className="r21-nunca">Nunca «Generar».</span></li>
          <li>Pulsa <strong>Listado precálculo</strong> y guárdalo en PDF.</li>
        </ol>
        <div className="r21-cifra-caja">
          <div>Arriba, en «Total facturación», Cegid tiene que darte exactamente:</div>
          <div className="r21-cifra" data-prueba="cifra-cegid">{p.serie1 ? `${euros(p.serie1.totalCent)} · ${n(p.serie1.facturas, 'factura', 'facturas')}` : '—'}</div>
          <div className="r21-cifra-nota">Si sale otra cifra, no sigas: pulsa «No coincide» y Sumied te enseña lo mandado cliente a cliente.</div>
        </div>
        {noCoincide && p.serie1 && (
          <div className="r21-tabla-caja" data-prueba="no-coincide">
            <p className="r21-frase">Lo mandado a Cegid en la serie 1, cliente a cliente: busca en el listado de Cegid el que falta o da otra cifra. Lo que Sumied no ve de la ficha de Cegid (la provincia, el periodo de facturación y la forma de pago) puede dejar a un cliente fuera del precálculo.</p>
            <table className="r21-tabla" aria-label="Lo mandado a Cegid, cliente a cliente">
              <thead><tr><th>Cliente de Cegid</th><th>Nombre</th><th className="r21-num">Líneas</th><th className="r21-num">Total</th></tr></thead>
              <tbody>{p.serie1.porCliente.map((c) => <tr key={c.cliente}><td>{c.cliente}</td><td>{c.nombre ?? '—'}</td><td className="r21-num">{c.lineas}</td><td className="r21-num">{euros(c.totalCent)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {linea(p.vistoBueno, 'visto-bueno')}
        <div className="r21-botones">
          <button type="button" className="r21-boton" data-prueba="coincide" disabled={!p.serie1} onClick={p.alCoincide}>Coincide: mandar el listado a QBO</button>
          <button type="button" className="r21-boton" data-tipo="otro" disabled={!p.serie1} onClick={() => setNoCoincide((x) => !x)}>No coincide</button>
        </div>
      </>
    ),
    5: (
      <>
        <div className="r21-aviso-rojo">Solo con el visto bueno de QBO.</div>
        <ol className="r21-instrucciones">
          <li>En Cegid, <strong>Facturación › Automática</strong>, mes {mesNum}, serie 1: <strong>Precalcular</strong> y después <strong>Generar facturación</strong>.</li>
          <li>Vuelve aquí y pulsa <strong>Mandar Contasimple</strong>: {n(p.contasimple.cuotas, 'cuota', 'cuotas')}, {euros(p.contasimple.cent)}.</li>
          <li>En Cegid, lo mismo con la <strong>serie 3</strong>: Precalcular y Generar.</li>
        </ol>
        {linea(p.contasimple.frase, 'contasimple-frase')}
        {linea(p.comprobar.frase, 'comprobar-frase')}
        {p.comprobar.faltan && p.comprobar.faltan.length > 0 && (
          <div className="r21-tabla-caja" data-prueba="faltan">
            <table className="r21-tabla" aria-label="Facturas que faltan en Cegid">
              <thead><tr><th>Serie</th><th>Cliente de Cegid</th><th>Nombre</th><th className="r21-num">Total</th></tr></thead>
              <tbody>{p.comprobar.faltan.map((c) => <tr key={`${c.serie}-${c.cliente}`}><td>{c.serie}</td><td>{c.cliente}</td><td>{c.nombre ?? '—'}</td><td className="r21-num">{euros(c.totalCent)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        <div className="r21-botones">
          <button type="button" className="r21-boton" data-prueba="comprobar" disabled={p.comprobar.frase?.estado === 'trabajando'} onClick={p.comprobar.alPulsar}>Hecho: facturas generadas</button>
          {p.contasimple.cuotas > 0 && (
            <button type="button" className="r21-boton" data-tipo="otro" disabled={p.contasimple.frase?.estado === 'trabajando'} onClick={p.contasimple.alPulsar}>Mandar Contasimple</button>
          )}
        </div>
      </>
    ),
  }

  return (
    <div className="r21" data-pantalla="facturar-mes">
      <div className="r21-arriba">
        <span>Clientes › Facturar el mes · {p.empresa}</span>
        <button type="button" className="r21-pendientes" data-prueba="pendientes" aria-expanded={verPendientes} onClick={() => setVerPendientes((x) => !x)}>Pendientes: {p.pendientes.length}</button>
      </div>
      {verPendientes && (
        <div className="r21-lista-pendientes" data-prueba="lista-pendientes">
          <h2>Pendientes</h2>
          {p.pendientes.length === 0 ? <p className="r21-nota">No hay nada pendiente.</p> : (
            <table>
              <thead><tr><th>Mes</th><th>Cliente</th><th className="r21-num">Importe</th><th>Motivo</th><th /></tr></thead>
              <tbody>
                {p.pendientes.map((x) => (
                  <tr key={x.clave}><td>{mesCorto(x.mes)}</td><td>{x.cliente ?? '—'}</td><td className="r21-num">{euros(x.importeCent)}</td><td>{x.motivo}</td>
                    <td><button type="button" className="r21-accion" onClick={() => { setAbiertoPaso2(true); setVerPendientes(false); p.alResolverPendiente(x.clave) }}>Resolver</button></td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <div className="r21-titulo-fila">
        <h1 className="r21-titulo">Facturar {mesLargo(p.mes).toLowerCase()}</h1>
        <label className="r21-mes">Mes
          <select value={p.mes} onChange={(e) => p.alCambiarMes(e.target.value)}>{p.meses.map((m) => <option key={m.valor} value={m.valor}>{m.texto}</option>)}</select>
        </label>
      </div>
      <p className="r21-intro">Sigue los pasos en orden. Cada paso tiene un solo botón. Mientras un paso no esté hecho, el siguiente no se abre. <strong>Solo se factura lo cobrado.</strong></p>

      <div className="r21-progreso">
        <div className="r21-progreso-textos"><span data-prueba="paso-visible">Paso {Math.min(actual, 5)} de 5</span><span>{hechos} hechos</span></div>
        <div className="r21-barra"><div style={{ width: `${hechos * 20}%` }} /></div>
      </div>

      <div className="r21-pasos">
        {pasos.map((x, i) => {
          const abierto = x.activo || (x.numero === 2 && abiertoPaso2)
          return (
            <section key={x.numero} className="r21-paso" data-prueba={`paso-${x.numero}`} data-activo={x.activo ? 'si' : undefined} data-hecho={x.hecho ? 'si' : undefined}
              data-falta={!x.hecho && !x.activo ? 'si' : undefined} aria-labelledby={`r21-paso-${x.numero}`}>
              <div className="r21-paso-fila">
                <div className="r21-circulo" aria-hidden="true">{x.hecho ? '✓' : x.numero}</div>
                <div className="r21-paso-cuerpo">
                  <h2 id={`r21-paso-${x.numero}`}>{TITULOS[i]}</h2>
                  <p className="r21-explica">{EXPLICA[i]}</p>
                  {x.hecho && x.resultado && <div className="r21-resultado" data-prueba="resultado">✓ {x.resultado}</div>}
                  {x.hecho && x.numero === 2 && !abiertoPaso2 && p.casos.length > 0 && (
                    <div className="r21-botones"><button type="button" className="r21-boton" data-tipo="otro" onClick={() => setAbiertoPaso2(true)}>Ver los {p.casos.length} casos</button></div>
                  )}
                  {abierto && cuerpo[x.numero]}
                </div>
              </div>
            </section>
          )
        })}
      </div>

      {actual === 6 && (
        <div className="r21-fin" data-prueba="fin">
          <div>{mesLargo(p.mes).replace(/ de \d+$/, '')} facturado</div>
          <div>{p.serie1 && p.serie3 ? `${n(p.serie1.facturas + p.serie3.facturas, 'factura emitida', 'facturas emitidas')} con Verifactu: ${p.serie1.facturas} de la serie 1 y ${p.serie3.facturas} de Contasimple (serie 3). Lo no cobrado queda en «Te deben».` : ''}</div>
          <div>{p.pendientes.length ? `Quedan ${n(p.pendientes.length, 'pendiente', 'pendientes')}. Al preparar el mes siguiente salen los primeros.` : 'No queda nada pendiente.'}</div>
        </div>
      )}
    </div>
  )
}
