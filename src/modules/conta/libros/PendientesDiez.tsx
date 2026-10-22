// src/modules/conta/libros/PendientesDiez.tsx
//
// C06b · Respuesta 7 (Julio, 14/10). Libros › Diario › Con Diez ›
// «Pendientes de adjuntar en Diez». Diez aún no guarda documentos (falta que
// Cegid active su almacén), así que las facturas van sin su PDF. Aquí:
//   · cuántas son y de cuándo es la más antigua;
//   · de cada una, cómo encontrarla en Diez (su asiento serie/documento del
//     ejercicio y su número de factura);
//   · «Descargar todos»: un zip con cada PDF guardado en Folvy, con el nombre
//     de su referencia en Diez («2026-1-1801.pdf»);
//   · «Ya está adjunto», una a una, cuando ya está adjunto en Diez.
// Lo adjunta Julio, o una tarea de Claude Desktop que lo haga cada día: baja
// el zip, adjunta cada PDF en Diez y lo marca aquí. Y lo anulado en Folvy que
// sigue en Diez sale aparte: le falta su contraasiento allí.
//
// C06b · Respuesta 8: al anular, el contraasiento va solo a Diez. Aquí solo
// queda lo que no ha llegado (con su motivo) y «Enviar el contraasiento»,
// que hace lo mismo: nunca dos veces.
//
// Regla 7: es una pantalla que se abre a propósito; no esconde ninguna fila.
// Regla 8: cada botón dice qué ha pasado, con contenido.
//
// S02 · PR 2 · El encabezado del patrón (EncabezadoLibro): «Descargar todos»
// es el único principal, y la frase dice cuántas quedan.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaAsiento } from '@/config/navegacion'
import { Boton } from '@/modules/conta/diseno'
import { EncabezadoLibro } from '@/modules/conta/libros/EncabezadoLibro'
import { Chip, ErrorConReintento, Guardado } from '@/modules/conta/ui/piezas'
import { useLeer, useLibros } from '@/modules/conta/libros/contexto'
import { fraseResumen, nombreEnZip, referenciaDiez, type PendienteDiez } from '@/modules/conta/lib/pendientesDiez'
import { enviarADiez, leerPendientesDiez, marcarAdjuntoEnDiez, urlDocumento, zipPendientesDiez, type AnuladoEnDiez } from '@/modules/conta/services/conDiezService'
import { MARCA } from '../cuenta/marca'

