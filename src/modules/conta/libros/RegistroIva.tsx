// src/modules/conta/libros/RegistroIva.tsx
//
// C05 · Los libros registro del IVA (maqueta N15) y su salida para un
// requerimiento.
//
//   · RegistroIva: expedidas, recibidas (con los bienes de inversión, que
//     también son 472) o intracomunitarias. Arriba, cuatro cifras: base,
//     cuota, cuadre con el diario (regla 6: la suma de cuotas = el movimiento
//     de la 477/472 del periodo, sin la liquidación) y anotaciones por
//     completar. El resumen de tiques se ve como «F4 · resumen · art. 63.4»
//     con su rango y su número de tiques (respuesta 1 del C05: F4, no F2).
//     Lo que no vale para un requerimiento sale en ámbar con «Completar».
//     El «Listado de facturación» de Diez son filtros de este libro: subcuenta,
//     NIF, importe superior a, tipo de factura, «agrupar por NIF» y «solo las
//     del 347». Un filtro ordena y recorta lo que se mira, nunca esconde sin
//     decirlo (regla 7): la cabecera dice siempre «N de M».
//   · FormatoAeat: el Excel con las columnas de la AEAT (acumulado del 1 de
//     enero al final del trimestre, como lo piden) y el zip con los
//     documentos que tengamos guardados.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaAsiento, rutaLibros } from '@/config/navegacion'
import { Dialogo, Migas } from '@/modules/conta/proveedor/piezas'
import { Chip, ErrorConReintento, Guardado, Hueso, Vacio } from '@/modules/conta/ui/piezas'
import { eurosExactos } from '@/modules/conta/lib/formato'
import {
  COLUMNAS_BIENES, UMBRAL_347, agruparPorNif, cifrasLibro, cuadreConDiario, etiquetaTipo, faltaParaCompletar, filaBienes, filtrar, nombreFichero,
  type AnotacionLibro, type FiltrosLibro, type Libro, type TipoFactura,
} from '@/modules/conta/lib/libroRegistro'
import { crearZip, nombresUnicos, type FicheroZip } from '@/modules/conta/lib/zip'
import { trimestreDe, useLeer, useLibros } from '@/modules/conta/libros/contexto'
import { excelAeat, excelTabla, pdfTabla, type FilaTabla } from '@/modules/conta/libros/exportar'
import {
  completarAnotacion, cuentasPorAsiento, datosFiscales, documentosDeFacturas, leerBienes, leerLibroRegistro, movimientoIva,
} from '@/modules/conta/services/librosService'

