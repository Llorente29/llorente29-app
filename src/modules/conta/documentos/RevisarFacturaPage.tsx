// src/modules/conta/documentos/RevisarFacturaPage.tsx
//
// S02 · Compras y gastos › Facturas recibidas › una factura, con la plantilla
// FICHA del patrón único (tablero 3):
//   · Encabezado: migas («Compras y gastos › Facturas recibidas › EUROPASTRY
//     24048027»), el título con su estado, «Llegó por correo el 14/10 ·
//     factura recibida»; arriba a la derecha «‹ 3 de 9 ›», «Más acciones ▾» y
//     el principal «Validar y siguiente» con Intro.
//   · A la izquierda, por bloques: el VEREDICTO de la IA con su motivo y «Por
//     qué» (veredicto.ts); proveedor y factura; importes; a qué gasto va (con
//     PROPUESTO y su motivo); el pago; y, abajo y desplegable, el asiento que
//     se crea, con «Cuadra» y, si la empresa tiene «Enviar a Diez» encendido (C07),
//     «Al validar se envía también a Diez».
//   · A la derecha, el PDF: grande, ampliable a pantalla completa y plegable
//     (se recuerda por persona).
//   · Teclado (regla 5 del patrón): Intro valida y pasa a la siguiente, las
//     flechas mueven y Esc vuelve a la lista como la dejaste.
//
// «3 de 9» es la cola de la LISTA de la que se vino, con sus mismos filtros y
// su orden (recibidas.ts): la dirección de la ficha lleva la de la lista.
//
// Lo de siempre se queda (D01, S01): «Validar» aprueba como en Compras,
// propone, valida, guarda su PDF y la manda a Diez, y cada paso que no sale se
// dice (regla 8); «No es una factura» la descarta con su motivo y se deshace.
// S02 · PR 2: la ficha vive solo en Compras y gastos (regla 1 del patrón: cada
// cosa en un solo sitio). Ya no se abre desde Contabilidad › Asientos: «volver»
// y Esc llevan siempre a la lista de Facturas recibidas de la que se vino.

import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { rutaCompras, rutaDocumentos, rutaRevisarFactura } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEnvioDiez } from '@/modules/conta/services/envioDiezService'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { eurosExactos, hoyEnMadrid, porcentaje } from '@/modules/conta/lib/formato'
import { comoLlego, productoDeDocumentos, vencimientoAEnsenar } from '@/modules/conta/documentos/documentos'
import { useProductoSolo } from '@/modules/conta/cuenta/useProductoSolo'
import { MARCA } from '@/modules/conta/cuenta/marca'
import { PapelPdf } from '@/modules/conta/documentos/PapelPdf'
import {
  apuntarFactura, decirProveedor, descartarFactura, leerDescarte, leerDocumentos, leerExtrasFacturas, leerFactura, plazoDeLaFicha, proveedoresDeLaCuenta, recuperarFactura,
  urlDelPapel, verPropuestaFactura, type Apuntada,
} from '@/modules/conta/services/documentosService'
import { useAnalitica, useMarco } from '@/modules/conta/marco/nuevo/contexto'
import { PorNivel } from '@/modules/conta/textos/PorNivel'
import { useTexto } from '@/modules/conta/textos/useTexto'
import { comprobacionesSinContradecir, textoSinPapel } from '@/modules/conta/documentos/RevisarFacturaPage.textos'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import type { GrupoDeAcciones } from '@/modules/conta/marco/acciones'
import { Boton, Tecla } from '@/modules/conta/diseno'
import {
  AsientoQueSeCrea, BloqueFicha, CampoFicha, DocumentoFicha, Ficha, FilaCampos, NavegaFicha, Veredicto, conCambio, listaRecordada, recordarLista,
} from '@/modules/conta/diseno/plantillas'
import { LISTA_RECIBIDAS, colaDeFacturas, filasDeLaLista, filtrosDe, ventanaDe } from '@/modules/conta/documentos/recibidas'
import { motivoGasto, motivoImportes, motivoProveedor, veredictoFactura, type Comprobacion } from '@/modules/conta/documentos/veredicto'

const fecha = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—')
const euro = (n: number | null) => (n === null ? '—' : eurosExactos(n))
const importe = (n: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
const mayuscula = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)

