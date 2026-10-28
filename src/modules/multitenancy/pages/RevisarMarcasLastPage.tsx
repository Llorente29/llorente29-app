// src/modules/multitenancy/pages/RevisarMarcasLastPage.tsx
//
// F01 · PR 3 · tablero 4: «Una marca que ya tienes llega con otro código».
// Last a veces cambia el código de una marca:
//   · si la carta es idéntica, Folvy la une sola (la pasada de cada hora) y
//     aquí solo avisa de lo que ha hecho, hasta «Entendido»;
//   · si se parece, pregunta con las dos cartas una al lado de la otra:
//     «Sí, es …» (sus ventas pasan a esa marca y descuentan almacén con sus
//     recetas, desde el último recuento cerrado) o «No, es otra marca» (se da de
//     alta como nueva, en Marcas);
//   · las ventas de Last sin marca de un código que nadie conoce, también: nunca
//     en silencio.
// Solo Last. Cada botón confirma con lo que ha hecho o falla (regla 8).

import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useActiveAccount } from '../hooks/useActiveAccount'
import {
  chipPregunta, fraseUnida, pistaPregunta, platosEnLinea, resumenFolvy, textoPregunta, textoReconocida, textoSinMarca, tituloPregunta,
  type PorRevisar, type Pregunta,
} from '../lib/cartaMarca'
import { claveMarca, enumerar, localCorto } from '../lib/marcasLast'
import { avisoVisto, decidirMarca, leerMarcasPorRevisar } from '../services/cartaMarcaService'
import '../components/brands/altaMarcaLast.css'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function RevisarMarcasLastPage() {
  const { activeAccountId } = useActiveAccount()
  const [params] = useSearchParams()
  const [datos, setDatos] = useState<PorRevisar | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [hecho, setHecho] = useState<{ ok: boolean; texto: string; altaDe?: string } | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  useEffect(() => {
    if (!activeAccountId) return
    let vivo = true
    leerMarcasPorRevisar(activeAccountId)
      .then((d) => { if (vivo) { setDatos(d); setError(null) } })
      .catch((e: unknown) => { if (vivo) setError(msg(e)) })
    return () => { vivo = false }
  }, [activeAccountId, vuelta])

  const decidir = async (q: Pregunta, es: boolean) => {
    if (!activeAccountId) return
    setOcupado(`${claveMarca(q)}:${es ? 'si' : 'no'}`); setHecho(null)
    try {
      const r = await decidirMarca(activeAccountId, q.org, q.nombre, q.comparacion.brandId, es)
      setHecho(es
        ? { ok: true, texto: fraseUnida(q.nombre, q.comparacion.marca, q.locales, r.ventas, r.sinReceta) }
        : { ok: true, texto: `Apuntado: «${q.nombre}» no es tu ${q.comparacion.marca}. Dala de alta como marca nueva en Marcas.`, altaDe: claveMarca(q) })
      setVuelta((v) => v + 1)
    } catch (e) {
      setHecho({ ok: false, texto: `No se ha guardado: ${msg(e)}` })
    } finally {
      setOcupado(null)
    }
  }

  const entendido = async (id: string) => {
    if (!activeAccountId) return
    setOcupado(id); setHecho(null)
    try { setHecho({ ok: true, texto: await avisoVisto(activeAccountId, id) }); setVuelta((v) => v + 1) }
    catch (e) { setHecho({ ok: false, texto: `No se ha guardado: ${msg(e)}` }) }
    finally { setOcupado(null) }
  }

  if (error) return <p className="ml-error" role="alert">No se han podido leer las marcas de Last por revisar: {error}</p>
  if (!datos) return <p className="ml-cargando" aria-busy="true">Leyendo las marcas de Last…</p>

  // La que se pide desde Inicio, primero.
  const pedida = params.get('marca')
  const preguntas = [...datos.preguntas].sort((a, b) => Number(claveMarca(b) === pedida) - Number(claveMarca(a) === pedida))
  const nada = preguntas.length === 0 && datos.reconocidas.length === 0 && datos.sinMarca.length === 0

  return (
    <div className="cc-pagina" data-prueba="revisar-last">
      <span className="cc-miga">Marcas › Revisar</span>
      {hecho && (
        <div className={hecho.ok ? 'ml-hecho' : 'ml-error'} role={hecho.ok ? 'status' : 'alert'} data-prueba="revisar-hecho">
          {hecho.texto}
          {hecho.altaDe && <> <Link className="rc-enlace rc-en-toast" to={`/configuracion/marcas?alta=${encodeURIComponent(hecho.altaDe)}`}>Darla de alta</Link></>}
        </div>
      )}
      {nada && <p className="cc-vacio">No hay ninguna marca de Last por revisar: todas las ventas de Last tienen su marca.</p>}

      {preguntas.map((q) => {
        const clave = claveMarca(q)
        const c = q.comparacion
        return (
          <section key={clave} className="rv-pregunta" aria-labelledby={`rv-${clave}`} data-prueba="revisar-pregunta">
            <span className="ml-chip" data-tono={q.ventas.despues + q.ventas.antes > 0 ? 'mal' : 'suave'}>{chipPregunta(q)}</span>
            <h2 id={`rv-${clave}`}>{tituloPregunta(q)}</h2>
            <p className="rv-texto">{textoPregunta(q)}</p>
            <div className="rv-compara">
              <div data-prueba="carta-last">
                <b>Lo que llega de Last</b>
                <span>{q.nombre}{q.locales.length ? ` · ${enumerar(q.locales.map((l) => localCorto(l.nombre)))}` : ''}</span>
                <span>{platosEnLinea(c.cartaLast)}</span>
                <ul className="rv-platos" aria-label={`Platos de ${q.nombre} en Last`}>
                  {c.cartaLast.map((p, i) => <li key={i} data-coincide={p.coincide ? 'si' : 'no'}>{p.nombre}{p.coincide ? '' : ' · no está en tu carta'}</li>)}
                </ul>
              </div>
              <div data-prueba="carta-folvy">
                <b>Tu marca en Folvy</b>
                <span>{c.marca}{c.localesFolvy.length ? ` · ${enumerar(c.localesFolvy.map((l) => localCorto(l.nombre)))}` : ''}</span>
                <span>{resumenFolvy(c)}</span>
                <ul className="rv-platos" aria-label={`Platos de ${c.marca} en Folvy`}>
                  {c.cartaFolvy.map((p, i) => <li key={i} data-coincide={p.coincide ? 'si' : 'no'}>{p.nombre}{p.coincide ? '' : ' · no llega de Last'}</li>)}
                </ul>
              </div>
            </div>
            <div className="cc-acciones">
              <button type="button" className="ml-boton" data-principal="si" disabled={!!ocupado} onClick={() => void decidir(q, true)}>
                {ocupado === `${clave}:si` ? 'Uniendo…' : `Sí, es ${c.marca}`}
              </button>
              <button type="button" className="ml-boton" disabled={!!ocupado} onClick={() => void decidir(q, false)}>
                {ocupado === `${clave}:no` ? 'Guardando…' : 'No, es otra marca'}
              </button>
            </div>
            <span className="ml-pista">{pistaPregunta(q)}</span>
          </section>
        )
      })}

      {datos.reconocidas.length > 0 && (
        <section className="ml-nuevas" aria-labelledby="rv-solas">
          <h2 id="rv-solas">Lo que Folvy ha hecho solo</h2>
          <ul className="ml-filas" data-prueba="revisar-reconocidas">
            {datos.reconocidas.map((r) => {
              const t = textoReconocida(r)
              return (
                <li className="ml-fila" key={r.id}>
                  <div className="ml-ico" aria-hidden>✓</div>
                  <div className="ml-txt"><b>{t.titulo}</b><span>{t.detalle}</span></div>
                  <span className="ml-chip" data-tono="ok">{r.como === 'sola' ? 'Reconocida' : 'Vinculada'}</span>
                  <button type="button" className="ml-boton" disabled={!!ocupado} onClick={() => void entendido(r.id)} aria-label={`Entendido: ${t.titulo}`}>
                    {ocupado === r.id ? 'Guardando…' : 'Entendido'}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {datos.sinMarca.length > 0 && (
        <section className="ml-nuevas" aria-labelledby="rv-sin-marca">
          <h2 id="rv-sin-marca">Ventas de Last sin marca</h2>
          <ul className="ml-filas" data-prueba="revisar-sin-marca">
            {datos.sinMarca.map((s, i) => (
              <li className="ml-fila" key={`${s.codigo ?? 'sin'}:${s.local ?? ''}:${i}`}>
                <div className="ml-ico cc-ico-aviso" aria-hidden>!</div>
                <div className="ml-txt"><b>{textoSinMarca(s)}</b>
                  <span>Folvy no sabe de qué marca son: no descuentan almacén. Si es una marca nueva, aparecerá en Marcas en cuanto Last la traiga en su carta.</span></div>
                <span className="ml-chip" data-tono="mal">{s.ventas === 1 ? '1 venta sin marca' : `${s.ventas} ventas sin marca`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
