// src/modules/conta/documentos/RevisarFacturaPage.tsx
//
// Compras y gastos › Facturas recibidas › una factura: la ficha COMPLETA
// (encargo «Para D · la ficha de la recibida completa», tablero 3b). Es la
// misma pantalla para la que entra sola y para la hecha a mano (regla de
// Julio): los bloques salen de FichaRecibidaBloques, que usa también
// «Nueva recibida a mano».
//
//   · Encabezado: migas, el título con su estado, de dónde vino sin inventar
//     («Entró con la recepción del 19/10 en Foodint Alcalá · leída de su PDF»;
//     «Escrita a mano» solo si lo es); «‹ 1 de N ›», «Más acciones ▾» (Cambiar
//     el PDF · Marcar como duplicada · Descartar con motivo · Ver el
//     historial) y «Validar y siguiente» con Intro.
//   · Todo se puede cambiar antes de validar: proveedor, número y fecha; los
//     importes por tipo de IVA (con «+ Otro tipo de IVA», «+ Retención (IRPF)»
//     y «+ Recargo de equivalencia», y «Igual que el PDF» o la diferencia); a
//     qué gasto va (cuenta con F4, local, importe; «+ Repartir»); el pago; el
//     PDF. NADA se guarda solo: cada campo cambiado sale «CAMBIADO» con «Antes ·
//     Deshacer», arriba la barra «N cambios sin guardar» con Descartar y
//     Guardar cambios (Ctrl S), el asiento se rehace al momento como VISTA
//     PREVIA, «Validar y siguiente» se apaga («Guarda o descarta primero») e
//     Intro no valida; y salir por el menú, las migas, ‹ ›, Esc o cerrando la
//     pestaña avisa (las piezas comunes de diseno/plantillas).
//   · «Guardar cambios» guarda lo que hoy tiene dónde guardarse (el proveedor,
//     el vencimiento) y dice con contenido lo que no y por qué
//     (fichaRecibida.COMO_SE_GUARDA): lo demás espera a su función en la base.
//   · El veredicto, coherente (veredicto.ts): «Lista para contabilizar» cuando
//     el gasto es el de sus facturas anteriores y los importes cuadran con el
//     PDF; «Revisa esto» solo diciendo qué falta.
//   · «1 de N» sale de la misma cola que la barra (recibidas.colaPorRevisar),
//     y la barra se vuelve a contar al validar, descartar o guardar.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { rutaAsiento, rutaCompras, rutaDocumentos, rutaRevisarFactura } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useEnvioDiez } from '@/modules/conta/services/envioDiezService'
import { useIsMobile } from '@/shell/useIsMobile'
import { useLeer } from '@/modules/conta/libros/contexto'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { calcularVencimiento } from '@/modules/conta/lib/cifras'
import { vencimientoAEnsenar } from '@/modules/conta/documentos/documentos'
import { MARCA } from '@/modules/conta/cuenta/marca'
import { PapelPdf } from '@/modules/conta/documentos/PapelPdf'
import { IvaNoDeducibleFicha } from '@/modules/conta/documentos/IvaNoDeducibleFicha'
import { LiquidacionesDeLaFactura } from '@/modules/conta/documentos/LiquidacionesDeLaFactura'
import { completarFicha, deLaFactura, enUnaFrase } from '@/modules/conta/lib/fichaDesdeDocumento'
import { altaEnFactura, fraseRelectura, hayQueReleer, type ProveedorLeido } from '@/modules/conta/lib/proveedorDesdeFactura'
import { fraseAltaEnFactura } from '@/modules/conta/lib/altaProveedor'
import { contactosDeLaFicha, guardarDesdeFactura } from '@/modules/conta/services/fichaDesdeFacturaService'
import { AltaDesdeFactura, AvisoIbanDistinto, EnlacesAlta, IbanNuevo, LoQueHaCambiado, NifDistinto, NombreEntero } from '@/modules/conta/documentos/ProveedorDesdeFactura'
import { NifDeLaFicha } from './NifDeLaFicha'
import { decisionIbanDeFactura, obtenerFicha } from '@/modules/conta/services/proveedorService'
import {
  apuntarFactura, cuentasDeGasto, descartarFactura, guardarCambiosRecibida, leerDescarte, ponerPapelRecibida, sinPapelRecibida, leerExtrasFacturas, leerFactura, leerFichaRecibida,
  plazoDeLaFicha, proveedoresDeLaCuenta, recuperarFactura, releerProveedorDeLaFactura, urlDelPapel, verPropuestaFactura, type Apuntada,
} from '@/modules/conta/services/documentosService'
import { leerAsiento, localesDeLaCuenta } from '@/modules/conta/services/diarioService'
import { tiposDeIvaRecibida } from '@/modules/conta/services/recibidaAManoService'
import { refrescarCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { useAnalitica, useMarco } from '@/modules/conta/marco/nuevo/contexto'
import { PorNivel } from '@/modules/conta/textos/PorNivel'
import { useTexto } from '@/modules/conta/textos/useTexto'
import { comprobacionesSinContradecir, textoSinPapel } from '@/modules/conta/documentos/RevisarFacturaPage.textos'
import { BotonPulgar, EncabezadoPagina } from '@/modules/conta/marco/EncabezadoPagina'
import type { GrupoDeAcciones } from '@/modules/conta/marco/acciones'
import { Boton, Tecla } from '@/modules/conta/diseno'
import {
  AsientoQueSeCrea, BarraCambios, DocumentoFicha, Ficha, NavegaFicha, Veredicto, conCambio, listaRecordada, recordarLista, useAvisoSalir, useCambiosSinGuardar,
  type MensajeGuardado, type ResultadoGuardar,
} from '@/modules/conta/diseno/plantillas'
import { LISTA_RECIBIDAS, filtrosDe, queCuentaLaCola, ventanaDe } from '@/modules/conta/documentos/recibidas'
import { colaRecibidas } from '@/modules/conta/documentos/colaRecibidas'
import { cargoParaLaTarjeta, casarPagoConTarjeta, duplicadaDe } from '@/modules/conta/documentos/paraValidarService'
import { faltaDocumento, pagadaConTarjeta, textoDePago, ultimos4 } from '@/modules/conta/documentos/paraValidar'
import { motivoGasto, motivoImportes, motivoProveedor, veredictoFactura, type Comprobacion } from '@/modules/conta/documentos/veredicto'
import {
  ACEPTA_PAPEL, COMO_SE_GUARDA, ETIQUETAS, aManoDeLoGuardado, asientoVistaPrevia, borradorDe, cambiosParaLaBase, lineasConMasDecimales, contraElPdf, cuentasDeLaPropuesta, deDondeVino, fechaEs, formatoCampo, historialDe, importeEs, partirCambios,
  textoDelGuardado, totalesDe, type BorradorFicha,
} from '@/modules/conta/documentos/fichaRecibida'
import {
  BloqueGasto, BloqueHistorial, BloqueImportesIva, BloquePago, BloqueProveedorFactura, EditarAsientoAMano, HuecoPapel,
} from '@/modules/conta/documentos/FichaRecibidaBloques'

const mayuscula = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)

/** ¿La tecla es para la ficha? No mientras se escribe, ni con un diálogo abierto, ni sobre un botón o enlace. */
function teclaDeLaFicha(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return false
  const t = e.target as HTMLElement | null
  if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.closest('[role="dialog"]'))) return false
  if (e.key === 'Enter' && t && t.closest('button, a, summary')) return false
  return true
}

/** Lo último que se leyó para ESTA clave: mientras se vuelve a leer (tras guardar), la ficha no se vacía. */
function useUltimo<T>(datos: T | null, clave: string): T | null {
  const [ultimo, setUltimo] = useState<{ clave: string; datos: T } | null>(null)
  // Al pintar, no en un efecto (el patrón de React para «lo del render anterior»).
  if (datos !== null && (ultimo?.clave !== clave || ultimo.datos !== datos)) setUltimo({ clave, datos })
  return datos ?? (ultimo?.clave === clave ? ultimo.datos : null)
}