/** ¿La tecla es para la ficha? No mientras se escribe, ni con un diálogo abierto, ni sobre un botón o enlace. */
function teclaDeLaFicha(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return false
  const t = e.target as HTMLElement | null
  if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.closest('[role="dialog"]'))) return false
  if (e.key === 'Enter' && t && t.closest('button, a, summary')) return false
  return true
}

export default function RevisarFacturaPage() {
  const { local: ejeLocal } = useAnalitica()
  const tx = useTexto()
  const marco = useMarco()
  const { invoiceId = '' } = useParams()
  const [query] = useSearchParams()
  const { search } = useLocation()
  const navegar = useNavigate()
  const { accountId, userId, userName } = useCuentaConta()
  const movil = useIsMobile()
  const producto = productoDeDocumentos(useProductoSolo(), MARCA.nombre)
  const avisoDeAntes = (useLocation().state as { aviso?: string } | null)?.aviso ?? null
  const [vuelta, setVuelta] = useState(0)
  const f = useLeer(invoiceId ? () => leerFactura(invoiceId) : null, `${invoiceId}:${vuelta}`)
  const fac = f.datos
  // C07: con «Enviar a Diez» apagado para la empresa, ni una palabra de Diez.
  const enviaADiez = useEnvioDiez(fac?.account_id, fac?.company_id).envio?.encendido === true
  const hoy = hoyEnMadrid()

  // La cola de la lista de la que se vino, con sus filtros y su orden: «3 de 9», ‹ y ›.
  const filtros = filtrosDe(query)
  const { desde, hasta } = ventanaDe(filtros.mes, hoy)
  const lista = useLeer(fac?.company_id && accountId ? async () => {
    const d = await leerDocumentos(fac.company_id!, desde, hasta)
    const ids = d.filas.filter((x) => x.tipo === 'factura').map((x) => x.id)
    const extras = await leerExtrasFacturas(accountId, ids).catch(() => new Map())
    return colaDeFacturas(filasDeLaLista(d.filas, extras, filtros))
  } : null, `${fac?.company_id}:${desde}:${hasta}:${search}:${vuelta}`)
  const ids = lista.datos ?? []
  const pos = ids.indexOf(invoiceId)

  // La lista a la que se vuelve: la de la dirección, o la última recordada.
  const volver = listaRecordada(LISTA_RECIBIDAS, `${rutaDocumentos()}${conCambio(search, { fila: invoiceId })}`)
  const ir = useCallback((id: string, aviso?: string) => {
    const q = conCambio(search, { fila: id })
    recordarLista(LISTA_RECIBIDAS, `${rutaDocumentos()}${q}`)
    navegar(`${rutaRevisarFactura(id)}${q}`, aviso ? { state: { aviso } } : undefined)
  }, [search, navegar])

  const papel = useLeer(fac ? async () => ({ url: await urlDelPapel(fac) }) : null, `${invoiceId}:papel:${fac?.llegada?.ruta ?? fac?.papel ?? ''}`)
  const plazo = useLeer(fac?.proveedor?.id && accountId ? () => plazoDeLaFicha(accountId, fac.proveedor!.id) : null, `${accountId}:${fac?.proveedor?.id}:plazo:${vuelta}`)
  const vista = useLeer(fac && accountId && fac.company_id && fac.fecha && !fac.asiento ? () => verPropuestaFactura(accountId, fac.company_id!, fac.id, fac.fecha!) : null,
    `${invoiceId}:${fac?.estado}:${fac?.proveedor?.id}:${vuelta}`)
  const extra = useLeer(accountId && invoiceId ? () => leerExtrasFacturas(accountId, [invoiceId]).then((m) => m.get(invoiceId) ?? null) : null, `${accountId}:${invoiceId}:extra:${vuelta}`)

  const descarte = useLeer(fac?.estado === 'descartada' ? () => leerDescarte(fac.id) : null, `${invoiceId}:${fac?.estado}:descarte:${vuelta}`)
  const [noEs, setNoEs] = useState(false)
  const [recuperado, setRecuperado] = useState<{ id: string; texto: string } | null>(null)
  const [falloDescarte, setFalloDescarte] = useState<string | null>(null)
  const siguiente = pos >= 0 && pos < ids.length - 1 ? ids[pos + 1] : null
  const anterior = pos > 0 ? ids[pos - 1] : null
  async function descartar(motivo: string) {
    if (!fac) return
    setFalloDescarte(null)
    try {
      await descartarFactura(fac.id, motivo, userName)
      setNoEs(false)
      const texto = `Descartada: «${motivo}». No es una factura y sale de «Por revisar»; la tienes en «Todas», por si hay que deshacerlo.`
      if (siguiente) { ir(siguiente, texto); return }
      setRecuperado({ id: fac.id, texto })
      setVuelta((v) => v + 1)
    } catch (e) { setFalloDescarte(e instanceof Error ? e.message : String(e)) }
  }
  async function deshacerDescarte() {
    if (!fac) return
    setFalloDescarte(null)
    try {
      const estado = await recuperarFactura(fac.id, userName)
      setRecuperado({ id: fac.id, texto: `Recuperada: es una factura y vuelve a «${NOMBRE_ESTADO[estado] ?? estado}».` })
      setVuelta((v) => v + 1)
    } catch (e) { setFalloDescarte(e instanceof Error ? e.message : String(e)) }
  }
  const [apuntando, setApuntando] = useState(false)
  const [apuntada, setApuntada] = useState<{ id: string; r: Apuntada } | null>(null)
  const hecho = apuntada?.id === invoiceId ? apuntada.r : null
  const [otra, setOtra] = useState(false)

  async function validar() {
    if (!fac) return
    setApuntando(true)
    try {
      const r = await apuntarFactura(fac, userName, userId)
      // «Validar y siguiente»: solo pasa si quedó validada; lo hecho se dice en la siguiente (regla 8).
      if (r.validado && siguiente) { ir(siguiente, r.texto); return }
      setApuntada({ id: fac.id, r })
      setVuelta((v) => v + 1)
    } finally {
      setApuntando(false)
    }
  }

  // El teclado de la cola: Intro valida y pasa; ← y → mueven; Esc vuelve a la lista.
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (!teclaDeLaFicha(e)) return
      if (e.key === 'Enter') {
        const boton = document.querySelector<HTMLButtonElement>('[data-validar-y-siguiente]')
        if (!boton || boton.disabled) return
        e.preventDefault(); boton.click()
      } else if (e.key === 'ArrowRight' && siguiente) { e.preventDefault(); ir(siguiente) }
      else if (e.key === 'ArrowLeft' && anterior) { e.preventDefault(); ir(anterior) }
      else if (e.key === 'Escape') { e.preventDefault(); navegar(volver) }
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [siguiente, anterior, ir, navegar, volver])

  if (f.error) {
    return (
      <div className="s-pagina">
        <p className="s-aviso-lista" data-tono="falta" role="alert">No se ha podido abrir la factura: {f.error} <button type="button" className="s-boton s-boton-enlace" onClick={f.recargar}>Reintentar</button></p>
      </div>
    )
  }
  if (!fac) return <div className="s-pagina" aria-busy="true" aria-label="Cargando la factura"><div className="s-lista-cargando" /></div>

  const prov = fac.proveedor
  const proveedor = prov?.nombre ?? 'No reconozco el emisor'
  const titulo = fac.numero ? tx('recibida.titulo', { proveedor, numero: fac.numero }) : tx('recibida.tituloSinNumero', { proveedor })
  const descartada = fac.estado === 'descartada'
  const validada = fac.asiento?.estado === 'validado'
  const yaApuntada = validada || descartada
  const sinProveedor = !prov
  const lectura = fac.lectura
  const nifDeLaFactura = lectura?.factura?.proveedor?.nif ?? fac.propuesto?.nif ?? null
  const comprobaciones: Comprobacion[] = comprobacionesSinContradecir(lectura?.comprobaciones ?? [], !!(prov?.nif || nifDeLaFactura))
    .map((c) => ({ ...c, grave: (lectura?.comprobaciones ?? []).find((x) => x.id === c.id)?.grave }))
  const vence = vencimientoAEnsenar(fac.vence, fac.fecha, plazo.datos ?? null)
  const propuesta = fac.asiento ? undefined : vista.datos ? (vista.datos.propuesta ?? null) : vista.error ? null : undefined
  const pagada = extra.datos?.pagada ? { fecha: extra.datos.pagada } : null
  const v = veredictoFactura({
    validada, numeroAsiento: fac.asiento?.numero ?? null, descartada, motivoDescarte: descarte.datos?.motivo ?? null,
    proveedor: prov ? { nombre: prov.nombre, nif: prov.nif } : null, nifFactura: nifDeLaFactura, fecha: fac.fecha,
    comprobaciones, propuesta: propuesta ? { confianza: propuesta.confianza, avisos: propuesta.avisos, razones: propuesta.razones } : propuesta,
    porqueSinPropuesta: vista.datos && !vista.datos.propuesta ? vista.datos.porque : vista.error,
    origenGasto: prov?.gasto?.origen ?? null, pagada,
  })

  // La cuenta de gasto: la de la propuesta (su primera línea de gasto) o la de sus facturas.
  const lineaGasto = propuesta?.lineas.find((l) => l.debe > 0 && /^6/.test(l.cuenta)) ?? null
  const nombres = vista.datos?.propuesta ? vista.datos.nombres : null
  const gasto = lineaGasto ? { cuenta: lineaGasto.cuenta, nombre: nombres?.get(lineaGasto.cuenta) ?? 'Cuenta' } : prov?.gasto ? { cuenta: prov.gasto.cuenta, nombre: prov.gasto.nombre } : null
  const mGasto = motivoGasto({ cuenta: gasto?.cuenta ?? null, origen: prov?.gasto?.origen ?? (propuesta?.razones[0]?.porque ?? null), confirmada: validada })
  const mProv = motivoProveedor({ proveedor: prov ? { nombre: prov.nombre, nif: prov.nif } : null, nifFactura: nifDeLaFactura })
  const mImportes = motivoImportes(comprobaciones)

  const sePuedeValidar = !yaApuntada && !apuntando && !sinProveedor && !!fac.fecha
  const botonValidar = !yaApuntada && (
    <Boton variante="principal" icono="ok" onClick={() => void validar()} disabled={!sePuedeValidar} aria-keyshortcuts="Enter" data-validar-y-siguiente="">
      {apuntando ? 'Validando…' : <><PorNivel clave="recibida.validarYSiguiente" />{!movil && <> <Tecla>Intro</Tecla></>}</>}
    </Boton>
  )
  const l = fac.llegada
  const cuando = l?.cuando ? new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(l.cuando)) : null
  const como = comoLlego(l?.canal ?? fac.canal ?? (!l && !fac.papel ? 'a_mano' : null), l?.tipo, producto.solo)
  const frase = `${como ? mayuscula(como) : 'Llegó'}${cuando ? ` el ${cuando}` : ''} · factura recibida`
  const estado = descartada ? { texto: 'No es una factura', tono: 'neutro' as const }
    : validada ? (pagada ? { texto: 'Pagada', tono: 'seguro' as const } : { texto: 'Por pagar', tono: 'neutro' as const })
      : sinProveedor ? { texto: 'Proveedor nuevo', tono: 'duda' as const } : { texto: 'Por revisar', tono: 'duda' as const }
  const migasExtra = [{ etiqueta: `${proveedor}${fac.numero ? ` ${fac.numero}` : ''}` }]
  const mas: GrupoDeAcciones[] = [{
    titulo: '',
    acciones: [
      ...(!descartada ? [{ id: 'no-es', etiqueta: 'No es una factura', dato: 'Un albarán, un presupuesto, un extracto…', alPulsar: () => setNoEs(true), grupo: '' }] : []),
      ...(prov ? [{ id: 'otro-proveedor', etiqueta: 'No es de este proveedor', alPulsar: () => setOtra(true), grupo: '' }] : []),
      { id: 'corregir', etiqueta: 'Corregir los importes', dato: 'En la recepción de la que salió', a: rutaCompras(), grupo: '' },
      ...(papel.datos?.url ? [{ id: 'abrir', etiqueta: 'Abrir el PDF aparte', alPulsar: () => window.open(papel.datos!.url!, '_blank', 'noopener'), grupo: '' }] : []),
    ],
  }]
  const msgRecuperado = recuperado?.id === invoiceId ? recuperado.texto : null
  const lineasAsiento = (propuesta?.lineas ?? []).map((x) => ({
    nombre: nombres?.get(x.cuenta) ?? 'Cuenta', codigo: x.cuenta, debe: x.debe ? importe(x.debe) : null, haber: x.haber ? importe(x.haber) : null,
  }))
  const notaDiez = enviaADiez ? 'Al validar se envía también a Diez (sin el PDF: Diez aún no guarda documentos)' : undefined
  const tipos = fac.tipos.length > 0 ? fac.tipos : fac.base !== null ? [{ tipo: fac.lineas.length === 1 ? fac.lineas[0].iva ?? null : null, base: fac.base, cuota: fac.cuota ?? 0, recargo: null }] : []
  const esFoto = /^image\//.test(l?.tipo ?? '') || /\.(jpe?g|png|webp)$/i.test(l?.archivo ?? fac.papel ?? '')
  const sinPapel = !l && !fac.papel

  const datos = (
    <>
      <Veredicto tipo={v.tipo} titulo={v.titulo} porque={v.porque} detalle={v.detalle} quien={MARCA.nombre} />
      {descartada && (
        <BloqueFicha titulo="No es una factura">
          <p className="s-apoyo">
            {descarte.datos ? `La descartó ${descarte.datos.quien ?? 'una persona'} el ${fecha(descarte.datos.cuando.slice(0, 10))}: «${descarte.datos.motivo}». ` : ''}No se contabiliza ni cuenta en lo que debes.
          </p>
          <div><Boton onClick={() => void deshacerDescarte()}>Deshacer: sí es una factura</Boton></div>
        </BloqueFicha>
      )}
      <BloqueFicha titulo="Proveedor y factura">
        <FilaCampos>
          <CampoFicha etiqueta="Proveedor" valor={prov?.nombre ?? fac.propuesto?.nombre ?? 'No lo reconozco'} tono={mProv.tono} marca={mProv.marca} motivo={mProv.motivo} />
          <CampoFicha etiqueta="Nº de factura" valor={fac.numero ?? 'Sin número'} tono={fac.numero ? 'normal' : 'revisar'}
            motivo={fac.no_repetida ? 'No está repetida: lo confirmaste.' : fac.numero ? 'No hay otra con su número y su total.' : 'Sin número no es una factura completa.'} />
          <CampoFicha etiqueta="Fecha de la factura" valor={fecha(fac.fecha)} tono={fac.fecha ? 'normal' : 'revisar'} motivo={fac.fecha ? undefined : 'No he leído la fecha.'} />
        </FilaCampos>
      </BloqueFicha>
      {sinProveedor && <DecirProveedor accountId={accountId} invoiceId={fac.id} alGuardar={() => setVuelta((x) => x + 1)} />}
      <BloqueFicha titulo="Importes">
        {tipos.map((t, i) => (
          <FilaCampos key={i} columnas={4}>
            <CampoFicha etiqueta="Base" valor={euro(t.base)} cifra tono={mImportes.tono === 'revisar' ? 'revisar' : 'normal'} />
            <CampoFicha etiqueta="Tipo de IVA" valor={t.tipo !== null ? porcentaje(t.tipo) : '—'} />
            <CampoFicha etiqueta="IVA" valor={euro(t.cuota)} cifra />
            {i === tipos.length - 1
              ? <CampoFicha etiqueta="Total" valor={<strong>{euro(fac.total)}</strong>} cifra tono={mImportes.tono} motivo={mImportes.motivo} />
              : <span />}
          </FilaCampos>
        ))}
        {tipos.length === 0 && <FilaCampos columnas={4}><CampoFicha etiqueta="Total" valor={<strong>{euro(fac.total)}</strong>} cifra tono={mImportes.tono} motivo={mImportes.motivo} /></FilaCampos>}
        {(!!fac.recargo || !!fac.retencion) && (
          <FilaCampos columnas={4}>
            {!!fac.recargo && <CampoFicha etiqueta="Recargo de equivalencia" valor={euro(fac.recargo)} cifra />}
            {!!fac.retencion && <CampoFicha etiqueta="Retención" valor={euro(-Math.abs(fac.retencion))} cifra />}
          </FilaCampos>
        )}
      </BloqueFicha>
      <BloqueFicha titulo="A qué gasto va">
        <FilaCampos columnas={ejeLocal ? 3 : 2}>
          <CampoFicha etiqueta="Gasto" valor={gasto?.nombre ?? 'Sin cuenta todavía'} codigo={gasto?.cuenta} tono={mGasto.tono} motivo={mGasto.motivo} ancho={ejeLocal ? 2 : 1} />
          {ejeLocal && <CampoFicha etiqueta={ejeLocal.nombre} valor={fac.recepcion?.local ?? extra.datos?.local ?? 'Común'}
            motivo={fac.recepcion ? `De la recepción del ${fecha(fac.recepcion.fecha).slice(0, 5)}.` : undefined} />}
          {!ejeLocal && <CampoFicha etiqueta="Vence" valor={vence.valor} tono={vence.aviso ? 'revisar' : 'normal'} motivo={mayuscula(vence.apoyo)} />}
        </FilaCampos>
      </BloqueFicha>
      <BloqueFicha titulo="Pago">
        {pagada
          ? <p className="s-pago"><span className="s-chip" data-tono="seguro">Pagada</span> <span className="s-cifra">{euro(fac.total)}</span> el {fecha(pagada.fecha)}{extra.datos?.comoPagada ? ` · ${extra.datos.comoPagada}` : ''}</p>
          : <p className="s-pago"><span className="s-chip" data-tono="neutro">Sin pagar</span> {ejeLocal ? <>Vence: <strong>{vence.valor}</strong> · {vence.apoyo}</> : 'Aún no está casada con ningún pago del banco.'}</p>}
        {extra.error && <p className="s-apoyo">No se ha podido saber si está pagada: {extra.error}</p>}
      </BloqueFicha>
      <AsientoQueSeCrea abierto={abiertoDeSerie(marco?.nivel)} titulo={fac.asiento ? 'Su asiento' : 'El asiento que se crea'} lineas={lineasAsiento} nota={notaDiez}
        vacio={fac.asiento ? `Ya tiene su asiento (${fac.asiento.estado}${fac.asiento.numero ? `, el ${fac.asiento.numero}` : ''}).`
          : vista.error ? `No se ha podido preparar: ${vista.error}` : vista.datos && !vista.datos.propuesta ? vista.datos.porque : 'Preparando el asiento…'} />
      <div role="status" aria-live="polite">
        {avisoDeAntes && !hecho && !msgRecuperado && <p className="s-aviso-lista" data-tono="ok">{avisoDeAntes}</p>}
        {msgRecuperado && <p className="s-aviso-lista" data-tono="ok">{msgRecuperado}</p>}
        {hecho && (
          <p className="s-aviso-lista" data-tono={hecho.validado ? 'ok' : 'falta'}><strong>{hecho.texto}</strong>
            {hecho.validado && siguiente && <> <button type="button" className="s-boton s-boton-enlace" onClick={() => ir(siguiente)}>La siguiente →</button></>}
          </p>
        )}
      </div>
      {falloDescarte && <p className="s-aviso-lista" data-tono="falta" role="alert">{falloDescarte}</p>}
    </>
  )
  const documento = (
    <DocumentoFicha titulo={l?.archivo ?? (sinPapel ? 'Sin fichero' : `${fac.numero ?? 'factura'}.pdf`)} descargar={papel.datos?.url ?? null}
      oculto={marco?.documentoOculto ?? false} alOcultar={(x) => marco?.ocultarDocumento(x)}>
      {!papel.datos && !papel.error && !sinPapel && <div className="s-lista-cargando" aria-label="Cargando el PDF" />}
      {papel.error && <p className="s-documento-nada">{textoSinPapel({ archivo: l?.archivo ?? null, aMano: false, error: papel.error })}</p>}
      {!papel.error && papel.datos && !papel.datos.url && <p className="s-documento-nada">{textoSinPapel({ archivo: l?.archivo ?? null, aMano: sinPapel, error: null })}</p>}
      {sinPapel && !papel.datos && <p className="s-documento-nada">{textoSinPapel({ archivo: null, aMano: true, error: null })}</p>}
      {papel.datos?.url && (esFoto
        ? <img src={papel.datos.url} alt={`La factura ${fac.numero ?? ''} tal como llegó`} />
        : <PapelPdf url={papel.datos.url} titulo={`La factura ${fac.numero ?? ''} tal como llegó`} />)}
    </DocumentoFicha>
  )

  return (
    <div className="s-pagina">
      <EncabezadoPagina
        titulo={titulo}
        estado={estado}
        frase={frase}
        migasExtra={migasExtra}
        derecha={<NavegaFicha pos={pos + 1} total={ids.length} anterior={anterior ? () => ir(anterior) : null} siguiente={siguiente ? () => ir(siguiente) : null} />}
        masAcciones={mas}
        principal={botonValidar || <Link to={volver} className="s-boton s-boton-secundario">Volver a la lista</Link>}
      />
      <Ficha datos={datos} documento={documento} documentoOculto={marco?.documentoOculto ?? false} />
      <BotonPulgar>{botonValidar || <Link to={volver} className="s-boton s-boton-secundario">Volver a la lista</Link>}</BotonPulgar>

      {otra && (
        <Dialogo titulo="¿Qué le pasa?" alCerrar={() => setOtra(false)}>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <li>Si los importes, la fecha o el número no son esos, corrígelos en <Link to={rutaCompras()}>la recepción de la que salió</Link>: allí se aprueba la factura.</li>
            <li>Si no es de este proveedor, elige el bueno aquí abajo.</li>
            <li>Si no es una factura (un albarán, un presupuesto, un extracto…), <button type="button" className="cx-enlace" disabled={descartada} onClick={() => { setOtra(false); setNoEs(true) }}>dímelo y la saco de lo que hay que revisar</button>.</li>
          </ul>
          <DecirProveedor accountId={accountId} invoiceId={fac.id} alGuardar={() => { setOtra(false); setVuelta((x) => x + 1) }} />
        </Dialogo>
      )}
      {noEs && <NoEsFactura alCerrar={() => setNoEs(false)} alDescartar={(m) => descartar(m)} fallo={falloDescarte} />}
    </div>
  )
}

