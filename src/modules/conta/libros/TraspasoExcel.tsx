// src/modules/conta/libros/TraspasoExcel.tsx
//
// B01r26 (13/11) · LOS PASOS 2 Y 3 DEL TRASPASO A DIEZ, con las facturas por
// Excel y su PDF (lo decidido por Julio el 24/10 y el 13/11,
// docs/conta/diez/traspaso_con_pdf.md):
//   2 · Descarga los dos Excel e impórtalos en Diez (Importaciones › Importación
//       desde fichero › Facturas). Antes, las subcuentas: si falta alguna en Diez,
//       no se genera nada; se dicen cuáles y «Crearlas en Diez» (confirmando).
//   3 · Ya lo he importado: Sumied lee las facturas del mes en Diez, enlaza cada
//       una con la suya, dice cuáles faltan y comprueba si «Cuadra».
// Cada botón dice en pantalla qué ha pasado, con cifras (regla 8).

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaAsiento } from '@/config/navegacion'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { Guardado } from '@/modules/conta/ui/piezas'
import { bajarXlsx, libroXlsx } from '@/modules/conta/lib/traspasoExcelLibro'
import { crearSubcuentasEnDiez, mandarPorLaApi, prepararExcel, yaLoHeImportado, type ResultadoExcel, type ResultadoImportado, type ResultadoSubcuentas } from '@/modules/conta/services/traspasoService'

// B01r26 (14/11): lo último de «Ya lo he importado», por empresa y mes. Al acabar, la pantalla vuelve a
// comprobar con Diez y se recarga entera (este componente se desmonta): sin esto, la lista de las que
// no están en Diez desaparecía y quedaba solo la cifra.
const ULTIMO_IMPORTADO = new Map<string, ResultadoImportado>()

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^[a-z_]+: /, '')
const n = (x: number) => x.toLocaleString('es-ES')

