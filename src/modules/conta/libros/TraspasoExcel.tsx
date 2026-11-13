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
import { crearSubcuentasEnDiez, prepararExcel, yaLoHeImportado, type ResultadoExcel, type ResultadoImportado } from '@/modules/conta/services/traspasoService'

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
  const [imp, setImp] = useState<ResultadoImportado | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [crear, setCrear] = useState(false)

  async function preparar() {
    setOcupado('Comprobando las subcuentas en Diez…'); setError(null); setHecho(null)
    try {
      const r = await prepararExcel(companyId, mes)
      setX(r)
      setHecho(r.faltan.length
        ? `Faltan ${n(r.faltan.length)} ${r.faltan.length === 1 ? 'subcuenta' : 'subcuentas'} en Diez (${r.base}): sin ellas no se prepara ningún Excel.`
        : `Las ${n(r.comprobadas)} subcuentas están en Diez (${r.base}). Listos: ${n(r.emitidas?.length ?? 0)} emitidas y ${n(r.recibidas?.length ?? 0)} recibidas.`)
    } catch (e) { setError(`No se han podido preparar los Excel: ${mensajeDe(e)}`) } finally { setOcupado(null) }
  }

  async function crearlas() {
    setOcupado('Creando las subcuentas en Diez…'); setError(null)
    try {
      const r = await crearSubcuentasEnDiez(companyId, mes)
      setCrear(false)
      setHecho(`Creadas en Diez (${r.base}): ${r.creadas.map((c) => `${c.codigo} ${c.nombre}`).join(', ') || 'ninguna'}.${r.faltan.length ? ` Siguen faltando ${n(r.faltan.length)}.` : ''}`)
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
      setHecho(`${n(r.enlazadas)} de ${n(r.van_por_excel)} facturas encontradas en Diez y enlazadas.${r.faltan.length ? ` Faltan ${n(r.faltan.length)}.` : ''}${r.dobles.length ? ` ${n(r.dobles.length)} están dos veces en Diez y no se enlazan: ${r.dobles.join(', ')}.` : ''}`)
      setOcupado('Comprobando con Diez…')
      await alImportar()
    } catch (e) { setError(`No se ha podido comprobar lo importado: ${mensajeDe(e)}`) } finally { setOcupado(null) }
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
        <button type="button" className="cx-boton" disabled={!!ocupado || !listos} onClick={() => void importado()}>Ya lo he importado</button>
      </div>
      {imp && imp.faltan.length > 0 && (
        <ul className="cxl-lista-estado" aria-label="Las que no están en Diez">
          {imp.faltan.map((f) => (
            <li key={f.entry_id} className="cxl-mes">
              <span className="cxl-mes-que"><span className="cxl-punto cxl-punto-rojo" aria-hidden="true" /><span>{f.numero}: no está en Diez</span></span>
              <Link to={rutaAsiento(f.entry_id)} className="cx-enlace">Ver el asiento</Link>
            </li>
          ))}
        </ul>
      )}
      <Guardado texto={ocupado ?? hecho} />
      {error && <p className="cxl-sin-sitio" role="alert">{error}</p>}

      {crear && x && (
        <Dialogo titulo="Crear las subcuentas en Diez" alCerrar={() => { if (!ocupado) setCrear(false) }}>
          <p>Se crean en Diez ({x.base}) con el nombre que tienen en Sumied:</p>
          <ul>{x.faltan.map((f) => <li key={f.codigo}><strong>{f.codigo}</strong> {f.nombre}</li>)}</ul>
          <p className="cxl-apoyo">Queda apuntado quién las ha creado y cuándo.</p>
          <div className="cxl-herramientas">
            <button type="button" className="cx-boton" disabled={!!ocupado} onClick={() => void crearlas()}>{ocupado ?? 'Crearlas'}</button>
            <button type="button" className="cx-boton-sec" disabled={!!ocupado} onClick={() => setCrear(false)}>Cancelar</button>
          </div>
        </Dialogo>
      )}
    </div>
  )
}