/** El asiento, abierto de serie; sin experiencia, plegado (lo que se ofrece, no dónde está). */
function abiertoDeSerie(nivel: string | undefined): boolean {
  return nivel !== 'sin_experiencia'
}

const NOMBRE_ESTADO: Record<string, string> = { borrador: 'borrador', en_revision: 'en revisión', aprobada: 'aprobada', con_discrepancias: 'con diferencias' }

const MOTIVOS = ['Es un albarán', 'Es un presupuesto', 'Es un extracto o un recibo', 'Está repetida'] as const

/** «No es una factura»: el motivo se elige o se escribe; sin motivo no se descarta (la base tampoco lo deja). */
function NoEsFactura({ alCerrar, alDescartar, fallo }: { alCerrar: () => void; alDescartar: (motivo: string) => Promise<void>; fallo: string | null }) {
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const listo = motivo.trim().length > 0
  return (
    <Dialogo titulo="No es una factura" alCerrar={alCerrar}>
      <p style={{ margin: 0 }}>Sale de lo que hay que revisar y no se contabiliza. No se borra: la tienes en Facturas recibidas › Todas y se puede deshacer.</p>
      <div role="group" aria-label="Qué es" className="cxr-motivos">
        {MOTIVOS.map((m) => <button key={m} type="button" className={motivo === m ? 'cx-boton' : 'cx-boton-sec'} aria-pressed={motivo === m} onClick={() => setMotivo(m)}>{m}</button>)}
      </div>
      <label className="cx-campo">Qué es, con tus palabras
        <input className="cx-input" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} placeholder="Ej.: es la proforma; la factura llega a fin de mes" />
      </label>
      {fallo && <p className="cx-error" role="alert">{fallo}</p>}
      <div className="cx-pie">
        <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button>
        <button type="button" className="cx-boton" disabled={!listo || ocupado}
          onClick={() => { setOcupado(true); void alDescartar(motivo.trim()).finally(() => setOcupado(false)) }}>{ocupado ? 'Guardando…' : 'Descartar'}</button>
      </div>
    </Dialogo>
  )
}

function DecirProveedor({ accountId, invoiceId, alGuardar }: { accountId: string | null; invoiceId: string; alGuardar: () => void }) {
  const ps = useLeer(accountId ? () => proveedoresDeLaCuenta(accountId) : null, `${accountId}:proveedores`)
  const [elegido, setElegido] = useState('')
  const [fallo, setFallo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  async function guardar() {
    setOcupado(true); setFallo(null)
    try { await decirProveedor(invoiceId, elegido); alGuardar() } catch (e) { setFallo(e instanceof Error ? e.message : String(e)) } finally { setOcupado(false) }
  }
  return (
    <BloqueFicha titulo="¿De quién es?">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <select className="cx-input" value={elegido} onChange={(e) => setElegido(e.target.value)} aria-label="Proveedor" style={{ flex: 1, minWidth: 0 }}>
          <option value="">Elige el proveedor…</option>
          {(ps.datos ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.nif ? ` · ${p.nif}` : ''}</option>)}
        </select>
        <Boton variante="principal" disabled={!elegido || ocupado} onClick={() => void guardar()}>Es este</Boton>
      </div>
      {fallo && <p className="s-aviso-lista" data-tono="falta" role="alert">{fallo}</p>}
    </BloqueFicha>
  )
}
