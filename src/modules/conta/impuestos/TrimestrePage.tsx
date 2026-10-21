// src/modules/conta/impuestos/TrimestrePage.tsx
//
// I01c · Pieza 3, la parte que ordena · Impuestos › Trimestre. Maqueta v4
// (Julio, 20/10): TODO el ancho, en tres columnas —izquierda, el resumen y la
// liquidación en palabras; centro, el justificante grande, fijo al bajar, con
// zoom y «Ampliar»; derecha, las cuotas a compensar y lo comprobado (el 303) o
// sus cuadres con el diario (111 ↔ 4751, 115 ↔ alquileres)—. Por debajo de
// 1.500 px la derecha baja debajo de la izquierda; en móvil, una columna y el
// PDF a pantalla completa al tocarlo. Lo de antes (maqueta v3):
//   1. arriba, la tira del trimestre: un selector 1T/2T/3T/4T y, por cada
//      modelo (303, 111, 115 y 202), su estado, importe y fecha; lo que vence
//      hoy o ya se pasó, en rojo;
//   2. debajo, a la izquierda, la ficha del modelo elegido: sus datos y sus
//      casillas con «qué es» en palabras; con el 303, debajo de sus casillas,
//      las cuotas a compensar trimestre a trimestre ([110], [78], [87]);
//   3. a la derecha, el justificante de Hacienda en grande, sea el modelo que
//      sea, con Descargar, Imprimir y Abrir aparte. Sin presentar: el impreso
//      calculado por Sumied o, si no hay nada, qué falta y el botón para hacerlo.
// La empresa puede venir por la ruta (impuestos/empresa/<id>/trimestre/…): la
// vista de despacho de P abre así el trimestre de un cliente. Si no, la activa.
//
// Si el borrador del 303 del trimestre se calculó antes de tener el anterior
// presentado, su [110] está desfasada (0280). Quien puede gestionar y lo tiene
// en borrador, se vuelve a calcular al abrir, y se dice con su cifra (regla 8);
// si ya estaba revisado, no se toca: se avisa y hay un botón.
// La pestaña «Liquidación» calculada desde el libro de IVA va después de la pieza 2.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { rutaAsiento, rutaImpuestos, rutaIvaPeriodo, rutaLibros, rutaMayor, rutaTrimestre } from '@/config/navegacion'
import { Boton, BotonEnlace, Chip, Icono, Tarjeta } from '@/modules/conta/diseno'
import { clasesBoton } from '@/modules/conta/diseno/valores'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { diaMesCorto, eurosExactos, fechaLarga } from '@/modules/conta/lib/formato'
import { esCasillaDePersonas } from '@/modules/conta/lib/justificanteAeat'
import { pdfjs } from '@/modules/conta/plan/leerFicheros'
import {
  asientosDeDeclaracion, calcular303, comprobacionesDeDeclaracion, cuentasDelTrimestre, enlaceJustificante, leerTrimestre, libroIvaDelTrimestre,
} from '@/modules/conta/services/impuestosService'
import { esCasillaDePorcentaje, queEsLaCasilla } from './casillasModelos'
import { textoResultado } from './calendario'
import {
  CASILLA_RESULTADO, estaPresentada, fraseDesfasada, fraseRecalculado, importeConSigno, lineasCartera, numeroTrimestre, presentadorEnPalabras,
  cuadreLibro303, cuadreRetenciones, cuentaDelImpuesto, fechasTrimestre, librosDelModelo, liquidacion303, tarjeta, tituloTrimestre, trimestrePorDefecto,
  type CasillaTrimestre, type FilaLiquidacion, type LineaCuadre, type ModeloTrimestre, type SumaCuenta, type Trimestre,
} from './trimestre'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })

/** impuestos/trimestre (sin año ni trimestre): el último acabado. */
export function TrimestrePorDefecto() {
  const d = trimestrePorDefecto(hoy())
  return <Navigate to={rutaTrimestre(d.ejercicio, d.trimestre)} replace />
}