type Vista = 'issued' | 'received' | 'intracomunitarias'
const TITULO: Record<Vista, string> = { issued: 'Facturas expedidas', received: 'Facturas recibidas', intracomunitarias: 'Operaciones intracomunitarias' }
const LIBROS: Record<Vista, Libro[]> = { issued: ['issued'], received: ['received', 'investment'], intracomunitarias: ['issued', 'received', 'investment'] }
const TIPOS: TipoFactura[] = ['F1', 'F2', 'F3', 'F4', 'R1', 'R2', 'R3', 'R4', 'R5']
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`
const anotaciones = (n: number) => `${n} ${n === 1 ? 'anotación' : 'anotaciones'}`
const esIntra = (a: AnotacionLibro) => a.operationKey === '09' || a.exemptCause === 'E5'

/** Los periodos del ejercicio: sus cuatro trimestres y el año entero. */
function periodos(inicio: string, fin: string): { id: string; desde: string; hasta: string; nombre: string }[] {
  const r: { id: string; desde: string; hasta: string; nombre: string }[] = []
  let f = inicio
  while (f <= fin) {
    const t = trimestreDe(f)
    r.push({ id: t.nombre, desde: t.desde < inicio ? inicio : t.desde, hasta: t.hasta > fin ? fin : t.hasta, nombre: t.nombre })
    const siguiente = new Date(`${t.hasta}T12:00:00Z`); siguiente.setUTCDate(siguiente.getUTCDate() + 1)
    f = siguiente.toISOString().slice(0, 10)
  }
  return [...r, { id: 'año', desde: inicio, hasta: fin, nombre: `Todo el ejercicio` }]
}

export function RegistroIva({ libro }: { libro: Vista }) {
  const L = useLibros()
  const ps = periodos(L.ejercicio.inicio, L.ejercicio.fin)
  const hoy = new Date().toISOString().slice(0, 10)
  const [periodo, setPeriodo] = useState(() => (ps.find((p) => p.desde <= hoy && hoy <= p.hasta) ?? ps[0]).id)
  const p = ps.find((x) => x.id === periodo) ?? ps[0]
  const [f, setF] = useState<FiltrosLibro & { importe?: string }>({})
  const [porNif, setPorNif] = useState(false)
  const [completando, setCompletando] = useState<AnotacionLibro | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)

  const d = useLeer(async () => {
    const anot = await leerLibroRegistro(L.accountId, L.companyId, LIBROS[libro], p.desde, p.hasta)
    const lado: 'issued' | 'received' = libro === 'issued' ? 'issued' : 'received'
    const diario = libro === 'intracomunitarias' ? null : await movimientoIva(L.accountId, L.companyId, lado, p.desde, p.hasta)
    const cuentas = f.subcuenta ? await cuentasPorAsiento(L.accountId, [...new Set(anot.map((a) => a.entryId))]) : new Map<string, string[]>()
    return { anot: libro === 'intracomunitarias' ? anot.filter(esIntra) : anot, diario, cuentas }
  }, `${L.companyId}:${libro}:${p.desde}:${p.hasta}:${f.subcuenta ? 's' : ''}:${L.vuelta}`)

  const vistas = useMemo(() => {
    if (!d.datos) return null
    const filtros: FiltrosLibro = { ...f, importeSuperiorA: f.importe ? Number(f.importe.replace(',', '.')) : undefined }
    const filas = filtrar(d.datos.anot, filtros, d.datos.cuentas)
    return { filas, total: d.datos.anot.filter((a) => f.verAnuladas || !a.voidedAt).length, cifras: cifrasLibro(d.datos.anot), cuadre: d.datos.diario === null ? null : cuadreConDiario(d.datos.anot, libro === 'issued' ? 'issued' : 'received', d.datos.diario) }
  }, [d.datos, f, libro])
  const hayFiltro = !!(f.subcuenta || f.nif || f.importe || f.tipos?.length || f.solo347)

  const exportar = (como: 'pdf' | 'excel') => {
    if (!vistas) return
    const cab = ['Fecha', 'Tipo', 'Número', 'NIF', 'Nombre', 'Base', '% IVA', 'Cuota', 'Total', 'Anulada']
    const filas: FilaTabla[] = vistas.filas.map((a) => [ddmm(a.issueDate), etiquetaTipo(a), [a.series, a.number].filter(Boolean).join('-') + (a.numberTo ? `–${a.numberTo}` : ''), a.counterpartTaxId, a.counterpartName, a.taxBase, a.taxRate, a.taxAmount, a.total, a.voidedAt ? 'sí' : ''])
    const nombre = `${TITULO[libro]} ${p.nombre}`
    const ok = como === 'pdf' ? pdfTabla(`${nombre}.pdf`, TITULO[libro], `${p.nombre} · ${ddmm(p.desde)} a ${ddmm(p.hasta)}${hayFiltro ? ' · filtrado' : ''}`, cab, filas) : excelTabla(`${nombre}.xlsx`, TITULO[libro], cab, filas)
    setHecho(ok ? `Bajado: ${nombre}.${como === 'pdf' ? 'pdf' : 'xlsx'}, ${anotaciones(filas.length)}${hayFiltro ? ` de ${vistas.total} (con los filtros puestos)` : ''}.` : 'No había nada que bajar con estos filtros.')
  }

  if (d.error) return <ErrorConReintento mensaje={d.error} reintentar={d.recargar} />
  return (
    <section className="cxl-pagina" aria-label={TITULO[libro]}>
      <div className="cxl-seccion">
        <div><Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Libros registro de IVA' }]} /><h2>{TITULO[libro]}</h2></div>
        <div className="cxl-herramientas">
          <label><span className="cx-oculto">Periodo</span>
            <select className="cx-input" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>{ps.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
          </label>
          <button type="button" className="cx-boton-sec" onClick={() => exportar('pdf')} disabled={!vistas}>Exportar PDF</button>
          <button type="button" className="cx-boton-sec" onClick={() => exportar('excel')} disabled={!vistas}>Excel</button>
          <Link to={rutaLibros('registro', 'formato-aeat')} className="cx-boton-sec">Formato AEAT</Link>
        </div>
      </div>
      <Guardado texto={hecho} />

      {!vistas && <div className="cx-tarjeta" aria-busy="true">{[0, 1, 2].map((i) => <Hueso key={i} alto={36} />)}</div>}
      {vistas && (
        <div className="cxl-cifras" role="group" aria-label="Cifras del libro">
          <div className="cx-tarjeta cxl-cifra"><span className="cxl-cifra-etiqueta">Base imponible</span><span className="cxl-cifra-valor">{eurosExactos(vistas.cifras.base)}</span></div>
          <div className="cx-tarjeta cxl-cifra"><span className="cxl-cifra-etiqueta">{libro === 'issued' ? 'IVA repercutido' : libro === 'received' ? 'IVA soportado' : 'Cuota'}</span><span className="cxl-cifra-valor">{eurosExactos(vistas.cifras.cuota)}</span></div>
          <div className="cx-tarjeta cxl-cifra">
            <span className="cxl-cifra-etiqueta">Cuadre con el diario</span>
            {vistas.cuadre
              ? <span className={`cxl-cifra-valor ${vistas.cuadre.cuadra ? 'cxl-cuadra-si' : 'cxl-cuadra-no'}`} title={vistas.cuadre.frase}>{vistas.cuadre.cuadra ? '✓ Cuadra' : `✗ ${eurosExactos(Math.abs(vistas.cuadre.diferencia))}`}</span>
              : <span className="cxl-cifra-valor cxl-apoyo">Se mira en expedidas y recibidas</span>}
          </div>
          <div className="cx-tarjeta cxl-cifra"><span className="cxl-cifra-etiqueta">Por completar</span><span className={`cxl-cifra-valor${vistas.cifras.porCompletar ? ' cxl-ambar-celda' : ''}`}>{vistas.cifras.porCompletar} de {vistas.cifras.anotaciones}</span></div>
        </div>
      )}
      {vistas?.cuadre && !vistas.cuadre.cuadra && <p className="cxl-sin-sitio" role="alert">{vistas.cuadre.frase}</p>}

      <details className="cx-tarjeta cxl-opciones" open={hayFiltro}>
        <summary>Filtros del listado de facturación{hayFiltro ? ' · puestos' : ''}</summary>
        <label>Subcuenta<input className="cx-input" value={f.subcuenta ?? ''} inputMode="numeric" placeholder="700, 6000001…" onChange={(e) => setF({ ...f, subcuenta: e.target.value.replace(/\D/g, '') || undefined })} /></label>
        <label>NIF<input className="cx-input" value={f.nif ?? ''} onChange={(e) => setF({ ...f, nif: e.target.value || undefined })} /></label>
        <label>Importe superior a<input className="cx-input" value={f.importe ?? ''} inputMode="decimal" onChange={(e) => setF({ ...f, importe: e.target.value.replace(/[^\d,.]/g, '') || undefined })} /></label>
        <fieldset><legend>Tipo de factura</legend>
          {TIPOS.map((t) => (
            <label key={t} className="cx-pildora"><input type="checkbox" checked={!!f.tipos?.includes(t)} onChange={(e) => setF({ ...f, tipos: e.target.checked ? [...(f.tipos ?? []), t] : (f.tipos ?? []).filter((x) => x !== t) })} /> {t}</label>
          ))}
        </fieldset>
        <label><input type="checkbox" checked={porNif} onChange={(e) => setPorNif(e.target.checked)} /> Agrupar por NIF</label>
        <label><input type="checkbox" checked={!!f.solo347} onChange={(e) => setF({ ...f, solo347: e.target.checked })} /> Solo las del 347 (más de {eurosExactos(UMBRAL_347)} con el mismo NIF{periodo !== 'año' ? '; el 347 es anual: mira «Todo el ejercicio»' : ''})</label>
        <label><input type="checkbox" checked={!!f.verAnuladas} onChange={(e) => setF({ ...f, verAnuladas: e.target.checked })} /> Ver también las anuladas</label>
        {hayFiltro && <button type="button" className="cx-boton-sec" onClick={() => setF({ verAnuladas: f.verAnuladas })}>Quitar filtros</button>}
      </details>

      {vistas && !vistas.total && <div className="cx-tarjeta"><Vacio titulo={`Sin anotaciones en ${p.nombre}.`} explicacion="El libro se llena solo al validar los asientos con IVA: ventas del día, facturas de proveedor, liquidaciones de plataformas." /></div>}
      {vistas && vistas.total > 0 && (
        <div className="cx-tarjeta" style={{ overflowX: 'auto' }}>
          <p className="cxl-apoyo" role="status">{hayFiltro ? `${vistas.filas.length} de ${anotaciones(vistas.total)} con los filtros puestos.` : `${anotaciones(vistas.total)}.`}</p>
          {porNif ? <TablaPorNif filas={vistas.filas} /> : (
            <table className="cxl-tabla" aria-label={TITULO[libro]}>
              <thead><tr><th>Fecha</th><th>Factura</th><th>{libro === 'issued' ? 'Destinatario' : 'Expedidor'}</th><th className="cxl-der">Base</th><th className="cxl-der">% IVA</th><th className="cxl-der">Cuota</th><th className="cxl-der">Total</th><th /></tr></thead>
              <tbody>
                {vistas.filas.map((a) => {
                  const falta = faltaParaCompletar(a)
                  return (
                    <tr key={a.id} className={a.voidedAt ? 'cxl-anulada' : undefined}>
                      <td>{ddmm(a.issueDate)}</td>
                      <td><Link to={rutaAsiento(a.entryId)}>{[a.series, a.number].filter(Boolean).join('-') || 'sin número'}</Link><br /><span className="cxl-apoyo">{etiquetaTipo(a)}</span>{a.voidedAt && <> <Chip>anulada</Chip></>}</td>
                      <td>{a.counterpartName ?? '—'}{a.counterpartTaxId && <><br /><span className="cxl-apoyo">{a.counterpartTaxId}</span></>}</td>
                      <td className="cxl-der">{eurosExactos(a.taxBase)}</td><td className="cxl-der">{a.taxRate === null ? '—' : `${a.taxRate} %`}</td>
                      <td className="cxl-der">{eurosExactos(a.taxAmount)}</td><td className="cxl-der">{a.total === null ? '—' : eurosExactos(a.total)}</td>
                      <td>{falta.length > 0 && !a.voidedAt && <button type="button" className="cxl-defecto" title={`Falta: ${falta.join(', ')}`} onClick={() => setCompletando(a)}>Falta {falta[0]} · Completar</button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
      {completando && <Completar a={completando} alCerrar={() => setCompletando(null)} alGuardar={(t) => { setCompletando(null); setHecho(t); d.recargar() }} quien={L.quien} />}
    </section>
  )
}

function TablaPorNif({ filas }: { filas: AnotacionLibro[] }) {
  const g = agruparPorNif(filas)
  return (
    <table className="cxl-tabla" aria-label="Agrupado por NIF">
      <thead><tr><th>NIF</th><th>Nombre</th><th className="cxl-der">Facturas</th><th className="cxl-der">Base</th><th className="cxl-der">Cuota</th><th className="cxl-der">Total</th><th /></tr></thead>
      <tbody>{g.map((x) => (
        <tr key={x.nif ?? '—'}><td>{x.nif ?? 'sin NIF (simplificadas)'}</td><td>{x.nombre ?? '—'}</td><td className="cxl-der">{x.anotaciones}</td>
          <td className="cxl-der">{eurosExactos(x.base)}</td><td className="cxl-der">{eurosExactos(x.cuota)}</td><td className="cxl-der">{eurosExactos(x.total)}</td>
          <td>{x.nif && Math.abs(x.total) > UMBRAL_347 && <Chip tono="azul">347</Chip>}</td></tr>
      ))}</tbody>
    </table>
  )
}

function Completar({ a, alCerrar, alGuardar, quien }: { a: AnotacionLibro; alCerrar: () => void; alGuardar: (t: string) => void; quien: string | null }) {
  const [nif, setNif] = useState(a.counterpartTaxId ?? '')
  const [nombre, setNombre] = useState(a.counterpartName ?? '')
  const [numero, setNumero] = useState(a.number ?? '')
  const [hasta, setHasta] = useState(a.numberTo ?? '')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const falta = faltaParaCompletar(a)
  async function guardar() {
    setOcupado(true); setError(null)
    try {
      const cambios = {
        counterpartTaxId: nif.trim().toUpperCase().replace(/[\s.-]/g, '') || null, counterpartName: nombre.trim() || null,
        number: numero.trim() || null, ...(a.invoiceType === 'F4' ? { numberTo: hasta.trim() || null } : {}),
      }
      await completarAnotacion(a.id, cambios, quien)
      const quedan = faltaParaCompletar({ ...a, ...cambios, numberTo: cambios.numberTo ?? a.numberTo })
      alGuardar(`Anotación del ${ddmm(a.issueDate)} completada${quedan.length ? `; aún falta ${quedan.join(', ')}` : ': ya vale para un requerimiento'}. El asiento no cambia.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se ha podido guardar.') } finally { setOcupado(false) }
  }
  return (
    <Dialogo titulo="Completar la anotación" alCerrar={alCerrar}>
      <p className="cxl-apoyo">{etiquetaTipo(a)} del {ddmm(a.issueDate)} · {eurosExactos(a.taxBase)} de base. Falta: {falta.join(', ')}. Solo cambia el libro registro, no el asiento.</p>
      <label>NIF<input className="cx-input" value={nif} onChange={(e) => setNif(e.target.value)} /></label>
      <label>Nombre o razón social<input className="cx-input" value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>
      <label>{a.invoiceType === 'F4' ? 'Primer número' : 'Número de factura'}<input className="cx-input" value={numero} onChange={(e) => setNumero(e.target.value)} /></label>
      {a.invoiceType === 'F4' && <label>Último número del resumen<input className="cx-input" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>}
      {error && <p className="cxl-sin-sitio" role="alert">{error}</p>}
      <div className="cxl-herramientas">
        <button type="button" className="cx-boton" onClick={() => void guardar()} disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button>
      </div>
    </Dialogo>
  )
}

