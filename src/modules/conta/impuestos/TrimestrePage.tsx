// src/modules/conta/impuestos/TrimestrePage.tsx
//
// I01c · Pieza 3, la parte que ordena · Impuestos › Trimestre, fiel a
// maqueta_303_v2 y a la revisión de Julio del 20/10:
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
import { rutaImpuestos, rutaIvaPeriodo, rutaTrimestre } from '@/config/navegacion'
import { Boton, BotonEnlace, Chip, Icono, Tarjeta } from '@/modules/conta/diseno'
import { clasesBoton } from '@/modules/conta/diseno/valores'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { diaMesCorto, eurosExactos, fechaLarga } from '@/modules/conta/lib/formato'
import { esCasillaDePersonas } from '@/modules/conta/lib/justificanteAeat'
import { pdfjs } from '@/modules/conta/plan/leerFicheros'
import { calcular303, enlaceJustificante, leerTrimestre } from '@/modules/conta/services/impuestosService'
import { queEsLaCasilla } from './casillasModelos'
import { textoResultado } from './calendario'
import {
  CASILLA_RESULTADO, estaPresentada, fraseDesfasada, fraseRecalculado, importeConSigno, lineasCartera, numeroTrimestre, presentadorEnPalabras,
  tarjeta, tituloTrimestre, trimestrePorDefecto,
  type CasillaTrimestre, type ModeloTrimestre, type Trimestre,
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
            <div className="s-trimestre-cuerpo">
              <Ficha key={clave(elegidoModelo)} m={elegidoModelo} d={datos} ejercicio={ejercicio} trimestre={trimestre} deRuta={!!deRuta}
                hoy={dia} alRecalcular={() => void recalcular(datos, pedido)} />
              <Derecha key={`${clave(elegidoModelo)}/${elegidoModelo.declaracion?.justificante_pdf ?? ''}`} m={elegidoModelo}
                ejercicio={ejercicio} trimestre={trimestre} deRuta={!!deRuta} />
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
  if ((modelo === '303' && c.casilla === '65') || (modelo === '202' && c.casilla === '17')) return `${String(c.valor).replace('.', ',')} %`
  return eurosExactos(c.valor)
}

/** Lo de la izquierda: el modelo elegido, sus datos y sus casillas; con el 303, la cartera debajo. */
function Ficha({ m, d: datos, ejercicio, trimestre, deRuta, hoy, alRecalcular }: {
  m: ModeloTrimestre; d: Trimestre; ejercicio: number; trimestre: string; deRuta: boolean; hoy: string; alRecalcular: () => void
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
      {casillas.length > 0 && (
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
      )}
      {m.modelo === '303' && <Cartera d={datos} alRecalcular={alRecalcular} />}
      {m.modelo === '303' && m.periodo && !deRuta && (
        <p className="s-trimestre-acciones">
          <BotonEnlace a={rutaIvaPeriodo(ejercicio, m.periodo)}>{presentada ? 'Ver el IVA del trimestre' : 'Abrir el IVA del trimestre'}</BotonEnlace>
        </p>
      )}
    </section>
  )
}

/**
 * Lo de la derecha: el justificante en grande; sin él, el impreso calculado
 * por Sumied (con sus casillas) o qué falta y el botón para hacerlo.
 */
function Derecha({ m, ejercicio, trimestre, deRuta }: { m: ModeloTrimestre; ejercicio: number; trimestre: string; deRuta: boolean }) {
  const d = m.declaracion
  const pdf = d?.justificante_pdf ?? null
  if (pdf) {
    return <VisorJustificante ruta={pdf} nombre={`justificante-${m.modelo}-${m.periodo ?? ''}-${ejercicio}.pdf`} titulo={`${tarjeta(m).titulo} · ${m.periodo ?? ''} ${ejercicio}`} />
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
function VisorJustificante({ ruta, nombre, titulo }: { ruta: string; nombre: string; titulo: string }) {
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
    <section className="s-tarjeta s-trimestre-derecha s-trimestre-visor" aria-labelledby="derecha-titulo" data-prueba="justificante">
      <div className="s-trimestre-derecha-cabeza">
        <h2 id="derecha-titulo" className="s-trimestre-derecha-titulo">Justificante de Hacienda</h2>
        {paginas !== null && <span className="s-apoyo">{paginas === 1 ? '1 página' : `${paginas} páginas`}</span>}
        {url && (
          <div className="s-trimestre-derecha-acciones">
            <a className={clasesBoton({ variante: 'secundario' })} href={url} download={nombre}><Icono nombre="descargar" /><span className="s-boton-texto">Descargar</span></a>
            <Boton variante="secundario" icono="imprimir" onClick={imprimir}>Imprimir</Boton>
            <a className={clasesBoton({ variante: 'secundario' })} href={url} target="_blank" rel="noopener noreferrer"><Icono nombre="abrirAparte" /><span className="s-boton-texto">Abrir aparte</span></a>
          </div>
        )}
      </div>
      {url && <iframe ref={marco} className="s-trimestre-pdf-visor" src={url} title={`Justificante de Hacienda: ${titulo}`} />}
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