const VACIO: BorradorFicha = borradorDe({ proveedorId: null, numero: null, fecha: null, vence: null, retencion: null, recargo: null, gasto: null, local: null, formaPago: null, pagada: false, tipos: [], lineas: [], base: null, cuota: null })

export default function RevisarFacturaPage() {
  const { local: ejeLocal } = useAnalitica()
  const tx = useTexto()
  const marco = useMarco()
  const { invoiceId = '' } = useParams()
  const [query] = useSearchParams()
  const { search } = useLocation()
  const navegar = useNavigate()
  const { accountId, userId, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const movil = useIsMobile()
  const avisoDeAntes = (useLocation().state as { aviso?: string } | null)?.aviso ?? null
  const [vuelta, setVuelta] = useState(0)
  const f = useLeer(invoiceId ? () => leerFactura(invoiceId) : null, `${invoiceId}:${vuelta}`)
  const fac = useUltimo(f.datos, invoiceId)
  const envioDiez = useEnvioDiez(fac?.account_id, fac?.company_id).envio
  // C12: con el traspaso mensual, al validar no sale nada: va en el traspaso del mes.
  const enviaADiez = envioDiez?.alMomento === true
  const vaEnElTraspaso = envioDiez?.mensual === true
  const hoy = hoyEnMadrid()
  const empresa = activa?.id ?? fac?.company_id ?? null

  // La cola: la de la lista de la que se vino, con sus filtros y su orden, y de la empresa activa (como la lista y la barra).
  const filtros = filtrosDe(query)
  const { desde, hasta } = ventanaDe(filtros.mes, hoy)
  // D04: la misma lectura que la barra (colaRecibidas).
  const lista = useLeer(empresa && accountId ? () => colaRecibidas(accountId, empresa, desde, hasta, filtros) : null,
    `${accountId}:${empresa}:${desde}:${hasta}:${search}:${vuelta}`)
  const ids = useUltimo(lista.datos, `${empresa}:${search}`) ?? []
  const pos = ids.indexOf(invoiceId)

  const volver = listaRecordada(LISTA_RECIBIDAS, `${rutaDocumentos()}${conCambio(search, { fila: invoiceId })}`)
  const ir = useCallback((id: string, aviso?: string) => {
    const q = conCambio(search, { fila: id })
    recordarLista(LISTA_RECIBIDAS, `${rutaDocumentos()}${q}`)
    navegar(`${rutaRevisarFactura(id)}${q}`, aviso ? { state: { aviso } } : undefined)
  }, [search, navegar])

  const fichaLeida = useLeer(accountId && invoiceId ? () => leerFichaRecibida(accountId, invoiceId) : null, `${accountId}:${invoiceId}:ficha:${vuelta}`)
  const ficha = useUltimo(fichaLeida.datos, invoiceId)
  const localPropuesto = ficha ? ficha.localId ?? ficha.recepcion?.localId ?? null : undefined
  const papel = useLeer(fac && ficha ? async () => ({ url: await urlDelPapel(fac, ficha.lectura?.ruta ?? null) }) : null,
    // `ficha ? …`: la lectura espera a la ficha; sin eso en la clave, si la factura ya traía su ruta, no se volvía a leer al llegar la ficha y se quedaba «Cargando».
    `${invoiceId}:papel:${ficha ? 'ficha' : '-'}:${fac?.llegada?.ruta ?? fac?.papel ?? ficha?.lectura?.ruta ?? ''}`)
  const plazo = useLeer(fac?.proveedor?.id && accountId ? () => plazoDeLaFicha(accountId, fac.proveedor!.id) : null, `${accountId}:${fac?.proveedor?.id}:plazo:${vuelta}`)
  // D07a · Validada: su asiento DE VERDAD (sus apuntes), con su enlace; no solo «Ya tiene su asiento».
  const asientoReal = useLeer(fac?.asiento && accountId ? () => leerAsiento(accountId, fac.asiento!.id) : null, `${accountId}:${invoiceId}:asiento:${fac?.asiento?.id ?? '-'}:${vuelta}`)
  const vista = useLeer(fac && accountId && fac.company_id && fac.fecha && !fac.asiento && localPropuesto !== undefined
    ? () => verPropuestaFactura(accountId, fac.company_id!, fac.id, fac.fecha!, localPropuesto) : null,
  `${accountId}:${invoiceId}:${fac?.company_id}:${fac?.fecha}:${fac?.asiento ? 'con' : 'sin'}-asiento:${fac?.estado}:${fac?.proveedor?.id}:${localPropuesto}:${vuelta}`)
  const extra = useLeer(accountId && invoiceId ? () => leerExtrasFacturas(accountId, [invoiceId]).then((m) => m.get(invoiceId) ?? null) : null, `${accountId}:${invoiceId}:extra:${vuelta}`)
  const proveedores = useLeer(accountId ? () => proveedoresDeLaCuenta(accountId) : null, `${accountId}:proveedores`)
  const locales = useLeer(accountId && ejeLocal ? () => localesDeLaCuenta(accountId) : null, `${accountId}:${ejeLocal ? 'con' : 'sin'}-local:locales`)
  const cuentas = useLeer(accountId && fac?.company_id ? () => cuentasDeGasto(accountId, fac.company_id!) : null, `${accountId}:${fac?.company_id}:gastos`)
  const tiposIva = useLeer(accountId ? () => tiposDeIvaRecibida(accountId) : null, `${accountId}:tipos-iva`)
  const descarte = useLeer(fac?.estado === 'descartada' ? () => leerDescarte(fac.id) : null, `${invoiceId}:${fac?.id ?? '-'}:${fac?.estado}:descarte:${vuelta}`)

  // La propuesta y la cuenta de gasto propuesta (la de su primera línea de gasto, o la de sus facturas).
  const propuesta = fac?.asiento ? undefined : vista.datos ? (vista.datos.propuesta ?? null) : vista.error ? null : undefined
  const nombresProp = vista.datos?.propuesta ? vista.datos.nombres : null
  const lineaGasto = propuesta?.lineas.find((l) => l.debe > 0 && /^6/.test(l.cuenta)) ?? null
  const gastoPropuesto = lineaGasto?.cuenta ?? fac?.proveedor?.gasto?.cuenta ?? null
  const venceFicha = fac?.fecha && plazo.datos && plazo.datos.dias !== null ? calcularVencimiento(fac.fecha, plazo.datos.dias, plazo.datos.fijos) : null

  // Lo guardado, como borrador (el «Antes» de cada campo).
  // Las cuentas del asiento (la 400, la 472 de cada tipo, la 4751), de la propuesta.
  const cuentasProp = useMemo(() => (propuesta ? cuentasDeLaPropuesta(propuesta.lineas, (c) => nombresProp?.get(c) ?? 'Cuenta') : null), [propuesta, nombresProp])
  const guardado = ficha?.guardado ?? null
  // D06: lo que el documento dice del pago («Pagado con tarjeta …»), y si puede estar repetida.
  const textoPago = textoDePago(fac?.lectura ?? fac?.leido_en_recepcion?.modelo ?? null)
  const conTarjeta = pagadaConTarjeta(textoPago)
  const dup = useLeer(accountId && fac ? () => duplicadaDe(accountId, fac.id, fac.proveedor?.id ?? null) : null, `${accountId}:${invoiceId}:${fac ? 'leida' : '-'}:${fac?.proveedor?.id}:${fac?.numero}:${fac?.total}:dup:${vuelta}`)
  const original = useMemo<BorradorFicha>(() => {
    if (!fac) return VACIO
    const datos = {
      proveedorId: fac.proveedor?.id ?? null, numero: fac.numero, fecha: fac.fecha, vence: fac.vence ?? venceFicha,
      retencion: fac.retencion, recargo: fac.recargo, gasto: gastoPropuesto, local: localPropuesto ?? null,
      // La forma de pago: la guardada en la factura (0790), la de cuando se pagó, o la de su ficha.
      // D06: si el documento dice que se pagó con tarjeta, tarjeta.
      formaPago: guardado?.formaPago ?? extra.datos?.comoPagada ?? (conTarjeta ? 'card' : null) ?? ficha?.formaPagoFicha ?? null, pagada: !!extra.datos?.pagada,
      tipos: fac.tipos, lineas: fac.lineas, base: fac.base, cuota: fac.cuota,
      reparto: guardado?.reparto.length ? guardado.reparto.map((g) => ({ cuenta: g.cuenta, local: g.comun ? null : g.local, importe: g.importe })) : null,
      sinPdf: guardado?.sinPdf ? { motivo: guardado.sinPdf.motivo } : null,
    }
    const base = borradorDe(datos)
    // El asiento guardado a mano, como «cuenta propuesta → elegida» sobre la vista previa sin tocar.
    if (!guardado?.asientoAMano || !cuentasProp) return base
    const previa = asientoVistaPrevia(base, cuentasProp, () => 'Cuenta', () => null)
    return { ...base, aMano: aManoDeLoGuardado(guardado.asientoAMano, previa.lineas) }
  }, [fac, venceFicha, gastoPropuesto, localPropuesto, extra.datos, ficha, guardado, cuentasProp, conTarjeta])

  const nombreProveedor = useCallback((id: string) => (proveedores.datos ?? []).find((p) => p.id === id)?.nombre ?? (fac?.proveedor?.id === id ? fac.proveedor.nombre : 'otro proveedor'), [proveedores.datos, fac])
  const nombreLocal = useCallback((id: string) => (locales.datos ?? []).find((l) => l.id === id)?.nombre ?? (id === ficha?.recepcion?.localId ? ficha.recepcion.local : null), [locales.datos, ficha])
  const formato = useMemo(() => formatoCampo(nombreProveedor, nombreLocal), [nombreProveedor, nombreLocal])
  const ed = useCambiosSinGuardar<BorradorFicha>(original, ETIQUETAS, formato)
  const b = ed.valor

  // D07b + S01b · La ficha del proveedor ELEGIDO (también el recién elegido, aún sin guardar), sus
  // contactos, y lo que trae el papel: lo que le falta se guarda al validar, «de la factura …»; lo que
  // no coincide se pregunta; el NIF distinto, aparte; el IBAN nunca entra solo.
  const proveedorFicha = b.proveedorId || fac?.proveedor?.id || ''
  const fichaProv = useLeer(accountId && proveedorFicha ? () => obtenerFicha(proveedorFicha) : null, `${accountId}:${proveedorFicha || '-'}:ficha-proveedor:${vuelta}`)
  const contactosProv = useLeer(proveedorFicha ? () => contactosDeLaFicha(proveedorFicha) : null, `${proveedorFicha || '-'}:contactos:${vuelta}`)
  const decisionIban = useLeer(invoiceId ? () => decisionIbanDeFactura(invoiceId) : null, `${invoiceId}:iban-decision:${vuelta}`)
  // S01b2 · Una lectura de antes del 28/10 no trae el teléfono ni la web: al dar de alta o al validar se
  // vuelve a leer su PDF (releer, abajo) y lo releído manda sobre lo guardado.
  const [releido, setReleido] = useState<{ id: string; prov: ProveedorLeido; texto: string; tono: 'ok' | 'falta' } | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const guardadoProv = fac?.lectura?.factura?.proveedor ?? null
  const leidoProv = useMemo(() => (guardadoProv && releido?.id === invoiceId ? { ...guardadoProv, ...releido.prov } : guardadoProv),
    [guardadoProv, releido, invoiceId])
  const ibanLeido = fac?.lectura?.factura?.iban ?? null
  const calcularDesde = useCallback((p: typeof leidoProv) => {
    const fp = fichaProv.datos
    if (!p || !fp || fp.id !== proveedorFicha || (!contactosProv.datos && !contactosProv.error)) return null
    const c = completarFicha({ nif: fp.taxId, nombreFiscal: fp.legalName, calle: fp.fiscalStreet, codigoPostal: fp.fiscalPostalCode, ciudad: fp.fiscalCity,
      correos: contactosProv.datos?.correos ?? [], telefonos: contactosProv.datos?.telefonos ?? [], web: fp.website, iban: fp.iban },
    { nif: p.nif, nombre: p.nombre, direccion: p.direccion, correo: p.email, telefono: p.telefono ?? null, web: p.web ?? null, iban: ibanLeido })
    // N1: el NIF que le falta no espera a validar (sin él no hay asiento): lo guarda «NIF del proveedor», ahora.
    if (c.proponer.taxId) { delete c.proponer.taxId; c.frases = c.frases.filter((f) => !f.startsWith('el NIF ')); c.campos = c.campos.filter((x) => x !== 'nif') }
    return c
  }, [ibanLeido, fichaProv.datos, contactosProv.datos, contactosProv.error, proveedorFicha])
  const desdeDocumento = useMemo(() => calcularDesde(leidoProv), [calcularDesde, leidoProv])
  /**
   * S01b2 · Vuelve a leer su PDF si su lectura es de antes (sin las claves del teléfono y la web), una
   * vez por factura, y devuelve el proveedor como queda; si no hace falta, null. Lo que pasa, se dice.
   */
  async function releer(): Promise<typeof leidoProv> {
    if (!fac || !hayQueReleer(guardadoProv as ProveedorLeido | null, !!fac.papel) || releido?.id === invoiceId) return null
    setLeyendo(true)
    try {
      const r = await releerProveedorDeLaFactura(fac.account_id, fac.id, fac.papel!)
      setReleido({ id: invoiceId, prov: r.proveedor, texto: fraseRelectura(r.puesto), tono: 'ok' })
      return guardadoProv ? { ...guardadoProv, ...(r.proveedor as Partial<NonNullable<typeof guardadoProv>>) } : null
    } catch (e) {
      setReleido({ id: invoiceId, prov: {}, texto: `No he podido volver a leer la factura (${e instanceof Error ? e.message : String(e)}): rellena a mano lo que falte.`, tono: 'falta' })
      return null
    } finally {
      setLeyendo(false)
    }
  }
  const facturaOrigen = useMemo(() => ({ id: fac?.id ?? '', numero: fac?.numero ?? null }), [fac?.id, fac?.numero])
  const quien = useMemo(() => ({ id: userId ?? null, name: userName ?? null }), [userId, userName])
  // S01b · El alta y lo que dice cada botón.
  const [altaAbierta, setAltaAbierta] = useState(false)
  const [avisoProv, setAvisoProv] = useState<{ id: string; texto: string; tono: 'ok' | 'falta' } | null>(null)
  const decir = (texto: string, tono: 'ok' | 'falta' = 'ok') => { setAvisoProv({ id: invoiceId, texto, tono }); setVuelta((v) => v + 1) }
  /** Elige el proveedor y lo guarda ya en la factura, solo ese campo: lo demás revisado sigue sin guardar, como estaba. */
  async function elegirYGuardar(id: string, nombre: string, texto: string) {
    if (!fac) return
    ed.poner('proveedorId', id)
    try {
      const r = await guardarCambiosRecibida(fac, cambiosParaLaBase({ ...original, proveedorId: id }, ['proveedorId']),
        { quien: userName, nombres: { proveedor: nombre }, localPropuesto: localPropuesto ?? null })
      if (r.fallos.length) decir(`${texto} No se ha guardado en la factura (${r.fallos.map((x) => x.porque).join(' · ')}): guárdalo con «Guardar».`, 'falta')
      else decir(`${texto} Guardado en la factura: ahora te propongo su cuenta de gasto.`)
    } catch (e) {
      decir(`${texto} No se ha guardado en la factura (${e instanceof Error ? e.message : String(e)}): guárdalo con «Guardar».`, 'falta')
    }
    proveedores.recargar()
  }
  // Otra factura (‹ ›): se empieza limpio; lo cambiado en la anterior ya se guardó o se descartó al salir (pedirSalir).
  const { reiniciar } = ed
  const deFactura = useRef(invoiceId)
  useEffect(() => {
    if (deFactura.current === invoiceId) return
    deFactura.current = invoiceId
    reiniciar(VACIO)
  }, [invoiceId, reiniciar])

  // El PDF o la foto elegidos (pendientes de guardar): se enseñan, no se suben.
  const [fichero, setFichero] = useState<{ file: File; url: string } | null>(null)
  useEffect(() => () => { if (fichero) URL.revokeObjectURL(fichero.url) }, [fichero])
  const elegirPapel = (file: File) => {
    setFichero({ file, url: URL.createObjectURL(file) })
    ed.poner('documento', file.name)
  }
  const ficheroVivo = b.documento && fichero?.file.name === b.documento ? fichero : null

  const [mensaje, setMensaje] = useState<MensajeGuardado | null>(null)
  const [guardando, setGuardando] = useState(false)
  async function guardar(): Promise<ResultadoGuardar> {
    if (!fac) return false
    setGuardando(true); setMensaje(null)
    try {
      // D03 · 0790: todo lo de la ficha en un viaje (conta_recibida_guardar), el PDF nuevo con
      // conta_recibida_papel_poner y «Sin PDF» con conta_recibida_sin_papel. Sin la tanda, lo de antes.
      const campos = ed.cambios.map((c) => c.campo)
      const aLaFuncion = campos.filter((c) => COMO_SE_GUARDA[c as keyof BorradorFicha] && 'con' in COMO_SE_GUARDA[c as keyof BorradorFicha]
        && (COMO_SE_GUARDA[c as keyof BorradorFicha] as { con: string }).con === 'conta_recibida_guardar')
      const previa = cuentasProp ? asientoVistaPrevia(b, cuentasProp, () => 'Cuenta', () => null).lineas : undefined
      const r = await guardarCambiosRecibida(fac, cambiosParaLaBase(b, aLaFuncion, { previa, comun: '', retencionTipoId: b.retencion && original.retencion && b.retencion.tipo === original.retencion.tipo ? ficha?.retencionId ?? null : null }),
        { quien: userName, nombres: { proveedor: nombreProveedor(b.proveedorId), vence: fechaEs(b.vence) }, localPropuesto: localPropuesto ?? null })
      const partes: string[] = []
      const fallos = [...r.fallos]
      let tocado = r.hechos.length > 0
      if (r.conTanda && r.texto) partes.push(r.texto)
      else if (r.hechos.length) partes.push(`Guardado: ${r.hechos.join(' · ')}.`)
      if (r.repropuesto) partes.push(r.repropuesto)
      let sinTanda = !r.conTanda && aLaFuncion.length > 0
      if (campos.includes('documento') && ficheroVivo) {
        const x = await ponerPapelRecibida(fac, ficheroVivo.file, userName)
        if (x.hecho) {
          partes.push(x.texto); tocado = true
          // El PDF ya está en la factura: deja de ser un cambio pendiente (la ficha lo vuelve a leer).
          ed.poner('documento', ''); setFichero(null)
        } else if (x.falta) sinTanda = true; else fallos.push({ etiqueta: 'PDF', porque: x.texto })
      }
      if (campos.includes('sinPdf') || campos.includes('motivoSinPdf')) {
        if (b.sinPdf && !b.motivoSinPdf.trim()) fallos.push({ etiqueta: 'Sin PDF', porque: 'di por qué no hay documento' })
        else {
          const x = await sinPapelRecibida(fac.id, b.sinPdf, b.motivoSinPdf, userName)
          if (x.hecho) { partes.push(x.texto); tocado = true } else if (x.falta) sinTanda = true; else fallos.push({ etiqueta: 'Sin PDF', porque: x.texto })
        }
      }
      // Lo que no se ha podido guardar: sin la 0790, lo que solo ella guarda; y siempre, «Pagada» antes de validar.
      const { noHoy } = partirCambios(ed.cambios, !sinTanda)
      const resto = noHoy.filter((c) => sinTanda || c.campo === 'estadoPago')
      const m = textoDelGuardado({ hechos: [], fallos, noHoy: resto })
      const texto = [...partes, ...(m.texto === 'No había nada que guardar.' ? [] : [m.texto])].join(' ') || 'No había nada que guardar.'
      const malo = fallos.length > 0 || resto.length > 0
      setMensaje({ tono: malo ? 'falta' : 'ok', texto })
      if (tocado) { setVuelta((v) => v + 1); refrescarCuentasMenu() }
      return malo ? texto : true
    } finally { setGuardando(false) }
  }

  const titulo = fac ? (fac.numero ? tx('recibida.titulo', { proveedor: fac.proveedor?.nombre ?? 'No reconozco el emisor', numero: fac.numero }) : tx('recibida.tituloSinNumero', { proveedor: fac.proveedor?.nombre ?? 'No reconozco el emisor' })) : ''
  const salida = useAvisoSalir({ hay: ed.hay, cambios: ed.cambios, donde: fac ? `${fac.proveedor?.nombre ?? 'la factura'}${fac.numero ? ` ${fac.numero}` : ''}` : undefined, onGuardar: guardar, onDescartar: ed.descartar })
  const pedirSalir = salida.pedirSalir

  const [noEs, setNoEs] = useState<string | null>(null)
  const [recuperado, setRecuperado] = useState<{ id: string; texto: string } | null>(null)
  const [falloDescarte, setFalloDescarte] = useState<string | null>(null)
  const [aMano, setAMano] = useState(false)
  const siguiente = pos >= 0 && pos < ids.length - 1 ? ids[pos + 1] : null
  const anterior = pos > 0 ? ids[pos - 1] : null
  async function descartar(motivo: string) {
    if (!fac) return
    setFalloDescarte(null)
    try {
      await descartarFactura(fac.id, motivo, userName)
      setNoEs(null); ed.descartar(); refrescarCuentasMenu()
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
      refrescarCuentasMenu(); setVuelta((v) => v + 1)
    } catch (e) { setFalloDescarte(e instanceof Error ? e.message : String(e)) }
  }
  const [apuntando, setApuntando] = useState(false)
  // N1 · Lo que dijo «NIF del proveedor» al guardar (el bloque se va: la ficha ya tiene NIF).
  const [nifGuardado, setNifGuardado] = useState<{ id: string; texto: string } | null>(null)
  const [apuntada, setApuntada] = useState<{ id: string; r: Apuntada } | null>(null)
  const hecho = apuntada?.id === invoiceId ? apuntada.r : null

  async function validar() {
    if (!fac || ed.hay) return
    setApuntando(true)
    try {
      const r = await apuntarFactura(fac, userName, userId, localPropuesto ?? null)
      // S01b2 · Con una lectura de antes, se vuelve a leer su PDF para completar también el teléfono y la web.
      const desde = r.validado && fac.proveedor?.id && fichaProv.datos?.id === fac.proveedor.id
        ? (await releer().then((p) => (p ? calcularDesde(p) : desdeDocumento)).catch(() => desdeDocumento)) : desdeDocumento
      // D07b: lo que le faltaba a la ficha del proveedor y trae el documento, guardado al validar.
      if (r.validado && desde?.frases.length && fac.proveedor?.id && fichaProv.datos?.id === fac.proveedor.id) {
        try {
          // S01b · Y queda escrito de qué factura sale cada dato («de la factura R0672»); el correo y el teléfono, en un contacto.
          await guardarDesdeFactura({ accountId: fac.account_id, ficha: fichaProv.datos, cambios: desde.proponer, campos: desde.campos,
            contacto: desde.contacto, factura: facturaOrigen, quien })
          r.texto += ` Ficha de ${fac.proveedor.nombre ?? 'su proveedor'} completada con ${enUnaFrase(desde.frases)}, ${deLaFactura(fac.numero)}.`
        } catch (e) { r.texto += ` No se ha podido completar la ficha del proveedor: ${e instanceof Error ? e.message : String(e)}.` }
      }
      // D06: pagada con tarjeta → se casa con el cargo del banco (mismo importe, en los 5 días siguientes).
      if (r.validado && conTarjeta && !extra.datos?.pagada && fac.total !== null) {
        const cuentaProveedor = propuesta?.lineas.find((l) => l.haber > 0 && /^4[01]/.test(l.cuenta))?.cuenta
        try {
          const cargo = await cargoParaLaTarjeta({ account_id: fac.account_id, company_id: fac.company_id, fecha: fac.fecha, total: fac.total, proveedor: fac.proveedor?.nombre ?? '', tarjeta: ultimos4(textoPago) })
          r.texto += cargo && cuentaProveedor
            ? ` ${await casarPagoConTarjeta(cargo, { id: fac.id, total: fac.total, cuentaProveedor, terceroId: propuesta?.terceroId ?? null, concepto: `Factura ${fac.proveedor?.nombre ?? ''}${fac.numero ? ` · ${fac.numero}` : ''}` })}`
            : ' Pagada con tarjeta, pero no encuentro un único cargo del mismo importe en los 5 días siguientes: cásalo en Bancos.'
        } catch (e) { r.texto += ` No se ha podido casar el pago con tarjeta: ${e instanceof Error ? e.message : String(e)}.` }
      }
      refrescarCuentasMenu()
      if (r.validado && siguiente) { ir(siguiente, r.texto); return }
      setApuntada({ id: fac.id, r })
      setVuelta((v) => v + 1)
    } finally {
      setApuntando(false)
    }
  }

  // El teclado de la cola: Intro valida y pasa (no con cambios sin guardar: el botón está apagado); ← y → mueven; Esc vuelve a la lista. Con cambios, avisa antes.
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (!teclaDeLaFicha(e)) return
      if (e.key === 'Enter') {
        const boton = document.querySelector<HTMLButtonElement>('[data-validar-y-siguiente]')
        if (!boton || boton.disabled) return
        e.preventDefault(); boton.click()
      } else if (e.key === 'ArrowRight' && siguiente) { e.preventDefault(); pedirSalir(() => ir(siguiente)) }
      else if (e.key === 'ArrowLeft' && anterior) { e.preventDefault(); pedirSalir(() => ir(anterior)) }
      else if (e.key === 'Escape') { e.preventDefault(); pedirSalir(() => navegar(volver)) }
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [siguiente, anterior, ir, navegar, volver, pedirSalir])

  const inputCambiar = useRef<HTMLInputElement>(null)

  if (f.error && !fac) {
    return (
      <div className="s-pagina">
        <p className="s-aviso-lista" data-tono="falta" role="alert">No se ha podido abrir la factura: {f.error} <button type="button" className="s-boton s-boton-enlace" onClick={f.recargar}>Reintentar</button></p>
      </div>
    )
  }
  if (!fac) return <div className="s-pagina" aria-busy="true" aria-label="Cargando la factura"><div className="s-lista-cargando" /></div>

  const prov = fac.proveedor
  const proveedor = prov?.nombre ?? 'No reconozco el emisor'
  const descartada = fac.estado === 'descartada'
  const validada = fac.asiento?.estado === 'validado'
  const yaApuntada = validada || descartada
  const sinProveedor = !prov
  const lectura = fac.lectura
  const nifDeLaFactura = lectura?.factura?.proveedor?.nif ?? fac.propuesto?.nif ?? null
  const comprobaciones: Comprobacion[] = comprobacionesSinContradecir(lectura?.comprobaciones ?? [], !!(prov?.nif || nifDeLaFactura))
    .map((c) => ({ ...c, grave: (lectura?.comprobaciones ?? []).find((x) => x.id === c.id)?.grave }))
  const vence = vencimientoAEnsenar(fac.vence, fac.fecha, plazo.datos ?? null)
  const pagada = extra.datos?.pagada ? { fecha: extra.datos.pagada } : null
  const leidaDeFichero = !!(lectura || fac.leido_en_recepcion || ficha?.lectura)
  const pdf = { base: fac.base, iva: fac.cuota, total: fac.total }
  const masDecimales = lineasConMasDecimales(fac.lineas)
  const contraGuardado = contraElPdf(totalesDe(original), pdf, leidaDeFichero ? 'pdf' : 'factura', { masDecimales })
  const cuadraGuardado = contraGuardado.igual
  // D06: sin documento no se valida (salvo «Sin PDF» con su motivo; las liquidaciones del correo de Uber, como hoy).
  const faltaDoc = faltaDocumento({ tieneDocumento: !!(fac.llegada || fac.papel || ficha?.lectura?.ruta), sinPdf: !!guardado?.sinPdf, fuente: ficha?.fuente ?? null })
  const v = veredictoFactura({
    validada, numeroAsiento: fac.asiento?.numero ?? null, descartada, motivoDescarte: descarte.datos?.motivo ?? null,
    proveedor: prov ? { nombre: prov.nombre, nif: prov.nif } : null, nifFactura: nifDeLaFactura, fecha: fac.fecha,
    comprobaciones, propuesta: propuesta ? { confianza: propuesta.confianza, avisos: propuesta.avisos, razones: propuesta.razones } : propuesta,
    porqueSinPropuesta: vista.datos && !vista.datos.propuesta ? vista.datos.porque : vista.error,
    origenGasto: prov?.gasto?.origen ?? null, pagada, cuadraConElPdf: leidaDeFichero ? cuadraGuardado : null, redondeo: contraGuardado.redondeo === true,
    faltaDocumento: faltaDoc, duplicada: dup.datos ?? null,
  })
  const mGasto = motivoGasto({ cuenta: gastoPropuesto, origen: prov?.gasto?.origen ?? (propuesta?.razones[0]?.porque ?? null), confirmada: validada })
  const mProv = motivoProveedor({ proveedor: prov ? { nombre: prov.nombre, nif: prov.nif } : null, nifFactura: nifDeLaFactura })
  const mImportes = motivoImportes(comprobaciones)
  const totales = totalesDe(b)

  const hayCambios = ed.hay
  const sePuedeValidar = !yaApuntada && !apuntando && !sinProveedor && !!fac.fecha && !hayCambios && !faltaDoc
  const botonValidar = !yaApuntada && (
    <span className="cxf-validar">
      <Boton variante="principal" icono="ok" onClick={() => void validar()} disabled={!sePuedeValidar} aria-keyshortcuts="Enter" data-validar-y-siguiente=""
        title={hayCambios ? 'Guarda o descarta primero' : faltaDoc ?? undefined}>
        {apuntando ? 'Validando…' : <><PorNivel clave="recibida.validarYSiguiente" />{!movil && <> <Tecla>Intro</Tecla></>}</>}
      </Boton>
      {hayCambios && <span className="cxf-guarda-primero" data-prueba="guarda-primero">Guarda o descarta primero</span>}
      {!hayCambios && faltaDoc && <span className="cxf-guarda-primero" data-prueba="falta-pdf">Falta su PDF o marcarla «Sin PDF»</span>}
    </span>
  )

  // De dónde vino, sin inventar.
  const origen = ficha ? {
    fuente: ficha.fuente, canal: fac.llegada?.canal ?? fac.canal ?? null,
    recepcion: ficha.recepcion ? { fecha: ficha.recepcion.fecha, local: ficha.recepcion.local, quien: ficha.recepcion.quien, cuando: ficha.recepcion.cuando } : null,
    lectura: ficha.lectura ? { cuando: ficha.lectura.cuando, archivo: ficha.lectura.archivo } : fac.llegada && lectura ? { cuando: fac.llegada.cuando, archivo: fac.llegada.archivo } : null,
    creada: ficha.creada,
  } : null
  const frase = origen ? deDondeVino(origen) : 'Leyendo de dónde vino…'
  const hechos = ficha && origen ? historialDe({
    ...origen, marca: MARCA.nombre, aprobada: ficha.aprobada,
    venceCambiado: ficha.venceCambiado ? { ...ficha.venceCambiado, vence: fac.vence } : null,
    pagos: ficha.pagos, asiento: ficha.asiento, descartada: ficha.descartada, cambios: ficha.guardado?.cambios ?? [],
  }) : null
  const aMano_ = ficha?.fuente === 'manual'

  const estado = descartada ? { texto: 'No es una factura', tono: 'neutro' as const }
    : validada ? (pagada ? { texto: 'Pagada', tono: 'seguro' as const } : { texto: 'Por pagar', tono: 'neutro' as const })
      : sinProveedor ? { texto: 'Proveedor nuevo', tono: 'duda' as const } : { texto: 'Por revisar', tono: 'duda' as const }
  const migasExtra = [{ etiqueta: `${proveedor}${fac.numero ? ` ${fac.numero}` : ''}` }]
  const tienePapel = !!papel.datos?.url
  const mas: GrupoDeAcciones[] = [{
    titulo: '',
    acciones: [
      ...(!yaApuntada ? [{ id: 'cambiar-pdf', etiqueta: tienePapel ? 'Cambiar el PDF' : 'Subir el PDF', dato: 'Un PDF o una foto, que se guarda como PDF', alPulsar: () => inputCambiar.current?.click(), grupo: '' }] : []),
      ...(!descartada ? [{ id: 'duplicada', etiqueta: 'Marcar como duplicada', dato: 'Ya la tienes: sale de «Por revisar»', alPulsar: () => setNoEs('Está repetida'), grupo: '' }] : []),
      ...(!descartada ? [{ id: 'no-es', etiqueta: 'Descartar con motivo', dato: 'Un albarán, un presupuesto, un extracto…', alPulsar: () => setNoEs(''), grupo: '' }] : []),
      // Sin la tanda 0790 (la base aún no guarda los importes desde aquí), se corrigen donde se aprobó.
      ...(!yaApuntada && ficha && !ficha.guardado ? [{ id: 'corregir', etiqueta: 'Corregir los importes', dato: 'En la recepción de la que salió', a: rutaCompras(), grupo: '' }] : []),
      { id: 'historial', etiqueta: 'Ver el historial', alPulsar: () => { const h = document.getElementById('historial'); h?.scrollIntoView({ behavior: 'smooth', block: 'start' }); h?.focus() }, grupo: '' },
      ...(tienePapel ? [{ id: 'abrir', etiqueta: 'Abrir el PDF aparte', alPulsar: () => window.open(papel.datos!.url!, '_blank', 'noopener'), grupo: '' }] : []),
    ],
  }]
  const msgRecuperado = recuperado?.id === invoiceId ? recuperado.texto : null

  // El asiento: si ya lo tiene, el suyo; si no, la vista previa con lo que hay en pantalla.
  const nombreCuenta = (c: string) => (cuentas.datos ?? []).find((x) => x.codigo === c)?.nombre ?? nombresProp?.get(c) ?? (prov?.gasto?.cuenta === c ? prov.gasto.nombre : 'Cuenta')
  const previa = cuentasProp ? asientoVistaPrevia(b, cuentasProp, nombreCuenta, nombreLocal) : null
  const lineasAsiento = fac.asiento
    ? (asientoReal.datos?.apuntes ?? []).map((x) => ({ nombre: x.nombreCuenta, codigo: x.cuenta, debe: x.debe ? importeEs(x.debe) : null, haber: x.haber ? importeEs(x.haber) : null }))
    : (previa?.lineas ?? []).map((x) => ({ nombre: x.nombre, codigo: x.codigo || '—', debe: x.debe !== null ? importeEs(x.debe) : null, haber: x.haber !== null ? importeEs(x.haber) : null, aMano: x.aMano }))
  const notaAsiento = fac.asiento ? (
    <>
      <Link to={rutaAsiento(fac.asiento.id)} data-prueba="ver-asiento">Ver el asiento{fac.asiento.numero ? ` ${fac.asiento.numero}` : ''}</Link>
      {` · ${fac.asiento.estado === 'validado' ? 'Validado' : mayuscula(fac.asiento.estado)}.`}
    </>
  ) : (
    <>
      {hayCambios ? 'Con cambios sin guardar, es la vista previa de cómo quedará: no se guarda ni se envía nada hasta «Guardar cambios». ' : ''}
      {previa?.faltan.length ? `Falta ${previa.faltan.join(', ')}. ` : ''}
      {enviaADiez ? 'Al validar se envía a Diez con su asiento; el PDF se queda aquí.' : vaEnElTraspaso ? 'Al validar queda para el traspaso del mes a Diez; el PDF se queda aquí.' : 'Debe arriba y haber debajo; cada importe en su columna.'}
    </>
  )
  const esFoto = (x: string | null | undefined) => /^image\//.test(x ?? '') || /\.(jpe?g|png|webp)$/i.test(x ?? '')
  // Foto o PDF según el fichero que se enseña de verdad (el mismo orden que urlDelPapel), no el nombre de lo que se leyó.
  const papelEsFoto = fac.llegada?.ruta
    ? esFoto(fac.llegada.tipo) || esFoto(fac.llegada.archivo ?? fac.llegada.ruta)
    : esFoto(fac.papel ?? ficha?.lectura?.ruta ?? null)
  const archivo = fac.llegada?.archivo ?? ficha?.lectura?.archivo ?? (fac.papel ? fac.papel.split('/').pop() ?? null : null)
  const sinPapelGuardado = !fac.llegada && !fac.papel && !ficha?.lectura?.ruta
  const soloLectura = yaApuntada
  // S01b · Sin proveedor: «Dar de alta a …» y «Es uno que ya tengo» (o «Es X: elegirlo» si el NIF ya es de uno tuyo).
  const nombreLeido = leidoProv?.nombre ?? fac.propuesto?.nombre ?? null
  const alta = altaEnFactura({ proveedorId: b.proveedorId, soloLectura, nifLeido: leidoProv?.nif ?? fac.propuesto?.nif ?? null, proveedores: proveedores.datos ?? [] })

  const datos = (
    <>
      {/* S01b · El único aviso en rojo de la pantalla, arriba del todo (al lado de «Validar»): el IBAN de esta factura no es el de su ficha. */}
      {!soloLectura && desdeDocumento?.iban.estado === 'distinto' && fac.proveedor?.id === proveedorFicha && fichaProv.datos && decisionIban.datos === null && !decisionIban.error && (
        <AvisoIbanDistinto iban={desdeDocumento.iban} ficha={fichaProv.datos} factura={facturaOrigen} quien={quien} accountId={fac.account_id} alHacer={(t) => decir(t)} />
      )}
      <Veredicto tipo={v.tipo} titulo={v.titulo} porque={v.porque} detalle={v.detalle} quien={MARCA.nombre} />
      {!soloLectura && <div className="cxf-barra"><BarraCambios cambios={ed.cambios} onDescartar={() => { ed.descartar(); setMensaje(null) }} onGuardar={() => void guardar()} guardando={guardando} mensaje={mensaje} /></div>}
      {descartada && (
        <section className="s-bloque-ficha" aria-label="No es una factura">
          <div className="s-bloque-ficha-cabeza"><h2>No es una factura</h2></div>
          <p className="s-apoyo">
            {descarte.datos ? `La descartó ${descarte.datos.quien ?? 'una persona'} el ${fechaEs(descarte.datos.cuando.slice(0, 10))}: «${descarte.datos.motivo}». ` : ''}No se contabiliza ni cuenta en lo que debes.
          </p>
          <div><Boton onClick={() => void deshacerDescarte()}>Deshacer: sí es una factura</Boton></div>
        </section>
      )}
      <BloqueProveedorFactura proveedorId={b.proveedorId} numero={b.numero} fecha={b.fecha} proveedores={proveedores.datos ?? []}
        alCambiar={(c) => { for (const [k, x] of Object.entries(c)) ed.poner(k as 'numero', x as string) }}
        cambioDe={ed.cambioDe} deshacer={ed.deshacer} soloLectura={soloLectura}
        tonoProveedor={mProv.tono} motivoProveedor={mProv.marca ? `${mProv.marca}${prov?.nif ? ` · NIF ${prov.nif}` : ''}` : mProv.motivo}
        motivoNumero={fac.no_repetida ? 'No está repetida: lo confirmaste.' : fac.numero ? 'No hay otra con su número y su total.' : 'Sin número no es una factura completa.'}
        // S01b2 · «Dar de alta a …» y «Es X: elegirlo» van debajo, a lo ancho del bloque: en la columna del
        // proveedor (un tercio) un nombre como «OFITOR 2000 S.L.U.» se partía en dos líneas.
        debajo={(abrirLista) => <>
          {alta.que === 'alta' && !altaAbierta && (
            <EnlacesAlta nombreLeido={nombreLeido} abierta={altaAbierta} alAbrirAlta={() => { setAltaAbierta(true); void releer() }} alAbrirLista={abrirLista} />
          )}
          {alta.que === 'es_uno_tuyo' && (
            <span className="cxf-alta-enlaces"><button type="button" className="s-boton s-boton-enlace" onClick={() => void elegirYGuardar(alta.proveedorId, alta.nombre, `Elegido ${alta.nombre}: el NIF de la factura es el suyo.`)}><NombreEntero texto={`Es ${alta.nombre}: elegirlo`} nombre={alta.nombre} /></button></span>
          )}
          {altaAbierta && alta.que === 'alta' && accountId && (
            <AltaDesdeFactura accountId={accountId} otros={(proveedores.datos ?? []).map((p) => ({ name: p.nombre, taxId: p.nif }))}
              leido={{ nombre: nombreLeido, nif: leidoProv?.nif ?? fac.propuesto?.nif ?? null, direccion: leidoProv?.direccion ?? null, correo: leidoProv?.email ?? null, telefono: leidoProv?.telefono ?? null, web: leidoProv?.web ?? null }}
              factura={facturaOrigen} alCancelar={() => setAltaAbierta(false)} leyendo={leyendo}
              relectura={releido?.id === invoiceId ? { texto: releido.texto, tono: releido.tono } : null}
              alCrear={(p) => { setAltaAbierta(false); void elegirYGuardar(p.id, p.name, fraseAltaEnFactura(p.name)) }} />
          )}
          {!soloLectura && desdeDocumento?.nifDistinto && fichaProv.datos && accountId && (
            <NifDistinto key={fichaProv.datos.id} accountId={accountId} ficha={fichaProv.datos} documento={desdeDocumento.nifDistinto.documento} factura={facturaOrigen} quien={quien}
              alGuardar={(t) => decir(t)} alElegirOtro={abrirLista} />
          )}
          {avisoProv?.id === invoiceId && <p className="s-aviso-lista" data-tono={avisoProv.tono} role="status" data-prueba="aviso-proveedor">{avisoProv.texto}</p>}
        </>} />
      {/* D07b · La ficha del proveedor, desde el documento: una nota bajo «Proveedor y factura», solo si hay algo que decir. */}
      {!soloLectura && desdeDocumento && fichaProv.datos && accountId && (desdeDocumento.frases.length > 0 || desdeDocumento.cambiados.length > 0 || desdeDocumento.iban.estado === 'nuevo' || desdeDocumento.iban.estado === 'invalido') && (
        <div className="cxf-desde-documento" aria-label="Su ficha, desde el documento">
          {desdeDocumento.frases.length > 0 && <p className="s-apoyo" data-prueba="se-guarda-al-validar">A la ficha de {fichaProv.datos.name} le falta {enUnaFrase(desdeDocumento.frases)}: lo trae el documento y lo guardo al validar, {deLaFactura(fac.numero)}.</p>}
          <LoQueHaCambiado accountId={accountId} ficha={fichaProv.datos} cambiados={desdeDocumento.cambiados} factura={facturaOrigen} quien={quien} alHacer={(t) => decir(t)} />
          {desdeDocumento.iban.estado === 'nuevo' && fac.proveedor?.id === proveedorFicha && (
            <IbanNuevo iban={desdeDocumento.iban} proveedorId={proveedorFicha} facturaId={fac.id} alGuardar={(t) => decir(t)} />
          )}
          {desdeDocumento.iban.estado === 'invalido' && <p className="s-apoyo">Esta factura trae un IBAN que no es válido ({desdeDocumento.iban.motivo.replace(/\.$/, '')}): puede estar mal leído, así que no lo ofrezco para su ficha.</p>}
        </div>
      )}
      {/* N1 · Sin NIF en su ficha no hay asiento: se guarda aquí, antes de validar (el documento lo propone si lo trae). */}
      {!soloLectura && !fac.asiento && fac.proveedor?.id && fichaProv.datos?.id === fac.proveedor.id && !fichaProv.datos.taxId && (
        <NifDeLaFicha key={fac.proveedor.id} proveedorId={fac.proveedor.id} proveedor={proveedor} entityKind={fichaProv.datos.entityKind}
          delDocumento={fac.lectura?.factura?.proveedor?.nif ?? null} alGuardar={(t) => { setNifGuardado({ id: invoiceId, texto: t }); setVuelta((v) => v + 1) }} />
      )}
      {nifGuardado?.id === invoiceId && <p className="s-aviso-lista" data-tono="ok" role="status" data-prueba="nif-guardado">{nifGuardado.texto}</p>}
      <BloqueImportesIva iva={b.iva} retencion={b.retencion} recargo={b.recargo} tipos={tiposIva.datos ?? [21, 10, 4, 0]} totales={totales} pdf={pdf}
        fuente={leidaDeFichero ? 'pdf' : 'factura'} soloLectura={soloLectura} masDecimales={masDecimales}
        alCambiar={(c) => { for (const [k, x] of Object.entries(c)) ed.poner(k as 'iva', x as BorradorFicha['iva']) }}
        cambioDe={ed.cambioDe} deshacer={ed.deshacer} />
      {mImportes.tono === 'revisar' && <p className="cxf-error" role="status">{mImportes.motivo}</p>}
      {!descartada && <IvaNoDeducibleFicha accountId={accountId} invoiceId={invoiceId} soloLectura={soloLectura} quien={userName} alGuardar={() => setVuelta((x) => x + 1)} />}
      {!descartada && <LiquidacionesDeLaFactura accountId={accountId} supplierId={fac.proveedor?.id ?? null} invoiceId={invoiceId} fecha={fac.fecha} total={fac.total} soloLectura={descartada} quien={userName} />}
      <BloqueGasto gastos={b.gastos} base={totales.base} cuentas={cuentas.datos ?? []} locales={ejeLocal ? locales.datos ?? [] : null} nombreEje={ejeLocal?.nombre ?? 'Local'}
        alCambiar={(g) => ed.poner('gastos', g)} cambio={ed.cambioDe('gastos')} alDeshacer={() => ed.deshacer('gastos')} soloLectura={soloLectura}
        tono={mGasto.tono} motivo={[mGasto.motivo, !ficha?.localId && ficha?.recepcion?.local ? `El local sale de la recepción del ${fechaEs(ficha.recepcion.fecha).slice(0, 5)}.` : null].filter(Boolean).join(' ')} />
      <BloquePago formaPago={b.formaPago} vence={b.vence} estadoPago={b.estadoPago} soloLectura={soloLectura}
        alCambiar={(c) => { for (const [k, x] of Object.entries(c)) ed.poner(k as 'vence', x as string) }} cambioDe={ed.cambioDe} deshacer={ed.deshacer}
        motivoVence={b.formaPago === 'prepaid' ? 'Se paga del saldo prepago Catcher (40700001): no espera a un vencimiento.' : mayuscula(vence.apoyo)}
        tonoVence={vence.aviso && b.formaPago !== 'prepaid' ? 'revisar' : 'normal'}
        motivoForma={extra.datos?.comoPagada ? 'Con la que se pagó.' : conTarjeta && !guardado?.formaPago ? 'Lo dice el documento: pagada con tarjeta. Al validarla, la caso con su cargo del banco.' : ficha?.formaPagoFicha ? 'La de su ficha.' : undefined}
        pagada={pagada ? `Pagada el ${fechaEs(pagada.fecha)}${extra.datos?.comoPagada ? ` · ${extra.datos.comoPagada}` : ''}.` : null} />
      {extra.error && <p className="s-apoyo">No se ha podido saber si está pagada: {extra.error}</p>}
      <AsientoQueSeCrea titulo={fac.asiento ? 'Su asiento' : 'El asiento que se crea'} lineas={lineasAsiento} nota={notaAsiento}
        alEditar={!fac.asiento && !soloLectura ? () => setAMano((x) => !x) : undefined}
        vacio={fac.asiento ? (asientoReal.error ? `No se ha podido leer su asiento${fac.asiento.numero ? ` (el ${fac.asiento.numero})` : ''}: ${asientoReal.error}` : 'Leyendo su asiento…')
          : vista.error ? `No se ha podido preparar: ${vista.error}` : vista.datos && !vista.datos.propuesta ? vista.datos.porque : 'Preparando el asiento…'} />
      {aMano && previa && (
        <EditarAsientoAMano lineas={previa.lineas.map((l) => ({ codigo: Object.entries(b.aMano).find(([, x]) => x === l.codigo && l.aMano)?.[0] ?? l.codigo, nombre: l.nombre, importe: importeEs(l.debe ?? l.haber ?? 0) }))}
          cuentas={[...(cuentas.datos ?? []), ...[...(nombresProp?.entries() ?? [])].filter(([c]) => !/^6/.test(c)).map(([codigo, nombre]) => ({ codigo, nombre }))]}
          aMano={b.aMano} alCambiar={(m) => ed.poner('aMano', m)} alCerrar={() => setAMano(false)} />
      )}
      {vista.datos && !vista.datos.propuesta && !fac.asiento && <p className="s-apoyo">{vista.datos.porque}</p>}
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
      {movil && <BloqueHistorial hechos={hechos} error={fichaLeida.error} />}
    </>
  )

  const hueco = (nota?: string) => (
    <HuecoPapel alElegir={elegirPapel} sinPdf={b.sinPdf} motivoSinPdf={b.motivoSinPdf} soloLectura={soloLectura} nota={nota}
      alCambiarSinPdf={(c) => { for (const [k, x] of Object.entries(c)) ed.poner(k as 'sinPdf', x as never) }}
      cambioSinPdf={ed.cambioDe('sinPdf') ?? ed.cambioDe('motivoSinPdf')} deshacerSinPdf={() => { ed.deshacer('sinPdf'); ed.deshacer('motivoSinPdf') }} />
  )
  const documento = (
    <div className="cxf-derecha">
      <DocumentoFicha titulo={ficheroVivo ? ficheroVivo.file.name : archivo ?? (sinPapelGuardado ? 'Sin PDF' : `${fac.numero ?? 'factura'}.pdf`)} descargar={ficheroVivo ? null : papel.datos?.url ?? null}
        oculto={marco?.documentoOculto ?? false} alOcultar={(x) => marco?.ocultarDocumento(x)}>
        {!soloLectura && (tienePapel || ficheroVivo) && (
          <div className="cxf-papel-acciones">
            {ficheroVivo && <span className="s-campo-cambiado">Sin guardar</span>}
            <Boton variante="secundario" onClick={() => inputCambiar.current?.click()}>Cambiar</Boton>
          </div>
        )}
        {ficheroVivo
          ? (esFoto(ficheroVivo.file.type) ? <img src={ficheroVivo.url} alt={`El documento elegido para la factura ${fac.numero ?? ''}`} /> : <PapelPdf url={ficheroVivo.url} titulo={`El documento elegido para la factura ${fac.numero ?? ''}`} />)
          : <>
            {!papel.datos && !papel.error && !sinPapelGuardado && <div className="s-lista-cargando" aria-label="Cargando el PDF" />}
            {/* Sin documento guardado no hay nada que bajar: el hueco y su porqué, sin esperar a leerlo. */}
            {sinPapelGuardado && hueco(aMano_ ? 'Escrita a mano, sin PDF todavía.' : 'Esta factura no tiene su PDF enlazado.')}
            {!sinPapelGuardado && papel.error && hueco(textoSinPapel({ archivo, aMano: false, error: papel.error }))}
            {!sinPapelGuardado && !papel.error && papel.datos && !papel.datos.url && hueco(textoSinPapel({ archivo, aMano: false, error: null }))}
            {papel.datos?.url && (papelEsFoto
              ? <img src={papel.datos.url} alt={`La factura ${fac.numero ?? ''} tal como llegó`} />
              : <PapelPdf url={papel.datos.url} titulo={`La factura ${fac.numero ?? ''} tal como llegó`} />)}
          </>}
      </DocumentoFicha>
      <input ref={inputCambiar} type="file" accept={ACEPTA_PAPEL} hidden aria-label="Cambiar el PDF de la factura"
        onChange={(e) => { const x = e.target.files?.[0]; if (x) elegirPapel(x); e.target.value = '' }} />
      {!movil && <BloqueHistorial hechos={hechos} error={fichaLeida.error} />}
    </div>
  )

  return (
    <div className="s-pagina" data-prueba="ficha-recibida" data-origen={aMano_ ? 'a-mano' : 'sola'}>
      <EncabezadoPagina
        titulo={titulo}
        estado={estado}
        frase={<span data-prueba="de-donde-vino">{frase}</span>}
        migasExtra={migasExtra}
        derecha={<NavegaFicha pos={pos + 1} total={ids.length} que={queCuentaLaCola(filtros.pestana)} anterior={anterior ? () => pedirSalir(() => ir(anterior)) : null} siguiente={siguiente ? () => pedirSalir(() => ir(siguiente)) : null} />}
        masAcciones={mas}
        principal={botonValidar || <Link to={volver} className="s-boton s-boton-secundario">Volver a la lista</Link>}
      />
      <Ficha datos={datos} documento={documento} documentoOculto={marco?.documentoOculto ?? false} usuario={userId} reglaAnchos />
      <BotonPulgar>{botonValidar || <Link to={volver} className="s-boton s-boton-secundario">Volver a la lista</Link>}</BotonPulgar>
      {salida.aviso}
      {noEs !== null && <NoEsFactura inicial={noEs} alCerrar={() => setNoEs(null)} alDescartar={(m) => descartar(m)} fallo={falloDescarte} />}
    </div>
  )
}

const NOMBRE_ESTADO: Record<string, string> = { borrador: 'borrador', en_revision: 'en revisión', aprobada: 'aprobada', con_discrepancias: 'con diferencias' }

const MOTIVOS = ['Es un albarán', 'Es un presupuesto', 'Es un extracto o un recibo', 'Está repetida'] as const

/** «Descartar con motivo» (y «Marcar como duplicada», con «Está repetida» elegido): sin motivo no se descarta (la base tampoco lo deja). */
function NoEsFactura({ inicial, alCerrar, alDescartar, fallo }: { inicial: string; alCerrar: () => void; alDescartar: (motivo: string) => Promise<void>; fallo: string | null }) {
  const [motivo, setMotivo] = useState(inicial)
  const [ocupado, setOcupado] = useState(false)
  const listo = motivo.trim().length > 0
  return (
    <Dialogo titulo={inicial === 'Está repetida' ? 'Marcar como duplicada' : 'Descartar con motivo'} alCerrar={alCerrar}>
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
