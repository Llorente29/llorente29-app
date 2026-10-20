// src/modules/conta/impuestos/TrimestrePage.tsx
//
// I01c · Pieza 3, la parte que ordena (Julio, 19/10) · Impuestos › Trimestre,
// fiel a maqueta_303_v2:
//   1. arriba, la tira del trimestre: un selector 1T/2T/3T/4T y, por cada
//      modelo (303, 111, 115 y 202), su estado, importe, fecha y justificante;
//   2. al pulsar un modelo, su ficha con el PDF (Presentados sigue siendo la
//      lista completa);
//   3. a la derecha, las cuotas a compensar del 303 trimestre a trimestre
//      ([110], [78], [87]), sacadas de los 303 presentados.
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
import { Boton, Chip, Tarjeta } from '@/modules/conta/diseno'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { diaMesCorto, eurosExactos, fechaLarga } from '@/modules/conta/lib/formato'
import { esCasillaDePersonas } from '@/modules/conta/lib/justificanteAeat'
import { calcular303, enlaceJustificante, leerTrimestre } from '@/modules/conta/services/impuestosService'
import { CASILLAS_303 } from './casillas303'
import { textoResultado } from './calendario'
import {
  estaPresentada, fraseDesfasada, fraseRecalculado, importeConSigno, lineasCartera, numeroTrimestre, tarjeta, tituloTrimestre, trimestrePorDefecto,
  type ModeloTrimestre, type Trimestre,
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
      const r = await calcular303(d.empresa.id, d.ejercicio, d.trimestre)
      const nuevo = await leerTrimestre(d.empresa.id, d.ejercicio, numeroTrimestre(d.trimestre)!)
      setLeido({ pedido: para, datos: nuevo, error: null })
      setHecho({ tono: 'ok', texto: fraseRecalculado(d.trimestre, d.cartera.esperada_110?.de ?? 'anterior', nuevo.cartera.borrador?.c110 ?? null) + (r.resultado === null ? ' El resultado sigue sin saberse: mira el IVA del trimestre.' : '') })
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
              {[ejercicio - 1, ejercicio, ...(ejercicio < Number(hoy().slice(0, 4)) ? [ejercicio + 1] : [])].map((y) => <option key={y} value={y}>{y}</option>)}
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
              const t = tarjeta(m)
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
          <div className="s-impuestos-columnas">
            <div className="s-impuestos-principal">
              {elegidoModelo && <Ficha key={`${clave(elegidoModelo)}/${elegidoModelo.declaracion?.justificante_pdf ?? ''}`} m={elegidoModelo} ejercicio={ejercicio} trimestre={trimestre} deRuta={!!deRuta} />}
            </div>
            <aside className="s-impuestos-lado">
              <Cartera d={datos} alRecalcular={() => void recalcular(datos, pedido)} />
            </aside>
          </div>
        </>
      )}
    </div>
  )
}

const clave = (m: ModeloTrimestre) => `${m.modelo}-${m.periodo ?? 'no'}`

