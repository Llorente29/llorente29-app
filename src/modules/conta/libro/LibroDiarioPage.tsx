// src/modules/conta/libro/LibroDiarioPage.tsx
//
// C04 · Libros › Libro diario (maqueta N11Diario). Arriba, los filtros por
// origen (solo los que la empresa tiene, con cuántos), las cuatro cifras del
// mes y, si el mes está cerrado, la franja con «Pedir desbloqueo». Debajo, el
// diario: cada asiento en una fila que se despliega en sus apuntes, con su
// estado (Para revisar ámbar, Hecho por Folvy verde, Validado, Borrador,
// Anulado gris). A la derecha, «Lo que he hecho yo» (con Deshacer) y el cierre
// del mes anterior. En el móvil, por niveles: la lista y, al tocar, el asiento.
//
// Regla 7: «Todos» enseña todo, también lo anulado. Regla 8: cada botón dice lo
// que ha hecho, con contenido («Validado: Ventas nº 1.287»).

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { rutaAsiento, rutaMayor, rutaNuevoAsiento } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useIsMobile } from '@/shell/useIsMobile'
import { Dialogo, Migas } from '@/modules/conta/proveedor/piezas'
import { Chip, ErrorConReintento, Guardado, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { diaMesCorto, eurosExactos, euros, hoyEnMadrid } from '@/modules/conta/lib/formato'
import {
  cifras, deDondeSale, estadoDe, filtrar, filtrosVisibles, importe, loQueHeHechoYo, mesAnterior, mesDe, nombreMes, numeroVisible,
  pasosCierre, pastillas, sePuedeCerrar, type AsientoDiario, type CierreMes, type FiltroDiario, type FuenteCierre,
} from '@/modules/conta/lib/diario'
import { NOMBRE_SERIE } from '@/modules/conta/lib/libro'
import {
  anular, cerrarMes, fuenteCierre, horaDeCierre, leerAsientos, leerCierres, leerEjercicios, localesDeLaCuenta, reabrirMes, resultadoDelMes,
  type EjercicioLibro,
} from '@/modules/conta/services/diarioService'
import { proponerPendientes, type ResultadoProponer } from '@/modules/conta/services/propuestasLibroService'
import { fijarCorte, primeraVenta } from '@/modules/conta/services/corteService'
import { corteDesdeRespuesta, rangoAProponer } from '@/modules/conta/lib/proponer'
import { ultimoDiaCerrado } from '@/modules/conta/lib/cierreDelDia'
import { TonoChip } from '@/modules/conta/libro/piezasLibro'

interface DatosLibro {
  ejercicios: EjercicioLibro[]
  ejercicio: EjercicioLibro | null
  asientos: AsientoDiario[]
  cierres: CierreMes[]
  mes: string
  resultado: { total: number; porLocal: { nombre: string; resultado: number }[] } | null
  /** Si el resultado no se ha podido calcular, por qué (la página sigue: es una cifra, no el libro). */
  resultadoError: string | null
  cierre: FuenteCierre | null
}

function useLibro(accountId: string | null, companyId: string | null, codigo: string | null, vuelta: number) {
  const [r, setR] = useState<{ clave: string; datos: DatosLibro | null; error: string | null }>({ clave: '', datos: null, error: null })
  const clave = `${accountId}:${companyId}:${codigo}:${vuelta}`
  useEffect(() => {
    if (!accountId || !companyId) return
    let vivo = true
    ;(async () => {
      const [ejercicios, cierres, locales] = await Promise.all([leerEjercicios(accountId, companyId), leerCierres(accountId, companyId), localesDeLaCuenta(accountId)])
      const hoy = hoyEnMadrid()
      const ejercicio = ejercicios.find((e) => e.code === codigo) ?? ejercicios.find((e) => hoy >= e.inicio && hoy <= e.fin) ?? ejercicios[0] ?? null
      if (!ejercicio) return { ejercicios, ejercicio, asientos: [], cierres, mes: mesDe(hoy), resultado: null, resultadoError: null, cierre: null }
      const mes = hoy >= ejercicio.inicio && hoy <= ejercicio.fin ? mesDe(hoy) : mesDe(ejercicio.fin)
      const asientos = await leerAsientos(accountId, companyId, ejercicio.inicio, ejercicio.fin)
      const anterior = mesAnterior(mes)
      let resultadoError: string | null = null
      const [resultado, cierre] = await Promise.all([
        resultadoDelMes(companyId, mes, locales).catch((e: unknown) => { resultadoError = e instanceof Error ? e.message : String(e); return null }),
        anterior >= ejercicio.inicio ? fuenteCierre(accountId, companyId, anterior, asientos, cierres.some((c) => c.mes === anterior)) : Promise.resolve(null),
      ])
      return { ejercicios, ejercicio, asientos, cierres, mes, resultado, resultadoError, cierre }
    })().then((datos) => { if (vivo) setR({ clave, datos, error: null }) },
      (e: unknown) => { if (vivo) setR({ clave, datos: null, error: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false }
  }, [accountId, companyId, codigo, clave])
  return r.clave === clave ? r : { clave, datos: null, error: null }
}

export default function LibroDiarioPage() {
  const { accountId, cargando, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const movil = useIsMobile()
  const navegar = useNavigate()
  const [params, setParams] = useSearchParams()
  const [vuelta, setVuelta] = useState(0)
  const recargar = () => setVuelta((v) => v + 1)
  const { datos, error } = useLibro(cargando ? null : accountId, activa?.id ?? null, params.get('ejercicio'), vuelta)
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [proponiendo, setProponiendo] = useState(false)
  const [sinPropuesta, setSinPropuesta] = useState<ResultadoProponer['sinPropuesta']>([])
  const [desbloqueo, setDesbloqueo] = useState(false)

  const visibles = useMemo(() => (datos ? filtrosVisibles(datos.asientos) : []), [datos])
  const pedido = params.get('ver') as FiltroDiario | null
  const filtro: FiltroDiario = visibles.some((f) => f.id === pedido) ? pedido! : 'todos'
  const lista = useMemo(() => (datos ? filtrar(datos.asientos, filtro) : []), [datos, filtro])
  const c = datos ? cifras(datos.asientos, datos.mes, datos.cierres, datos.resultado) : null
  const hechos = datos ? loQueHeHechoYo(datos.asientos) : []
  const cambiarFiltro = (f: FiltroDiario) => {
    const p = new URLSearchParams(params)
    if (f === 'todos') p.delete('ver'); else p.set('ver', f)
    setParams(p, { replace: true })
  }

  // Respuesta 4: el corte manda (nada ≤ imported_until), sin corte y con ventas
  // de antes del ejercicio se pregunta primero, y cada vez un mes de ventas del
  // más reciente hacia atrás, diciendo cuántos días quedan.
  const [pregunta, setPregunta] = useState<{ porque: string; desde: string; programa: string; fallo: string | null } | null>(null)

  async function proponer() {
    if (!accountId || !activa || !datos?.ejercicio) return
    setFallo(null); setHecho(null); setProponiendo(true)
    try {
      const e = datos.ejercicio
      // Hasta el último día CERRADO, no hasta hoy: un día no se propone antes
      // de su hora de cierre (las 6:00 de serie, ajuste de la empresa).
      const cerrado = ultimoDiaCerrado(new Date(), await horaDeCierre(accountId, activa.id))
      const rango = rangoAProponer(e, cerrado, { primeraVenta: await primeraVenta(accountId), asientosEnEjercicio: datos.asientos.length })
      if (rango.tipo === 'nada') { setHecho(rango.porque); return }
      if (rango.tipo === 'preguntar') { setPregunta({ porque: rango.porque, desde: '', programa: '', fallo: null }); return }
      const { desde, hasta } = rango
      const r = await proponerPendientes(accountId, activa.id, desde, hasta, userName)
      setSinPropuesta(r.sinPropuesta)
      const partes = [`${r.propuestas} ${r.propuestas === 1 ? 'asiento propuesto' : 'asientos propuestos'}`]
      if (r.validadasSolas) partes.push(`${r.validadasSolas} validados solos (los Seguros de ventas, como tienes elegido)`)
      if (r.yaEstaban) partes.push(`${r.yaEstaban} ya estaban`)
      if (r.descartadas) partes.push(`${r.descartadas} descartados antes, que no vuelvo a proponer`)
      if (r.sinPropuesta.length) partes.push(`${r.sinPropuesta.length} sin propuesta (debajo, por qué)`)
      const ventas = r.mesVentas ? ` Ventas de ${nombreMes(r.mesVentas)}.` : ''
      const quedan = r.quedanDias > 0
        ? ` Quedan ${r.quedanDias.toLocaleString('es-ES')} ${r.quedanDias === 1 ? 'día' : 'días'} de ventas más antiguos por proponer: vuelve a pulsar.`
        : ' No queda ningún día de ventas por proponer.'
      setHecho(`Repasado del ${diaMesCorto(desde)} al ${diaMesCorto(hasta)}${e.traidoHasta ? ` (hasta el ${diaMesCorto(e.traidoHasta)} lo trae el programa anterior)` : ''}: ${partes.join(' · ')}.${ventas}${quedan}`)
      recargar()
    } catch (e) { setFallo(e instanceof Error ? e.message : 'No se ha podido proponer.') }
    finally { setProponiendo(false) }
  }

  async function contestar() {
    if (!activa || !datos?.ejercicio || !pregunta) return
    const r = corteDesdeRespuesta(datos.ejercicio, pregunta.desde, hoyEnMadrid())
    if ('error' in r) { setPregunta({ ...pregunta, fallo: r.error }); return }
    try {
      await fijarCorte(activa.id, r.corte, pregunta.programa.trim() || 'el programa anterior')
      setPregunta(null)
      setHecho(r.corte ? `Guardado: Folvy asienta desde el ${diaMesCorto(pregunta.desde)}; lo de antes lo trae el programa anterior.` : 'Guardado: Folvy asienta el ejercicio entero.')
      recargar()
    } catch (e) { setPregunta({ ...pregunta, fallo: e instanceof Error ? e.message : 'No se ha podido guardar.' }) }
  }

  async function deshacer(id: string) {
    const a = datos?.asientos.find((x) => x.id === id)
    if (!a) return
    setFallo(null); setHecho(null)
    try {
      const r = await anular(id, 'Deshecho desde «Lo que he hecho yo»', null, userName)
      setHecho(`Deshecho: «${a.concepto}» queda anulado con el contraasiento ${NOMBRE_SERIE[r.serie as 1]} nº ${r.numero.toLocaleString('es-ES')} del ${diaMesCorto(r.fecha)}. Vuelve a salir para proponer.`)
      recargar()
    } catch (e) { setFallo(e instanceof Error ? e.message : 'No se ha podido deshacer.') }
  }

  if (!accountId && !cargando) return <Vacio titulo="No hay cuenta activa." explicacion="Elige una cuenta para ver su libro." />

  const mesCerrado = c?.mes.cerrado ? c.mes : null
  return (
    <div className="cxd-pagina">
      <header className="cxp-cabecera cxd-cabecera">
        <div className="cxp-titulos">
          <Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Libro diario' }]} />
          <h1 className="cxp-nombre">Libro diario</h1>
        </div>
        <div className="cxd-acciones">
          {datos && datos.ejercicios.length > 0 && (
            <label className="cxd-ejercicio">
              <span className="cx-oculto">Ejercicio</span>
              <select className="cx-input" value={datos.ejercicio?.code ?? ''} onChange={(e) => { const p = new URLSearchParams(params); p.set('ejercicio', e.target.value); setParams(p, { replace: true }) }}>
                {datos.ejercicios.map((e) => <option key={e.id} value={e.code}>Ejercicio {e.code}</option>)}
              </select>
            </label>
          )}
          <button type="button" className="cx-boton-sec" onClick={proponer} disabled={proponiendo || !datos?.ejercicio}>
            {proponiendo ? 'Repasando…' : 'Proponer lo pendiente'}
          </button>
          <button type="button" className="cx-boton" onClick={() => navegar(rutaNuevoAsiento())} disabled={!datos?.ejercicio}>+ Nuevo asiento</button>
        </div>
      </header>
      <Guardado texto={hecho} />
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      {pregunta && (
        <section className="cx-tarjeta" aria-label="Desde qué día asienta Folvy">
          <div className="cx-tarjeta-cabeza"><h2 className="cx-tarjeta-titulo">¿Desde qué día asienta Folvy?</h2></div>
          <p className="cx-ayuda" style={{ marginTop: 0 }}>{pregunta.porque} Lo de antes de ese día no lo propongo: lo trae el programa anterior. Se puede cambiar en Ajustes › Ejercicio.</p>
          <form className="cx-rejilla-2" onSubmit={(ev) => { ev.preventDefault(); void contestar() }}>
            <label className="cx-campo"><span className="cx-etiqueta">Desde el día</span>
              <input className="cx-input" type="date" value={pregunta.desde} onChange={(ev) => setPregunta({ ...pregunta, desde: ev.target.value, fallo: null })} /></label>
            <label className="cx-campo"><span className="cx-etiqueta">Programa anterior</span>
              <input className="cx-input" value={pregunta.programa} placeholder="Diez, A3, Sage…" onChange={(ev) => setPregunta({ ...pregunta, programa: ev.target.value })} /></label>
            <div className="cx-pie">
              <button type="button" className="cx-boton-sec" onClick={() => setPregunta(null)}>Ahora no</button>
              <button type="submit" className="cx-boton">Guardar</button>
            </div>
          </form>
          {pregunta.fallo && <div className="cx-error" role="alert">{pregunta.fallo}</div>}
        </section>
      )}
      {sinPropuesta.length > 0 && (
        <section className="cx-tarjeta cxd-sin-propuesta" aria-label="Lo que no he propuesto">
          <div className="cx-tarjeta-cabeza"><h2 className="cx-tarjeta-titulo">Lo que no he propuesto, y por qué</h2>
            <button type="button" className="cx-enlace" onClick={() => setSinPropuesta([])}>Entendido</button></div>
          <ul>{sinPropuesta.map((x, i) => <li key={i}><strong>{x.que}</strong> · {x.porque}</li>)}</ul>
        </section>
      )}

      {error && <ErrorConReintento mensaje={error} reintentar={recargar} />}
      {!error && !datos && (
        <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando el libro" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[0, 1, 2, 3, 4].map((i) => <Hueso key={i} alto={44} />)}
        </div>
      )}
      {datos && !datos.ejercicio && (
        <div className="cx-tarjeta"><Vacio titulo="Aún no hay ningún ejercicio abierto." explicacion="Ábrelo en Ajustes › Ejercicio y el libro empieza a llenarse." /></div>
      )}

      {datos?.ejercicio && c && (
        <>
          <div className="cx-tablas-filtros" role="group" aria-label="Qué asientos ver">
            {visibles.map((f) => (
              <button key={f.id} type="button" className="cx-pildora" aria-pressed={filtro === f.id} onClick={() => cambiarFiltro(f.id)}>
                {f.texto}{f.id === 'todos' ? '' : ` · ${f.n}`}
              </button>
            ))}
          </div>

          <div className="cxd-cifras">
            <div className="cx-tarjeta cxd-cifra"><span className="cxd-cifra-etiqueta">Asientos en {nombreMes(datos.mes)}</span>
              <strong className="cxd-cifra-valor">{c.asientosMes.toLocaleString('es-ES')}</strong><span className="cx-ayuda">{c.apoyoAsientos}</span></div>
            <button type="button" className="cx-tarjeta cxd-cifra cxd-cifra-boton" onClick={() => cambiarFiltro('revisar')} aria-label={`Para revisar: ${c.revisar}. Ver`}>
              <span className="cxd-cifra-etiqueta">Para revisar</span>
              <strong className="cxd-cifra-valor">{c.revisar}</strong><span className={c.revisar ? 'cxt-ambar' : 'cx-ayuda'}>{c.apoyoRevisar}</span></button>
            <div className="cx-tarjeta cxd-cifra"><span className="cxd-cifra-etiqueta">{capital(nombreMes(datos.mes))}</span>
              <strong className="cxd-cifra-valor">{c.mes.texto}</strong><span className={c.mes.cerrado ? 'cxt-ambar' : 'cxt-verde'}>{c.mes.apoyo}</span></div>
            <div className="cx-tarjeta cxd-cifra"><span className="cxd-cifra-etiqueta">Resultado de {nombreMes(datos.mes)}</span>
              <strong className="cxd-cifra-valor">{c.resultado === null ? '—' : `${c.resultado >= 0 ? '+' : ''}${euros(c.resultado)}`}</strong>
              <span className={datos.resultadoError ? 'cxt-ambar' : 'cx-ayuda'}>{datos.resultadoError ? `No se ha podido calcular: ${datos.resultadoError}` : c.apoyoResultado}</span></div>
          </div>

          {mesCerrado && (
            <div className="cx-tarjeta cxd-franja" role="status">
              <span><strong>{capital(nombreMes(datos.mes))} está {mesCerrado.texto.toLowerCase()}</strong> · {mesCerrado.apoyo}. Lo que propongo cae en el primer día abierto.</span>
              {mesCerrado.cerrado && mesCerrado.tipo !== 'migrated' && <button type="button" className="cx-boton-sec" onClick={() => setDesbloqueo(true)}>Pedir desbloqueo</button>}
            </div>
          )}

          <div className="cxd-cuerpo">
            <section className="cx-tarjeta cxd-diario" aria-label="Asientos">
              {lista.length === 0 ? (
                filtro === 'revisar'
                  ? <Vacio titulo="Nada que revisar." explicacion="Lo que propongo sale aquí; con «Proponer lo pendiente» repaso ventas, facturas, liquidaciones y nóminas." />
                  : <Vacio titulo="Aún no hay asientos en este ejercicio." explicacion="Pulsa «Proponer lo pendiente» y los preparo con su porqué; o haz uno a mano con «+ Nuevo asiento»." />
              ) : (
                <div className="cxd-tabla">
                  {!movil && (
                    <div className="cxd-fila cxd-fila-cabeza" aria-hidden="true">
                      <span>Fecha</span><span>Nº</span><span>Concepto · local · marca · de dónde sale</span><span className="cxd-der">Importe</span><span /><span />
                    </div>
                  )}
                  {lista.map((a) => (
                    <FilaAsiento key={a.id} a={a} abierto={abierto === a.id} movil={movil}
                      alAbrir={() => (movil ? navegar(rutaAsiento(a.id)) : setAbierto(abierto === a.id ? null : a.id))} />
                  ))}
                </div>
              )}
            </section>

            <aside className="cxd-lado">
              <section className="cxd-ia" aria-label="Lo que he hecho yo">
                <h2 className="cxd-ia-titulo"><span className="cx-marca-ia" aria-hidden="true">IA</span> Lo que he hecho yo</h2>
                {hechos.length === 0
                  ? <p className="cxd-ia-apoyo">Aún nada este ejercicio. Cuando proponga o asiente algo, sale aquí con su porqué.</p>
                  : hechos.map((h) => (
                    <div key={h.asientoId} className="cxd-ia-fila">
                      <div><Link to={rutaAsiento(h.asientoId)} className="cxd-ia-hecho">{h.titulo}</Link><span className="cxd-ia-apoyo">{h.apoyo}</span></div>
                      {h.deshacer && <button type="button" className="cx-enlace" onClick={() => deshacer(h.asientoId)}>Deshacer</button>}
                    </div>
                  ))}
              </section>
              {datos.cierre && <TarjetaCierre mes={mesAnterior(datos.mes)} fuente={datos.cierre} companyId={activa!.id}
                alHacer={(t) => { setHecho(t); recargar() }} alFallar={setFallo} />}
            </aside>
          </div>
        </>
      )}
      {desbloqueo && datos && activa && (
        <PedirDesbloqueo mes={datos.mes} companyId={activa.id} alCerrar={() => setDesbloqueo(false)}
          alHacer={(t) => { setDesbloqueo(false); setHecho(t); recargar() }} />
      )}
    </div>
  )
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

function FilaAsiento({ a, abierto, movil, alAbrir }: { a: AsientoDiario; abierto: boolean; movil: boolean; alAbrir: () => void }) {
  const e = estadoDe(a)
  const anulado = a.estado === 'anulado'
  return (
    <div className={`cxd-envoltura${anulado ? ' cxd-anulado' : ''}`}>
      <button type="button" className="cxd-fila" aria-expanded={movil ? undefined : abierto} onClick={alAbrir}>
        {movil
          ? <span className="cxd-fecha">{diaMesCorto(a.fecha)}<span className="cxd-num-movil">{numeroVisible(a)}</span></span>
          : <><span className="cxd-fecha">{diaMesCorto(a.fecha)}</span><span className="cxd-num">{numeroVisible(a)}</span></>}
        <span className="cxd-concepto">
          <span className="cxd-concepto-titulo" title={a.concepto}>{a.concepto}</span>
          <span className="cxd-concepto-apoyo">
            {pastillas(a).map((p) => <Chip key={p.texto} tono={p.tono}>{p.texto}</Chip>)}
            <span className="cxd-sale" title={deDondeSale(a)}>{deDondeSale(a)}</span>
          </span>
        </span>
        <span className="cxd-importe">{eurosExactos(importe(a))}</span>
        <TonoChip tono={e.tono}>{e.texto}</TonoChip>
        {!movil && <span className="cxd-flecha" aria-hidden="true">{abierto ? '▾' : '▸'}</span>}
      </button>
      {abierto && !movil && (
        <div className="cxd-apuntes">
          {a.apuntes.map((l) => (
            <div key={l.posicion} className="cxd-apunte">
              <span className="cxd-apunte-cuenta">
                <span>{l.nombreCuenta}{l.local ? ` · ${l.local}` : l.comun ? ' · común' : ''}</span>
                <Link to={rutaMayor(l.cuenta)} className="cxd-codigo">{l.cuenta}</Link>
              </span>
              <span>{l.marca && <Chip tono={l.cedida ? 'ambar' : 'neutro'}>{l.cedida ? `${l.marca} · cedida` : l.marca}</Chip>}</span>
              <span className="cxd-importe">{eurosExactos(l.debe || l.haber)}</span>
              <span className="cx-ayuda">{l.debe ? 'al Debe' : 'al Haber'}</span>
            </div>
          ))}
          <div className="cxd-apunte-pie"><Link to={rutaAsiento(a.id)} className="cx-enlace">Abrir el asiento</Link></div>
        </div>
      )}
    </div>
  )
}

function TarjetaCierre({ mes, fuente, companyId, alHacer, alFallar }: {
  mes: string; fuente: FuenteCierre; companyId: string; alHacer: (t: string) => void; alFallar: (t: string) => void
}) {
  const pasos = pasosCierre(fuente)
  const puede = sePuedeCerrar(pasos)
  const [ocupado, setOcupado] = useState(false)
  async function cerrar() {
    setOcupado(true)
    try {
      await cerrarMes(companyId, mes)
      alHacer(`${capital(nombreMes(mes))} cerrado: ya no entra ningún asiento con fecha de ese mes. Lo que llegue tarde va al primer día abierto.`)
    } catch (e) { alFallar(e instanceof Error ? e.message : 'No se ha podido cerrar.') }
    finally { setOcupado(false) }
  }
  return (
    <section className="cx-tarjeta cxd-cierre" aria-label={`Cierre de ${nombreMes(mes)}`}>
      <h2 className="cx-tarjeta-titulo">Cierre de {nombreMes(mes)}</h2>
      <ul className="cxd-pasos">
        {pasos.map((p) => (
          <li key={p.texto} className={p.hecho ? 'cxd-paso-hecho' : 'cxd-paso-falta'}>
            <span aria-hidden="true">{p.hecho ? '✓' : '·'}</span> {p.texto}<span className="cx-oculto">{p.hecho ? ' (hecho)' : ' (falta)'}</span>
          </li>
        ))}
      </ul>
      {!fuente.cerrado && (
        <>
          <button type="button" className="cx-boton" onClick={cerrar} disabled={!puede.puede || ocupado}>{ocupado ? 'Cerrando…' : `Cerrar ${nombreMes(mes)}`}</button>
          {puede.falta && <span className="cx-ayuda">{puede.falta}</span>}
        </>
      )}
    </section>
  )
}

function PedirDesbloqueo({ mes, companyId, alCerrar, alHacer }: { mes: string; companyId: string; alCerrar: () => void; alHacer: (t: string) => void }) {
  const [motivo, setMotivo] = useState('')
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  async function pedir() {
    setOcupado(true); setFallo(null)
    try {
      await reabrirMes(companyId, mes, motivo)
      alHacer(`${capital(nombreMes(mes))} reabierto. Queda escrito por qué: «${motivo.trim()}».`)
    } catch (e) { setFallo(e instanceof Error ? e.message : 'No se ha podido reabrir.') }
    finally { setOcupado(false) }
  }
  return (
    <Dialogo titulo={`Desbloquear ${nombreMes(mes)}`} alCerrar={alCerrar}>
      <p className="cx-ayuda">Solo se reabre el último mes cerrado, y queda escrito quién y por qué. Si su impuesto está presentado, cambiar algo pide una complementaria.</p>
      <label className="cxd-campo">Por qué
        <textarea className="cx-input" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: llegó tarde una factura del 28" />
      </label>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      <div className="cxd-dialogo-acciones">
        <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button>
        <button type="button" className="cx-boton" onClick={pedir} disabled={ocupado || !motivo.trim()}>{ocupado ? 'Reabriendo…' : 'Desbloquear'}</button>
      </div>
    </Dialogo>
  )
}
