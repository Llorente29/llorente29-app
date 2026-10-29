// src/modules/conta/impuestos/AnualPage.tsx
//
// S02 · Impuestos › El año. Los modelos anuales (390, 190, 180, 347 y 349)
// con las piezas del trimestre (TrimestrePage), no una pantalla nueva: arriba,
// el selector del año y la tira de modelos con su estado y su plazo; debajo,
// en tres columnas, la ficha del modelo elegido (casillas en palabras,
// calcular, revisar, «ya lo presenté fuera» y el fichero), en el centro el
// justificante o lo calculado (en el 190, sus perceptores) y a la derecha lo
// comprobado, cada aviso con el asiento o la ficha que lo causa.
//
// Hoy Sumied calcula el 190 (de los 111 del año). Los demás se presentan fuera
// y se apuntan aquí con su CSV: quedan presentados y con candado.
// Cada botón dice lo que ha hecho, con su cifra (regla 8).

import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { rutaAnual, rutaAsiento, rutaImpuestos, rutaTrimestre } from '@/config/navegacion'
import { Boton, Campo, Chip, Tarjeta } from '@/modules/conta/diseno'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { eurosExactos, fechaLarga } from '@/modules/conta/lib/formato'
import {
  aceptarAviso, calcular190, comprobacionesConAviso, hacienda, informativaFuera, leerAnual, perceptores190, revisarDeclaracion, type Perceptor190,
} from '@/modules/conta/services/impuestosService'
import { CALCULA_SUMIED, claveEnPalabras, ejercicioPorDefecto, perceptoresEnOrden, porQueNoFichero, queFaltaAnual, sinTrabajadorEnPalabras, tarjetaAnual } from './anual'
import { estaPresentada, presentadorEnPalabras, type ModeloTrimestre, type Trimestre } from './trimestre'
import { BotonCalcular, TablaCasillas, VisorJustificante } from './TrimestrePage'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
type Hecho = { tono: 'ok' | 'falta'; texto: string }
type Check = Awaited<ReturnType<typeof comprobacionesConAviso>>[number]