export function TraspasoExcel({ companyId, mes, nombre, alImportar }: {
  companyId: string
  mes: string
  /** «octubre». */
  nombre: string
  /** Después de enlazar lo importado: el cuadre con Diez (el de la pantalla). */
  alImportar: () => Promise<void>
}) {
  const [x, setX] = useState<ResultadoExcel | null>(null)
  const [imp, setImpEstado] = useState<ResultadoImportado | null>(() => ULTIMO_IMPORTADO.get(`${companyId}|${mes}`) ?? null)
  const setImp = (r: ResultadoImportado | null) => { if (r) ULTIMO_IMPORTADO.set(`${companyId}|${mes}`, r); else ULTIMO_IMPORTADO.delete(`${companyId}|${mes}`); setImpEstado(r) }
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [crear, setCrear] = useState(false)
  const [creacion, setCreacion] = useState<ResultadoSubcuentas | null>(null)
  const [mandar, setMandar] = useState(false)
  const [noLlegaron, setNoLlegaron] = useState<{ entry_id: string; numero: number | null; motivo: string }[]>([])

  async function preparar() {
    setOcupado('Comprobando las subcuentas en Diez…'); setError(null)
    try {
      const r = await prepararExcel(companyId, mes)
      setX(r)
      setHecho((antes) => (antes && antes.startsWith('En Diez (') ? `${antes} ` : '') + (r.faltan.length
        ? `Faltan ${n(r.faltan.length)} ${r.faltan.length === 1 ? 'subcuenta' : 'subcuentas'} en Diez (${r.base}): sin ellas no se prepara ningún Excel.`
        : `Las ${n(r.comprobadas)} subcuentas están en Diez (${r.base}). Listos: ${n(r.emitidas?.length ?? 0)} emitidas y ${n(r.recibidas?.length ?? 0)} recibidas.`))
    } catch (e) { setError(`No se han podido preparar los Excel: ${mensajeDe(e)}`) } finally { setOcupado(null) }
  }

  async function crearlas() {
    const cuantas = x?.faltan.length ?? 0
    setOcupado(`Creando ${n(cuantas)} ${cuantas === 1 ? 'subcuenta' : 'subcuentas'} en Diez, una a una… (unos segundos cada una)`); setError(null); setCreacion(null)
    try {
      const r = await crearSubcuentasEnDiez(companyId, mes)
      setCrear(false)
      setCreacion(r)
      const no = r.no_creadas ?? []
      setHecho(`En Diez (${r.base}): ${r.creadas.length ? `creadas ${n(r.creadas.length)}` : 'no se ha creado ninguna'}${no.length ? `; ${n(no.length)} no (abajo, por qué)` : ''}.${r.faltan.length ? ` Siguen faltando ${n(r.faltan.length)}.` : ' Ya están todas.'}${r.otra_vez ? ` ${n(r.otra_vez)} ${r.otra_vez === 1 ? 'asiento que esperaba vuelve' : 'asientos que esperaban vuelven'} al traspaso: pulsa «Seguir traspasando ${nombre}».` : ''}`)
      await preparar()
    } catch (e) { setError(`No se han creado: ${mensajeDe(e)}`); setOcupado(null) }
  }

  async function bajar(cual: 'emitidas' | 'recibidas') {
    const filas = x?.[cual] ?? []
    try {
      bajarXlsx(await libroXlsx(filas, cual === 'emitidas' ? 'Emitidas' : 'Recibidas'), `diez-${cual}-${mes.slice(0, 7)}.xlsx`)
      setHecho(`Descargado el Excel de ${cual}: ${n(filas.length)} ${filas.length === 1 ? 'factura' : 'facturas'}, cada una con el enlace a su PDF.`)
    } catch (e) { setError(`No se ha podido hacer el Excel: ${mensajeDe(e)}`) }
  }

  async function importado() {
    setOcupado(`Leyendo las facturas de ${nombre} en Diez…`); setError(null); setHecho(null)
    try {
      const r = await yaLoHeImportado(companyId, mes)
      setImp(r)
      setHecho(`${n(r.enlazadas)} de ${n(r.van_por_excel)} facturas encontradas en Diez y enlazadas.${r.faltan.length ? ` Faltan ${n(r.faltan.length)}.` : ''}${r.dobles.length ? ` ${n(r.dobles.length)} están dos veces en Diez y no se enlazan: ${r.dobles.join(', ')}.` : ''}${r.dias_sin_leer?.length ? ` Diez no ha dejado leer ${n(r.dias_sin_leer.length)} ${r.dias_sin_leer.length === 1 ? 'día' : 'días'} (${r.dias_sin_leer.join(', ')}): las facturas de esos días salen como que faltan; vuelve a pulsar en un rato.` : ''}`)
      setOcupado('Comprobando con Diez…')
      await alImportar()
    } catch (e) { setError(`No se ha podido comprobar lo importado: ${mensajeDe(e)}`) } finally { setOcupado(null) }
  }

  // B01r26 (14/11) · Plan B: las que Diez no tiene, por la API, unas pocas cada vez hasta que no quedan.
  async function porLaApi() {
    const ids = (imp?.faltan ?? []).map((f) => f.entry_id)
    if (!ids.length) return
    setError(null); setHecho(null); setNoLlegaron([])
    setOcupado(`Mandando por la API ${n(ids.length)} ${ids.length === 1 ? 'factura' : 'facturas'} a Diez, unas pocas cada vez…`)
    let llegan = 0; const fallos: { entry_id: string; numero: number | null; motivo: string }[] = []; let fuera: number | null = null
    try {
      // Cada vuelta, todas menos las que ya han fallado: el servidor se salta lo que ya llegó (sale de la lista).
      for (let vuelta = 0; vuelta < 200; vuelta++) {
        const falladas = new Set(fallos.map((f) => f.entry_id))
        const pendientes = ids.filter((id) => !falladas.has(id))
        if (!pendientes.length) break
        let r
        try { r = await mandarPorLaApi(companyId, mes, pendientes) } catch (e) {
          if (/tanda de este traspaso en marcha/.test(mensajeDe(e))) { setOcupado('Hay otra tanda en marcha; espero a que acabe…'); await new Promise((ok) => setTimeout(ok, 6000)); continue }
          throw e
        }
        if (fuera === null) fuera = r.fuera_de_la_lista
        llegan += r.llegaron; fallos.push(...r.fallaron)
        if (r.quedan === 0 || r.llegaron + r.fallaron.length === 0) break
        setOcupado(`Mandando por la API: ${n(llegan)} en Diez${fallos.length ? `, ${n(fallos.length)} no` : ''}; quedan ${n(r.quedan)}…`)
      }
      setMandar(false)
      setNoLlegaron(fallos)
      // Si se han hecho todas, en la lista quedan solo las que no han llegado (lo que llegó ya está en Diez).
      if (imp && llegan + fallos.length === ids.length) {
        const no = new Set(fallos.map((f) => f.entry_id))
        setImp({ ...imp, faltan: imp.faltan.filter((f) => no.has(f.entry_id)) })
      }
      setHecho(`Por la API: ${n(llegan)} ${llegan === 1 ? 'factura ha llegado' : 'facturas han llegado'} a Diez${fallos.length ? `; ${n(fallos.length)} no (abajo, por qué)` : ''}${fuera ? `; ${n(fuera)} ya no estaban pendientes (enviadas o enlazadas antes)` : ''}. Después, «Volver a comprobar con Diez».`)
    } catch (e) { setError(`Se ha parado al mandarlas por la API: ${mensajeDe(e)}. Lo que llegó está en Diez; al volver a pulsar sigue con las que faltan.`) } finally { setOcupado(null) }
  }

  const listos = x && x.faltan.length === 0
  return (
    <div className="cxl-traspaso-excel" aria-label="Las facturas, por Excel">
      <h4 className="cxl-subtitulo">2 · Descarga los dos Excel e impórtalos en Diez</h4>
      <p className="cxl-apoyo">Las facturas de {nombre} van a Diez por Excel, cada una con su PDF. En Diez: Importaciones › Importación desde fichero › Facturas, una vez con cada Excel.</p>
      <div className="cxl-herramientas">
        <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={() => void preparar()}>{x ? 'Volver a preparar' : 'Preparar los Excel'}</button>
        {listos && <button type="button" className="cx-boton" disabled={!!ocupado} onClick={() => void bajar('emitidas')}>Descargar emitidas ({n(x.emitidas?.length ?? 0)})</button>}
        {listos && <button type="button" className="cx-boton" disabled={!!ocupado} onClick={() => void bajar('recibidas')}>Descargar recibidas ({n(x.recibidas?.length ?? 0)})</button>}
      </div>
      {x && x.faltan.length > 0 && (
        <div className="cxl-aviso-ambar" role="note" data-testid="traspaso-subcuentas-faltan">
          <p>Estas subcuentas no están en Diez. Si se importa sin ellas, Diez deja la línea sin cuenta:</p>
          <ul>{x.faltan.map((f) => <li key={f.codigo}><strong>{f.codigo}</strong> {f.nombre || '(sin nombre en Sumied)'}</li>)}</ul>
          <button type="button" className="cx-boton" disabled={!!ocupado} onClick={() => setCrear(true)}>Crearlas en Diez</button>
        </div>
      )}
      {creacion && (creacion.creadas.length > 0 || (creacion.no_creadas?.length ?? 0) > 0) && (
        <ul className="cxl-lista-estado" aria-label="Lo que se ha hecho en Diez" data-testid="traspaso-subcuentas-creadas">
          {creacion.creadas.map((c) => (
            <li key={c.codigo} className="cxl-mes"><span className="cxl-mes-que"><span className="cxl-punto cxl-punto-verde" aria-hidden="true" /><span><strong>{c.codigo}</strong> {c.nombre}: creada{c.recortado ? ' (con el nombre recortado: Diez admite 60 caracteres)' : ''}</span></span></li>
          ))}
          {(creacion.no_creadas ?? []).map((c) => (
            <li key={c.codigo} className="cxl-mes"><span className="cxl-mes-que"><span className="cxl-punto cxl-punto-rojo" aria-hidden="true" /><span><strong>{c.codigo}</strong> {c.nombre}: no se ha creado. {c.porque}</span></span></li>
          ))}
        </ul>
      )}
      {x && x.por_la_api.length > 0 && (
        <details>
          <summary>{n(x.por_la_api.length)} {x.por_la_api.length === 1 ? 'factura va' : 'facturas van'} por la API, sin PDF en Diez</summary>
          <ul className="cxl-lista-estado">
            {x.por_la_api.map((p) => (
              <li key={p.entry_id} className="cxl-mes">
                <span className="cxl-mes-que"><span className="cxl-punto cxl-punto-ambar" aria-hidden="true" /><span>{p.numero || 'Sin número'}: {p.motivo}</span></span>
                <Link to={rutaAsiento(p.entry_id)} className="cx-enlace">Ver el asiento</Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      <h4 className="cxl-subtitulo">3 · Ya lo he importado</h4>
      <p className="cxl-apoyo">Cuando los dos estén importados en Diez, Sumied busca cada factura allí, la enlaza con la suya y comprueba si cuadra.</p>
      <div className="cxl-herramientas">
        <button type="button" className="cx-boton" disabled={!!ocupado} onClick={() => void importado()}>Ya lo he importado</button>
      </div>
      {!x && <p className="cxl-apoyo">No hace falta volver a preparar los Excel: Sumied lee directamente lo que hay en Diez.</p>}
      {imp && imp.faltan.length > 0 && (
        <>
          <ul className="cxl-lista-estado" aria-label="Las que no están en Diez" data-testid="traspaso-faltan">
            {imp.faltan.map((f) => (
              <li key={f.entry_id} className="cxl-mes">
                <span className="cxl-mes-que"><span className="cxl-punto cxl-punto-rojo" aria-hidden="true" /><span>{f.numero}: {f.porque ?? 'no está en Diez'}</span></span>
                <Link to={rutaAsiento(f.entry_id)} className="cx-enlace">Ver el asiento</Link>
              </li>
            ))}
          </ul>
          <div className="cxl-herramientas">
            <button type="button" className="cx-boton" disabled={!!ocupado} onClick={() => setMandar(true)}>Mandarlas por la API ({n(imp.faltan.length)})</button>
          </div>
        </>
      )}
      {imp && (imp.sin_enlace_en_diez?.length ?? 0) > 0 && (
        <details data-testid="traspaso-sin-enlace">
          <summary>{n(imp.sin_enlace_en_diez!.length)} {imp.sin_enlace_en_diez!.length === 1 ? 'factura está' : 'facturas están'} en Diez sin enlace con Sumied</summary>
          <ul className="cxl-lista-estado">
            {imp.sin_enlace_en_diez!.map((f) => (
              <li key={f.ref} className="cxl-mes"><span className="cxl-mes-que"><span className="cxl-punto cxl-punto-ambar" aria-hidden="true" /><span>{f.ref} · {f.numero || 'sin número'} · subcuenta {f.cuenta || '—'} · {f.total.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</span></span></li>
            ))}
          </ul>
        </details>
      )}
      {noLlegaron.length > 0 && (
        <ul className="cxl-lista-estado" aria-label="Las que no han llegado por la API">
          {noLlegaron.map((f) => (
            <li key={f.entry_id} className="cxl-mes">
              <span className="cxl-mes-que"><span className="cxl-punto cxl-punto-rojo" aria-hidden="true" /><span>{f.numero ? `Asiento ${f.numero}` : 'Un asiento'}: {f.motivo}</span></span>
              <Link to={rutaAsiento(f.entry_id)} className="cx-enlace">Ver el asiento</Link>
            </li>
          ))}
        </ul>
      )}
      <Guardado texto={ocupado ?? hecho} />
      {error && <p className="cxl-sin-sitio" role="alert">{error}</p>}

      {mandar && imp && (
        <Dialogo titulo="Mandarlas por la API" alCerrar={() => { if (!ocupado) setMandar(false) }}>
          <p>Se mandan a Diez por la API, sin PDF, las {n(imp.faltan.length)} que «Ya lo he importado» no ha encontrado. Antes de escribir, cada una se busca en Diez por su número y su NIF: si ya está, se enlaza y no se escribe otra.</p>
          {(imp.sin_enlace_en_diez?.length ?? 0) > 0 && (
            <p className="cxl-aviso-ambar" role="note">En Diez hay {n(imp.sin_enlace_en_diez!.length)} sin enlace con Sumied (la lista de arriba). Si alguna es una de estas con otro número, bórrala antes en Diez: si no, quedará dos veces.</p>
          )}
          {ocupado && <p className="cxl-apoyo" role="status" data-testid="traspaso-mandando">{ocupado}</p>}
          <div className="cxl-herramientas">
            <button type="button" className="cx-boton" disabled={!!ocupado} onClick={() => void porLaApi()}>{ocupado ? 'Mandando…' : 'Mandarlas'}</button>
            <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={() => setMandar(false)}>Cancelar</button>
          </div>
        </Dialogo>
      )}

      {crear && x && (
        <Dialogo titulo="Crear las subcuentas en Diez" alCerrar={() => { if (!ocupado) setCrear(false) }}>
          <p>Se crean en Diez ({x.base}) con el nombre que tienen en Sumied:</p>
          <ul>{x.faltan.map((f) => <li key={f.codigo}><strong>{f.codigo}</strong> {f.nombre}</li>)}</ul>
          <p className="cxl-apoyo">Queda apuntado quién las ha creado y cuándo. Si un nombre pasa de 60 caracteres, va recortado por la última palabra entera.</p>
          {ocupado && <p className="cxl-apoyo" role="status" data-testid="traspaso-creando">{ocupado}</p>}
          <div className="cxl-herramientas">
            <button type="button" className="cx-boton" disabled={!!ocupado} onClick={() => void crearlas()}>{ocupado ? 'Creando…' : 'Crearlas'}</button>
            <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={() => setCrear(false)}>Cancelar</button>
          </div>
        </Dialogo>
      )}
    </div>
  )
}