function Ficha({ m, ejercicio, trimestre, deRuta }: { m: ModeloTrimestre; ejercicio: number; trimestre: string; deRuta: boolean }) {
  const d = m.declaracion
  // La ficha se monta de nuevo con cada modelo y cada PDF (key): empieza sin enlace.
  const [url, setUrl] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const pdf = d?.justificante_pdf ?? null
  useEffect(() => {
    if (!pdf) return
    let vivo = true
    enlaceJustificante(pdf).then((u) => { if (vivo) setUrl(u) }, (e: unknown) => { if (vivo) setFallo(msg(e)) })
    return () => { vivo = false }
  }, [pdf])
  const t = tarjeta(m)
  const v = d ? importeConSigno(d) : null
  const casillas = useMemo(() => (d?.casillas ?? []).filter((c) => c.valor !== null || c.texto), [d])
  const presentada = d && estaPresentada(d.estado)
  return (
    <section className="s-tarjeta s-trimestre-ficha" aria-labelledby="ficha-titulo" data-prueba="ficha-modelo">
      <div className="s-trimestre-ficha-datos">
        <div className="s-csv-cabeza">
          <h2 id="ficha-titulo" className="s-csv-titulo">{t.titulo}{m.periodo ? ` · ${m.periodo} ${ejercicio}` : ''}</h2>
          <Chip tono={t.chip.tono}>{t.chip.texto}</Chip>
        </div>
        {m.no_toca && <p className="s-apoyo">El pago a cuenta del Impuesto de sociedades se hace en abril (1P), octubre (2P) y diciembre (3P): en el {trimestre} no hay ninguno.</p>}
        {!m.no_toca && !d && (
          <p className="s-apoyo">Aún no está en Sumied. {m.presentacion ? `Se presenta hasta el ${fechaLarga(m.presentacion)}.` : ''} Si ya lo presentaste, súbelo en <Link to={rutaImpuestos('presentados')}>Presentados</Link>.</p>
        )}
        {d && (
          <dl className="s-csv-dl">
            <dt>Resultado</dt>
            <dd data-prueba="resultado-ficha">{v === null ? 'Sin calcular' : <><span className="s-cifra">{eurosExactos(Math.abs(v))}</span> · {textoResultado(d.resultado)}</>}</dd>
            {presentada ? (
              <>
                <dt>Presentado</dt><dd>{d.presentada ? `el ${fechaLarga(d.presentada.slice(0, 10))} a las ${new Date(d.presentada).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}` : '—'}{d.por === 'outside' ? ' · fuera de Sumied' : ''}</dd>
                <dt>Nº de justificante</dt><dd className="s-cifra">{d.justificante ?? '—'}</dd>
                <dt>CSV</dt><dd className="s-impuestos-csv">{d.csv ?? '—'}</dd>
                {d.expediente && <><dt>Expediente</dt><dd>{d.expediente}</dd></>}
                {d.presentador?.nombre && <><dt>Presentador</dt><dd>{d.presentador.nombre}{d.presentador.nif ? ` (${d.presentador.nif})` : ''}</dd></>}
              </>
            ) : (
              <><dt>Plazo</dt><dd>{m.presentacion ? `hasta el ${fechaLarga(m.presentacion)}` : '—'}{m.domiciliacion ? ` · domiciliado hasta el ${diaMesCorto(m.domiciliacion)}` : ''}</dd></>
            )}
          </dl>
        )}
        {casillas.length > 0 && (
          <details className="s-csv-casillas" open={!!presentada}>
            <summary>{casillas.length} casillas{presentada ? ' del justificante' : ''}</summary>
            <table className="s-tabla s-justificantes-dif-tabla">
              <thead><tr><th scope="col">Casilla</th><th scope="col">Qué es</th><th scope="col" className="s-tabla-cifra">Importe</th></tr></thead>
              <tbody>{casillas.map((c) => (
                <tr key={c.casilla}>
                  <td><span className="s-impuestos-casilla">[{c.casilla}]</span>{c.origen === 'manual' && <span title={c.motivo ?? 'Escrita a mano'}> ✎</span>}</td>
                  <td>{m.modelo === '303' ? CASILLAS_303[c.casilla]?.texto ?? '' : ''}</td>
                  <td className="s-tabla-cifra">{c.valor === null ? c.texto
                    : esCasillaDePersonas(m.modelo, c.casilla) ? `${c.valor} ${c.valor === 1 ? 'persona' : 'personas'}`
                    : m.modelo === '303' && c.casilla === '65' ? `${String(c.valor).replace('.', ',')} %` : eurosExactos(c.valor)}</td>
                </tr>
              ))}</tbody>
            </table>
          </details>
        )}
        {m.modelo === '303' && m.periodo && !deRuta && (
          <p><Link to={rutaIvaPeriodo(ejercicio, m.periodo)}>{presentada ? 'Ver el IVA del trimestre' : 'Abrir el IVA del trimestre para revisarlo'} →</Link></p>
        )}
      </div>
      {pdf && (
        <div className="s-trimestre-pdf">
          {url && <iframe className="s-csv-pdf-visor" src={url} title={`Justificante de Hacienda: ${t.titulo}`} />}
          {url && <a href={url} target="_blank" rel="noopener noreferrer">Abrir el PDF ↗</a>}
          {fallo && <p className="s-impuestos-fallo" role="alert">{fallo}</p>}
          {!url && !fallo && <p className="s-apoyo">Abriendo el justificante…</p>}
        </div>
      )}
      {d && presentada && !pdf && <p className="s-apoyo s-trimestre-sinpdf">Falta el justificante en PDF: súbelo en <Link to={rutaImpuestos('presentados')}>Presentados</Link>.</p>}
    </section>
  )
}

function Cartera({ d, alRecalcular }: { d: Trimestre; alRecalcular: () => void }) {
  const { lineas, total, cuadra } = lineasCartera(d)
  const desfase = fraseDesfasada(d)
  const fmt = (n: number | null) => (n === null ? '—' : eurosExactos(n))
  return (
    <section className="s-tarjeta s-trimestre-cartera" aria-labelledby="cartera-titulo" data-prueba="cartera">
      <h2 id="cartera-titulo" className="s-trimestre-cartera-titulo">Cuotas a compensar de trimestres anteriores</h2>
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