export default function AnualPage() {
  const { ejercicio: ej, modelo = '' } = useParams<{ ejercicio: string; modelo: string }>()
  const { activa } = useEmpresas()
  const companyId = activa?.id ?? null
  const ejercicio = Number(ej)
  const navegar = useNavigate()
  const [vuelta, setVuelta] = useState(0)
  const pedido = `${companyId}/${ejercicio}/${vuelta}`
  const [leido, setLeido] = useState<{ pedido: string; datos: Trimestre | null; error: string | null } | null>(null)
  const datos = leido?.pedido === pedido ? leido.datos : null
  const error = leido?.pedido === pedido ? leido.error : null
  const [hecho, setHecho] = useState<Hecho | null>(null)
  const [ampliado, setAmpliado] = useState(false)
  const dia = hoy()

  useEffect(() => {
    if (!companyId || !Number.isInteger(ejercicio)) return
    let vivo = true
    leerAnual(companyId, ejercicio).then(
      (d) => { if (vivo) setLeido({ pedido, datos: d, error: null }) },
      (e: unknown) => { if (vivo) setLeido({ pedido, datos: null, error: msg(e) }) })
    return () => { vivo = false }
  }, [companyId, ejercicio, pedido])

  if (!companyId) {
    return <div className="s-pantalla"><Tarjeta titulo="Aún no hay ninguna empresa"><p className="s-apoyo">Da de alta tu empresa y aquí verás sus modelos del año.</p></Tarjeta></div>
  }
  if (!Number.isInteger(ejercicio)) return <Navigate to={rutaAnual(ejercicioPorDefecto(dia), modelo || '190')} replace />

  const ir = (y: number, m: string) => { setHecho(null); navegar(rutaAnual(y, m)) }
  const alHacer = (h: Hecho) => { setHecho(h); if (h.tono === 'ok') setVuelta((v) => v + 1) }
  const modelos = datos?.modelos ?? []
  const elegido = modelos.find((m) => m.modelo === modelo) ?? modelos[0] ?? null
  const anoHoy = Number(dia.slice(0, 4))

  return (
    <div className="s-pantalla s-impuestos s-trimestre s-anual">
      <nav aria-label="Migas" className="s-impuestos-migas">
        <Link to={rutaImpuestos()}>Impuestos</Link> › El año {ejercicio}
      </nav>
      <div className="s-trimestre-cabeza">
        <h1 className="s-impuestos-titulo">Los modelos del año</h1>
        <div className="s-trimestre-selector">
          <label className="s-trimestre-ano">
            <span className="cx-oculto">Ejercicio</span>
            <select className="s-control" value={ejercicio} onChange={(e) => ir(Number(e.target.value), modelo)}>
              {[ejercicio - 1, ejercicio, ...(ejercicio < anoHoy ? [ejercicio + 1] : [])].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <Link className="s-apoyo" to={rutaTrimestre(ejercicio, '4T')}>Ver los trimestres</Link>
        </div>
      </div>

      {error && (
        <Tarjeta titulo="No se han podido leer los modelos del año" tono="falta" accion={<Boton onClick={() => setVuelta((v) => v + 1)}>Volver a intentar</Boton>}>
          <p className="s-apoyo">{error}</p>
        </Tarjeta>
      )}
      {!error && !datos && <Tarjeta titulo="Leyendo los modelos del año…"><p className="s-apoyo">Un momento.</p></Tarjeta>}
      {hecho && <p className={hecho.tono === 'ok' ? 's-impuestos-hecho' : 's-impuestos-fallo'} role={hecho.tono === 'ok' ? 'status' : 'alert'} data-prueba="anual-hecho">{hecho.texto}</p>}

      {datos && (
        <>
          <ul className="s-trimestre-tira" aria-label={`Modelos de ${ejercicio}`}>
            {modelos.map((m) => {
              const t = tarjetaAnual(m, dia, ejercicio, datos.desde)
              return (
                <li key={m.modelo}>
                  <button type="button" className="s-trimestre-tarjeta" aria-pressed={elegido?.modelo === m.modelo} onClick={() => ir(ejercicio, m.modelo)}>
                    <span className="s-trimestre-tarjeta-nombre">{t.titulo}</span>
                    <span className="s-cifra s-trimestre-tarjeta-importe">{t.importe}</span>
                    <Chip tono={t.chip.tono}>{t.chip.texto}</Chip>
                  </button>
                </li>
              )
            })}
            {modelos.length === 0 && <li className="s-apoyo">Esta empresa no tiene modelos anuales en sus impuestos.</li>}
          </ul>
          {elegido && (
            <Cuerpo key={`${elegido.modelo}/${vuelta}`} m={elegido} d={datos} ejercicio={ejercicio} hoy={dia} ampliado={ampliado}
              alAmpliar={() => setAmpliado((a) => !a)} alHacer={alHacer} />
          )}
        </>
      )}
    </div>
  )
}

/** Las tres columnas del modelo elegido. Lo comprobado y los perceptores se leen una vez y los usan las tres. */
function Cuerpo({ m, d: datos, ejercicio, hoy, ampliado, alAmpliar, alHacer }: {
  m: ModeloTrimestre; d: Trimestre; ejercicio: number; hoy: string; ampliado: boolean; alAmpliar: () => void; alHacer: (h: Hecho) => void
}) {
  const decl = m.declaracion
  const [leido, setLeido] = useState<{ checks: Check[]; perceptores: Perceptor190[]; fallo: string | null } | null>(null)
  useEffect(() => {
    if (!decl) return
    let vivo = true
    Promise.all([comprobacionesConAviso(decl.id, decl.cuenta), m.modelo === '190' ? perceptores190(decl.id, decl.cuenta) : Promise.resolve([] as Perceptor190[])])
      .then(([checks, perceptores]) => { if (vivo) setLeido({ checks, perceptores, fallo: null }) },
        (e: unknown) => { if (vivo) setLeido({ checks: [], perceptores: [], fallo: msg(e) }) })
    return () => { vivo = false }
  }, [decl, m.modelo])
  return (
    <div className={`s-trimestre-cuerpo${ampliado ? ' s-trimestre-cuerpo--ampliado' : ''}`} data-prueba="cuerpo">
      <div className="s-trimestre-col s-trimestre-col-izq">
        <Ficha m={m} d={datos} ejercicio={ejercicio} hoy={hoy} checks={decl ? leido?.checks ?? null : []} alHacer={alHacer} />
      </div>
      <div className="s-trimestre-col s-trimestre-col-centro">
        {decl?.justificante_pdf
          ? <VisorJustificante ruta={decl.justificante_pdf} nombre={`justificante-${m.modelo}-${ejercicio}.pdf`} titulo={`${m.modelo} · ${ejercicio}`} ampliado={ampliado} alAmpliar={alAmpliar} />
          : <Centro m={m} ejercicio={ejercicio} perceptores={leido?.perceptores ?? null} />}
      </div>
      <div className="s-trimestre-col s-trimestre-col-der">
        <Comprobado m={m} checks={leido?.checks ?? null} fallo={leido?.fallo ?? null} alHacer={alHacer} />
      </div>
    </div>
  )
}

/** La izquierda: el modelo, su plazo o cuándo se presentó, sus casillas en palabras y lo que se hace con él. */
function Ficha({ m, d: datos, ejercicio, hoy, checks, alHacer }: {
  m: ModeloTrimestre; d: Trimestre; ejercicio: number; hoy: string; checks: Check[] | null; alHacer: (h: Hecho) => void
}) {
  const d = m.declaracion
  const t = tarjetaAnual(m, hoy, ejercicio, datos.desde)
  const presentada = !!d && estaPresentada(d.estado)
  const casillas = useMemo(() => (d?.casillas ?? []).filter((c) => c.valor !== null || c.texto), [d])
  const presentador = d ? presentadorEnPalabras(d.presentador, datos.empresa.nif) : null
  const falta = queFaltaAnual(m)
  const gestiona = datos.puede_gestionar
  return (
    <section className="s-tarjeta s-trimestre-ficha" aria-labelledby="ficha-titulo" data-prueba="ficha-modelo">
      <div className="s-trimestre-ficha-cabeza">
        <h2 id="ficha-titulo" className="s-trimestre-ficha-titulo">{t.titulo} · {ejercicio}</h2>
        <Chip tono={t.chip.tono}>{t.chip.texto}</Chip>
      </div>
      <dl className="s-trimestre-dl">
        <dt>Qué es</dt><dd>{m.nombre}. Es informativo: no se paga.</dd>
        {presentada && d ? (
          <>
            <dt>Presentado</dt><dd>{d.presentada ? fechaLarga(d.presentada.slice(0, 10)) : '—'}{d.por === 'outside' ? ' · fuera de Sumied' : ''}</dd>
            <dt>CSV</dt><dd className="s-impuestos-csv">{d.csv ?? '—'}</dd>
            {d.justificante && <><dt>Justificante</dt><dd className="s-cifra">nº {d.justificante}</dd></>}
            {presentador && <><dt>Presentador</dt><dd>{presentador}</dd></>}
          </>
        ) : (
          <><dt>Plazo</dt><dd>{m.presentacion ? `hasta el ${fechaLarga(m.presentacion)}` : '—'}</dd></>
        )}
      </dl>
      {presentada && <p className="s-apoyo" data-prueba="candado">🔒 Presentado: ya no se recalcula.</p>}
      {!presentada && gestiona && <Preparar m={m} d={datos} ejercicio={ejercicio} checks={checks} alHacer={alHacer} />}
      {!presentada && !gestiona && <p className="s-apoyo">Lo calcula y lo apunta un administrador o encargado de la empresa.</p>}
      {!presentada && !CALCULA_SUMIED.has(m.modelo) && <p className="s-apoyo">{falta.texto}</p>}
      {casillas.length > 0 && <TablaCasillas m={m} casillas={casillas} resultado={undefined} />}
    </section>
  )
}

/** Calcular, revisar, el fichero y «ya lo presenté fuera». Cada botón dice lo que ha hecho. */
function Preparar({ m, d: datos, ejercicio, checks, alHacer }: { m: ModeloTrimestre; d: Trimestre; ejercicio: number; checks: Check[] | null; alHacer: (h: Hecho) => void }) {
  const d = m.declaracion
  const [fuera, setFuera] = useState(false)
  const calcula = CALCULA_SUMIED.has(m.modelo)
  const calcular = async () => {
    try {
      const c = await calcular190(datos.empresa.id, ejercicio)
      const cosas = [c.errores ? `${c.errores} ${c.errores === 1 ? 'cosa' : 'cosas'} por resolver` : null, c.avisos ? `${c.avisos} ${c.avisos === 1 ? 'aviso' : 'avisos'}` : null].filter(Boolean)
      alHacer({ tono: 'ok', texto: `Calculado el 190 de ${ejercicio}: ${c.perceptores} ${c.perceptores === 1 ? 'línea' : 'líneas'} de perceptor y ${eurosExactos(c.casillas['03'] ?? 0)} retenidos${cosas.length ? `; ${cosas.join(' y ')} en «Lo comprobado»` : ', y todo cuadra'}.` })
    } catch (e) { alHacer({ tono: 'falta', texto: `No se ha calculado el 190 de ${ejercicio}: ${msg(e)}` }) }
  }
  const noFichero = calcula ? porQueNoFichero(m, checks) : null
  const errores = (checks ?? []).filter((c) => c.resultado === 'error').length
  const bajar = async () => {
    const s = await hacienda('fichero_190', { declaracion: d!.id })
    if (!s.ok) { alHacer({ tono: 'falta', texto: `No se ha descargado: ${s.mensaje}` }); return }
    const texto = String(s.fichero ?? '')
    const bytes = Uint8Array.from(texto, (ch) => ch.charCodeAt(0) & 0xff) // ISO-8859-1, como pide el anexo
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'text/plain;charset=iso-8859-1' }))
    a.download = String(s.nombre ?? `190_${ejercicio}.txt`)
    a.click()
    URL.revokeObjectURL(a.href)
    alHacer({ tono: 'ok', texto: `Descargado ${a.download}: ${s.mensaje}` })
  }
  return (
    <section className="s-trimestre-preparar" aria-label={`Preparar el ${m.modelo}`} data-prueba="preparar">
      {calcula && (!d || d.estado === 'pending') && (
        <>
          <p className="s-apoyo">{queFaltaAnual(m).texto}</p>
          <p><BotonCalcular texto={`Calcular el ${m.modelo} de ${ejercicio}`} alCalcular={calcular} /></p>
        </>
      )}
      {calcula && d && d.estado === 'draft' && (
        <div className="s-impuestos-fila-botones">
          {d.resultado !== null && errores === 0 && checks && (
            <BotonCalcular texto="Revisado: pasar a presentar" alCalcular={async () => {
              try {
                const r = await revisarDeclaracion(d.id) as { mensaje?: string }
                const dicho = (r?.mensaje ?? 'Revisado.').replace(/Quedan 1 avisos sin dar por buenos/, 'Queda 1 aviso sin dar por bueno')
                alHacer({ tono: 'ok', texto: `${dicho} El ${m.modelo} de ${ejercicio} queda listo para presentar.` })
              } catch (e) { alHacer({ tono: 'falta', texto: `No se ha dado por revisado: ${msg(e)}` }) }
            }} />
          )}
          <BotonCalcular variante="enlace" texto="Volver a calcular con lo que hay ahora en el diario" alCalcular={calcular} />
        </div>
      )}
      {calcula && d && d.estado === 'reviewed' && (
        <div className="s-trimestre-listo">
          <p className="s-trimestre-ok">✓ Revisado: listo para presentar.</p>
          <p className="s-apoyo">Presentar desde Sumied sigue cerrado hasta que se abra la conexión con Hacienda. Baja el fichero, preséntalo fuera y apúntalo aquí con su CSV.</p>
          <BotonCalcular variante="enlace" texto="Volver a calcular (vuelve a borrador)" alCalcular={calcular} />
        </div>
      )}
      {calcula && d && d.estado !== 'pending' && (
        <div className="s-impuestos-fila-botones">
          <BotonCalcular variante="secundario" texto="Descargar el fichero oficial" alCalcular={bajar} />
          {noFichero && <p className="s-impuestos-porque-no" role="note" data-prueba="por-que-no-fichero">{noFichero}</p>}
        </div>
      )}
      {!fuera && <p><Boton variante="enlace" onClick={() => setFuera(true)}>Ya lo presenté fuera · pegar CSV</Boton></p>}
      {fuera && <Fuera companyId={datos.empresa.id} modelo={m.modelo} ejercicio={ejercicio} alCerrar={() => setFuera(false)} alHacer={alHacer} />}
    </section>
  )
}