const ddmmaa = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`
const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function PendientesDiez() {
  const L = useLibros()
  const d = useLeer(() => leerPendientesDiez(L.accountId, L.companyId), `${L.companyId}:${L.vuelta}`)
  const [hecho, setHecho] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  async function descargar() {
    if (!d.datos?.pendientes.length) return
    setOcupado('zip'); setHecho(null)
    try {
      const r = await zipPendientesDiez(d.datos.pendientes)
      const nombre = `PDF pendientes en Diez ${new Date().toISOString().slice(0, 10)}.zip`
      const url = URL.createObjectURL(new Blob([r.zip.buffer as ArrayBuffer], { type: 'application/zip' }))
      const a = document.createElement('a'); a.href = url; a.download = nombre; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setHecho(`Bajado: ${nombre}, con ${r.n} de ${d.datos.pendientes.length} PDF, cada uno con el nombre de su referencia en Diez.${r.sinPdf.length ? ` No se han podido bajar: ${r.sinPdf.join(', ')}.` : ''}`)
    } catch (e) { setHecho(`No se ha podido hacer el zip: ${mensajeDe(e)}`) } finally { setOcupado(null) }
  }

  async function marcar(p: PendienteDiez) {
    setOcupado(p.entryId); setHecho(null)
    try { setHecho(await marcarAdjuntoEnDiez(p.entryId, L.quien)); d.recargar() }
    catch (e) { setHecho(`No se ha marcado ${referenciaDiez(p)}: ${mensajeDe(e)}`) } finally { setOcupado(null) }
  }

  async function enviarContra(a: AnuladoEnDiez) {
    if (!a.contraasiento) return
    setOcupado(a.entryId); setHecho(null)
    try { setHecho((await enviarADiez(a.contraasiento)).texto); d.recargar() }
    catch (e) { setHecho(`No ha llegado a Diez: ${mensajeDe(e)}.`) } finally { setOcupado(null) }
  }

  async function ver(p: PendienteDiez) {
    const v = window.open('', '_blank')
    try { const url = await urlDocumento(p.ruta); if (v) v.location.href = url; else window.location.assign(url) }
    catch (e) { v?.close(); setHecho(`No se ha podido abrir el PDF: ${mensajeDe(e)}`) }
  }

  const pend = d.datos?.pendientes ?? []
  const anul = d.datos?.anulados ?? []
  const encabezado = (
    <EncabezadoLibro titulo="Pendientes de adjuntar en Diez"
      frase={d.datos ? fraseResumen(pend, ddmmaa) : 'Las facturas que ya están en Diez sin su PDF, y cómo encontrarlas allí.'}
      principal={<Boton variante="principal" icono="descargar" disabled={!pend.length || ocupado === 'zip'} onClick={() => void descargar()}>
        {ocupado === 'zip' ? 'Reuniendo los PDF…' : `Descargar todos${pend.length ? ` (${pend.length})` : ''}`}
      </Boton>} />
  )
  if (d.error) return <section className="cxl-pagina" aria-label="Pendientes de adjuntar en Diez">{encabezado}<ErrorConReintento mensaje={d.error} reintentar={d.recargar} /></section>
  return (
    <section className="cxl-pagina" aria-label="Pendientes de adjuntar en Diez">
      {encabezado}
      <Guardado texto={hecho} />
      {!d.datos && <div className="s-lista-cargando" aria-busy="true" aria-label="Cargando las pendientes" />}
      {d.datos && (
        <div className="cx-tarjeta">
          <p className="cx-ayuda">
            Diez aún no guarda documentos (falta que Cegid lo active), así que {MARCA.nombre} manda la factura sin su PDF. En Diez, busca cada una por su asiento o su número de factura,
            adjunta el PDF y pulsa «Ya está adjunto». El zip trae cada PDF con el nombre de su referencia en Diez.
          </p>
          {pend.length > 0 && (
            <ul className="cxp-pendientes" aria-label="Facturas en Diez sin su PDF">
              {pend.map((p) => (
                <li key={p.entryId} className="cxp-pendiente">
                  <div className="cxp-pendiente-que">
                    <Link className="cx-enlace" to={rutaAsiento(p.entryId)}><strong>{p.concepto}</strong></Link>
                    <span className="cxp-pendiente-fecha"> · {ddmmaa(p.fecha)}</span>
                    <div className="cxp-pendiente-ref">
                      En Diez: asiento <strong>{referenciaDiez(p)}</strong>{p.factura ? <> · factura <strong>{p.factura}</strong></> : null}
                    </div>
                    <div className="cxp-pendiente-fecha">En el zip: {nombreEnZip(p)}</div>
                  </div>
                  <div className="cxp-pendiente-acciones">
                    {p.ruta && <button type="button" className="cx-boton-sec" onClick={() => void ver(p)}>Ver PDF</button>}
                    <button type="button" className="cx-boton-sec" disabled={ocupado === p.entryId} onClick={() => void marcar(p)}>
                      {ocupado === p.entryId ? 'Marcando…' : 'Ya está adjunto'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {anul.length > 0 && (
        <div className="cx-tarjeta">
          <h3 className="cx-tarjeta-titulo">Anulados en {MARCA.nombre} que siguen en Diez</h3>
          <p className="cx-ayuda">Se anularon aquí con su contraasiento, pero en Diez la factura sigue. Al anular, {MARCA.nombre} manda el contraasiento a Diez solo; estos no han llegado. «Enviar el contraasiento» lo vuelve a intentar, y nunca lo manda dos veces.</p>
          <ul className="cxp-pendientes" aria-label="Anulados que siguen en Diez">
            {anul.map((a) => (
              <li key={a.entryId} className="cxp-pendiente">
                <div className="cxp-pendiente-que">
                  <Link className="cx-enlace" to={rutaAsiento(a.entryId)}><strong>{a.concepto}</strong></Link>
                  <span className="cxp-pendiente-fecha"> · {ddmmaa(a.fecha)}</span>{' '}<Chip tono="ambar">falta su contraasiento en Diez</Chip>
                  <div className="cxp-pendiente-ref">En Diez: asiento <strong>{referenciaDiez(a)}</strong>{a.factura ? <> · factura <strong>{a.factura}</strong></> : null}</div>
                  {a.motivo && <div className="cxp-pendiente-fecha">No ha llegado: {a.motivo}</div>}
                </div>
                {a.contraasiento && (
                  <div className="cxp-pendiente-acciones">
                    <button type="button" className="cx-boton-sec" disabled={ocupado === a.entryId} onClick={() => void enviarContra(a)}>
                      {ocupado === a.entryId ? 'Enviando…' : 'Enviar el contraasiento'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
