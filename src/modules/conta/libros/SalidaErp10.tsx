// src/modules/conta/libros/SalidaErp10.tsx
//
// X04 · «Salida a ERP10» (la maqueta aprobada, maqueta_salida_paso1/2.png): lo
// que se contabiliza en Sumied sale en ficheros que se importan en ERP10.
//
//   Paso 1 · «Mira lo que sale»: la tabla «Qué sale» (cinco filas, con sus
//   cifras de verdad; emitidas y asientos se cuentan con «Todavía no sale por
//   aquí»), la lista entera de la fila que se pulsa, «Qué mirar antes de
//   sacarlo» (sin PDF, las que no pueden salir y las que cambiaron después de
//   salir), las comprobaciones que se pueden afirmar y «Descargar los ficheros».
//   Paso 2 · «Impórtalo en ERP10»: los ficheros en el orden en que se importan,
//   con su botón de ERP10, «La primera vez» y «Dónde está en ERP10».
//   El paso 3 se ve, apagado: llega en la siguiente versión.
//
// Al descargar: se preparan los dos libros y los PDF (con lo que lleva hecho a
// la vista), se apunta lo que sale y SOLO si se apunta se entregan los ficheros
// (regla 8: confirma con contenido o dice por qué no).
//
// Solo con la salida encendida en la empresa (Ajustes › Ejercicio).

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaAjustes, rutaAsiento } from '@/config/navegacion'
import { useLeer, useLibros } from '@/modules/conta/libros/contexto'
import { fechaLarga, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { ErrorConReintento, Hueso } from '@/modules/conta/ui/piezas'
import { XML_RECIBIDAS, XML_SUBCUENTAS } from '@/modules/conta/erp10/configuracion'
import { armarSalida, comprimirPdfs, importe, mesEnPalabras, mesesDesde, prepararDescarga, type FilaQueSale, type Salida } from '@/modules/conta/erp10/salida'
import {
  apuntarLote, bajarPdf, carpetaDeLaSalida, leerCambiadas, leerLotes, leerPorSalir, leerRecibidasPorSalir, leerSalidaEmpresa,
} from '@/modules/conta/services/erp10Service'

function bajar(bytes: ArrayBuffer | Uint8Array, nombre: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: tipo }))
  const a = document.createElement('a')
  a.href = url; a.download = nombre
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const XLSX_TIPO = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const ETIQUETA: Record<FilaQueSale['estado'], string> = { Listo: 'cxe-etq-listo', 'Mira esto': 'cxe-etq-mira', 'Todavía no sale por aquí': 'cxe-etq-gris', Nada: 'cxe-etq-gris' }

type Descargado = { cuentas: number; recibidas: number; importe: number; pdfs: number; zips: string[]; texto: string }