/** «Ya lo presenté fuera»: el CSV, la fecha y, si se tiene, el número de justificante. */
function Fuera({ companyId, modelo, ejercicio, alCerrar, alHacer }: { companyId: string; modelo: string; ejercicio: number; alCerrar: () => void; alHacer: (h: Hecho) => void }) {
  const [csv, setCsv] = useState('')
  const [fecha, setFecha] = useState('')
  const [justificante, setJustificante] = useState('')
  const [haciendo, setHaciendo] = useState(false)
  const limpio = csv.replace(/\s/g, '').toUpperCase()
  const csvVale = /^[A-Z0-9]{16}$/.test(limpio)
  return (
    <form className="s-trimestre-perceptores" data-prueba="fuera" onSubmit={async (e) => {
      e.preventDefault()
      if (!csvVale || !fecha) return
      setHaciendo(true)
      try {
        const r = await informativaFuera(companyId, modelo, ejercicio, limpio, fecha, justificante.trim() || null)
        alHacer({ tono: 'ok', texto: r.mensaje })
      } catch (x) { alHacer({ tono: 'falta', texto: `No se ha apuntado: ${msg(x)}` }) } finally { setHaciendo(false) }
    }}>
      <p className="s-trimestre-perceptores-titulo">Ya presenté el {modelo} de {ejercicio} fuera de Sumied</p>
      <p className="s-apoyo">Con el CSV del justificante queda apuntado como presentado y ya no se recalcula.</p>
      <div className="s-trimestre-perceptores-campos">
        <Campo etiqueta="CSV del justificante" error={csv && !csvVale ? '16 letras y números, como lo da Hacienda.' : null}>
          {(p) => <input {...p} className="s-control" autoComplete="off" value={csv} onChange={(e) => setCsv(e.target.value)} />}
        </Campo>
        <Campo etiqueta="Fecha de presentación">
          {(p) => <input {...p} type="date" className="s-control" value={fecha} onChange={(e) => setFecha(e.target.value)} />}
        </Campo>
        <Campo etiqueta="Número de justificante" ayuda="Si lo tienes a mano.">
          {(p) => <input {...p} className="s-control s-cifra" inputMode="numeric" value={justificante} onChange={(e) => setJustificante(e.target.value)} />}
        </Campo>
      </div>
      <div className="s-impuestos-fila-botones">
        <Boton type="submit" variante="principal" disabled={haciendo || !csvVale || !fecha}>{haciendo ? 'Guardando…' : 'Apuntar como presentado'}</Boton>
        <Boton variante="enlace" onClick={alCerrar}>Cancelar</Boton>
      </div>
    </form>
  )
}