/** Para el zip: el nombre de cada documento a partir de su URL. */
const extension = (url: string) => { const m = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url); return m ? `.${m[1].toLowerCase()}` : '.pdf' }

export function FormatoAeat() {
  const L = useLibros()
  const ps = periodos(L.ejercicio.inicio, L.ejercicio.fin).filter((x) => x.id !== 'año')
  const hoy = new Date().toISOString().slice(0, 10)
  const [periodo, setPeriodo] = useState(() => (ps.find((p) => p.desde <= hoy && hoy <= p.hasta) ?? ps[ps.length - 1]).id)
  const p = ps.find((x) => x.id === periodo) ?? ps[0]
  const [hecho, setHecho] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  // Acumulado: del inicio del ejercicio al final del trimestre (así lo pide la AEAT).
  const d = useLeer(async () => {
    const [anot, bienes, fiscal] = await Promise.all([
      leerLibroRegistro(L.accountId, L.companyId, ['issued', 'received', 'investment'], L.ejercicio.inicio, p.hasta),
      leerBienes(L.accountId, L.companyId), datosFiscales(L.companyId),
    ])
    return { anot, bienes: bienes.filter((b) => (b.inicioUso ?? b.alta) <= p.hasta), fiscal }
  }, `${L.companyId}:${L.ejercicio.id}:${p.hasta}:${L.vuelta}`)

  const exp = d.datos?.anot.filter((a) => a.book === 'issued') ?? []
  const rec = d.datos?.anot.filter((a) => a.book !== 'issued') ?? []
  const porCompletar = (d.datos?.anot ?? []).filter((a) => !a.voidedAt && faltaParaCompletar(a).length > 0).length
  const anio = Number(L.ejercicio.fin.slice(0, 4))

  const bajarExcel = () => {
    if (!d.datos) return
    if (!d.datos.fiscal.nif) { setHecho('No se puede nombrar el fichero: la empresa no tiene NIF. Ponlo en Ajustes › Tu empresa.'); return }
    const nombre = nombreFichero(anio, d.datos.fiscal.nif, d.datos.fiscal.razon)
    const bienes = d.datos.bienes.map((b) => filaBienes(b, anio))
    const ok = excelAeat(nombre, exp, rec, bienes, COLUMNAS_BIENES)
    const vivas = (xs: AnotacionLibro[]) => xs.filter((a) => !a.voidedAt).length
    setHecho(ok ? `Bajado: ${nombre} · EXPEDIDAS ${vivas(exp)}, RECIBIDAS ${vivas(rec)}${bienes.length ? `, BIENES-INVERSIÓN ${bienes.length}` : ''}; del ${ddmm(L.ejercicio.inicio)} al ${ddmm(p.hasta)}.${porCompletar ? ` Ojo: ${anotaciones(porCompletar)} aún por completar.` : ''}` : 'No había nada que bajar: no hay anotaciones en ese periodo.')
  }

  async function bajarZip() {
    if (!d.datos) return
    setOcupado('Reuniendo los documentos…'); setHecho(null)
    try {
      const ids = [...new Set(rec.filter((a) => !a.voidedAt && a.sourceType === 'supplier_invoice' && a.sourceId).map((a) => a.sourceId!))]
      const docs = await documentosDeFacturas(L.accountId, ids)
      const ficheros: FicheroZip[] = []
      const fallidos: string[] = []
      const nombres = nombresUnicos(docs.map((x) => `${x.numero ?? x.id}${extension(x.url)}`))
      for (const [i, x] of docs.entries()) {
        setOcupado(`Bajando ${i + 1} de ${docs.length}…`)
        try {
          const r = await fetch(x.url)
          if (!r.ok) throw new Error(String(r.status))
          ficheros.push({ nombre: nombres[i], datos: new Uint8Array(await r.arrayBuffer()) })
        } catch { fallidos.push(`${nombres[i]}\t${x.url}`) }
      }
      const sinDoc = ids.length - docs.length
      const indice = [
        `Documentos de las facturas recibidas del ${ddmm(L.ejercicio.inicio)} al ${ddmm(p.hasta)}.`,
        `Facturas en el libro: ${ids.length}. Con documento guardado: ${docs.length}. Dentro del zip: ${ficheros.length}.`,
        ...(sinDoc ? [`${sinDoc} facturas no tienen documento guardado en Folvy.`] : []),
        ...(fallidos.length ? ['', 'No se han podido bajar (nombre y dirección):', ...fallidos] : []),
      ].join('\r\n')
      const zip = crearZip([{ nombre: 'indice.txt', datos: new TextEncoder().encode(indice) }, ...ficheros])
      const url = URL.createObjectURL(new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' }))
      const enlace = document.createElement('a')
      enlace.href = url; enlace.download = `Documentos ${anio} ${p.nombre}.zip`; enlace.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setHecho(`Bajado: Documentos ${anio} ${p.nombre}.zip con ${ficheros.length} de ${ids.length} facturas${sinDoc ? `; ${sinDoc} sin documento guardado` : ''}${fallidos.length ? `; ${fallidos.length} no se han podido bajar (en indice.txt)` : ''}.`)
    } catch (e) { setHecho(e instanceof Error ? `No se ha podido hacer el zip: ${e.message}` : 'No se ha podido hacer el zip.') } finally { setOcupado(null) }
  }

  if (d.error) return <ErrorConReintento mensaje={d.error} reintentar={d.recargar} />
  return (
    <section className="cxl-pagina" aria-label="Formato AEAT">
      <div className="cxl-seccion">
        <div><Migas migas={[{ etiqueta: 'Libros' }, { etiqueta: 'Libros registro de IVA' }]} /><h2>Libros en formato AEAT</h2></div>
        <div className="cxl-herramientas">
          <label><span className="cx-oculto">Hasta el trimestre</span>
            <select className="cx-input" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>{ps.map((x) => <option key={x.id} value={x.id}>Hasta el {x.nombre}</option>)}</select>
          </label>
        </div>
      </div>
      <Guardado texto={hecho} />
      {ocupado && <p className="cxl-apoyo" role="status">{ocupado}</p>}
      {!d.datos && <div className="cx-tarjeta" aria-busy="true">{[0, 1].map((i) => <Hueso key={i} alto={48} />)}</div>}
      {d.datos && (
        <>
          <div className="cx-tarjeta">
            <h3 className="cxl-subtitulo">Excel del requerimiento</h3>
            <p>Un fichero con las hojas EXPEDIDAS, RECIBIDAS{d.datos.bienes.length ? ' y BIENES-INVERSIÓN' : ''}, con las columnas y las dos filas de cabecera del diseño de la AEAT, acumulado del {ddmm(L.ejercicio.inicio)} al {ddmm(p.hasta)}.</p>
            <p className="cxl-apoyo">Nombre: {d.datos.fiscal.nif ? nombreFichero(anio, d.datos.fiscal.nif, d.datos.fiscal.razon) : '— (falta el NIF de la empresa)'}. {exp.filter((a) => !a.voidedAt).length} expedidas, {rec.filter((a) => !a.voidedAt).length} recibidas, {d.datos.bienes.length} bienes. Las anuladas no van: se compensan con su contraasiento.</p>
            {porCompletar > 0 && <p className="cxl-sin-sitio">{anotaciones(porCompletar)} por completar: el fichero sale igual, pero esas filas tienen huecos. <Link to={rutaLibros('registro', 'recibidas')}>Completarlas</Link></p>}
            <button type="button" className="cx-boton" onClick={bajarExcel}>Bajar el Excel</button>
          </div>
          <div className="cx-tarjeta">
            <h3 className="cxl-subtitulo">Documentos (zip)</h3>
            <p>Las facturas recibidas del periodo que tienen su documento guardado en Folvy, con un índice de las que no.</p>
            <button type="button" className="cx-boton-sec" onClick={() => void bajarZip()} disabled={!!ocupado}>Bajar el zip</button>
          </div>
        </>
      )}
    </section>
  )
}