export function SalidaErp10() {
  const L = useLibros()
  const hoy = hoyEnMadrid()
  const salida = useLeer(() => leerSalidaEmpresa(L.accountId, L.companyId), `${L.companyId}:${L.vuelta}`)
  const meses = useMemo(() => (salida.datos?.desde ? mesesDesde(salida.datos.desde, hoy) : []), [salida.datos, hoy])
  const [mesElegido, setMes] = useState<string | null>(null)
  const mes = mesElegido ?? meses[0] ?? null
  const [vuelta, setVuelta] = useState(0)
  const encendida = salida.datos?.encendida === true

  const datos = useLeer(encendida && mes ? async () => {
    const [ps, rs, cambiadas, lotes] = await Promise.all([
      leerPorSalir(L.companyId, mes), leerRecibidasPorSalir(L.companyId, mes), leerCambiadas(L.companyId), leerLotes(L.accountId, L.companyId),
    ])
    return { ps, rs, cambiadas, lotes }
  } : null, `${L.companyId}:${mes}:${vuelta}:${L.vuelta}`)

  const carpeta = salida.datos ? carpetaDeLaSalida(salida.datos) : ''
  const s: Salida | null = useMemo(() => (datos.datos ? armarSalida(datos.datos.ps, datos.datos.rs, carpeta) : null), [datos.datos, carpeta])

  const [paso, setPaso] = useState<1 | 2>(1)
  const [fila, setFila] = useState<FilaQueSale['id']>('recibidas')
  const [verLotes, setVerLotes] = useState(false)
  const [verSinPdf, setVerSinPdf] = useState(false)
  const [sinPdfAceptadas, setSinPdfAceptadas] = useState(false)
  const [haciendo, setHaciendo] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [hecho, setHecho] = useState<Descargado | null>(null)
  const [primeraVez, setPrimeraVez] = useState(false)
  const [marcados, setMarcados] = useState<Set<number>>(new Set())
  // La página no se mueve: la pantalla ocupa lo que queda debajo de su borde de arriba, y lo que no cabe rueda dentro.
  const caja = useRef<HTMLElement | null>(null)
  const [alto, setAlto] = useState<number | null>(null)
  useLayoutEffect(() => {
    const medir = () => {
      const el = caja.current
      if (!el) return
      // Lo que ponen debajo los que la contienen (relleno, borde y margen de abajo), para no pasarse de la ventana.
      let debajo = parseFloat(getComputedStyle(el).marginBottom) || 0
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const c = getComputedStyle(p)
        debajo += (parseFloat(c.paddingBottom) || 0) + (parseFloat(c.borderBottomWidth) || 0) + (parseFloat(c.marginBottom) || 0)
      }
      setAlto(Math.max(480, Math.floor(window.innerHeight - el.getBoundingClientRect().top - window.scrollY - debajo - 4)))
    }
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [salida.datos, paso])

  if (salida.error) return <ErrorConReintento mensaje={salida.error} reintentar={salida.recargar} />
  if (!salida.datos) return <div className="cx-tarjeta" aria-busy="true" aria-label="Cargando la salida a ERP10"><Hueso alto={40} /></div>
  if (!encendida) {
    return (
      <div className="cx-tarjeta" role="note">
        <h1 className="cxe-titulo">Salida a ERP10</h1>
        <p className="cx-ayuda">La salida a ERP10 no está encendida en esta empresa. Se enciende en <Link className="cx-enlace" to={rutaAjustes('ejercicio')}>Ajustes › Ejercicio</Link>, con el código de la empresa en ERP10.</p>
      </div>
    )
  }

  async function descargar() {
    if (!s || !mes) return
    setFallo(null); setHecho(null)
    try {
      setHaciendo('Preparando los ficheros…')
      const { libros, partidas } = await prepararDescarga(s)
      const pdfs: { nombre: string; bytes: Uint8Array }[] = []
      for (const [i, p] of s.ficheros.pdfs.entries()) {
        setHaciendo(`Preparando los PDF: ${i + 1} de ${s.ficheros.pdfs.length}`)
        pdfs.push({ nombre: p.nombre, bytes: await bajarPdf(p.ruta) })
      }
      const zips = pdfs.length ? comprimirPdfs(pdfs) : []
      if (!partidas.length) throw new Error('No hay ninguna factura recibida que pueda salir este mes.')
      setHaciendo('Apuntando lo que sale…')
      const ficheros = [...libros.map((l) => ({ nombre: l.nombre, filas: l.filas, huella: l.huella })),
        ...zips.map((z) => ({ nombre: z.nombre, filas: z.pdfs, huella: `${z.bytes.length}` }))]
      await apuntarLote(L.companyId, mes, ficheros, partidas, L.quien)
      // Solo si se ha apuntado, se entregan.
      for (const l of libros) bajar(l.bytes, l.nombre, XLSX_TIPO)
      for (const z of zips) bajar(z.bytes, z.nombre, 'application/zip')
      const cuentas = s.ficheros.subcuentas.length
      const texto = `Descargado: ${cuentas} ${cuentas === 1 ? 'cuenta nueva' : 'cuentas nuevas'} y ${partidas.length} ${partidas.length === 1 ? 'factura recibida' : 'facturas recibidas'}, ${importe(s.totalRecibidas)} €.`
        + (zips.length ? ` Los PDF, en ${zips.length === 1 ? 'un fichero comprimido' : `${zips.length} ficheros comprimidos`}.` : '') + ' Queda apuntado.'
      setHecho({ cuentas, recibidas: partidas.length, importe: s.totalRecibidas, pdfs: pdfs.length, zips: zips.map((z) => z.nombre), texto })
      setPaso(2)
    } catch (e) {
      setFallo(`No se ha descargado nada: ${e instanceof Error ? e.message : 'no ha contestado'}`)
    } finally {
      setHaciendo(null)
    }
  }

  const pasos = (
    <ol className="cxe-pasos" aria-label="Pasos">
      <li className={`cxe-paso${paso > 1 ? ' cxe-paso-hecho' : ''}`} aria-current={paso === 1 ? 'step' : undefined}><span className="cxe-paso-num">1</span>Mira lo que sale</li>
      <li className="cxe-paso" aria-current={paso === 2 ? 'step' : undefined}><span className="cxe-paso-num">2</span>Impórtalo en ERP10</li>
      <li className="cxe-paso cxe-paso-apagado" aria-disabled="true"><span className="cxe-paso-num">3</span><span className="cxe-paso-texto">Comprueba que queda igual<span className="cxe-paso-luego">Llega en la siguiente versión</span></span></li>
    </ol>
  )

  const ultima = datos.datos?.lotes[0] ?? null
  const nMirar = s ? (s.sinPdf.length && !sinPdfAceptadas ? 1 : 0) + (s.noPuedenSalir.length ? 1 : 0) + (datos.datos?.cambiadas.length ? 1 : 0) : 0

  return (
    <section className="cxe" aria-labelledby="cxe-titulo" ref={caja} style={alto ? { height: alto } : undefined}>
      <div className="cxe-cabeza">
        <h1 className="cxe-titulo" id="cxe-titulo">Salida a ERP10</h1>
        <select className="cxe-mes" aria-label="Mes" value={mes ?? ''} disabled={paso === 2 || !!haciendo}
          onChange={(e) => { setMes(e.target.value); setFila('recibidas') }}>
          {meses.map((m) => <option key={m} value={m}>{mesEnPalabras(m).replace(/^./, (x) => x.toUpperCase())}</option>)}
        </select>
        {pasos}
        <div className="cxe-botones">
          {paso === 1
            ? <button type="button" className="cxe-grande" disabled={!s || !!haciendo || !s.ficheros.recibidas.length} onClick={() => { void descargar() }}>Descargar los ficheros</button>
            : <>
                <button type="button" className="cxe-sec" onClick={() => setPaso(1)}>Volver</button>
                <button type="button" className="cxe-grande" onClick={() => { setPaso(1); setHecho(null); setMarcados(new Set()); setVuelta((v) => v + 1) }}>Ya lo he importado</button>
              </>}
        </div>
      </div>

      {datos.error && <div className="cxe-estado cxe-mal" role="alert">No se ha podido leer lo que sale: {datos.error} <button type="button" className="cxe-enlace" onClick={datos.recargar}>Reintentar</button></div>}
      {!s && !datos.error && <div className="cxe-cuerpo" aria-busy="true" aria-label="Leyendo lo que sale"><div className="cxe-izq"><Hueso alto={200} /></div><div className="cxe-der" /></div>}

      {s && paso === 1 && (
        <div className="cxe-cuerpo">
          <div className="cxe-izq">
            <div className="cxe-marco">
              <div className="cxe-rueda">
                <table className="cxe-tabla" aria-label="Qué sale">
                  <thead><tr><th>Qué sale</th><th className="cxe-num">Cuántos</th><th className="cxe-num">Importe</th><th>Cómo está</th></tr></thead>
                  <tbody>
                    {s.filas.map((f) => (
                      <tr key={f.id} className="cxe-fila" aria-selected={fila === f.id} tabIndex={0} onClick={() => setFila(f.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFila(f.id) } }}>
                        <td>{f.que}</td>
                        <td className="cxe-num">{f.cuantos}</td>
                        <td className="cxe-num">{f.importe === null ? '' : importe(f.importe)}</td>
                        <td><span className={`cxe-etq ${ETIQUETA[f.estado]}`}>{f.estado === 'Nada' ? 'Nada' : f.estado}</span>{f.texto}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Lista s={s} fila={fila} />
              </div>
              <div className="cxe-pie">
                <strong>Sale solo lo que todavía no ha salido.</strong>
                <span className="cxe-pie-gris">{ultima ? `Última salida: ${fechaLarga(ultima.cuando)}, ${mesEnPalabras(ultima.mes)}.` : 'Todavía no ha salido nada.'}</span>
                <button type="button" className="cxe-enlace" aria-expanded={verLotes} onClick={() => setVerLotes((v) => !v)}>{verLotes ? 'Ocultar lo que ya salió' : 'Ver lo que ya salió'}</button>
              </div>
              {verLotes && datos.datos && (
                <div className="cxe-rueda" style={{ maxHeight: 160, flex: 'none' }}>
                  <table className="cxe-tabla cxe-sub" aria-label="Lo que ya salió">
                    <thead><tr><th>Cuándo</th><th>Mes</th><th>Quién</th><th className="cxe-num">Cuentas</th><th className="cxe-num">Recibidas</th></tr></thead>
                    <tbody>
                      {datos.datos.lotes.length === 0 && <tr><td colSpan={5}>Todavía no ha salido nada.</td></tr>}
                      {datos.datos.lotes.map((l) => (
                        <tr key={l.id}><td>{fechaLarga(l.cuando)}</td><td>{mesEnPalabras(l.mes)}</td><td>{l.quien ?? '—'}</td><td className="cxe-num">{l.cuentasNuevas}</td><td className="cxe-num">{l.recibidas}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {s.comprobaciones.length > 0 && <ul className="cxe-comprobaciones" aria-label="Comprobaciones">{s.comprobaciones.map((c) => <li key={c}>{c}</li>)}</ul>}
          </div>

          <aside className="cxe-der" aria-labelledby="cxe-mirar">
            <h2 className="cxe-der-titulo" id="cxe-mirar">Qué mirar antes de sacarlo · {nMirar}</h2>
            <div className="cxe-der-cuerpo">
              {s.sinPdf.length > 0 && (sinPdfAceptadas
                ? <div className="cxe-nota"><p><strong>{s.sinPdf.length} {s.sinPdf.length === 1 ? 'factura sale' : 'facturas salen'} sin PDF.</strong> En ERP10 quedarán sin documento.</p></div>
                : (
                  <div className="cxe-aviso" role="note">
                    <p><strong>{s.sinPdf.length} {s.sinPdf.length === 1 ? 'factura recibida no tiene' : 'facturas recibidas no tienen'} PDF.</strong> Salen igual, pero en ERP10 quedarán sin documento.</p>
                    <div className="cxe-aviso-botones">
                      <button type="button" className="cxe-ambar" aria-expanded={verSinPdf} onClick={() => setVerSinPdf((v) => !v)}>Añadir los PDF</button>
                      <button type="button" className="cxe-ambar-sec" onClick={() => setSinPdfAceptadas(true)}>Sacarlas igual</button>
                    </div>
                    {verSinPdf && <ul>{s.sinPdf.map((f) => <li key={f.entryId}><Link className="cx-enlace" to={rutaAsiento(f.entryId)}>{f.numero}</Link> · {f.proveedor} · {fechaLarga(f.fecha)}</li>)}</ul>}
                  </div>
                ))}
              {s.noPuedenSalir.length > 0 && (
                <div className="cxe-aviso" role="note">
                  <p><strong>{s.noPuedenSalir.length} {s.noPuedenSalir.length === 1 ? 'factura recibida no puede' : 'facturas recibidas no pueden'} salir.</strong> No van en el fichero.</p>
                  <ul>{s.noPuedenSalir.map((x) => <li key={x.entryId}><Link className="cx-enlace" to={rutaAsiento(x.entryId)}>{x.numero}</Link> · {x.quien}: {x.porque}</li>)}</ul>
                </div>
              )}
              {datos.datos && datos.datos.cambiadas.length > 0 && (
                <div className="cxe-aviso" role="note">
                  <p><strong>{datos.datos.cambiadas.length} {datos.datos.cambiadas.length === 1 ? 'ha cambiado' : 'han cambiado'} después de salir.</strong> ERP10 tiene la versión de antes. No se vuelven a mandar.</p>
                  <ul>{datos.datos.cambiadas.map((x) => <li key={x.entryId}><Link className="cx-enlace" to={rutaAsiento(x.entryId)}>{x.serie}/{x.numero}</Link> · {x.concepto}: {x.queHacer}</li>)}</ul>
                </div>
              )}
              {nMirar === 0 && <div className="cxe-nota"><p>Nada que mirar: todo lo que sale está listo.</p></div>}
              <div className="cxe-nota"><p><strong>Es temporal.</strong> Sirve para llevar esta empresa en Sumied y en ERP10 a la vez y comparar. Se apaga en la ficha de la empresa cuando ya no haga falta.</p></div>
            </div>
          </aside>
        </div>
      )}

      {s && paso === 2 && hecho && (
        <div className="cxe-cuerpo">
          <div className="cxe-izq">
            <div className="cxe-marco">
              <div className="cxe-rueda">
                <table className="cxe-tabla" aria-label="Los ficheros, en el orden en que se importan">
                  <thead><tr><th>Hecho</th><th>Fichero</th><th>Botón de ERP10</th><th>Qué lleva</th></tr></thead>
                  <tbody>
                    {[
                      ...(hecho.cuentas ? [{ f: 'subcuentas.xlsx', b: 'Subcuentas', q: `${hecho.cuentas} ${hecho.cuentas === 1 ? 'cuenta nueva' : 'cuentas nuevas'}` }] : []),
                      { f: 'recibidas.xlsx', b: 'Facturas, eligiendo «Facturas recibidas»', q: `${hecho.recibidas} ${hecho.recibidas === 1 ? 'factura recibida' : 'facturas recibidas'}` },
                      ...hecho.zips.map((z) => ({ f: z, b: 'Su carpeta de documentos', q: `Descomprímelos en ${carpeta} antes de importar las facturas.` })),
                    ].map((x, i) => (
                      <tr key={x.f}>
                        <td><input type="checkbox" aria-label={`Hecho: ${x.f}`} checked={marcados.has(i)}
                          onChange={() => setMarcados((m) => { const n = new Set(m); if (n.has(i)) n.delete(i); else n.add(i); return n })} /> <strong>{i + 1}</strong></td>
                        <td><strong>{x.f}</strong></td><td>{x.b}</td><td>{x.q}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="cxe-pie"><strong>En este orden.</strong><span className="cxe-pie-gris">Primero las cuentas: si no, ERP10 no encuentra a qué apuntar las facturas.</span></div>
            </div>
          </div>
          <aside className="cxe-der" aria-labelledby="cxe-donde">
            <h2 className="cxe-der-titulo" id="cxe-donde">Dónde está en ERP10</h2>
            <div className="cxe-der-cuerpo">
              <div className="cxe-nota">
                <p>Contabilidad › pestaña <strong>Importaciones</strong> › grupo</p>
                <div className="cxe-chips"><span className="cxe-chip cxe-chip-si">Facturas</span><span className="cxe-chip">Asientos</span><span className="cxe-chip">Balances</span><span className="cxe-chip cxe-chip-si">Subcuentas</span><span className="cxe-chip">Asientos TXT</span><small>IMPORTACIÓN DESDE FICHERO</small></div>
              </div>
              <div className="cxe-nota"><p><strong>Queda apuntado.</strong> Qué salió, cuándo y quién lo descargó.</p></div>
              <div className="cxe-nota">
                <button type="button" className="cxe-enlace" aria-expanded={primeraVez} onClick={() => setPrimeraVez((v) => !v)}><strong>La primera vez</strong></button>
                {primeraVez && (
                  <div style={{ marginTop: 8 }}>
                    <p>Antes de importar nada, carga en ERP10 cómo lee Sumied cada fichero:</p>
                    <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
                      <li><button type="button" className="cxe-enlace" onClick={() => bajar(new TextEncoder().encode(XML_RECIBIDAS.replace(/\n/g, '\r\n')), 'ConfiguracionRecibidas.XML', 'application/xml')}>ConfiguracionRecibidas.XML</button>: En ERP10: Importaciones › Facturas › Configurar Excel › Configuración.</li>
                      <li><button type="button" className="cxe-enlace" onClick={() => bajar(new TextEncoder().encode(XML_SUBCUENTAS.replace(/\n/g, '\r\n')), 'ConfiguracionSubcuentas.XML', 'application/xml')}>ConfiguracionSubcuentas.XML</button>: En ERP10: Importaciones › Subcuentas › Configurar Excel › Configuración.</li>
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

      <div className="cxe-estado" role="status" aria-live="polite">
        {haciendo && <span>{haciendo}</span>}
        {hecho && !haciendo && <span className="cxe-hecho">{hecho.texto}</span>}
      </div>
      {fallo && <div className="cxe-estado cxe-mal" role="alert">{fallo}</div>}
    </section>
  )
}

/** La lista entera de la fila pulsada (regla 7: lo que se abre a propósito no esconde filas). */
function Lista({ s, fila }: { s: Salida; fila: FilaQueSale['id'] }) {
  const titulo = s.filas.find((f) => f.id === fila)!.que
  return (
    <>
      <h2 className="cxe-lista-titulo">{titulo}</h2>
      {fila === 'cuentas' && (
        <table className="cxe-tabla cxe-sub" aria-label={titulo}>
          <thead><tr><th>Cuenta</th><th>En ERP10</th><th>Nombre</th><th>NIF</th></tr></thead>
          <tbody>{s.listas.cuentas.length ? s.listas.cuentas.map((c) => <tr key={c.codigo}><td>{c.codigo}</td><td>{c.codigoErp10}</td><td>{c.nombre}</td><td>{c.nif ?? ''}</td></tr>)
            : <tr><td colSpan={4}>Ninguna: todas las que usan ya están en ERP10.</td></tr>}</tbody>
        </table>
      )}
      {fila === 'recibidas' && (
        <table className="cxe-tabla cxe-sub" aria-label={titulo}>
          <thead><tr><th>Fecha</th><th>Proveedor</th><th>Número</th><th className="cxe-num">Importe</th></tr></thead>
          <tbody>{s.listas.recibidas.length ? s.listas.recibidas.map((f) => (
            <tr key={f.entryId}><td>{fechaLarga(f.fecha)}{f.deOtroMes && <span className="cxe-otro-mes">de otro mes</span>}</td><td>{f.proveedor}</td>
              <td><Link className="cx-enlace" to={rutaAsiento(f.entryId)}>{f.numero}</Link></td><td className="cxe-num">{importe(f.importe)}</td></tr>
          )) : <tr><td colSpan={4}>Ninguna factura recibida sale este mes.</td></tr>}</tbody>
        </table>
      )}
      {(fila === 'emitidas' || fila === 'asientos') && (
        <table className="cxe-tabla cxe-sub" aria-label={titulo}>
          <thead><tr><th>Fecha</th><th>Asiento</th><th>Concepto</th><th className="cxe-num">Importe</th></tr></thead>
          <tbody>{(fila === 'emitidas' ? s.listas.emitidas : s.listas.asientos).map((p) => (
            <tr key={p.entryId}><td>{fechaLarga(p.fecha)}{p.deOtroMes && <span className="cxe-otro-mes">de otro mes</span>}</td>
              <td><Link className="cx-enlace" to={rutaAsiento(p.entryId)}>{p.serie}/{p.numero}</Link></td><td>{p.numeroFactura ?? p.concepto}</td><td className="cxe-num">{importe(p.importe)}</td></tr>
          ))}
          {(fila === 'emitidas' ? s.listas.emitidas : s.listas.asientos).length === 0 && <tr><td colSpan={4}>Ninguno este mes.</td></tr>}</tbody>
        </table>
      )}
      {fila === 'pdf' && (
        <table className="cxe-tabla cxe-sub" aria-label={titulo}>
          <thead><tr><th>Nombre del fichero</th><th>Factura</th></tr></thead>
          <tbody>{s.listas.pdf.length ? s.listas.pdf.map((p) => <tr key={p.nombre}><td>{p.nombre}</td><td>{p.factura}</td></tr>)
            : <tr><td colSpan={2}>Ninguna factura que sale tiene su PDF en Sumied.</td></tr>}</tbody>
        </table>
      )}
    </>
  )
}