/** El centro sin justificante: en el 190, sus perceptores (lo que irá en el fichero); en los demás, qué falta. */
function Centro({ m, ejercicio, perceptores }: { m: ModeloTrimestre; ejercicio: number; perceptores: Perceptor190[] | null }) {
  const d = m.declaracion
  if (m.modelo !== '190' || !d || d.estado === 'pending') {
    const f = queFaltaAnual(m)
    return (
      <section className="s-tarjeta s-trimestre-derecha s-trimestre-falta" aria-labelledby="derecha-titulo" data-prueba="que-falta">
        <h2 id="derecha-titulo" className="s-trimestre-derecha-titulo">{estaPresentada(d?.estado) ? 'Presentado fuera, sin el PDF' : f.titulo}</h2>
        <p className="s-apoyo">{estaPresentada(d?.estado) ? `Está apuntado con su CSV. El PDF del justificante de los anuales aún no se lee en Sumied.` : f.texto}</p>
      </section>
    )
  }
  const filas = perceptoresEnOrden(perceptores ?? [])
  const con = filas.filter((p) => p.falta.length > 0).length
  return (
    <section className="s-tarjeta s-trimestre-derecha" aria-labelledby="derecha-titulo" data-prueba="perceptores-190">
      <div className="s-trimestre-derecha-cabeza">
        <h2 id="derecha-titulo" className="s-trimestre-derecha-titulo">Los perceptores del {ejercicio}</h2>
        <span className="s-apoyo">{perceptores === null ? 'Leyendo…' : `${filas.length} ${filas.length === 1 ? 'línea' : 'líneas'}${con ? ` · ${con} con algo que corregir, arriba` : ''}`}</span>
      </div>
      {perceptores !== null && filas.length === 0 && <p className="s-apoyo">En el año no hay nada retenido a nadie.</p>}
      {filas.length > 0 && (
        <table className="s-trimestre-casillas s-anual-perceptores" aria-label="Perceptores del 190">
          <thead><tr><th scope="col">Quién</th><th scope="col" className="s-tabla-cifra">Pagado</th><th scope="col" className="s-tabla-cifra">Retenido</th></tr></thead>
          <tbody>{filas.map((p, i) => (
            <tr key={`${p.clave}/${p.nif ?? ''}/${i}`} data-falta={p.falta.length ? 'si' : undefined}>
              <td>
                {p.sin_trabajador ? <strong>{sinTrabajadorEnPalabras(p).titulo}</strong> : <strong>{p.nombre ?? 'Sin nombre'}</strong>}
                <span className="s-tabla-apoyo">{p.sin_trabajador ? sinTrabajadorEnPalabras(p).apoyo : `${p.nif ?? 'sin NIF'}${p.provincia ? ` · provincia ${p.provincia}` : ''}`}</span>
                <span className="s-tabla-apoyo">Clave {p.clave}{p.subclave ? `.${p.subclave}` : ''} · {claveEnPalabras(p.clave, p.subclave)}</span>
                {p.falta.length > 0 && <span className="s-impuestos-aviso">! {p.falta.join(', ')}</span>}
              </td>
              <td className="s-tabla-cifra s-cifra">{eurosExactos(p.integra)}</td>
              <td className="s-tabla-cifra s-cifra">{eurosExactos(p.retenciones)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </section>
  )
}

/** Lo comprobado: cada aviso con lo que lo causa (el asiento o el perceptor), y «Dar por bueno» en los avisos. */
function Comprobado({ m, checks, fallo, alHacer }: { m: ModeloTrimestre; checks: Check[] | null; fallo: string | null; alHacer: (h: Hecho) => void }) {
  const decl = m.declaracion
  const orden = { error: 0, warning: 1, ok: 2 } as const
  const lista = [...(checks ?? [])].sort((a, b) => orden[a.resultado] - orden[b.resultado])
  return (
    <section className="s-tarjeta s-trimestre-comprobado" aria-labelledby="comp-titulo" data-prueba="comprobado">
      <h3 id="comp-titulo" className="s-trimestre-cartera-titulo">Lo comprobado</h3>
      {!decl && <p className="s-apoyo">{CALCULA_SUMIED.has(m.modelo) ? 'Al calcularlo, Sumied comprueba que suma lo mismo que los 111 del año y que cada perceptor tiene su NIF y su provincia.' : `Del ${m.modelo} no hay comprobaciones todavía.`}</p>}
      {decl && !checks && !fallo && <p className="s-apoyo">Leyendo…</p>}
      {fallo && <p className="s-impuestos-fallo" role="alert">{fallo}</p>}
      {lista.length > 0 && (
        <ul className="s-trimestre-checks" aria-label="Lo que comprobó Sumied al calcularlo">
          {lista.map((c) => <li key={c.id} data-resultado={c.resultado}><Aviso c={c} presentada={estaPresentada(decl?.estado)} alHacer={alHacer} /></li>)}
        </ul>
      )}
    </section>
  )
}

type Asiento = { asiento: string; fecha: string; serie: number | null; numero: number | null }

/** Un aviso: su frase, lo que lo causa con enlace, y «Dar por bueno» si es un aviso (no un error). */
function Aviso({ c, presentada, alHacer }: { c: Check; presentada: boolean; alHacer: (h: Hecho) => void }) {
  const [motivo, setMotivo] = useState('')
  const [abierto, setAbierto] = useState(false)
  const det = c.detalle ?? {}
  const asientos: Asiento[] = [
    ...((det.asientos as Asiento[] | undefined) ?? []),
    ...(((det.lineas as { asientos?: Asiento[] }[] | undefined) ?? []).flatMap((l) => l.asientos ?? [])),
  ]
  const perceptores = ((det.perceptores as Perceptor190[] | undefined) ?? [])
  const periodos = c.clave === 'sum_111_vs_190'
    ? ((det.periodos as { periodo: string; base_111: number; retenido_111: number; base_diario: number; retenido_diario: number; declaracion: string | null }[] | undefined) ?? [])
    : []
  const casa = (a: number, b: number) => Math.abs(a - b) < 0.005
  return (
    <>
      {c.resultado === 'ok' ? '✓ ' : '! '}{c.titulo}
      {c.aceptado && <span className="s-tabla-apoyo">Dado por bueno: {c.motivo}</span>}
      {c.resultado !== 'ok' && perceptores.length > 0 && (
        <ul className="s-anual-causa">{perceptores.map((p, i) => <li key={i}>{p.nombre ?? 'Sin nombre'} · {p.nif ?? 'sin NIF'}{p.clave === 'G' ? ' · corrígelo en su ficha de proveedor' : ''}</li>)}</ul>
      )}
      {c.resultado !== 'ok' && asientos.length > 0 && (
        <ul className="s-anual-causa">{asientos.slice(0, 12).map((a) => (
          <li key={a.asiento}><Link to={rutaAsiento(a.asiento)}>Asiento {a.serie ?? ''}/{a.numero ?? ''} · {fechaLarga(a.fecha)}</Link></li>
        ))}{asientos.length > 12 && <li className="s-apoyo">y {asientos.length - 12} más</li>}</ul>
      )}
      {c.resultado === 'warning' && periodos.length > 0 && (
        <table className="s-trimestre-cuadre" aria-label="El 190 y los 111">
          <thead><tr><th scope="col">Periodo</th><th scope="col" className="s-tabla-cifra">El 111</th><th scope="col" className="s-tabla-cifra">El diario</th></tr></thead>
          <tbody>{periodos.map((p) => {
            const vacio = !p.declaracion && casa(p.base_diario, 0) && casa(p.retenido_diario, 0)
            const bien = vacio || (!!p.declaracion && casa(p.base_111, p.base_diario) && casa(p.retenido_111, p.retenido_diario))
            return (
              <tr key={p.periodo} data-casa={bien ? 'si' : 'no'}>
                <th scope="row">{bien ? '✓ ' : '! '}{p.periodo}{p.declaracion ? '' : ' · sin 111'}</th>
                <td className="s-tabla-cifra s-cifra">{p.declaracion ? <>{eurosExactos(p.retenido_111)}<span className="s-tabla-apoyo">base {eurosExactos(p.base_111)}</span></> : '—'}</td>
                <td className="s-tabla-cifra s-cifra">{eurosExactos(p.retenido_diario)}<span className="s-tabla-apoyo">base {eurosExactos(p.base_diario)}</span></td>
              </tr>
            )
          })}</tbody>
        </table>
      )}
      {c.resultado === 'warning' && !c.aceptado && !presentada && (abierto ? (
        <form className="s-impuestos-fila-botones" onSubmit={async (e) => {
          e.preventDefault()
          try { const r = await aceptarAviso(c.id, motivo.trim()) as { mensaje?: string }; alHacer({ tono: 'ok', texto: r?.mensaje ?? 'Dado por bueno.' }) } catch (x) { alHacer({ tono: 'falta', texto: `No se ha dado por bueno: ${msg(x)}` }) }
        }}>
          <Campo etiqueta="Por qué está bien">{(p) => <input {...p} className="s-control" value={motivo} onChange={(e) => setMotivo(e.target.value)} />}</Campo>
          <Boton type="submit" disabled={!motivo.trim()}>Dar por bueno</Boton>
        </form>
      ) : <Boton variante="enlace" onClick={() => setAbierto(true)}>Dar por bueno…</Boton>)}
    </>
  )
}
