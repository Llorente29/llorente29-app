// src/modules/conta/libros/SalidaErp10.tsx
//
// X04 · «Salida a ERP10» (la maqueta aprobada, maqueta_salida_paso1/2.png): lo
// que se contabiliza en Sumied sale en ficheros que se importan en ERP10.
//
//   Paso 1 · «Mira lo que sale»: la tabla «Qué sale» (con sus cifras de verdad;
//   X05: las emitidas salen como las recibidas; asientos y días del TPV se
//   cuentan con «Todavía no sale por aquí»), la lista entera de la fila que se
//   pulsa, «Qué mirar antes de sacarlo» (sin PDF, las que no pueden salir y las
//   que cambiaron después de salir), las comprobaciones que se pueden afirmar y
//   «Descargar los ficheros».
//   Paso 2 · «Impórtalo en ERP10»: los ficheros en el orden en que se importan,
//   con su botón de ERP10, «La primera vez» y «Dónde está en ERP10».
//   Paso 3 · «Comprueba que queda igual» (X06, ComprobarErp10.tsx): se sube el
//   sumas y saldos de ERP10 y se compara cuenta a cuenta, con el porqué de cada
//   diferencia, «Volver a sacar solo esa», «Ya la he metido a mano» y «Darlo por
//   igualado». Se llega con «Ya lo he importado» o pulsando el paso, si ya ha salido algo.
//
// Al descargar: se preparan los libros y los PDF (con lo que lleva hecho a
// la vista), se apunta lo que sale y SOLO si se apunta se entregan los ficheros
// (regla 8: confirma con contenido o dice por qué no).
//
// Solo con la salida encendida en la empresa (Ajustes › Ejercicio).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaAjustes, rutaAsiento, rutaCierres } from '@/config/navegacion'
import { useLeer, useLeerConservando, useLibros } from '@/modules/conta/libros/contexto'
import { fechaLarga, hoyEnMadrid } from '@/modules/conta/lib/formato'
import { ErrorConReintento, Hueso } from '@/modules/conta/ui/piezas'
import { XML_ASIENTOS, XML_EXPEDIDAS, XML_RECIBIDAS, XML_SUBCUENTAS } from '@/modules/conta/erp10/configuracion'
import { armarSalida, comprimirPdfs, importe, mesEnPalabras, mesesDesde, prepararDescarga, soloUna, type Clase, type FilaQueSale, type Salida } from '@/modules/conta/erp10/salida'
import { comparar, fechaDelSumas } from '@/modules/conta/erp10/comparar'
import { abrirExcel, leerSumasYSaldos, reconocer, texto as textoDe, type FilaSumas } from '@/modules/conta/lib/traer'
import { ComprobarErp10, type Subido } from '@/modules/conta/libros/ComprobarErp10'
import { leerConexionErp10, leerEstadoEscribir, leerSaldosErp10, loQueFalta, sacarRecibidasErp10, type ParaSacar } from '@/modules/conta/services/erp10ApiService'
import { loQueHaEntrado, queVaAEntrar } from '@/modules/conta/erp10/conexion'
import { huellaFila, salePorLaConexion } from '@/modules/conta/erp10/ficheros'
import { ConexionErp10Tarjeta } from '@/modules/conta/libros/ConexionErp10'
import {
  apuntarLote, bajarPdf, carpetaDeLaSalida, leerAsientosPorSalir, leerCambiadas, leerComprobar, leerDiasTpvPorSalir, leerEmitidasPorSalir, leerLotes, leerPorSalir, leerRecibidasPorSalir, leerSalidaEmpresa,
  ponerAMano, ponerIgualado, volverASacar,
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

type Descargado = { cuentas: number; emitidas: number; recibidas: number; asientos: number; dias: number; pdfs: number; zips: string[]; texto: string }

const facturas = (n: number, clase: Clase | 'dia') => clase === 'asiento' ? `${n} ${n === 1 ? 'asiento' : 'asientos'}`
  : clase === 'dia' ? `${n} ${n === 1 ? 'día' : 'días'} de ventas`
  : `${n} ${n === 1 ? 'factura' : 'facturas'} ${clase === 'emitida' ? (n === 1 ? 'emitida' : 'emitidas') : (n === 1 ? 'recibida' : 'recibidas')}`
const CLASES: (Clase | 'dia')[] = ['emitida', 'dia', 'recibida', 'asiento']

export function SalidaErp10() {
  const L = useLibros()
  const hoy = hoyEnMadrid()
  const salida = useLeer(() => leerSalidaEmpresa(L.accountId, L.companyId), `${L.companyId}:${L.vuelta}`)
  const meses = useMemo(() => (salida.datos?.desde ? mesesDesde(salida.datos.desde, hoy) : []), [salida.datos, hoy])
  const [mesElegido, setMes] = useState<string | null>(null)
  const mes = mesElegido ?? meses[0] ?? null
  const [vuelta, setVuelta] = useState(0)
  const encendida = salida.datos?.encendida === true

  // X07: al refrescar lo del mismo mes (después de sacar o de volver a sacar), lo de antes se queda a la vista.
  const datos = useLeerConservando(encendida && mes ? async () => {
    const [ps, rs, es, as, ds, cambiadas, lotes] = await Promise.all([
      leerPorSalir(L.companyId, mes), leerRecibidasPorSalir(L.companyId, mes), leerEmitidasPorSalir(L.companyId, mes), leerAsientosPorSalir(L.companyId, mes),
      leerDiasTpvPorSalir(L.companyId, mes), leerCambiadas(L.companyId), leerLotes(L.accountId, L.companyId),
    ])
    return { ps, rs, es, as, ds, cambiadas, lotes }
  } : null, `${L.companyId}:${mes}:${vuelta}:${L.vuelta}`, `${L.companyId}:${mes}`)

  const carpeta = salida.datos ? carpetaDeLaSalida(salida.datos) : ''
  const s: Salida | null = useMemo(() => (datos.datos ? armarSalida(datos.datos.ps, datos.datos.rs, datos.datos.es, carpeta, datos.datos.as, datos.datos.ds) : null), [datos.datos, carpeta])

  const [paso, setPaso] = useState<1 | 2 | 3>(1)
  // X10b · La conexión con ERP10 (las claves de la cuenta y el código de esta sociedad), en la tarjeta de arriba.
  const [vueltaConexion, setVueltaConexion] = useState(0)
  const conexion = useLeerConservando(() => leerConexionErp10(L.accountId, L.companyId), `${L.companyId}:${vueltaConexion}`, L.companyId)
  const [conexionAbierta, setConexionAbierta] = useState<boolean | null>(null)
  const faltaErp10 = conexion.datos ? loQueFalta(conexion.datos) : null
  // Plegada en una línea (con lo que falta, si falta) hasta que alguien la abre: así la salida sigue cabiendo en la ventana.
  const abierta = conexionAbierta ?? false
  // Paso 3: el sumas y saldos subido (con su cabecera, para la fecha), la comparación y la cuenta elegida.
  const [subido, setSubido] = useState<(Subido & { cabecera: string[]; filas: FilaSumas[] }) | null>(null)
  const [errorSubir, setErrorSubir] = useState<string | null>(null)
  const [elegida, setElegida] = useState<string | null>(null)
  // Lo que confirma el paso 3 (regla 8): lo apuntado a mano, lo vuelto a sacar, lo igualado.
  const [dicho, setDicho] = useState<string | null>(null)
  const [vueltaC, setVueltaC] = useState(0)
  const fecha = subido && mes ? fechaDelSumas(subido.cabecera, mes) : null
  // X07: mientras vuelve a comparar (al igualar, al apuntar a mano, al volver a sacar), la tabla que había se queda a la vista.
  const comprobar = useLeerConservando(paso === 3 && fecha ? () => leerComprobar(L.companyId, fecha) : null, `${L.companyId}:${fecha}:${vueltaC}:${L.vuelta}`,
    `${L.companyId}:${fecha}:${subido?.nombre ?? ''}`)
  const comparacion = useMemo(() => {
    if (!subido || !comprobar.datos || !s) return null
    const porSacar = new Set([...s.ficheros.expedidas, ...s.ficheros.recibidas, ...s.ficheros.asientos, ...s.ficheros.dias].map((f) => f.entryId))
    // X08 · Un día de ventas que no puede salir no sale por aquí (sin rango, sin «Clientes de contado»…): no es un fallo de la salida.
    const noSaleAqui = new Set(s.noPuedenSalir.filter((x) => x.clase === 'dia').map((x) => x.entryId))
    return comparar(subido.filas, comprobar.datos, { porSacar, noPueden: new Map(s.noPuedenSalir.map((x) => [x.entryId, x.porque])), noSaleAqui })
  }, [subido, comprobar.datos, s])
  // X08 · Sin elegir, el detalle de abajo es la primera fila que sale con algo (o la primera con algo): no «Ninguna factura recibida» si salen asientos.
  const [filaElegida, setFila] = useState<FilaQueSale['id'] | null>(null)
  const fila: FilaQueSale['id'] = filaElegida
    ?? s?.filas.find((f) => f.sale && f.cuantos > 0 && f.id !== 'cuentas' && f.id !== 'pdf')?.id
    ?? s?.filas.find((f) => f.cuantos > 0)?.id
    ?? 'recibidas'
  const [verLotes, setVerLotes] = useState(false)
  const [verSinPdf, setVerSinPdf] = useState(false)
  const [sinPdfAceptadas, setSinPdfAceptadas] = useState(false)
  const [haciendo, setHaciendo] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const [hecho, setHecho] = useState<Descargado | null>(null)
  // X10b · Sacar a ERP10 por la conexión (las recibidas): la primera, sola; el mes, después de comprobarla.
  const [vueltaEsc, setVueltaEsc] = useState(0)
  const escribir = useLeer(() => leerEstadoEscribir(L.accountId, L.companyId), `${L.companyId}:${vueltaEsc}:${L.vuelta}`)
  const [confirmar, setConfirmar] = useState(false)
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
  }, [salida.datos, paso, abierta, conexion.datos])

  // «Darlo por igualado» con Intro, si se puede y no se está escribiendo en otro sitio: pulsa su botón (si está encendido).
  useEffect(() => {
    if (paso !== 3) return
    const tecla = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key !== 'Enter' || (t && /^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(t.tagName)) || (t && t.closest('tr[tabindex]'))) return
      const b = document.querySelector<HTMLButtonElement>('button.cxe-igualar')
      if (b && !b.disabled) b.click()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [paso])

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

  /** Prepara los libros y los PDF de una salida, la apunta y, solo si se apunta, entrega los ficheros. */
  async function sacar(sx: Salida, m: string) {
    const { libros, partidas } = await prepararDescarga(sx)
    const pdfs: { nombre: string; bytes: Uint8Array }[] = []
    for (const [i, p] of sx.ficheros.pdfs.entries()) {
      setHaciendo(`Preparando los PDF: ${i + 1} de ${sx.ficheros.pdfs.length}`)
      pdfs.push({ nombre: p.nombre, bytes: await bajarPdf(p.ruta) })
    }
    const zips = pdfs.length ? comprimirPdfs(pdfs) : []
    if (!partidas.length) throw new Error('No hay ninguna factura que pueda salir este mes.')
    setHaciendo('Apuntando lo que sale…')
    const ficheros = [...libros.map((l) => ({ nombre: l.nombre, filas: l.filas, huella: l.huella })),
      ...zips.map((z) => ({ nombre: z.nombre, filas: z.pdfs, huella: `${z.bytes.length}` }))]
    await apuntarLote(L.companyId, m, ficheros, partidas, L.quien)
    // Solo si se ha apuntado, se entregan.
    for (const l of libros) bajar(l.bytes, l.nombre, XLSX_TIPO)
    for (const z of zips) bajar(z.bytes, z.nombre, 'application/zip')
    return { libros, zips, pdfs }
  }

  async function descargar() {
    if (!s || !mes) return
    setFallo(null); setHecho(null)
    try {
      setHaciendo('Preparando los ficheros…')
      const { zips, pdfs } = await sacar(s, mes)
      const cuentas = s.ficheros.subcuentas.length
      const nE = s.ficheros.expedidas.length
      const nR = s.ficheros.recibidas.length
      // X08 · Los asientos que se cuentan son los del X07; el cobro de cada día va con su día.
      const nA = s.listas.asientos.length
      const nD = s.ficheros.dias.length
      const partes = [`${cuentas} ${cuentas === 1 ? 'cuenta nueva' : 'cuentas nuevas'}`, `${facturas(nE, 'emitida')} (${importe(s.totalEmitidas)} €)`, `${facturas(nR, 'recibida')} (${importe(s.totalRecibidas)} €)`]
      if (nD) partes.push(`${facturas(nD, 'dia')} (${importe(s.totalDias)} €)`)
      if (nA) partes.push(`${facturas(nA, 'asiento')} (${importe(s.totalAsientos)} €)`)
      const texto = `Descargado: ${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}.`
        + (zips.length ? ` Los PDF, en ${zips.length === 1 ? 'un fichero comprimido' : `${zips.length} ficheros comprimidos`}.` : '') + ' Queda apuntado.'
      setHecho({ cuentas, emitidas: nE, recibidas: nR, asientos: s.ficheros.asientos.length, dias: nD, pdfs: pdfs.length, zips: zips.map((z) => z.nombre), texto })
      setPaso(2)
    } catch (e) {
      setFallo(`No se ha descargado nada: ${e instanceof Error ? e.message : 'no ha contestado'}`)
    } finally {
      setHaciendo(null)
    }
  }

  // ── Paso 3 ──
  async function subir(f: File) {
    setErrorSubir(null); setFallo(null); setDicho(null)
    try {
      const ex = abrirExcel(f.name, await f.arrayBuffer())
      const r = reconocer(ex)
      if (!r || r.tipo !== 'sumas_saldos') throw new Error(`${f.name} no es un sumas y saldos de ERP10. Sácalo de ERP10 en Excel y súbelo tal cual.`)
      const leido = leerSumasYSaldos(r.hoja, r.fila)
      const cabecera = r.hoja.filas.slice(0, r.fila).flat().map((c) => textoDe(c)).filter(Boolean)
      setSubido({ nombre: f.name, fecha: mes ? fechaDelSumas(cabecera, mes) : '', avisos: leido.avisos, cabecera, filas: leido.filas })
      setElegida(null)
      setVueltaC((v) => v + 1)
    } catch (e) {
      setErrorSubir(e instanceof Error ? e.message : 'No se ha podido leer el fichero.')
    }
  }
  // X10 · Sin Excel: los saldos de ERP10 leídos ahora (las líneas de sus apuntes sumadas por
  // cuenta, desde el día de inicio de la sociedad hasta la fecha elegida). Igual que un Excel
  // subido, con su nombre («ERP10, leído el …») y su fecha.
  async function leerDeErp10(hasta: string) {
    if (!mes) return
    setErrorSubir(null); setFallo(null); setDicho(null); setHaciendo('Entrando en ERP10…')
    try {
      const base = await leerComprobar(L.companyId, hasta)
      const r = await leerSaldosErp10(L.companyId, base.desde, hasta)
      const hora = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(r.leidoEn)).replace(',', '')
      setSubido({ nombre: `ERP10, leído el ${hora}`, fecha: hasta, avisos: [], cabecera: [`hasta ${hasta.slice(8, 10)}/${hasta.slice(5, 7)}/${hasta.slice(0, 4)}`], filas: r.filas, leidoEn: hora })
      setElegida(null)
      setVueltaC((v) => v + 1)
    } catch (e) {
      setErrorSubir(e instanceof Error ? e.message : 'No se ha podido entrar en ERP10.')
    } finally { setHaciendo(null) }
  }
  async function aMano(entryId: string) {
    setFallo(null); setDicho(null); setHaciendo('Apuntando…')
    try {
      setDicho(await ponerAMano(L.companyId, entryId, L.quien))
      setVueltaC((v) => v + 1)
    } catch (e) {
      setFallo(`No se ha apuntado: ${e instanceof Error ? e.message : 'no ha contestado'}`)
    } finally { setHaciendo(null) }
  }
  async function volverASacarla(entryId: string) {
    if (!mes) return
    setFallo(null); setDicho(null); setHaciendo('Preparando la factura…')
    try {
      await volverASacar(L.companyId, entryId, L.quien)
      const [ps, rs, es, as, ds] = await Promise.all([leerPorSalir(L.companyId, mes), leerRecibidasPorSalir(L.companyId, mes), leerEmitidasPorSalir(L.companyId, mes),
        leerAsientosPorSalir(L.companyId, mes), leerDiasTpvPorSalir(L.companyId, mes)])
      const una = soloUna(armarSalida(ps, rs, es, carpeta, as, ds), entryId)
      if (!una) throw new Error('ha vuelto a lo que sale, pero su fila no se puede preparar: mírala en el paso 1.')
      const { libros, pdfs } = await sacar(una, mes)
      const nombre = [...una.listas.emitidas, ...una.listas.recibidas][0]?.numero ?? 'la factura'
      setDicho(`Vuelve a salir la ${nombre}: ${libros.map((l) => l.nombre).join(' y ')} con una factura${pdfs.length ? ' y su PDF (pdf.zip)' : ''}. Queda apuntado como una salida más. Impórtalo en ERP10 y sube otra vez el sumas y saldos.`)
    } catch (e) {
      setFallo(`No se ha vuelto a sacar: ${e instanceof Error ? e.message : 'no ha contestado'}`)
    } finally {
      setHaciendo(null); setVuelta((v) => v + 1); setVueltaC((v) => v + 1)
    }
  }
  async function igualar() {
    if (!mes || !subido || !fecha || !comparacion?.igualable || haciendo) return
    setFallo(null); setDicho(null); setHaciendo('Apuntando…')
    try {
      setDicho(await ponerIgualado(L.companyId, { mes, fichero: subido.nombre, fecha, cuentas: comparacion.cuentas.length, conDiferencia: comparacion.noIgual.length, quien: L.quien }))
      setVueltaC((v) => v + 1)
    } catch (e) {
      setFallo(`No se ha dado por igualado: ${e instanceof Error ? e.message : 'no ha contestado'}`)
    } finally { setHaciendo(null) }
  }
  const hayLotes = (datos.datos?.lotes.length ?? 0) > 0
  // X07 · Ya igualado (este mes, este fichero, esta fecha): el botón lo dice y se apaga; la pantalla se ve acabada.
  const g = comprobar.datos?.igualado
  const yaIgualado = !!g && !!subido && g.mes === mes && g.fichero === subido.nombre && g.fechaSaldos === fecha
  const porQueNoIgualar = !subido ? 'Primero compara con ERP10 o sube su sumas y saldos.'
    : !comparacion ? 'Comparando…'
    : !comparacion.igualable ? 'Queda alguna diferencia sin explicar o por hacer.' : undefined

  // X10b · Lo que sale por la conexión: las recibidas medidas (interior, sin retención, hasta tres IVA); la primera vez, una.
  const porLaConexion = (s?.ficheros.recibidas ?? []).filter((f) => f.api && salePorLaConexion(f.api))
  const nPorExcel = (s?.ficheros.recibidas.length ?? 0) - porLaConexion.length
  const pruebaPrimero = !!escribir.datos && !escribir.datos.primera
  const pendienteComprobar = !!escribir.datos?.primera && !escribir.datos.comprobada
  const aSacar = pruebaPrimero ? porLaConexion.slice(0, 1) : porLaConexion
  const porQueNoSacar = faltaErp10
    ?? (!escribir.datos ? 'Leyendo lo que ya ha salido a ERP10…'
      : pendienteComprobar ? 'Antes de sacar el mes, comprueba en el paso 3 la factura de prueba y dala por igualada.'
      : !porLaConexion.length ? 'Este mes no hay ninguna recibida que pueda salir por la conexión con ERP10.' : null)
  const avisoSacar = faltaErp10 ? `Para sacar a ERP10: ${faltaErp10}` : pendienteComprobar ? 'Antes de sacar el mes, comprueba en el paso 3 la factura de prueba y dala por igualada.' : null

  async function sacarPorLaConexion() {
    if (!s || !mes || !aSacar.length) return
    setFallo(null); setDicho(null); setHaciendo(pruebaPrimero ? 'Metiendo la factura de prueba en ERP10…' : `Metiendo en ERP10 ${aSacar.length} ${aSacar.length === 1 ? 'factura' : 'facturas'}…`)
    try {
      const xs: ParaSacar[] = []
      for (const f of aSacar) xs.push({ api: f.api!, huella: await huellaFila(f.fila), pdf: f.pdf ?? null })
      const cuentas = s.listas.cuentas.map((c) => ({ codigo: c.codigoErp10, nombre: c.nombre, nif: c.nif }))
      const r = await sacarRecibidasErp10(L.companyId, mes, xs, cuentas, L.quien, (h, de) => setHaciendo(`Metiendo en ERP10: ${h} de ${de}…`))
      const dicho = loQueHaEntrado(r.salidas.map((x) => ({ ...x, numero: x.numero })), mesEnPalabras(mes))
      setConfirmar(false)
      // Pasa sola al paso 3, para comprobar que queda igual.
      setPaso(3); setSubido(null); setHecho(null)
      setDicho([dicho.texto, r.sinApuntar].filter(Boolean).join(' '))
      if (!dicho.bien || r.sinApuntar) setFallo('Mira lo que no ha podido entrar: lo demás ya está en ERP10.')
    } catch (e) {
      setFallo(`No ha entrado nada en ERP10: ${e instanceof Error ? e.message : 'no ha contestado'}`)
    } finally {
      setHaciendo(null); setVuelta((v) => v + 1); setVueltaEsc((v) => v + 1); setVueltaC((v) => v + 1)
    }
  }

  const pasos = (
    <ol className="cxe-pasos" aria-label="Pasos">
      <li className={`cxe-paso${paso > 1 ? ' cxe-paso-hecho' : ''}`} aria-current={paso === 1 ? 'step' : undefined}>
        {paso === 3 ? <button type="button" className="cxe-paso-boton" aria-label="Mira lo que sale" title="Mira lo que sale" onClick={() => setPaso(1)}><span className="cxe-paso-num">1</span><span className="cxe-paso-etq">Mira lo que sale</span></button> : <><span className="cxe-paso-num">1</span><span className="cxe-paso-etq">Mira lo que sale</span></>}
      </li>
      <li className={`cxe-paso${paso > 2 ? ' cxe-paso-hecho' : ''}`} aria-current={paso === 2 ? 'step' : undefined}><span className="cxe-paso-num">2</span><span className="cxe-paso-etq">Impórtalo en ERP10</span></li>
      <li className="cxe-paso" aria-current={paso === 3 ? 'step' : undefined}>
        {paso === 1 && hayLotes ? <button type="button" className="cxe-paso-boton" aria-label="Comprueba que queda igual" title="Comprueba que queda igual" onClick={() => setPaso(3)}><span className="cxe-paso-num">3</span><span className="cxe-paso-etq">Comprueba que queda igual</span></button>
          : <><span className="cxe-paso-num">3</span><span className="cxe-paso-etq">Comprueba que queda igual</span></>}
      </li>
    </ol>
  )

  const ultima = datos.datos?.lotes[0] ?? null
  const nCambiadas = (datos.datos?.cambiadas.length ?? 0) + (s?.corregidas.length ?? 0)
  const nMirar = s ? CLASES.reduce((t, k) => t + (s.sinPdf.some((x) => x.clase === k) && !sinPdfAceptadas ? 1 : 0) + (s.noPuedenSalir.some((x) => x.clase === k) ? 1 : 0), 0) + (nCambiadas ? 1 : 0) : 0

  const irALaConexion = () => {
    setConexionAbierta(true)
    requestAnimationFrame(() => document.getElementById('conexion-erp10')?.scrollIntoView({ block: 'start' }))
  }

  return (
    <>
    <ConexionErp10Tarjeta key={L.companyId} accountId={L.accountId} companyId={L.companyId} quien={L.quien} conexion={conexion.datos ?? null} error={conexion.error ?? null}
      abierta={abierta} abrir={setConexionAbierta} cambiada={() => setVueltaConexion((v) => v + 1)} />
    <section className="cxe" aria-labelledby="cxe-titulo" ref={caja} style={alto ? { height: alto } : undefined}>
      <div className="cxe-cabeza">
        <h1 className="cxe-titulo" id="cxe-titulo">Salida a ERP10</h1>
        <select className="cxe-mes" aria-label="Mes" value={mes ?? ''} disabled={paso === 2 || !!haciendo}
          onChange={(e) => { setMes(e.target.value); setFila(null) }}>
          {meses.map((m) => <option key={m} value={m}>{mesEnPalabras(m).replace(/^./, (x) => x.toUpperCase())}</option>)}
        </select>
        {pasos}
        <div className="cxe-botones">
          {paso === 1 && <>
            <button type="button" className="cxe-enlace" disabled={!s || !!haciendo || !(s.ficheros.recibidas.length + s.ficheros.expedidas.length + s.ficheros.asientos.length)} onClick={() => { void descargar() }}>Descargar los ficheros (Excel)</button>
            <button type="button" className="cxe-grande" disabled={!!porQueNoSacar || !!haciendo || confirmar} title={porQueNoSacar ?? undefined} onClick={() => { setFallo(null); setHecho(null); setConfirmar(true) }}>
              {pruebaPrimero ? 'Sacar una para probar' : 'Sacar a ERP10'}
            </button>
          </>}
          {paso === 2 && <>
            <button type="button" className="cxe-sec" onClick={() => setPaso(1)}>Volver</button>
            <button type="button" className="cxe-grande" onClick={() => { setPaso(3); setHecho(null); setMarcados(new Set()); setSubido(null); setVuelta((v) => v + 1) }}>Ya lo he importado</button>
          </>}
          {paso === 3 && <>
            {yaIgualado
              ? <button type="button" className="cxe-grande cxe-igualado-hecho" disabled>✓ Igualado</button>
              : <button type="button" className="cxe-grande cxe-igualar" disabled={!!porQueNoIgualar || !!haciendo} title={porQueNoIgualar} onClick={() => { void igualar() }}>
                  Darlo por igualado <kbd className="cxe-kbd">Intro</kbd>
                </button>}
          </>}
        </div>
      </div>

      {paso === 1 && s && avisoSacar && (
        <div className="cxe-aviso-linea cxe-sacar-falta" role="note">
          {avisoSacar}
          {faltaErp10 && <> <button type="button" className="cxe-enlace" onClick={irALaConexion}>Ir a la conexión con ERP10</button></>}
          {!faltaErp10 && pendienteComprobar && <> <button type="button" className="cxe-enlace" onClick={() => { setPaso(3); setSubido(null) }}>Ir al paso 3</button></>}
        </div>
      )}
      {paso === 1 && confirmar && mes && (
        <div className="cxe-confirmar" role="alertdialog" aria-label="Sacar a ERP10">
          <p>{queVaAEntrar({ cuantas: aSacar.length, mes: mesEnPalabras(mes), prueba: pruebaPrimero && aSacar[0] ? { numero: aSacar[0].api!.numero, proveedor: aSacar[0].api!.nombre, total: aSacar[0].api!.total } : null })}</p>
          {nPorExcel > 0 && <p className="cx-ayuda">{nPorExcel === 1 ? 'Una recibida sale con el Excel' : `${nPorExcel} recibidas salen con el Excel`} (retención, inversión del sujeto pasivo o intracomunitaria). Las emitidas, los asientos y los días del TPV, también con el Excel, por ahora.</p>}
          <div className="cxe-confirmar-botones">
            <button type="button" className="cxe-sec" onClick={() => setConfirmar(false)} disabled={!!haciendo}>No, todavía no</button>
            <button type="button" className="cxe-grande" onClick={() => { void sacarPorLaConexion() }} disabled={!!haciendo}>{pruebaPrimero ? 'Sacar solo esta para probar' : 'Meterlas en ERP10'}</button>
          </div>
        </div>
      )}
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
                <span className="cxe-pie-gris">{ultima ? `Última salida: ${fechaLarga(hoyEnMadrid(new Date(ultima.cuando)))}, ${mesEnPalabras(ultima.mes)}.` : 'Todavía no ha salido nada.'}</span>
                <button type="button" className="cxe-enlace" aria-expanded={verLotes} onClick={() => setVerLotes((v) => !v)}>{verLotes ? 'Ocultar lo que ya salió' : 'Ver lo que ya salió'}</button>
              </div>
              {verLotes && datos.datos && (
                <div className="cxe-rueda" style={{ maxHeight: 160, flex: 'none' }}>
                  <table className="cxe-tabla cxe-sub" aria-label="Lo que ya salió">
                    <thead><tr><th>Cuándo</th><th>Mes</th><th>Quién</th><th className="cxe-num">Cuentas</th><th className="cxe-num">Emitidas</th><th className="cxe-num">Recibidas</th></tr></thead>
                    <tbody>
                      {datos.datos.lotes.length === 0 && <tr><td colSpan={6}>Todavía no ha salido nada.</td></tr>}
                      {datos.datos.lotes.map((l) => (
                        <tr key={l.id}><td>{fechaLarga(hoyEnMadrid(new Date(l.cuando)))}</td><td>{mesEnPalabras(l.mes)}</td><td>{l.quien ?? '—'}</td><td className="cxe-num">{l.cuentasNuevas}</td><td className="cxe-num">{l.emitidas}</td><td className="cxe-num">{l.recibidas}</td></tr>
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
              {CLASES.map((k) => {
                const sp = s.sinPdf.filter((x) => x.clase === k)
                if (!sp.length) return null
                return sinPdfAceptadas
                  ? <div key={`sp-${k}`} className="cxe-nota"><p><strong>{facturas(sp.length, k)} {sp.length === 1 ? 'sale' : 'salen'} sin PDF.</strong> En ERP10 quedarán sin documento.</p></div>
                  : (
                    <div key={`sp-${k}`} className="cxe-aviso" role="note">
                      <p><strong>{facturas(sp.length, k)} {sp.length === 1 ? 'no tiene' : 'no tienen'} PDF.</strong> Salen igual, pero en ERP10 quedarán sin documento.</p>
                      <div className="cxe-aviso-botones">
                        <button type="button" className="cxe-ambar" aria-expanded={verSinPdf} onClick={() => setVerSinPdf((v) => !v)}>Añadir los PDF</button>
                        <button type="button" className="cxe-ambar-sec" onClick={() => setSinPdfAceptadas(true)}>Sacarlas igual</button>
                      </div>
                      {verSinPdf && <ul>{sp.map((f) => <li key={f.entryId}><Link className="cx-enlace" to={rutaAsiento(f.entryId)}>{f.numero}</Link> · {f.tercero} · {fechaLarga(f.fecha)}</li>)}</ul>}
                    </div>
                  )
              })}
              {CLASES.map((k) => {
                const np = s.noPuedenSalir.filter((x) => x.clase === k)
                if (!np.length) return null
                return (
                  <div key={`np-${k}`} className="cxe-aviso" role="note">
                    <p><strong>{facturas(np.length, k)} no {np.length === 1 ? 'puede' : 'pueden'} salir.</strong> No van en el fichero.</p>
                    <ul>{np.map((x) => <li key={x.entryId}><Link className="cx-enlace" to={rutaAsiento(x.entryId)}>{x.numero}</Link> · {x.quien}: {x.porque}</li>)}</ul>
                    {k === 'dia' && np.some((x) => /Clientes de contado|cuenta de /.test(x.porque)) && (
                      <p>Se elige en <Link className="cx-enlace" to={rutaCierres()}>A qué cuenta va cada forma de pago</Link> (Ventas › Cierres del día).</p>
                    )}
                  </div>
                )
              })}
              {datos.datos && nCambiadas > 0 && (
                <div className="cxe-aviso" role="note">
                  <p><strong>{nCambiadas} {nCambiadas === 1 ? 'ha cambiado' : 'han cambiado'} después de salir.</strong> ERP10 tiene la versión de antes. No se vuelven a mandar.</p>
                  <ul>
                    {datos.datos.cambiadas.map((x) => <li key={x.entryId}><Link className="cx-enlace" to={rutaAsiento(x.entryId)}>{x.serie}/{x.numero}</Link> · {x.concepto}: {x.queHacer}</li>)}
                    {s.corregidas.map((x) => <li key={`${x.entryId}-${x.rectificativa}`}><Link className="cx-enlace" to={rutaAsiento(x.entryId)}>{x.numero}</Link>: {x.queHacer}</li>)}
                  </ul>
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
                      ...(hecho.emitidas ? [{ f: 'expedidas.xlsx', b: 'Facturas, eligiendo «Facturas emitidas»', q: facturas(hecho.emitidas, 'emitida') }] : []),
                      ...(hecho.dias ? [{ f: 'dias-tpv.xlsx', b: 'Facturas, eligiendo «Facturas emitidas»',
                        q: `${facturas(hecho.dias, 'dia')}: una factura por día, con su primera y su última factura del TPV. Antes, carga otra vez ConfiguracionExpedidas.XML (lleva el resumen del día)` }] : []),
                      ...(hecho.recibidas ? [{ f: 'recibidas.xlsx', b: 'Facturas, eligiendo «Facturas recibidas»', q: facturas(hecho.recibidas, 'recibida') }] : []),
                      ...(hecho.asientos ? [{ f: 'asientos.xlsx', b: 'Asientos', q: `${facturas(hecho.asientos, 'asiento')}: nóminas, pagos y cobros, bancos${hecho.dias ? ', y el cobro de cada día de ventas' : ''}` }] : []),
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
              <div className="cxe-pie"><strong>En este orden.</strong><span className="cxe-pie-gris">{hecho.dias ? 'Primero las cuentas; después las emitidas, los días de ventas, las recibidas y los asientos.' : 'Primero las cuentas; después las emitidas, las recibidas y los asientos.'}</span></div>
            </div>
          </div>
          <aside className="cxe-der" aria-labelledby="cxe-donde">
            <h2 className="cxe-der-titulo" id="cxe-donde">Dónde está en ERP10</h2>
            <div className="cxe-der-cuerpo">
              <div className="cxe-nota">
                <p>Contabilidad › pestaña <strong>Importaciones</strong> › grupo</p>
                <div className="cxe-chips"><span className="cxe-chip cxe-chip-si">Facturas</span><span className={`cxe-chip${hecho.asientos ? ' cxe-chip-si' : ''}`}>Asientos</span><span className="cxe-chip">Balances</span><span className="cxe-chip cxe-chip-si">Subcuentas</span><span className="cxe-chip">Asientos TXT</span><small>IMPORTACIÓN DESDE FICHERO</small></div>
              </div>
              <div className="cxe-nota"><p><strong>Queda apuntado.</strong> Qué salió, cuándo y quién lo descargó.</p></div>
              <div className="cxe-nota">
                <button type="button" className="cxe-enlace" aria-expanded={primeraVez} onClick={() => setPrimeraVez((v) => !v)}><strong>La primera vez</strong></button>
                {primeraVez && (
                  <div style={{ marginTop: 8 }}>
                    <p>Antes de importar nada, carga en ERP10 cómo lee Sumied cada fichero:</p>
                    <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
                      <li><button type="button" className="cxe-enlace" onClick={() => bajar(new TextEncoder().encode(XML_EXPEDIDAS.replace(/\n/g, '\r\n')), 'ConfiguracionExpedidas.XML', 'application/xml')}>ConfiguracionExpedidas.XML</button>: En ERP10: Importaciones › Facturas › Configurar Excel › Configuración, con «Facturas emitidas».</li>
                      <li><button type="button" className="cxe-enlace" onClick={() => bajar(new TextEncoder().encode(XML_ASIENTOS.replace(/\n/g, '\r\n')), 'ConfiguracionAsientos.XML', 'application/xml')}>ConfiguracionAsientos.XML</button>: En ERP10: Importaciones › Asientos › Configurar Excel › Configuración, con «No importar facturas» marcada.</li>
                      <li><button type="button" className="cxe-enlace" onClick={() => bajar(new TextEncoder().encode(XML_RECIBIDAS.replace(/\n/g, '\r\n')), 'ConfiguracionRecibidas.XML', 'application/xml')}>ConfiguracionRecibidas.XML</button>: En ERP10: Importaciones › Facturas › Configurar Excel › Configuración, con «Facturas recibidas».</li>
                      <li><button type="button" className="cxe-enlace" onClick={() => bajar(new TextEncoder().encode(XML_SUBCUENTAS.replace(/\n/g, '\r\n')), 'ConfiguracionSubcuentas.XML', 'application/xml')}>ConfiguracionSubcuentas.XML</button>: En ERP10: Importaciones › Subcuentas › Configurar Excel › Configuración.</li>
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

      {s && paso === 3 && (
        <ComprobarErp10 subido={subido} base={comprobar.datos} comparacion={comparacion} error={errorSubir ?? comprobar.error}
          elegida={elegida} elegir={setElegida} subir={(f) => { void subir(f) }} leerErp10={(h) => { void leerDeErp10(h) }} faltaErp10={conexion.datos ? faltaErp10 : null} irALaConexion={irALaConexion} aMano={(id) => { void aMano(id) }} volver={(id) => { void volverASacarla(id) }}
          ocupado={!!haciendo} cargando={comprobar.cargando || datos.cargando} mes={mes} />
      )}

      <div className="cxe-estado" role="status" aria-live="polite">
        {haciendo && <span>{haciendo}</span>}
        {hecho && !haciendo && paso !== 3 && <span className="cxe-hecho">{hecho.texto}</span>}
        {dicho && !haciendo && paso === 3 && <span className="cxe-hecho">{dicho}</span>}
      </div>
      {fallo && <div className="cxe-estado cxe-mal" role="alert">{fallo}</div>}
    </section>
    </>
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
      {(fila === 'recibidas' || fila === 'emitidas') && (
        <table className="cxe-tabla cxe-sub" aria-label={titulo}>
          <thead><tr><th>Fecha</th><th>{fila === 'emitidas' ? 'Cliente' : 'Proveedor'}</th><th>Número</th><th className="cxe-num">Importe</th></tr></thead>
          <tbody>{s.listas[fila].length ? s.listas[fila].map((f) => (
            <tr key={f.entryId}><td>{fechaLarga(f.fecha)}{f.deOtroMes && <span className="cxe-otro-mes">de otro mes</span>}</td><td>{f.tercero}</td>
              <td><Link className="cx-enlace" to={rutaAsiento(f.entryId)}>{f.numero}</Link></td><td className="cxe-num">{importe(f.importe)}</td></tr>
          )) : <tr><td colSpan={4}>{fila === 'emitidas' ? 'Ninguna factura emitida sale este mes.' : 'Ninguna factura recibida sale este mes.'}</td></tr>}</tbody>
        </table>
      )}
      {fila === 'tpv' && (
        <table className="cxe-tabla cxe-sub" aria-label={titulo}>
          <thead><tr><th>Día</th><th>Local</th><th>Facturas del TPV</th><th className="cxe-num">Importe</th></tr></thead>
          <tbody>{s.listas.tpv.map((d) => (
            <tr key={d.entryId}><td>{fechaLarga(d.fecha)}</td><td>{d.local ?? '—'}</td>
              <td><Link className="cx-enlace" to={rutaAsiento(d.entryId)}>{d.rango}</Link> · {d.facturas}</td><td className="cxe-num">{importe(d.importe)}</td></tr>
          ))}
          {s.listas.tpv.length === 0 && <tr><td colSpan={4}>Ningún día de ventas sale este mes.</td></tr>}</tbody>
        </table>
      )}
      {fila === 'asientos' && (
        <table className="cxe-tabla cxe-sub" aria-label={titulo}>
          <thead><tr><th>Fecha</th><th>Asiento</th><th>Concepto</th><th className="cxe-num">Importe</th></tr></thead>
          <tbody>{s.listas[fila].map((p) => (
            <tr key={p.entryId}><td>{fechaLarga(p.fecha)}{p.deOtroMes && <span className="cxe-otro-mes">de otro mes</span>}</td>
              <td><Link className="cx-enlace" to={rutaAsiento(p.entryId)}>{p.serie}/{p.numero}</Link></td><td>{p.numeroFactura ?? p.concepto}</td><td className="cxe-num">{importe(p.importe)}</td></tr>
          ))}
          {s.listas[fila].length === 0 && <tr><td colSpan={4}>Ninguno este mes.</td></tr>}</tbody>
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