export default function TrimestrePage() {
  const { empresa: deRuta, ejercicio: ej, trimestre = '' } = useParams<{ empresa?: string; ejercicio: string; trimestre: string }>()
  const { activa } = useEmpresas()
  const companyId = deRuta ?? activa?.id ?? null
  const ejercicio = Number(ej)
  const q = numeroTrimestre(trimestre)
  const navegar = useNavigate()
  const [vuelta, setVuelta] = useState(0)
  // Lo leído va con la clave de lo que se pidió: al cambiar de trimestre, lo de antes deja de valer sin borrarlo a mano.
  const pedido = `${companyId}/${ejercicio}/${q}/${vuelta}`
  const [leido, setLeido] = useState<{ pedido: string; datos: Trimestre | null; error: string | null } | null>(null)
  const datos = leido?.pedido === pedido ? leido.datos : null
  const error = leido?.pedido === pedido ? leido.error : null
  const [elegido, setElegido] = useState<string | null>(null)
  const [hecho, setHecho] = useState<{ tono: 'ok' | 'falta'; texto: string } | null>(null)
  const [ampliado, setAmpliado] = useState(false)
  const recalculado = useRef<string | null>(null)

  useEffect(() => {
    if (!companyId || !Number.isInteger(ejercicio) || !q) return
    let vivo = true
    leerTrimestre(companyId, ejercicio, q).then(
      (d) => { if (vivo) setLeido({ pedido, datos: d, error: null }) },
      (e: unknown) => { if (vivo) setLeido({ pedido, datos: null, error: msg(e) }) })
    return () => { vivo = false }
  }, [companyId, ejercicio, q, pedido])

  const recalcular = useCallback(async (d: Trimestre, para: string) => {
    try {
      await calcular303(d.empresa.id, d.ejercicio, d.trimestre)
      const nuevo = await leerTrimestre(d.empresa.id, d.ejercicio, numeroTrimestre(d.trimestre)!)
      setLeido({ pedido: para, datos: nuevo, error: null })
      const conResultado = nuevo.modelos.find((m) => m.modelo === '303')?.declaracion?.resultado != null
      setHecho({ tono: 'ok', texto: fraseRecalculado(d.trimestre, d.cartera.esperada_110?.de ?? 'anterior', nuevo.cartera.borrador?.c110 ?? null, conResultado) })
    } catch (e) {
      setHecho({ tono: 'falta', texto: `No se ha vuelto a calcular el ${d.trimestre}: ${msg(e)}` })
    }
  }, [])

  // El borrador desfasado y sin revisar, se recalcula al abrir (una vez por trimestre), y se dice.
  useEffect(() => {
    if (!datos || !datos.cartera.desfasada || !datos.puede_gestionar || datos.cartera.borrador?.estado !== 'draft') return
    const clave = `${datos.empresa.id}/${datos.ejercicio}/${datos.trimestre}`
    if (recalculado.current === clave) return
    recalculado.current = clave
    void recalcular(datos, pedido)
  }, [datos, pedido, recalcular])

  if (!companyId) {
    return <div className="s-pantalla"><Tarjeta titulo="Aún no hay ninguna empresa"><p className="s-apoyo">Da de alta tu empresa y aquí verás su trimestre.</p></Tarjeta></div>
  }
  if (!q || !Number.isInteger(ejercicio)) return <TrimestrePorDefecto />

  const ir = (y: number, t: string) => { setElegido(null); setHecho(null); navegar(rutaTrimestre(y, t, deRuta)) }
  const modelos = datos?.modelos ?? []
  const elegidoModelo = modelos.find((m) => clave(m) === elegido) ?? modelos.find((m) => m.modelo === '303') ?? modelos[0] ?? null
  const dia = hoy()

  return (
    <div className="s-pantalla s-impuestos s-trimestre">
      <nav aria-label="Migas" className="s-impuestos-migas">
        <Link to={rutaImpuestos()}>Impuestos</Link>{deRuta && datos ? ` › ${datos.empresa.nombre}` : ''} › {tituloTrimestre(ejercicio, trimestre)}
      </nav>
      <div className="s-trimestre-cabeza">
        <h1 className="s-impuestos-titulo">El trimestre{deRuta && datos ? <span className="s-impuestos-titulo-apoyo"> · {datos.empresa.nombre}</span> : null}</h1>
        <div className="s-trimestre-selector">
          <label className="s-trimestre-ano">
            <span className="cx-oculto">Ejercicio</span>
            <select className="s-control" value={ejercicio} onChange={(e) => ir(Number(e.target.value), trimestre)}>
              {[ejercicio - 1, ejercicio, ...(ejercicio < Number(dia.slice(0, 4)) ? [ejercicio + 1] : [])].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <div role="radiogroup" aria-label="Trimestre" className="s-trimestre-qs">
            {['1T', '2T', '3T', '4T'].map((t) => (
              <button key={t} type="button" role="radio" aria-checked={t === trimestre} className="s-trimestre-q" onClick={() => ir(ejercicio, t)}>{t}</button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <Tarjeta titulo="No se ha podido leer el trimestre" tono="falta" accion={<Boton onClick={() => setVuelta((v) => v + 1)}>Volver a intentar</Boton>}>
          <p className="s-apoyo">{error}</p>
        </Tarjeta>
      )}
      {!error && !datos && <Tarjeta titulo="Leyendo el trimestre…"><p className="s-apoyo">Un momento.</p></Tarjeta>}
      {hecho && <p className={hecho.tono === 'ok' ? 's-impuestos-hecho' : 's-impuestos-fallo'} role={hecho.tono === 'ok' ? 'status' : 'alert'}>{hecho.texto}</p>}

      {datos && (
        <>
          <ul className="s-trimestre-tira" aria-label={`Modelos del ${tituloTrimestre(ejercicio, trimestre)}`}>
            {modelos.map((m) => {
              const t = tarjeta(m, dia)
              const activo = elegidoModelo !== null && clave(m) === clave(elegidoModelo)
              return (
                <li key={clave(m)}>
                  <button type="button" className="s-trimestre-tarjeta" aria-pressed={activo} onClick={() => setElegido(clave(m))}>
                    <span className="s-trimestre-tarjeta-nombre">{t.titulo}</span>
                    <span className="s-cifra s-trimestre-tarjeta-importe">{t.importe}</span>
                    <Chip tono={t.chip.tono}>{t.chip.texto}</Chip>
                  </button>
                </li>
              )
            })}
            {modelos.length === 0 && <li className="s-apoyo">Esta empresa no tiene modelos trimestrales en sus impuestos.</li>}
          </ul>
          {elegidoModelo && (
            <div className={`s-trimestre-cuerpo${ampliado ? ' s-trimestre-cuerpo--ampliado' : ''}`} data-prueba="cuerpo">
              <div className="s-trimestre-col s-trimestre-col-izq">
                <Ficha key={clave(elegidoModelo)} m={elegidoModelo} d={datos} ejercicio={ejercicio} trimestre={trimestre} deRuta={!!deRuta} hoy={dia} />
              </div>
              <div className="s-trimestre-col s-trimestre-col-centro">
                <Derecha key={`${clave(elegidoModelo)}/${elegidoModelo.declaracion?.justificante_pdf ?? ''}`} m={elegidoModelo}
                  ejercicio={ejercicio} trimestre={trimestre} deRuta={!!deRuta} ampliado={ampliado} alAmpliar={() => setAmpliado((a) => !a)} />
              </div>
              <div className="s-trimestre-col s-trimestre-col-der">
                <ColDerecha key={clave(elegidoModelo)} m={elegidoModelo} d={datos} ejercicio={ejercicio} trimestre={trimestre}
                  alRecalcular={() => void recalcular(datos, pedido)} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const clave = (m: ModeloTrimestre) => `${m.modelo}-${m.periodo ?? 'no'}`

/** El importe de una casilla: personas, porcentaje o euros. */
function valorCasilla(modelo: string, c: CasillaTrimestre): string {
  if (c.valor === null) return c.texto ?? ''
  if (esCasillaDePersonas(modelo, c.casilla)) return `${c.valor} ${c.valor === 1 ? 'persona' : 'personas'}`
  if (esCasillaDePorcentaje(modelo, c.casilla)) return `${String(c.valor).replace('.', ',')} %`
  return eurosExactos(c.valor)
}

/**
 * La izquierda: el resumen del modelo elegido; con el 303, la liquidación en
 * palabras y «Ver las casillas» para desplegarlas todas; con los demás, sus
 * casillas (son pocas).
 */
function Ficha({ m, d: datos, ejercicio, trimestre, deRuta, hoy }: {
  m: ModeloTrimestre; d: Trimestre; ejercicio: number; trimestre: string; deRuta: boolean; hoy: string
}) {
  const d = m.declaracion
  const t = tarjeta(m, hoy)
  const v = d ? importeConSigno(d) : null
  const casillas = useMemo(() => (d?.casillas ?? []).filter((c) => c.valor !== null || c.texto), [d])
  const presentada = !!d && estaPresentada(d.estado)
  const presentador = d ? presentadorEnPalabras(d.presentador, datos.empresa.nif) : null
  const resultado = CASILLA_RESULTADO[m.modelo]
  return (
    <section className="s-tarjeta s-trimestre-ficha" aria-labelledby="ficha-titulo" data-prueba="ficha-modelo">
      <div className="s-trimestre-ficha-cabeza">
        <h2 id="ficha-titulo" className="s-trimestre-ficha-titulo">{t.titulo}{m.periodo ? ` · ${m.periodo} ${ejercicio}` : ''}</h2>
        <Chip tono={t.chip.tono}>{t.chip.texto}</Chip>
      </div>
      {m.no_toca && <p className="s-apoyo">El pago a cuenta del Impuesto de sociedades se hace en abril (1P), octubre (2P) y diciembre (3P): en el {trimestre} no hay ninguno.</p>}
      {!m.no_toca && !d && (
        <p className="s-apoyo">Aún no está en Sumied.{m.presentacion ? ` Se presenta hasta el ${fechaLarga(m.presentacion)}.` : ''}</p>
      )}
      {d && (
        <dl className="s-trimestre-dl">
          <dt>Resultado</dt>
          <dd data-prueba="resultado-ficha">{v === null ? 'Sin calcular' : <><span className="s-cifra">{eurosExactos(Math.abs(v))}</span> · {textoResultado(d.resultado)}</>}</dd>
          {presentada ? (
            <>
              <dt>Presentado</dt><dd>{d.presentada ? `${fechaLarga(d.presentada.slice(0, 10))} a las ${new Date(d.presentada).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}` : '—'}{d.por === 'outside' ? ' · fuera de Sumied' : ''}</dd>
              <dt>Justificante</dt><dd className="s-cifra">{d.justificante ? `nº ${d.justificante}` : '—'}</dd>
              <dt>CSV</dt><dd className="s-impuestos-csv">{d.csv ?? '—'}</dd>
              {d.expediente && <><dt>Expediente</dt><dd>{d.expediente}</dd></>}
              {presentador && <><dt>Presentador</dt><dd>{presentador}</dd></>}
            </>
          ) : (
            <><dt>Plazo</dt><dd>{m.presentacion ? `hasta el ${fechaLarga(m.presentacion)}` : '—'}{m.domiciliacion ? ` · domiciliado hasta el ${diaMesCorto(m.domiciliacion)}` : ''}</dd></>
          )}
        </dl>
      )}
      {d && !deRuta && <Acciones m={m} d={d} ejercicio={ejercicio} trimestre={trimestre} presentada={presentada} />}
      {m.modelo === '303' && casillas.length > 0 && <Liquidacion casillas={casillas} />}
      {casillas.length > 0 && (m.modelo === '303'
        ? <details className="s-trimestre-todas" data-prueba="todas-las-casillas"><summary>Ver las casillas ({casillas.length})</summary><TablaCasillas m={m} casillas={casillas} resultado={resultado} /></details>
        : <TablaCasillas m={m} casillas={casillas} resultado={resultado} />)}
    </section>
  )
}

/** Todas las casillas con «qué es» y su importe; la del resultado, marcada. */
function TablaCasillas({ m, casillas, resultado }: { m: ModeloTrimestre; casillas: CasillaTrimestre[]; resultado: string | undefined }) {
  return (
    <table className="s-trimestre-casillas" aria-label={`Casillas del ${m.modelo}`}>
      <thead><tr><th scope="col">Casilla</th><th scope="col">Qué es</th><th scope="col" className="s-tabla-cifra">Importe</th></tr></thead>
      <tbody>{casillas.map((c) => (
        <tr key={c.casilla} data-resultado={c.casilla === resultado ? 'si' : undefined}>
          <td className="s-trimestre-casilla">[{c.casilla}]{c.origen === 'manual' && <span title={c.motivo ?? 'Escrita a mano'}> ✎</span>}</td>
          <td>{queEsLaCasilla(m.modelo, c.casilla) ?? ''}</td>
          <td className="s-tabla-cifra s-cifra">{valorCasilla(m.modelo, c)}</td>
        </tr>
      ))}</tbody>
    </table>
  )
}

/** La liquidación del 303 en palabras (maqueta v4): lo que cobras y lo que deduces, por tipo, con sus casillas en pequeño. */
function Liquidacion({ casillas }: { casillas: CasillaTrimestre[] }) {
  const l = liquidacion303(casillas)
  const fmt = (n: number | null) => (n === null ? '—' : eurosExactos(n))
  const bloque = (titulo: string, filas: FilaLiquidacion[], total: number | null, casillaTotal: string) => (
    <table className="s-trimestre-liq" aria-label={titulo}>
      <thead><tr><th scope="col">{titulo}</th><th scope="col" className="s-tabla-cifra">Base</th><th scope="col" className="s-tabla-cifra">Cuota</th></tr></thead>
      <tbody>
        {filas.map((f) => (
          <tr key={f.texto + f.casillas.join()}>
            <th scope="row">{f.texto}<span className="s-impuestos-casilla">{f.casillas.map((c) => `[${c}]`).join(' ')}</span></th>
            <td className="s-tabla-cifra s-cifra">{fmt(f.base)}</td>
            <td className="s-tabla-cifra s-cifra">{fmt(f.cuota)}</td>
          </tr>
        ))}
        {filas.length === 0 && <tr><td colSpan={3} className="s-apoyo">Nada en este trimestre.</td></tr>}
        <tr className="s-trimestre-liq-total"><th scope="row">Total<span className="s-impuestos-casilla">[{casillaTotal}]</span></th><td /><td className="s-tabla-cifra s-cifra">{fmt(total)}</td></tr>
      </tbody>
    </table>
  )
  return (
    <section className="s-trimestre-liquidacion" aria-labelledby="liq-titulo" data-prueba="liquidacion">
      <h3 id="liq-titulo" className="s-trimestre-cartera-titulo">La liquidación</h3>
      {bloque('IVA que cobras', l.cobras, l.totalCobras, '27')}
      {bloque('IVA que deduces', l.deduces, l.totalDeduces, '45')}
      <dl className="s-trimestre-liq-resultado">
        <dt>Lo que cobras menos lo que deduces <span className="s-impuestos-casilla">[46]</span></dt><dd className="s-cifra">{fmt(l.diferencia)}</dd>
        <dt>Resultado <span className="s-impuestos-casilla">[71]</span></dt><dd className="s-cifra">{fmt(l.resultado)}</dd>
      </dl>
    </section>
  )
}

/**
 * La derecha (maqueta v4): con el 303, las cuotas a compensar y lo
 * comprobado (el libro de IVA del trimestre contra las cuotas del 303, y lo
 * que Sumied comprobó al calcularlo); con el 111 y el 115, sus cuadres con el
 * diario. Lo que no se puede leer se dice, no se esconde (regla 8).
 */
function ColDerecha({ m, d, ejercicio, trimestre, alRecalcular }: { m: ModeloTrimestre; d: Trimestre; ejercicio: number; trimestre: string; alRecalcular: () => void }) {
  if (m.modelo === '303') return <><Cartera d={d} alRecalcular={alRecalcular} /><Comprobado303 m={m} d={d} ejercicio={ejercicio} trimestre={trimestre} /></>
  if (m.modelo === '111' || m.modelo === '115') return <CuadreConDiario m={m} d={d} ejercicio={ejercicio} trimestre={trimestre} />
  return (
    <section className="s-tarjeta s-trimestre-comprobado" aria-labelledby="comp-titulo">
      <h3 id="comp-titulo" className="s-trimestre-cartera-titulo">Lo comprobado</h3>
      <p className="s-apoyo">Del {m.modelo} no hay cuadres con el diario todavía.</p>
    </section>
  )
}

function Comprobado303({ m, d, ejercicio, trimestre }: { m: ModeloTrimestre; d: Trimestre; ejercicio: number; trimestre: string }) {
  const decl = m.declaracion
  const [leido, setLeido] = useState<{ para: string; libro: LineaCuadre[] | null; checks: { clave: string; resultado: string; titulo: string }[]; fallo: string | null } | null>(null)
  const para = `${d.empresa.id}/${ejercicio}/${trimestre}/${decl?.id ?? ''}`
  useEffect(() => {
    if (!decl) return
    let vivo = true
    const { desde, hasta } = fechasTrimestre(ejercicio, trimestre)
    Promise.all([libroIvaDelTrimestre(decl.cuenta, d.empresa.id, ejercicio, trimestre, desde, hasta), comprobacionesDeDeclaracion(decl.id, decl.cuenta)])
      .then(([filas, checks]) => { if (vivo) setLeido({ para, libro: filas.length ? cuadreLibro303(filas, decl.casillas) : null, checks, fallo: null }) },
        (e: unknown) => { if (vivo) setLeido({ para, libro: null, checks: [], fallo: msg(e) }) })
    return () => { vivo = false }
  }, [decl, d.empresa.id, ejercicio, trimestre, para])
  const l = leido?.para === para ? leido : null
  return (
    <section className="s-tarjeta s-trimestre-comprobado" aria-labelledby="comp-titulo" data-prueba="comprobado">
      <h3 id="comp-titulo" className="s-trimestre-cartera-titulo">Lo comprobado</h3>
      {!decl && <p className="s-apoyo">Sin 303 del {trimestre} no hay nada que comprobar.</p>}
      {decl && !l && <p className="s-apoyo">Comprobando…</p>}
      {l?.fallo && <p className="s-impuestos-fallo" role="alert">{l.fallo}</p>}
      {l && !l.fallo && l.libro === null && <p className="s-apoyo">El libro de IVA del {trimestre} está vacío: no hay con qué casar el 303.</p>}
      {l?.libro && (
        <>
          <table className="s-trimestre-cuadre" aria-label="Libro de IVA y 303">
            <thead><tr><th scope="col">Libro de IVA ↔ 303</th><th scope="col" className="s-tabla-cifra">Libro</th><th scope="col" className="s-tabla-cifra">303</th></tr></thead>
            <tbody>{l.libro.map((x) => (
              <tr key={x.casilla} data-casa={x.casa ? 'si' : 'no'}>
                <th scope="row">{x.casa ? '✓ ' : '! '}{x.texto}<span className="s-impuestos-casilla">[{x.casilla}]</span></th>
                <td className="s-tabla-cifra s-cifra">{eurosExactos(x.libro)}</td>
                <td className="s-tabla-cifra s-cifra">{eurosExactos(x.presentado)}</td>
              </tr>
            ))}</tbody>
          </table>
          {l.libro.every((x) => x.casa)
            ? <p className="s-trimestre-ok">✓ El libro de IVA del {trimestre} casa con el 303, cuota a cuota</p>
            : <p className="s-impuestos-porque-no" role="note">! No casa cuota a cuota. Si la diferencia está en la [29], puede ser una factura deducida en otro trimestre: se marca con «deducida en».</p>}
        </>
      )}
      {l && l.checks.length > 0 && (
        <ul className="s-trimestre-checks" aria-label="Lo que comprobó Sumied al calcularlo">
          {l.checks.map((c) => <li key={c.clave} data-resultado={c.resultado}>{c.resultado === 'ok' ? '✓ ' : '! '}{c.titulo}</li>)}
        </ul>
      )}
    </section>
  )
}

function CuadreConDiario({ m, d, ejercicio, trimestre }: { m: ModeloTrimestre; d: Trimestre; ejercicio: number; trimestre: string }) {
  const decl = m.declaracion
  const [leido, setLeido] = useState<{ para: string; cuentas: SumaCuenta[] | null; fallo: string | null } | null>(null)
  const para = `${d.empresa.id}/${ejercicio}/${trimestre}/${m.modelo}`
  useEffect(() => {
    if (!decl) return
    let vivo = true
    const { desde, hasta } = fechasTrimestre(ejercicio, trimestre)
    cuentasDelTrimestre(decl.cuenta, d.empresa.id, m.modelo === '115' ? ['4751', '621'] : ['4751'], desde, hasta)
      .then((c) => { if (vivo) setLeido({ para, cuentas: c, fallo: null }) }, (e: unknown) => { if (vivo) setLeido({ para, cuentas: null, fallo: msg(e) }) })
    return () => { vivo = false }
  }, [decl, d.empresa.id, ejercicio, trimestre, m.modelo, para])
  const l = leido?.para === para ? leido : null
  const c = l?.cuentas && decl ? cuadreRetenciones(m.modelo, decl.casillas, l.cuentas) : null
  return (
    <section className="s-tarjeta s-trimestre-comprobado" aria-labelledby="comp-titulo" data-prueba="cuadres">
      <h3 id="comp-titulo" className="s-trimestre-cartera-titulo">{m.modelo === '111' ? 'El 111 y la 4751' : 'El 115, la 4751 y los alquileres'}</h3>
      {!decl && <p className="s-apoyo">Sin el {m.modelo} del {trimestre} no hay nada que cuadrar.</p>}
      {decl && !l && <p className="s-apoyo">Leyendo el diario…</p>}
      {l?.fallo && <p className="s-impuestos-fallo" role="alert">{l.fallo}</p>}
      {c && c.lineas.length > 0 && (
        <table className="s-trimestre-cuadre" aria-label={`Cuadres del ${m.modelo}`}>
          <tbody>{c.lineas.map((x) => (
            <tr key={x.texto} data-casa={x.casa === true ? 'si' : x.casa === false ? 'no' : undefined}>
              <th scope="row">{x.casa === true ? '✓ ' : ''}{x.texto}{x.casillas && <span className="s-impuestos-casilla">{x.casillas}</span>}</th>
              <td className="s-tabla-cifra s-cifra">{x.importe === null ? '—' : eurosExactos(x.importe)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {c?.conclusion && (c.conclusion.casa
        ? <p className="s-trimestre-ok">✓ {c.conclusion.texto}</p>
        : <p className="s-impuestos-porque-no" role="note">! {c.conclusion.texto}</p>)}
      {c && m.modelo === '115' && <p className="s-apoyo">La 621 puede llevar también alquileres sin retención (un renting, por ejemplo): su cifra no tiene por qué ser la base del 115.</p>}
    </section>
  )
}

/**
 * Debajo de las casillas (maqueta v3): «Ver el asiento» y «Facturas del
 * trimestre». Sin asiento en Sumied (una declaración presentada fuera, como
 * todas las de Foodint en 2026), el botón lleva a la cuenta del impuesto en el
 * mayor y lo dice: no promete un asiento que no hay. Van a pantallas de la
 * empresa activa: por la ruta de otra empresa (despacho) no salen.
 */
function Acciones({ m, d, ejercicio, trimestre, presentada }: {
  m: ModeloTrimestre; d: NonNullable<ModeloTrimestre['declaracion']>; ejercicio: number; trimestre: string; presentada: boolean
}) {
  const [asientos, setAsientos] = useState<{ id: string; liquidacion: string | null; pago: string | null } | null>(null)
  useEffect(() => {
    let vivo = true
    asientosDeDeclaracion(d.id, d.cuenta).then((a) => { if (vivo) setAsientos({ id: d.id, ...a }) }).catch(() => { if (vivo) setAsientos({ id: d.id, liquidacion: null, pago: null }) })
    return () => { vivo = false }
  }, [d.id, d.cuenta])
  const a = asientos?.id === d.id ? asientos : null
  const cuenta = cuentaDelImpuesto(m.modelo, d.resultado)
  const entrada = a?.liquidacion ?? a?.pago ?? null
  const libro = librosDelModelo(m.modelo)
  const conPeriodo = (ruta: string) => `${ruta}?ejercicio=${ejercicio}&periodo=${trimestre}`
  return (
    <p className="s-trimestre-acciones">
      {a && (entrada
        ? <BotonEnlace a={rutaAsiento(entrada)}>{a.liquidacion ? 'Ver el asiento' : 'Ver el asiento del pago'}</BotonEnlace>
        : cuenta && <BotonEnlace a={rutaMayor(cuenta)} titulo="Esta declaración no tiene asiento en Sumied (se presentó fuera): su cuenta en el mayor.">Ver la cuenta {cuenta}</BotonEnlace>)}
      {libro && <BotonEnlace a={conPeriodo(rutaLibros('registro', libro))}>Facturas del trimestre</BotonEnlace>}
      {m.modelo === '303' && m.periodo && (
        <BotonEnlace a={rutaIvaPeriodo(ejercicio, m.periodo)}>{presentada ? 'Ver el IVA del trimestre' : 'Abrir el IVA del trimestre'}</BotonEnlace>
      )}
    </p>
  )
}

/**
 * Lo de la derecha: el justificante en grande; sin él, el impreso calculado
 * por Sumied (con sus casillas) o qué falta y el botón para hacerlo.
 */
function Derecha({ m, ejercicio, trimestre, deRuta, ampliado, alAmpliar }: { m: ModeloTrimestre; ejercicio: number; trimestre: string; deRuta: boolean; ampliado: boolean; alAmpliar: () => void }) {
  const d = m.declaracion
  const pdf = d?.justificante_pdf ?? null
  if (pdf) {
    return <VisorJustificante ruta={pdf} nombre={`justificante-${m.modelo}-${m.periodo ?? ''}-${ejercicio}.pdf`} titulo={`${tarjeta(m).titulo} · ${m.periodo ?? ''} ${ejercicio}`} ampliado={ampliado} alAmpliar={alAmpliar} />
  }
  const presentada = !!d && estaPresentada(d.estado)
  const casillas = (d?.casillas ?? []).filter((c) => c.valor !== null)
  // Sin presentar y con casillas calculadas: el impreso, como lo verá Hacienda.
  if (d && !presentada && casillas.length > 0) {
    return (
      <section className="s-tarjeta s-trimestre-derecha" aria-labelledby="derecha-titulo" data-prueba="impreso-calculado">
        <div className="s-trimestre-derecha-cabeza">
          <h2 id="derecha-titulo" className="s-trimestre-derecha-titulo">Impreso calculado por Sumied</h2>
          <span className="s-apoyo">Modelo {m.modelo} · {m.periodo} {ejercicio} · sin presentar</span>
        </div>
        <div className="s-trimestre-impreso">
          <p className="s-trimestre-impreso-titulo">Modelo {m.modelo} · Liquidación</p>
          <dl>{casillas.map((c) => (
            <div key={c.casilla} className="s-trimestre-impreso-fila">
              <dt>{queEsLaCasilla(m.modelo, c.casilla) ?? `Casilla ${c.casilla}`}</dt>
              <dd><span className="s-trimestre-impreso-num">{c.casilla}</span><span className="s-cifra">{valorCasilla(m.modelo, c)}</span></dd>
            </div>
          ))}</dl>
        </div>
      </section>
    )
  }
  // Si no hay nada que enseñar: qué falta, y el botón para hacerlo.
  const falta = queFalta(m, ejercicio, trimestre, presentada)
  return (
    <section className="s-tarjeta s-trimestre-derecha s-trimestre-falta" aria-labelledby="derecha-titulo" data-prueba="que-falta">
      <h2 id="derecha-titulo" className="s-trimestre-derecha-titulo">{falta.titulo}</h2>
      <p className="s-apoyo">{falta.texto}</p>
      {falta.boton && !(deRuta && falta.boton.soloPropia) && (
        <p><BotonEnlace variante="principal" a={falta.boton.a}>{falta.boton.texto}</BotonEnlace></p>
      )}
    </section>
  )
}

/** Qué falta para que la derecha tenga algo que enseñar, en palabras. */
function queFalta(m: ModeloTrimestre, ejercicio: number, trimestre: string, presentada: boolean): { titulo: string; texto: string; boton?: { texto: string; a: string; soloPropia?: boolean } } {
  // Presentados es de la empresa activa: por la ruta de otra empresa (despacho), sin botón.
  const traer = { texto: 'Traer el justificante', a: `${rutaImpuestos('presentados')}?fuera=1`, soloPropia: true }
  if (m.no_toca) return { titulo: 'En este trimestre no hay 202', texto: `El pago a cuenta del Impuesto de sociedades va en abril, octubre y diciembre; en el ${trimestre}, ninguno.` }
  if (presentada) return { titulo: 'Falta el justificante en PDF', texto: 'Está apuntado como presentado, pero sin su PDF. Tráelo de Hacienda con su CSV y aquí se verá entero.', boton: traer }
  const d = m.declaracion
  if (m.modelo === '303' && m.periodo) {
    const iva = { texto: 'Abrir el IVA del trimestre', a: rutaIvaPeriodo(ejercicio, m.periodo), soloPropia: true }
    if (!d || d.estado === 'pending') return { titulo: `Falta calcular el 303 del ${trimestre}`, texto: 'Sumied lo calcula con el libro de IVA del trimestre.', boton: iva }
    return { titulo: `Falta el libro de IVA del ${trimestre}`, texto: 'Sin el libro de IVA del trimestre, Sumied no sabe el resultado del 303. Cuando esté, aquí saldrá el impreso calculado.', boton: iva }
  }
  return {
    titulo: 'Aún no está en Sumied',
    texto: `${m.presentacion ? `Se presenta hasta el ${fechaLarga(m.presentacion)}. ` : ''}Si ya lo presentaste, trae su justificante de Hacienda con el CSV y aquí se verá entero.`,
    boton: traer,
  }
}

/**
 * El justificante en grande: se baja una vez (el enlace firmado caduca) y se
 * enseña desde el navegador, así Descargar, Imprimir y Abrir aparte van con el
 * mismo fichero. Cuántas páginas tiene, de pdfjs.
 */
const ZOOM = ['page-width', '75', '100', '125', '150', '200'] as const

function VisorJustificante({ ruta, nombre, titulo, ampliado, alAmpliar }: { ruta: string; nombre: string; titulo: string; ampliado: boolean; alAmpliar: () => void }) {
  const [zoom, setZoom] = useState(0)
  const [completa, setCompleta] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [paginas, setPaginas] = useState<number | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const marco = useRef<HTMLIFrameElement | null>(null)
  useEffect(() => {
    let vivo = true
    let local: string | null = null
    ;(async () => {
      const firmado = await enlaceJustificante(ruta)
      const r = await fetch(firmado)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const bytes = new Uint8Array(await r.arrayBuffer())
      local = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      if (!vivo) { URL.revokeObjectURL(local); return }
      setUrl(local)
      try {
        const pj = await pdfjs() as unknown as { getDocument(o: { data: Uint8Array; verbosity?: number }): { promise: Promise<{ numPages: number }> } }
        const doc = await pj.getDocument({ data: bytes.slice(), verbosity: 0 }).promise
        if (vivo) setPaginas(doc.numPages)
      } catch { /* sin el número de páginas, el PDF se ve igual */ }
    })().catch((e: unknown) => { if (vivo) setFallo(`No se ha podido abrir el justificante: ${msg(e)}`) })
    return () => { vivo = false; if (local) URL.revokeObjectURL(local) }
  }, [ruta])
  const imprimir = () => {
    try { marco.current?.contentWindow?.focus(); marco.current?.contentWindow?.print() } catch { if (url) window.open(url, '_blank', 'noopener') }
  }
  return (
    <section className={`s-tarjeta s-trimestre-derecha s-trimestre-visor${completa ? ' s-trimestre-visor--completa' : ''}`} aria-labelledby="derecha-titulo" data-prueba="justificante">
      <div className="s-trimestre-derecha-cabeza">
        <h2 id="derecha-titulo" className="s-trimestre-derecha-titulo">Justificante de Hacienda</h2>
        {paginas !== null && <span className="s-apoyo">{paginas === 1 ? '1 página' : `${paginas} páginas`}</span>}
        {completa && <Boton variante="secundario" onClick={() => setCompleta(false)}>Cerrar</Boton>}
        {url && (
          <div className="s-trimestre-derecha-acciones">
            <div className="s-trimestre-zoom" role="group" aria-label="Zoom">
              <button type="button" className="s-trimestre-zoom-btn" aria-label="Alejar" disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))}>−</button>
              <span className="s-trimestre-zoom-valor" aria-live="polite">{ZOOM[zoom] === 'page-width' ? 'Ajustar' : `${ZOOM[zoom]} %`}</span>
              <button type="button" className="s-trimestre-zoom-btn" aria-label="Acercar" disabled={zoom === ZOOM.length - 1} onClick={() => setZoom((z) => Math.min(ZOOM.length - 1, z + 1))}>+</button>
            </div>
            <Boton variante="secundario" className="s-trimestre-ampliar" onClick={alAmpliar} aria-label={ampliado ? 'Reducir: volver a las tres columnas' : 'Ampliar: solo el justificante'}>{ampliado ? 'Reducir' : 'Ampliar'}</Boton>
            <a className={clasesBoton({ variante: 'secundario' })} href={url} download={nombre}><Icono nombre="descargar" /><span className="s-boton-texto">Descargar</span></a>
            <Boton variante="secundario" icono="imprimir" onClick={imprimir}>Imprimir</Boton>
            <a className={clasesBoton({ variante: 'secundario' })} href={url} target="_blank" rel="noopener noreferrer"><Icono nombre="abrirAparte" /><span className="s-boton-texto">Abrir aparte</span></a>
          </div>
        )}
      </div>
      {url && (
        <div className="s-trimestre-pdf-marco">
          {/* El hash cambia el zoom del visor de PDF del navegador; con otra clave, el iframe se vuelve a cargar con él. */}
          <iframe key={ZOOM[zoom]} ref={marco} className="s-trimestre-pdf-visor" src={`${url}#zoom=${ZOOM[zoom]}`} title={`Justificante de Hacienda: ${titulo}`} />
          {/* En el móvil, el PDF se toca para verlo a pantalla completa (lo enseña solo el CSS de móvil). */}
          {!completa && <button type="button" className="s-trimestre-pdf-tocar" onClick={() => setCompleta(true)}>Ver el justificante a pantalla completa</button>}
        </div>
      )}
      {fallo && <p className="s-impuestos-fallo" role="alert">{fallo}</p>}
      {!url && !fallo && <p className="s-apoyo s-trimestre-abriendo">Abriendo el justificante…</p>}
    </section>
  )
}

function Cartera({ d, alRecalcular }: { d: Trimestre; alRecalcular: () => void }) {
  const { lineas, total, cuadra } = lineasCartera(d)
  const desfase = fraseDesfasada(d)
  const fmt = (n: number | null) => (n === null ? '—' : eurosExactos(n))
  return (
    <section className="s-trimestre-cartera" aria-labelledby="cartera-titulo" data-prueba="cartera">
      <h3 id="cartera-titulo" className="s-trimestre-cartera-titulo">Cuotas a compensar de trimestres anteriores</h3>
      <table className="s-trimestre-cartera-tabla">
        <tbody>
          {lineas.map((l) => (
            <tr key={l.texto}>
              <th scope="row">{l.texto}{l.casilla && <span className="s-impuestos-casilla">{l.casilla}</span>}{l.nota && <span className="s-tabla-apoyo">{l.nota}</span>}</th>
              <td className="s-cifra">{fmt(l.importe)}</td>
            </tr>
          ))}
          <tr className="s-trimestre-cartera-total">
            <th scope="row">{total.texto}</th>
            <td className="s-cifra">{fmt(total.importe)}</td>
          </tr>
        </tbody>
      </table>
      <p className="s-apoyo">Sale de tus 303 presentados.{d.trimestre === '4T' ? ' En el 4T podrás elegir entre compensar o pedir la devolución.' : ''}</p>
      {cuadra === true && <p className="s-trimestre-ok">✓ Las cuotas a compensar casan con los 303 anteriores</p>}
      {cuadra === false && <p className="s-impuestos-porque-no" role="note">! Las cuotas a compensar no casan con los 303 anteriores: mira la [110] del {d.trimestre}.</p>}
      {desfase && (
        <div className="s-trimestre-desfase" role="note">
          <p>{desfase}</p>
          {d.puede_gestionar && d.cartera.borrador?.estado === 'reviewed' && (
            <Boton onClick={alRecalcular}>Volver a calcular el {d.trimestre} (vuelve a borrador)</Boton>
          )}
          {!d.puede_gestionar && <p className="s-apoyo">Lo puede volver a calcular un administrador o encargado de la empresa.</p>}
        </div>
      )}
    </section>
  )
}
