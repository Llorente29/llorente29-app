// src/modules/conta/nucleo/recibida/FichaRecibida.tsx
//
// K04 · La ficha de la factura recibida en el núcleo (maquetas nucleo_1,
// nucleo_2 y nucleo_3, aprobadas por Julio el 17/11). Es la pantalla; los
// datos, la validación y lo que se guarda son los de hoy (RevisarFacturaPage y
// RecibidaAMano), con las mismas funciones de la base:
//
//   · leer: conta_factura_para_revisar, la ficha (leerFichaRecibida), la
//     propuesta del asiento (verPropuestaFactura), la cola de «Por revisar»
//     (colaRecibidas), las repetidas (duplicadaDe);
//   · guardar: conta_recibida_guardar (0790) con cambiosParaLaBase, el PDF con
//     conta_recibida_papel_poner; la escrita a mano, con guardarRecibidaAMano;
//   · validar: apuntarFactura, la misma de «Validar y siguiente».
//
// «Guardar y siguiente» hace los tres en un paso (decisión 12): guarda, valida
// y pasa a la siguiente, y lo dice con contenido (regla 8). Si no se puede
// validar, guarda, dice por qué y no pasa.
//
// Lo que esta ficha no hace, y sigue en la ficha de hoy (Más › «La ficha
// completa»): los abonos, la comisión de una plataforma, el IBAN, pagar, el
// historial y descartar. Las validadas y las descartadas se abren con la de hoy.
//
// K04b · El emisor que no se reconoce: la franja dice «Mira esto · No conozco
// al que la emite», el NIF y el nombre leídos quedan en sus casillas («PDF») y
// debajo, en ámbar, «Darlo de alta» (AltaDesdeFactura, la de la ficha de hoy)
// y «Es uno que ya tengo» (el foco al proveedor, con su lista abierta). Hasta
// que tenga proveedor no se valida, y si se intenta, lo dice.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as KE } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { rutaDocumentos, rutaMayor, rutaRevisarFactura } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { useAnalitica } from '@/modules/conta/marco/nuevo/contexto'
import { hoyEnMadrid } from '@/modules/conta/lib/formato'
import { calcularVencimiento } from '@/modules/conta/lib/cifras'
import { LOCAL_COMUN } from '@/modules/conta/lib/recibidaAMano'
import { useAvisoSalir, useCambiosSinGuardar, useNombreDePestana, usePestana, useSeVe } from '@/modules/conta/diseno/plantillas'
import { conCambio, recordarLista } from '@/modules/conta/diseno/plantillas'
import { LISTA_RECIBIDAS, filtrosDe, ventanaDe } from '@/modules/conta/documentos/recibidas'
import { colaRecibidas } from '@/modules/conta/documentos/colaRecibidas'
import { duplicadaDe } from '@/modules/conta/documentos/paraValidarService'
import { faltaDocumento } from '@/modules/conta/documentos/paraValidar'
import { esAbono } from '@/modules/conta/documentos/abono'
import {
  ACEPTA_PAPEL, ETIQUETAS, TIPOS_RETENCION, asientoVistaPrevia, borradorDe, cambiosParaLaBase, comprobarAMano, cuentasDeLaPropuesta, formatoCampo,
  importeEs, rehacerCuota, rehacerRetencion, totalesDe, desdeElTotal, type BorradorFicha, type LineaIva,
} from '@/modules/conta/documentos/fichaRecibida'
import {
  apuntarFactura, cuentasDeGasto, guardarCambiosRecibida, leerExtrasFacturas, leerFactura, leerFichaRecibida, plazoDeLaFicha, ponerPapelRecibida,
  proveedoresDeLaCuenta, urlDelPapel, verPropuestaFactura, leerAntesDelInicio, sinPapelRecibida,
} from '@/modules/conta/services/documentosService'
import { localesDeLaCuenta } from '@/modules/conta/services/diarioService'
import { guardarRecibidaAMano, tiposDeIvaRecibida } from '@/modules/conta/services/recibidaAManoService'
import { refrescarCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { AsientoQueSale, AyudaTeclas, Casilla, CasillaFecha, Comprobaciones, Duda, EstadoFicha } from '../ficha/piezas'
import { PanelDocumento } from '../ficha/PanelDocumento'
import { cifra } from '../ficha/textos'
import { useUltimo } from '../ficha/useUltimo'
import { Buscador } from '../ficha/Buscador'
import { cuentasQueEncajan, queHaceIntro, type CuentaDelPlan } from '../ficha/teclas'
import { origenes } from './origen'
import { casillasVacias, comprobacionesDe, dondeVaElFoco, dudaDelGasto, emisorDesconocido, estadoDeLaFicha, etiquetaDelAsiento, nombreDePestana, puedeGuardar, trimestreDe } from './estado'
import { calendarioDe, cuentasAMano, delProveedor, gastoAprendido, marcaDeLaFactura, mayorDelProveedor, textoOperacion } from './servicio'
import { fechaDelPago, propuestaDelPago, queHaceElPago, textoDudaPago, textoPendiente, type QueHaceElPago } from './pago'
import { apuntarPago, cuentasDePago, hayLiquidacion, pagoDelProveedor } from './pagoServicio'
import RevisarFacturaPage from '@/modules/conta/documentos/RevisarFacturaPage'
import { AltaDesdeFactura } from '@/modules/conta/documentos/ProveedorDesdeFactura'
import { fraseAltaEnFactura } from '@/modules/conta/lib/altaProveedor'

/**
 * K06 · El borrador de esta ficha: el de la ficha de hoy y la cuenta del pago con su fecha. null = lo que
 * se propone (la 430 de su liquidación, la del último pago, o vacía); '' = pendiente de pagar.
 */
type BorradorNucleo = BorradorFicha & { pagoCuenta: string | null; pagoFecha: string | null }
/** Los nombres de los cambios sin guardar, con los rótulos de esta ficha (K04b: «N.º de factura», como la casilla). */
const ETIQUETAS_NUCLEO = { ...ETIQUETAS, numero: 'N.º de factura', pagoCuenta: 'La cuenta del pago', pagoFecha: 'La fecha del pago' }
const SIN_PAGO = { pagoCuenta: null, pagoFecha: null }
const VACIO: BorradorNucleo = { ...borradorDe({ proveedorId: null, numero: null, fecha: null, vence: null, retencion: null, recargo: null, gasto: null, local: null, formaPago: null, pagada: false, tipos: [], lineas: [], base: null, cuota: null }), ...SIN_PAGO }
const vacioAMano = (hoy: string): BorradorNucleo => ({ ...VACIO, fecha: hoy, iva: [{ base: '', tipo: '21', cuota: '' }, { base: '', tipo: '10', cuota: '' }] })
/** Lo que no guarda conta_recibida_guardar: la cuenta del pago va al validar (K06). */
const NO_SE_GUARDA = new Set(['documento', 'sinPdf', 'motivoSinPdf', 'estadoPago', 'pagoCuenta', 'pagoFecha'])
const num = (x: string): number | null => { const n = Number(x.replace(/\./g, '').replace(',', '.')); return x.trim() && Number.isFinite(n) ? n : null }

type Aviso = { tono: 'ok' | 'falta' | 'mal'; texto: string }

/** Las casillas que cuentan para Intro, en el orden de la página (data-casilla). */
function casillasDe(raiz: HTMLElement | null): HTMLElement[] {
  return raiz ? Array.from(raiz.querySelectorAll<HTMLElement>('[data-casilla]')).filter((x) => !x.hasAttribute('disabled') && x.offsetParent !== null) : []
}

export default function FichaRecibida({ aMano = false }: { aMano?: boolean }) {
  const { invoiceId = '' } = useParams()
  const [query] = useSearchParams()
  const { search, state } = useLocation()
  const navegar = useNavigate()
  const pestana = usePestana()
  const seVe = useSeVe()
  const { accountId, userId, userName } = useCuentaConta()
  const { activa } = useEmpresas()
  const { local: ejeLocal } = useAnalitica()
  const hoy = hoyEnMadrid()
  const [vuelta, setVuelta] = useState(0)
  // «La ficha completa» (la de hoy), solo para la factura en que se pidió.
  const [completaDe, setCompletaDe] = useState<string | null>(null)
  const completa = !aMano && completaDe === invoiceId
  const setCompleta = (si: boolean) => setCompletaDe(si ? invoiceId : null)
  const [textoProv, setTextoProv] = useState<string | null>(null)
  const [textoCuenta, setTextoCuenta] = useState<Record<number, string>>({})
  const [textoTotal, setTextoTotal] = useState<string | null>(null)
  const [fichero, setFichero] = useState<{ file: File; url: string } | null>(null)

  // ── Lo que se lee: lo mismo que la ficha de hoy ──
  const id = aMano ? '' : invoiceId
  const f = useLeer(id ? () => leerFactura(id) : null, `${id}:${vuelta}`)
  // Lo último leído de ESTA factura mientras se vuelve a leer (useUltimo): la ficha no se vacía ni pierde su cuenta.
  const fac = useUltimo(f.datos, id)
  const empresa = activa?.id ?? fac?.company_id ?? null
  const filtros = filtrosDe(query)
  const { desde, hasta } = ventanaDe(filtros.mes, hoy)
  const lista = useLeer(empresa && accountId ? () => colaRecibidas(accountId, empresa, desde, hasta, filtros) : null, `${accountId}:${empresa}:${desde}:${hasta}:${search}:${vuelta}`)
  const listaDatos = useUltimo(lista.datos, `${empresa}:${search}`)
  const ids = useMemo(() => listaDatos ?? [], [listaDatos])
  const pos = ids.indexOf(invoiceId)
  const ficha = useUltimo(useLeer(accountId && id ? () => leerFichaRecibida(accountId, id) : null, `${accountId}:${id}:ficha:${vuelta}`).datos, id)
  const localPropuesto = ficha ? ficha.localId ?? ficha.recepcion?.localId ?? null : undefined
  const papel = useLeer(fac && ficha ? async () => ({ url: await urlDelPapel(fac, ficha.lectura?.ruta ?? null) }) : null, `${id}:papel:${ficha ? 'f' : '-'}:${fac?.llegada?.ruta ?? fac?.papel ?? ''}`)
  const plazo = useLeer(fac?.proveedor?.id && accountId ? () => plazoDeLaFicha(accountId, fac.proveedor!.id) : null, `${accountId}:${fac?.proveedor?.id}:plazo`).datos
  const vista = useLeer(fac && accountId && fac.company_id && fac.fecha && !fac.asiento && localPropuesto !== undefined
    ? () => verPropuestaFactura(accountId, fac.company_id!, fac.id, fac.fecha!, localPropuesto) : null,
  `${accountId}:${id}:${fac?.fecha}:${fac?.proveedor?.id}:${localPropuesto}:${vuelta}`)
  const extra = useUltimo(useLeer(accountId && id ? () => leerExtrasFacturas(accountId, [id]).then((m) => m.get(id) ?? null) : null, `${accountId}:${id}:extra:${vuelta}`).datos, id)
  const [vueltaProv, setVueltaProv] = useState(0)
  const proveedoresL = useUltimo(useLeer(accountId ? () => proveedoresDeLaCuenta(accountId) : null, `${accountId}:proveedores:${vueltaProv}`).datos, accountId ?? '')
  const proveedores = useMemo(() => proveedoresL ?? [], [proveedoresL])
  const localesL = useLeer(accountId && ejeLocal ? () => localesDeLaCuenta(accountId) : null, `${accountId}:${ejeLocal ? 'con' : 'sin'}:locales`).datos
  const locales = useMemo(() => localesL ?? [], [localesL])
  const cuentasGastoL = useLeer(accountId && empresa ? () => cuentasDeGasto(accountId, empresa) : null, `${accountId}:${empresa}:gastos`).datos
  const cuentasGasto = useMemo(() => cuentasGastoL ?? [], [cuentasGastoL])
  const tiposIva = useLeer(accountId ? () => tiposDeIvaRecibida(accountId) : null, `${accountId}:tipos-iva`).datos ?? [21, 10, 4, 0]
  const dup = useLeer(accountId && fac ? () => duplicadaDe(accountId, fac.id, fac.proveedor?.id ?? null) : null, `${accountId}:${id}:${fac?.numero}:${fac?.total}:dup:${vuelta}`).datos ?? null
  const calendario = useLeer(accountId && empresa ? () => calendarioDe(accountId, empresa) : null, `${accountId}:${empresa}:calendario`).datos ?? null
  const marca = useLeer(accountId && id ? () => marcaDeLaFactura(accountId, id) : null, `${accountId}:${id}:marca`).datos ?? null

  // ── El borrador: lo guardado, como en la ficha de hoy ──
  const vistaDatos = useUltimo(vista.datos, `${id}:${fac?.proveedor?.id ?? ''}`)
  const propuesta = fac?.asiento ? undefined : vistaDatos ? (vistaDatos.propuesta ?? null) : vista.error ? null : undefined
  const nombresProp = vistaDatos?.propuesta ? vistaDatos.nombres : null
  const lineaGasto = propuesta?.lineas.find((l) => l.debe > 0 && /^6/.test(l.cuenta)) ?? null
  const gastoPropuesto = lineaGasto?.cuenta ?? fac?.proveedor?.gasto?.cuenta ?? null
  const venceFicha = fac?.fecha && plazo && plazo.dias !== null ? calcularVencimiento(fac.fecha, plazo.dias, plazo.fijos) : null
  const guardado = ficha?.guardado ?? null
  const original = useMemo<BorradorNucleo>(() => {
    if (aMano) return vacioAMano(hoy)
    if (!fac) return VACIO
    return { ...SIN_PAGO, ...borradorDe({
      proveedorId: fac.proveedor?.id ?? null, numero: fac.numero, fecha: fac.fecha, vence: fac.vence ?? venceFicha,
      retencion: fac.retencion, recargo: fac.recargo, gasto: gastoPropuesto, local: localPropuesto ?? null,
      formaPago: guardado?.formaPago ?? extra?.comoPagada ?? ficha?.formaPagoFicha ?? null, pagada: !!extra?.pagada,
      tipos: fac.tipos, lineas: fac.lineas, base: fac.base, cuota: fac.cuota,
      reparto: guardado?.reparto.length ? guardado.reparto.map((g) => ({ cuenta: g.cuenta, local: g.comun ? null : g.local, importe: g.importe })) : null,
      sinPdf: guardado?.sinPdf ? { motivo: guardado.sinPdf.motivo } : null,
    }) }
  }, [aMano, hoy, fac, venceFicha, gastoPropuesto, localPropuesto, extra, ficha, guardado])
  const nombreProveedor = useCallback((pid: string) => proveedores.find((p) => p.id === pid)?.nombre ?? (fac?.proveedor?.id === pid ? fac.proveedor.nombre : 'otro proveedor'), [proveedores, fac])
  const nombreLocal = useCallback((lid: string) => locales.find((l) => l.id === lid)?.nombre ?? null, [locales])
  const formato = useMemo(() => {
    const f = formatoCampo(nombreProveedor, nombreLocal)
    return (campo: string, v: unknown): string => campo === 'pagoCuenta' ? (v ? String(v) : 'Pendiente de pagar')
      : campo === 'pagoFecha' ? (v ? String(v).split('-').reverse().join('/') : '—') : f(campo, v)
  }, [nombreProveedor, nombreLocal])
  const ed = useCambiosSinGuardar<BorradorNucleo>(original, ETIQUETAS_NUCLEO, formato)
  const b = ed.valor
  const { reiniciar } = ed
  const deFactura = useRef(`${aMano}:${invoiceId}`)
  useEffect(() => {
    const k = `${aMano}:${invoiceId}`
    if (deFactura.current === k) return
    deFactura.current = k
    reiniciar(aMano ? vacioAMano(hoy) : VACIO)
  }, [aMano, invoiceId, reiniciar, hoy])

  // ── Del proveedor elegido: su ficha (régimen, subcuenta), su mayor, lo aprendido ──
  const provId = b.proveedorId || fac?.proveedor?.id || ''
  const prov = proveedores.find((p) => p.id === provId) ?? (fac?.proveedor && fac.proveedor.id === provId ? { id: provId, nombre: fac.proveedor.nombre, nif: fac.proveedor.nif } : null)
  const delProv = useLeer(accountId && empresa && provId ? () => delProveedor(accountId, empresa, provId) : null, `${accountId}:${empresa}:${provId}:del`).datos ?? null
  const mayor = useUltimo(useLeer(accountId && empresa && delProv?.subcuenta ? () => mayorDelProveedor(accountId, empresa, delProv.subcuenta!.id, hoy) : null, `${accountId}:${empresa}:${delProv?.subcuenta?.id}:mayor:${vuelta}`).datos, `${id}:${provId}`)
  const aprendido = useUltimo(useLeer(empresa && provId && !aMano ? () => gastoAprendido(empresa, provId) : null, `${empresa}:${provId}:${invoiceId}:aprendido:${vuelta}`).datos, `${id}:${provId}`)
  const sinPropuesta = aMano || propuesta === null
  // Una vez por empresa: la subcuenta del proveedor sale de delProveedor (ya leído), no de volver a leer el contexto entero.
  const aManoCuentas = useLeer(accountId && empresa && sinPropuesta ? () => cuentasAMano(accountId, empresa) : null, `${accountId}:${empresa}:cuentas-a-mano`).datos ?? null

  // ── K06 · Cómo se paga: la cuenta del pago, propuesta (la 430 de su liquidación, la del último pago) o vacía ──
  const cuentasPago = useUltimo(useLeer(accountId && empresa ? () => cuentasDePago(accountId, empresa) : null, `${accountId}:${empresa}:cuentas-pago`).datos, empresa ?? '')
  const subProvCodigo = delProv?.subcuenta?.codigo ?? null
  const pagoProv = useUltimo(useLeer(accountId && empresa && provId && delProv ? () => pagoDelProveedor(accountId, empresa, provId, subProvCodigo) : null, `${accountId}:${empresa}:${provId}:${subProvCodigo}:pago:${vuelta}`).datos, `${id}:${provId}`)
  const conLiquidacion = useLeer(id && pagoProv?.plataforma ? () => hayLiquidacion(id) : null, `${id}:${pagoProv?.plataforma ? 'p' : '-'}:liquidacion:${vuelta}`).datos ?? false
  const plataforma = pagoProv?.plataforma ? { ...pagoProv.plataforma, hayLiquidacion: conLiquidacion } : null
  const propuestaPago = pagoProv ? propuestaDelPago({ plataforma, ultimas: pagoProv.ultimas }) : null
  const pagoCuenta = b.pagoCuenta ?? propuestaPago?.cuenta ?? ''
  const pagoFecha = b.pagoFecha ?? fechaDelPago(b.fecha, b.vence)
  const origenPago = b.pagoCuenta === null ? propuestaPago?.origen ?? null : null
  const dudaPago = b.pagoCuenta === null && propuestaPago?.duda ? propuestaPago.duda : null
  const nombrePago = pagoCuenta ? cuentasPago?.nombres.get(pagoCuenta) ?? 'Cuenta' : ''
  // Lo que se escribe en la casilla del pago, de ESTA factura (al pasar a otra, se vuelve a lo suyo).
  const [escrito, setEscrito] = useState<{ de: string; texto: string | null }>({ de: '', texto: null })
  const textoPago = escrito.de === `${aMano}:${invoiceId}` ? escrito.texto : null
  const setTextoPago = (texto: string | null) => setEscrito({ de: `${aMano}:${invoiceId}`, texto })

  // ── El asiento que sale ──
  const cuentasPlan: CuentaDelPlan[] = useMemo(() => cuentasGasto.map((c) => ({ codigo: c.codigo, nombre: c.nombre })), [cuentasGasto])
  const nombreGasto = useCallback((c: string) => cuentasPlan.find((x) => x.codigo === c)?.nombre ?? nombresProp?.get(c) ?? 'Cuenta', [cuentasPlan, nombresProp])
  const subProv = delProv?.subcuenta ?? null
  const cuentasAsiento = useMemo(() => (propuesta ? cuentasDeLaPropuesta(propuesta.lineas, (c) => nombresProp?.get(c) ?? 'Cuenta')
    : aManoCuentas ? { ...aManoCuentas.cuentas, proveedor: subProv ? { codigo: subProv.codigo, nombre: subProv.nombre } : null } : null), [propuesta, nombresProp, aManoCuentas, subProv])
  const previa = cuentasAsiento ? asientoVistaPrevia(b, cuentasAsiento, nombreGasto, nombreLocal) : null
  const totales = totalesDe(b)

  // ── Lo que se dice: origen, comprobaciones, la duda, la franja ──
  const leido = fac?.lectura?.factura ?? null
  const origen = origenes({
    leido: leido ? { nif: leido.proveedor.nif, numero: leido.numero, fecha: leido.fecha, nombre: leido.proveedor.nombre } : null,
    deRecepcion: !!fac?.leido_en_recepcion && !fac?.lectura?.factura?.numero,
    proveedor: prov ? { id: prov.id, nif: prov.nif, regimen: delProv?.regimen ?? null } : null,
    proveedorCambiado: !!fac && b.proveedorId !== (fac.proveedor?.id ?? ''),
    numero: b.numero, fecha: b.fecha, conceptoPropuesto: !!propuesta && Object.keys(b.aMano).length === 0,
  })
  const [decidida, setDecidida] = useState<string | null>(null)
  const duda = aprendido ? dudaDelGasto({ reparto: aprendido.reparto, confianza: aprendido.confianza, cuentaAhora: b.gastos[0]?.cuenta ?? '', decidida: decidida === `${invoiceId}:${provId}` }) : null
  const comprobaciones = aMano ? [] : comprobacionesDe({
    aMano, duplicada: dup, noRepetida: fac?.no_repetida ?? false, fecha: b.fecha, calendario, numero: b.numero, hayFicha: !!prov,
    nifFicha: prov?.nif ?? null, nifLeido: leido?.proveedor.nif ?? fac?.propuesto?.nif ?? null,
    total: totales.total, totalDocumento: leido?.total ?? null, lectura: fac?.lectura?.comprobaciones ?? [], avisos: propuesta?.avisos ?? [],
  })
  const faltaDoc = !aMano && fac ? faltaDocumento({ tieneDocumento: !!(fac.llegada || fac.papel || ficha?.lectura?.ruta || fichero), sinPdf: b.sinPdf, fuente: ficha?.fuente ?? null }) : null
  if (faltaDoc) comprobaciones.push({ id: 'documento', tono: 'rojo', texto: faltaDoc.replace(/\.$/, '') })
  // K04b · El emisor que no se reconoce, y lo que falta: la franja no dice «Rellenada» con casillas vacías.
  const leidoEmisor = leido ? { nombre: leido.proveedor.nombre ?? fac?.propuesto?.nombre ?? null, nif: leido.proveedor.nif ?? fac?.propuesto?.nif ?? null }
    : fac?.propuesto ? { nombre: fac.propuesto.nombre, nif: fac.propuesto.nif } : null
  const emisor = fac ? emisorDesconocido({ aMano, proveedorId: provId, leido: leidoEmisor, proveedores }) : null
  const vacias = aMano ? [] : casillasVacias({ proveedor: !!provId, numero: b.numero, fecha: b.fecha, total: totales.total, cuentaGasto: b.gastos.some((g) => g.cuenta.trim() !== '') })
  const estado = estadoDeLaFicha({ aMano, leida: !!fac?.lectura, comprobaciones, hayDudaGasto: !!duda || !!dudaPago, desconocido: emisor?.que === 'alta', vacias })
  const [altaAbierta, setAltaAbierta] = useState<string | null>(null)
  const [abrirProveedor, setAbrirProveedor] = useState(0)
  useNombreDePestana(nombreDePestana(aMano ? prov?.nombre : prov?.nombre ?? fac?.proveedor?.nombre ?? emisor?.nombre, !aMano))

  // ── Guardar, validar y pasar ──
  const siguiente = pos >= 0 && pos < ids.length - 1 ? ids[pos + 1] : null
  const anterior = pos > 0 ? ids[pos - 1] : null
  const ir = useCallback((destino: string, aviso?: string) => {
    const q = conCambio(search, { fila: destino })
    recordarLista(LISTA_RECIBIDAS, `${rutaDocumentos()}${q}`)
    navegar(`${rutaRevisarFactura(destino)}${q}`, aviso ? { state: { aviso } } : undefined)
  }, [search, navegar])
  // El aviso: el de la factura de antes (lo que dijo al pasar), hasta que esta diga el suyo.
  const avisoDeAntes = (state as { aviso?: string } | null)?.aviso ?? null
  const claveAviso = `${aMano}:${invoiceId}:${avisoDeAntes ?? ''}`
  const [propio, setPropio] = useState<{ k: string; a: Aviso | null } | null>(null)
  const aviso: Aviso | null = propio && propio.k === claveAviso ? propio.a : avisoDeAntes ? { tono: 'ok', texto: avisoDeAntes } : null
  const setAviso = (a: Aviso | null) => setPropio({ k: claveAviso, a })
  const [guardando, setGuardando] = useState(false)
  useEffect(() => () => { if (fichero) URL.revokeObjectURL(fichero.url) }, [fichero])

  // K06 · Qué hace al validar la cuenta del pago que hay en la casilla, y hacerlo (siempre una frase, regla 8).
  const importePago = Math.round(totales.total * 100) / 100
  const queElPago = (): QueHaceElPago => queHaceElPago({ cuenta: pagoCuenta, fecha: pagoFecha, hoy, importe: importePago,
    tesorerias: cuentasPago?.tesorerias ?? new Map<string, string>(), plataforma, cuentaProveedor: subProvCodigo })
  async function elPago(facturaId: string, empresaId: string): Promise<string> {
    const q = queElPago()
    if (q.que === 'pendiente') return textoPendiente(q.porque)
    if (q.que === 'liquidacion') return `Se paga con su liquidación: la ${q.cuenta}${plataforma ? ` de ${plataforma.nombre}` : ''} la descuenta, no pasa por el banco.`
    try { return await apuntarPago({ companyId: empresaId, facturaId, pago: q, quien: userName }) }
    catch (e) { return `El pago no se ha apuntado (${e instanceof Error ? e.message.replace(/\.$/, '') : String(e)}): queda pendiente de pagar.` }
  }

  /** Guarda lo cambiado (sin validar). true si todo; si no, el porqué. */
  async function guardarCambios(): Promise<true | string> {
    if (!fac) return true
    const campos = ed.cambios.map((c) => c.campo).filter((c) => !NO_SE_GUARDA.has(c))
    // K06 · Con la 430 de su liquidación, la forma de pago es «Compensación con la liquidación» (la de la 0790): al validarla la paga la base.
    const conLiq = queElPago().que === 'liquidacion' && b.formaPago !== 'compensation'
    const bb: BorradorNucleo = conLiq ? { ...b, formaPago: 'compensation' } : b
    if (conLiq && !campos.includes('formaPago')) campos.push('formaPago')
    const partes: string[] = []
    if (campos.length) {
      const prev = cuentasAsiento ? asientoVistaPrevia(bb, cuentasAsiento, () => 'Cuenta', () => null).lineas : undefined
      const r = await guardarCambiosRecibida(fac, cambiosParaLaBase(bb, campos as (keyof BorradorFicha)[], { previa: prev, comun: '', retencionTipoId: b.retencion && original.retencion && b.retencion.tipo === original.retencion.tipo ? ficha?.retencionId ?? null : null }),
        { quien: userName, nombres: { proveedor: nombreProveedor(b.proveedorId) }, localPropuesto: localPropuesto ?? null })
      if (r.fallos.length) return `No se ha guardado: ${r.fallos.map((x) => `${x.etiqueta}, ${x.porque.replace(/\.$/, '')}`).join(' · ')}.`
      if (!r.conTanda) return 'No se ha guardado: la base aún no tiene la función que guarda la ficha (0790).'
      if (r.texto) partes.push(r.texto)
    }
    if (!fichero && ed.cambios.some((c) => c.campo === 'sinPdf' || c.campo === 'motivoSinPdf')) {
      if (b.sinPdf && !b.motivoSinPdf.trim()) return 'No se ha guardado «Sin documento»: di por qué no tiene documento.'
      const x = await sinPapelRecibida(fac.id, b.sinPdf, b.motivoSinPdf, userName)
      if (!x.hecho) return `No se ha guardado «Sin documento»: ${x.texto}`
      partes.push(x.texto)
    }
    if (fichero) {
      const x = await ponerPapelRecibida(fac, fichero.file, userName)
      if (!x.hecho) return `No se ha guardado el documento: ${x.texto}`
      partes.push(x.texto); setFichero(null)
    }
    if (partes.length) { ed.reiniciar(b); setVuelta((v) => v + 1) }
    return true
  }

  async function guardarYSiguiente() {
    if (guardando) return
    setGuardando(true); setAviso(null)
    try {
      if (aMano) { await guardarNueva(); return }
      if (!fac) return
      const g = await guardarCambios()
      if (g !== true) { setAviso({ tono: 'mal', texto: g }); return }
      // K04b · Sin proveedor no se valida: se dice, y no se pasa.
      if (!b.proveedorId && !fac.proveedor?.id) {
        setAviso({ tono: 'falta', texto: `${ed.hay ? 'Guardada, sin validar' : 'Sin validar'}: no conozco al que la emite${emisor?.nombre ? ` (${emisor.nombre})` : ''}. Dalo de alta o elige uno que ya tengas. No paso a la siguiente.` }); return
      }
      const a = await leerAntesDelInicio(fac.id).catch(() => null)
      if (a?.preguntar || a?.traida || a?.respuesta === 'ya_estaba') {
        setAviso({ tono: 'falta', texto: 'Guardada. Es de antes del día de inicio de Sumied: contesta si ya estaba contabilizada en «Más › La ficha completa». No paso a la siguiente.' }); return
      }
      const fresca = await leerFactura(fac.id)
      const faltaDoc = faltaDocumento({ tieneDocumento: !!(fresca.llegada || fresca.papel || ficha?.lectura?.ruta || fichero), sinPdf: b.sinPdf, fuente: ficha?.fuente ?? null })
      if (faltaDoc) { setAviso({ tono: 'falta', texto: `Guardada, sin validar: ${faltaDoc} No paso a la siguiente.` }); setVuelta((v) => v + 1); return }
      const r = await apuntarFactura(fresca, userName, userId, localPropuesto ?? null)
      refrescarCuentasMenu()
      if (!r.validado) { setAviso({ tono: 'falta', texto: `Guardada, sin validar: ${r.texto.replace(/^Apuntada y validada\.\s*/, '')} No paso a la siguiente.` }); setVuelta((v) => v + 1); return }
      const pago = await elPago(fac.id, fac.company_id ?? empresa ?? '')
      const texto = `${r.texto} ${pago}${siguiente ? '' : ' No quedan más por revisar en esta lista.'}`
      if (siguiente) { ir(siguiente, texto); return }
      setAviso({ tono: 'ok', texto }); setVuelta((v) => v + 1)
    } catch (e) {
      setAviso({ tono: 'mal', texto: `No se ha podido: ${e instanceof Error ? e.message.replace(/\.$/, '') : String(e)}. No paso a la siguiente.` })
    } finally { setGuardando(false) }
  }

  /** La escrita a mano: se da de alta como la de hoy (guardarRecibidaAMano), se valida y se abre la siguiente nueva. */
  async function guardarNueva() {
    const c = comprobarAMano(b, tiposIva, hoy, !!ejeLocal, LOCAL_COMUN)
    if (!c.datos) {
      const faltan = Object.values(c.errores).filter(Boolean)
      setAviso({ tono: 'falta', texto: `No se ha guardado: ${faltan.map((x) => String(x).replace(/\.$/, '')).join(' · ') || 'falta algún dato'}.` }); return
    }
    if (!accountId || !activa) { setAviso({ tono: 'mal', texto: 'No se ha guardado: no sé de qué empresa es. Elige la empresa arriba.' }); return }
    const nombre = nombreProveedor(b.proveedorId)
    const r = await guardarRecibidaAMano({ accountId, companyId: activa.id, userId, userName, proveedor: nombre, datos: c.datos, papel: fichero?.file ?? null })
    const dicho: string[] = [`Guardada la ${c.datos.numero} de ${nombre.replace(/\.$/, '')}.`, ...r.ademas]
    // Lo mismo que «Nueva recibida a mano» de hoy: después de darla de alta, la forma de pago, la retención y el recargo (0790).
    const campos = [...(b.formaPago ? ['formaPago'] : []), ...(b.retencion ? ['retencion'] : []), ...(b.recargo ? ['recargo'] : [])]
    const nueva = { id: r.id, account_id: accountId, company_id: activa.id, estado: 'en_revision', fecha: c.datos.fecha }
    if (campos.length) {
      const g = await guardarCambiosRecibida(nueva, cambiosParaLaBase(b, campos, { comun: LOCAL_COMUN }), { quien: userName, nombres: {} })
      for (const x of g.fallos) dicho.push(`${x.etiqueta}: no se ha guardado (${x.porque.replace(/\.$/, '')}).`)
    }
    if (b.sinPdf && !fichero) {
      const x = await sinPapelRecibida(r.id, true, b.motivoSinPdf || 'Escrita a mano, sin documento', userName)
      if (!x.hecho) dicho.push(`«Sin documento»: no se ha guardado (${x.texto.replace(/\.$/, '')}).`)
    }
    const conPapel = !!fichero
    setFichero(null)
    refrescarCuentasMenu()
    const falta = faltaDocumento({ tieneDocumento: conPapel, sinPdf: b.sinPdf, fuente: 'manual' })
    if (falta) { navegar(`${rutaRevisarFactura(r.id)}?ver=por-revisar`, { state: { aviso: `${dicho.join(' ')} Sin validar: ${falta}` } }); return }
    const fresca = await leerFactura(r.id)
    const v = await apuntarFactura(fresca, userName, userId, null)
    if (!v.validado) {
      navegar(`${rutaRevisarFactura(r.id)}?ver=por-revisar`, { state: { aviso: `${dicho.join(' ')} Sin validar: ${v.texto}` } }); return
    }
    const pago = await elPago(r.id, activa.id)
    ed.reiniciar(vacioAMano(hoy))
    setAviso({ tono: 'ok', texto: `${dicho.join(' ')} ${v.texto} ${pago} Escribe la siguiente.` })
    focoPuesto.current = ''; tocada.current = ''
    setTimeout(() => document.getElementById('kf-proveedor')?.focus(), 0)
  }

  /** K04b · Elige el proveedor y lo guarda ya en la factura (solo ese campo), como «elegirYGuardar» de la ficha de hoy. */
  async function elegirYGuardar(pid: string, nombre: string, texto: string) {
    if (!fac) return
    ed.poner('proveedorId', pid)
    setTextoProv(null)
    try {
      const r = await guardarCambiosRecibida(fac, cambiosParaLaBase({ ...original, proveedorId: pid }, ['proveedorId']),
        { quien: userName, nombres: { proveedor: nombre }, localPropuesto: localPropuesto ?? null })
      if (r.fallos.length) setAviso({ tono: 'falta', texto: `${texto} No se ha guardado en la factura (${r.fallos.map((x) => x.porque.replace(/\.$/, '')).join(' · ')}): pulsa Intro para guardarla.` })
      else setAviso({ tono: 'ok', texto: `${texto} Guardado en la factura: ya se puede validar.` })
    } catch (e) {
      setAviso({ tono: 'falta', texto: `${texto} No se ha guardado en la factura (${e instanceof Error ? e.message.replace(/\.$/, '') : String(e)}): pulsa Intro para guardarla.` })
    }
    ed.reiniciar({ ...b, proveedorId: pid })
    setVueltaProv((v) => v + 1); setVuelta((v) => v + 1)
  }

  const salida = useAvisoSalir({ hay: ed.hay, cambios: ed.cambios, donde: prov ? `${prov.nombre}${b.numero ? ` ${b.numero}` : ''}` : 'la factura nueva',
    onGuardar: async () => { const g = await guardarCambios(); return g === true ? true : g }, onDescartar: ed.descartar })

  // ── El teclado: Intro (decisiones 11 y 12), las flechas de la cola y Esc ──
  const raiz = useRef<HTMLDivElement>(null)
  const alPulsar = (e: KE<HTMLDivElement>) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing) return
    const t = e.target as HTMLElement
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const lista = casillasDe(raiz.current)
      const sobre = t.closest('button, a, summary') ? 'boton' : t.closest('textarea') ? 'texto' : null
      const que = queHaceIntro({ orden: lista.length, actual: lista.indexOf(t), sobre })
      if (!que) return
      e.preventDefault()
      if (que.que === 'siguiente') { const s = lista[que.a]; s.focus(); if (s instanceof HTMLInputElement) s.select() }
      else void guardarYSiguiente()
    } else if (e.key === 'Escape' && !t.closest('[role="dialog"]')) {
      // Sin parar la pulsación, llega a window cuando la ventana de «cambios sin guardar» ya está puesta (React la pinta
      // dentro de este mismo Esc) y su Esc la cierra al momento: con cambios, Esc no hacía nada (e2e 44479781525 del K05;
      // reproducido en Chromium con React 19.2.5: sin parar, 0 ventanas; parando, 1).
      e.preventDefault(); e.stopPropagation()
      if (pestana?.cerrar) pestana.cerrar(); else salida.pedirSalir(() => navegar(rutaDocumentos('por-revisar')))
    }
  }
  // Intro y Esc fuera de la ficha (nada con el foco, o la zona): «Guardar y siguiente» y dejarla sin guardar.
  useEffect(() => {
    const fuera = (e: KeyboardEvent) => {
      if (!seVe() || (e.key !== 'Enter' && e.key !== 'Escape') || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return
      const t = e.target as HTMLElement | null
      if (t && (raiz.current?.contains(t) || t.closest('input, textarea, select, button, a, [role="dialog"], [contenteditable="true"]'))) return
      e.preventDefault()
      if (e.key === 'Enter') void guardarYSiguiente()
      else if (pestana?.cerrar) pestana.cerrar()
    }
    window.addEventListener('keydown', fuera)
    return () => window.removeEventListener('keydown', fuera)
  })

  // El foco, donde hay que mirar (dondeVaElFoco): en la duda si la hay (Intro la contesta, otro Intro guarda); en la
  // nueva, el proveedor. Se vuelve a mirar cada vez que la ficha termina de pintarse o aparece la duda (la duda puede
  // llegar antes que la ficha), una vez por factura, y nunca encima de lo que alguien ya ha empezado a escribir en ella.
  const claveFicha = aMano ? 'nueva' : invoiceId
  const pintada = aMano ? proveedoresL !== null : (!!fac && !!ficha)
  const focoPuesto = useRef('')
  const tocada = useRef('')
  // Quien empieza a escribir o pulsa en esta factura ya ha elegido dónde está: el foco no se le mueve.
  const marcarTocada = () => { if (pintada) tocada.current = claveFicha }
  useEffect(() => {
    if (!seVe()) return
    const donde = dondeVaElFoco({ pintada, yaPuesto: focoPuesto.current === claveFicha, tocada: tocada.current === claveFicha, aMano, hayDuda: !!duda || !!emisor })
    if (!donde) return
    const x = raiz.current?.querySelector<HTMLElement>(donde === 'proveedor' ? '#kf-proveedor' : '.kf-duda .kf-boton-ambar')
    if (!x) return
    x.focus()
    focoPuesto.current = claveFicha
  }, [claveFicha, pintada, aMano, duda, emisor, seVe])

  // ── Lo que no es de esta ficha: la de hoy, dentro de la pestaña ──
  const validada = !!fac?.asiento && fac.asiento.estado === 'validado'
  const descartada = fac?.estado === 'descartada'
  if (!aMano && (completa || (fac && (esAbono(fac) || validada || descartada)))) {
    return <>{completa && <p className="kf-aviso" data-tono="ok"><button type="button" className="kf-enlace" onClick={() => setCompleta(false)}>‹ Volver a la ficha nueva</button></p>}<RevisarFacturaPage /></>
  }
  if (!aMano && f.error) return <div className="kf-ficha"><p className="kf-aviso" data-tono="mal">No se ha podido abrir la factura: {f.error}</p></div>
  const cargando = !aMano && (!fac || !ficha)

  // ── Lo que se pinta ──
  const ponerIva = (i: number, c: Partial<LineaIva>, rehacer = true) => {
    const iva = b.iva.map((l, j) => (j === i ? (rehacer ? rehacerCuota({ ...l, ...c }) : { ...l, ...c }) : l))
    ed.poner('iva', iva)
    const base = iva.reduce((t, l) => t + (num(l.base) ?? 0), 0)
    if (b.retencion) ed.poner('retencion', rehacerRetencion(b.retencion, base))
  }
  const ponerGasto = (i: number, c: Partial<BorradorFicha['gastos'][number]>) => ed.poner('gastos', b.gastos.map((g, j) => (j === i ? { ...g, ...c } : g)))
  const subcuenta = delProv?.subcuenta?.codigo ?? ''
  const conEstaFactura = mayor ? mayor.saldo + (validada ? 0 : totales.total) : null
  const cola = !aMano && pos >= 0 ? `${pos + 1} de ${ids.length} por revisar` : aMano ? 'Nueva' : ''
  const etiqueta = previa ? etiquetaDelAsiento({ debe: previa.debe, haber: previa.haber, cuadra: previa.cuadra, faltan: previa.faltan, lineas: previa.lineas.length }) : { texto: 'Se forma al escribir', tono: 'vacio' as const }
  const documento = aMano
    ? (fichero ? { url: fichero.url, foto: !/pdf/i.test(fichero.file.type), titulo: fichero.file.name } : null)
    : fichero ? { url: fichero.url, foto: !/pdf/i.test(fichero.file.type), titulo: fichero.file.name }
    : papel.datos ? (papel.datos.url ? { url: papel.datos.url, foto: /^image\//i.test(fac?.llegada?.tipo ?? '') || /\.(jpe?g|png)$/i.test(fac?.llegada?.archivo ?? fac?.papel ?? ''), titulo: `El documento de la ${fac?.numero ?? 'factura'}` } : null) : undefined
  const puede = puedeGuardar({ guardando, validada, descartada })
  const conceptoTexto = propuesta?.concepto ?? (prov ? `${b.numero || 'Factura'}-${prov.nombre}` : '')

  return (
    <div className="kf-ficha" ref={raiz} onKeyDown={(e) => { marcarTocada(); alPulsar(e) }} onPointerDown={marcarTocada} data-prueba="ficha-recibida-nucleo" aria-busy={cargando || undefined}>
      <header className="kf-cabecera">
        <h1>Factura recibida</h1>
        <span className="kf-cola">{cola}</span>
        {!cargando && <EstadoFicha {...estado} />}
        <div className="kf-cabecera-botones">
          {!aMano && <>
            <button type="button" className="kf-flecha" aria-label="La anterior" disabled={!anterior} onClick={() => anterior && salida.pedirSalir(() => ir(anterior))}>‹</button>
            <button type="button" className="kf-flecha" aria-label="La siguiente" disabled={!siguiente} onClick={() => siguiente && salida.pedirSalir(() => ir(siguiente))}>›</button>
          </>}
          <Mas aMano={aMano} abrirCompleta={() => setCompleta(true)} />
          <button type="button" className="kf-guardar" data-guardar-y-siguiente disabled={!puede || cargando} onClick={() => void guardarYSiguiente()}>
            {guardando ? 'Guardando…' : 'Guardar y siguiente'} <kbd>Intro</kbd>
          </button>
        </div>
      </header>
      {aviso && <p className="kf-aviso" data-tono={aviso.tono} role="status" data-prueba="aviso-ficha">{aviso.texto}</p>}
      {salida.aviso}
      <div className="kf-cuerpo">
        <div className="kf-izquierda">
        <div className="kf-formulario">
          {cargando ? <p className="kf-panel-nota" aria-busy="true">Abriendo la factura…</p> : <>
            <div className="kf-fila" style={{ gridTemplateColumns: '1.1fr 1.1fr 2.9fr 1.7fr' }}>
              <Casilla rotulo="Proveedor" origen={origen.proveedor} htmlFor="kf-proveedor" duda={!!emisor}>
                <Buscador id="kf-proveedor" etiqueta="Proveedor" cargando={proveedoresL === null} enfocar={abrirProveedor} duda={!!emisor} valor={textoProv ?? (provId ? subcuenta || prov?.nombre || '' : '')} cuenta={subcuenta || null}
                  placeholder={aMano ? 'Código, nombre o NIF' : undefined}
                  ponerTexto={setTextoProv} lista={(t) => { const q = t.toLowerCase(); return proveedores.filter((p) => !q || p.nombre.toLowerCase().includes(q) || (p.nif ?? '').toLowerCase().includes(q)) }}
                  texto={(p) => `${p.nombre}${p.nif ? ` · ${p.nif}` : ''}`} elegir={(p) => { if (emisor) void elegirYGuardar(p.id, p.nombre, `Elegido ${p.nombre}.`); else { ed.poner('proveedorId', p.id); setTextoProv(null) } }} />
              </Casilla>
              <Casilla rotulo="N.I.F." origen={origen.nif} htmlFor="kf-nif"><input id="kf-nif" readOnly tabIndex={-1} value={prov?.nif ?? emisor?.nif ?? ''} /></Casilla>
              <Casilla rotulo="Nombre" origen={origen.nombre} htmlFor="kf-nombre"><input id="kf-nombre" readOnly tabIndex={-1} value={prov?.nombre ?? emisor?.nombre ?? ''} title={prov?.nombre ?? emisor?.nombre ?? undefined} /></Casilla>
              <Casilla rotulo="Tipo de operación" origen={origen.tipoOperacion} htmlFor="kf-operacion"><input id="kf-operacion" readOnly tabIndex={-1} value={textoOperacion(delProv?.regimen ?? null) ?? ''} /></Casilla>
            </div>
            {emisor?.que === 'alta' && altaAbierta !== invoiceId && (
              <Duda texto={`No conozco al que la emite${emisor.nombre ? `: ${emisor.nombre}` : ''}${emisor.nif ? ` · NIF ${emisor.nif}` : ''}. Hasta que tenga proveedor no se valida.`}
                principal={{ texto: 'Darlo de alta', hacer: () => setAltaAbierta(invoiceId) }}
                secundario={{ texto: 'Es uno que ya tengo', hacer: () => setAbrirProveedor((n) => n + 1) }} />
            )}
            {emisor?.que === 'alta' && altaAbierta === invoiceId && accountId && fac && (
              <AltaDesdeFactura accountId={accountId} otros={proveedores.map((p) => ({ name: p.nombre, taxId: p.nif }))}
                leido={{ nombre: emisor.nombre, nif: emisor.nif, direccion: leido?.proveedor.direccion ?? null, correo: leido?.proveedor.email ?? null, telefono: leido?.proveedor.telefono ?? null, web: leido?.proveedor.web ?? null }}
                factura={{ id: fac.id, numero: fac.numero ?? null }} alCancelar={() => setAltaAbierta(null)}
                alCrear={(p) => { setAltaAbierta(null); void elegirYGuardar(p.id, p.name, fraseAltaEnFactura(p.name)) }} />
            )}
            {emisor?.que === 'es_uno_tuyo' && (
              <Duda texto={`El NIF de la factura${emisor.nif ? ` (${emisor.nif})` : ''} es el de ${emisor.nombre}.`}
                principal={{ texto: `Es ${emisor.nombre}: elegirlo`, hacer: () => void elegirYGuardar(emisor.proveedorId, emisor.nombre, `Elegido ${emisor.nombre}: el NIF de la factura es el suyo.`) }}
                secundario={{ texto: 'Es uno que ya tengo', hacer: () => setAbrirProveedor((n) => n + 1) }} />
            )}
            <div className="kf-fila" style={{ gridTemplateColumns: '1.7fr 1.1fr 1.1fr 1.1fr 1.7fr' }}>
              <Casilla rotulo="N.º de factura" origen={origen.numero} htmlFor="kf-numero"><input id="kf-numero" data-casilla value={b.numero} onChange={(e) => ed.poner('numero', e.target.value)} /></Casilla>
              <Casilla rotulo="Fecha factura" origen={origen.fecha} htmlFor="kf-fecha"><CasillaFecha id="kf-fecha" etiqueta="Fecha factura" iso={b.fecha} hoy={hoy} poner={(x) => ed.poner('fecha', x)} /></Casilla>
              <Casilla rotulo="Se deduce en" htmlFor="kf-deduce"><input id="kf-deduce" readOnly tabIndex={-1} value={trimestreDe(b.fecha)} /></Casilla>
              <Casilla rotulo="Serie / documento" htmlFor="kf-serie"><input id="kf-serie" readOnly tabIndex={-1} value={fac?.asiento?.numero ? `2 / ${fac.asiento.numero}` : '2 / —'} /></Casilla>
              <Casilla rotulo="Concepto del asiento" origen={origen.concepto} htmlFor="kf-concepto"><input id="kf-concepto" readOnly tabIndex={-1} value={conceptoTexto} title={conceptoTexto} /></Casilla>
            </div>
            {!aMano && (
              <div className="kf-saldo" data-prueba="saldo-proveedor">
                Saldo del proveedor a hoy <strong>{mayor ? cifra(mayor.saldo) : '—'}</strong>
                · con esta factura <strong>{conEstaFactura !== null ? cifra(conEstaFactura) : '—'}</strong>
                {provId && <Link className="kf-enlace" to={`/conta/proveedores/${provId}`}>Ficha del proveedor</Link>}
              </div>
            )}
            <Comprobaciones lista={comprobaciones} nota={aMano ? 'Al escribir se comprueba que no esté repetida, el periodo y el NIF' : null} />

            <div className="kf-importes">
              <div className="kf-bloque">
                <table className="kf-iva">
                  <colgroup><col className="kf-col-base" /><col className="kf-col-tipo" /><col /><col className="kf-iva-quitar" /></colgroup>
                  <thead><tr>
                    <th><span className="kf-iva-cabeza"><span className="kf-titulo">IVA <button type="button" className="kf-enlace-plano" onClick={() => ed.poner('iva', [...b.iva, { base: '', tipo: String(tiposIva.find((t) => !b.iva.some((l) => l.tipo === String(t))) ?? 21), cuota: '' }])}>+ Otro tipo</button></span><span>Base</span></span></th>
                    <th>%</th><th>Cuota</th><th />
                  </tr></thead>
                  <tbody>
                    {b.iva.map((l, i) => (
                      <tr key={i}>
                        <td><input className="kf-cifra" data-casilla aria-label={`Base ${i + 1}`} value={l.base} onChange={(e) => ponerIva(i, { base: e.target.value })} onBlur={() => { const n = num(l.base); if (n !== null) ponerIva(i, { base: importeEs(n) }) }} /></td>
                        <td><select data-casilla aria-label={`Tipo de IVA ${i + 1}`} className="kf-cifra" value={l.tipo} onChange={(e) => ponerIva(i, { tipo: e.target.value })}>
                          {[...new Set([...tiposIva.map(String), l.tipo])].filter(Boolean).map((t) => <option key={t} value={t}>{t}</option>)}
                        </select></td>
                        <td><input className="kf-cifra" aria-label={`Cuota ${i + 1}`} value={l.cuota} tabIndex={-1} onChange={(e) => ponerIva(i, { cuota: e.target.value }, false)} /></td>
                        <td>{b.iva.length > 1 && <button type="button" className="kf-quitar" aria-label={`Quitar el tipo ${l.tipo} %`} tabIndex={-1} onClick={() => ed.poner('iva', b.iva.filter((_, j) => j !== i))}>×</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="kf-total">
                <div className="kf-total-arriba">
                  <span>Total factura</span>
                  {aMano
                    ? <input className="kf-total-cifra" data-casilla aria-label="Total factura" placeholder="0,00"
                        value={textoTotal ?? (totales.total ? importeEs(totales.total) : '')}
                        onFocus={(e) => { setTextoTotal(totales.total ? importeEs(totales.total) : ''); e.target.select() }}
                        onChange={(e) => setTextoTotal(e.target.value)}
                        onBlur={() => {
                          const n = textoTotal !== null ? num(textoTotal) : null
                          // Solo si se ha escrito otro total: sale la base (desdeElTotal); si no, lo que suman las bases.
                          if (n !== null && Math.round(n * 100) !== Math.round(totales.total * 100)) { const r = desdeElTotal(b, n); if (r) { ed.poner('iva', r.iva); ed.poner('retencion', r.retencion) } }
                          setTextoTotal(null)
                        }} />
                    : <span className="kf-total-cifra" data-prueba="total">{cifra(totales.total)}</span>}
                </div>
                {aMano && <span className="kf-total-ayuda">Escríbelo y sale la base</span>}
                <label className="kf-total-retencion">Retención
                  <select data-casilla value={b.retencion?.tipo ?? ''} onChange={(e) => ed.poner('retencion', e.target.value ? rehacerRetencion({ tipo: e.target.value, importe: '' }, totales.base) : null)}>
                    <option value="">Sin retención</option>
                    {TIPOS_RETENCION.map((t) => <option key={t} value={String(t)}>{t} % · {b.retencion?.tipo === String(t) ? b.retencion.importe : cifra(Math.round(totales.base * t) / 100)}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div className="kf-dos">
              <div className="kf-bloque">
                <h2 className="kf-titulo">A qué cuenta de gasto va
                  <span className="kf-titulo-derecha">
                    <button type="button" className="kf-enlace-plano" onClick={() => ed.poner('gastos', [...b.gastos, { cuenta: '', local: b.gastos[0]?.local ?? '', importe: '' }])}>+ Otra cuenta</button>
                    <button type="button" className="kf-enlace-plano" onClick={() => ed.poner('gastos', [...b.gastos, { cuenta: b.gastos[0]?.cuenta ?? '', local: '', importe: '' }])}>+ Repartir</button>
                  </span>
                </h2>
                {b.gastos.map((g, i) => (
                  <div className="kf-gasto" key={i} data-una={b.gastos.length === 1 ? 'si' : undefined}>
                    <Buscador id={`kf-cuenta-${i}`} etiqueta={`Cuenta de gasto ${i + 1}`} cargando={cuentasGastoL === null} valor={textoCuenta[i] ?? g.cuenta} cuenta={g.cuenta || null} duda={!!duda && i === 0}
                      ponerTexto={(t) => setTextoCuenta((x) => ({ ...x, [i]: t }))} lista={(t) => cuentasQueEncajan(t, cuentasPlan, 8)}
                      texto={(c) => `${c.codigo} · ${c.nombre}`} elegir={(c) => { ponerGasto(i, { cuenta: c.codigo }); setTextoCuenta((x) => { const y = { ...x }; delete y[i]; return y }) }} />
                    <input readOnly tabIndex={-1} aria-label={`Nombre de la cuenta ${i + 1}`} value={g.cuenta ? nombreGasto(g.cuenta) : ''} data-duda={duda && i === 0 ? 'si' : undefined} />
                    <input className="kf-cifra" data-casilla={b.gastos.length > 1 ? '' : undefined} aria-label={`Importe del gasto ${i + 1}`} placeholder={i === b.gastos.length - 1 ? importeEs(totales.base) : ''}
                      value={g.importe || (b.gastos.length === 1 ? importeEs(totales.base + (totales.recargo ?? 0)) : '')} readOnly={b.gastos.length === 1}
                      tabIndex={b.gastos.length === 1 ? -1 : 0} onChange={(e) => ponerGasto(i, { importe: e.target.value })} />
                    {b.gastos.length > 1 ? <button type="button" className="kf-quitar" aria-label={`Quitar la cuenta ${i + 1}`} tabIndex={-1} onClick={() => ed.poner('gastos', b.gastos.filter((_, j) => j !== i))}>×</button> : <span />}
                  </div>
                ))}
                {aMano && <p className="kf-gasto-ayuda">Escribe 6001 y sale 60000001. También vale 600.1, o parte del nombre.</p>}
                <div className="kf-pareja">
                  <select aria-label="Local" data-casilla={ejeLocal ? '' : undefined} disabled={!ejeLocal} value={b.gastos[0]?.local ?? ''} onChange={(e) => ponerGasto(0, { local: e.target.value })}>
                    {aMano && ejeLocal && <option value="">Elige el local</option>}
                    <option value={aMano && ejeLocal ? LOCAL_COMUN : ''}>{ejeLocal ? 'Común a todos los locales' : 'Sin locales'}</option>
                    {locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}{l.id === localPropuesto ? ' (su ficha)' : ''}</option>)}
                  </select>
                  <select aria-label="Marca" disabled title="La marca de la factura no se cambia desde aquí: la base aún no la guarda (conta_recibida_guardar)." value="">
                    <option value="">{marca ? `${marca} (de la factura)` : 'Sin repartir por marca'}</option>
                  </select>
                </div>
              </div>
              <div className="kf-bloque">
                {/* K06 · «Cómo se paga» (Julio, 19/11): la cuenta del pago con su nombre, como «Cómo se cobra» en la emitida. Vacía
                    quiere decir pendiente de pagar. Debajo, con su rótulo, cuándo vence, el día del pago y lo que se paga. */}
                <h2 className="kf-titulo">Cómo se paga
                  {origenPago && <span className="kf-titulo-derecha kf-origen" data-prueba="origen-pago">{origenPago}</span>}
                </h2>
                <div className="kf-cobro">
                  <Buscador id="kf-pago" etiqueta="La cuenta del pago" cargando={!cuentasPago} valor={textoPago ?? pagoCuenta} cuenta={pagoCuenta || null} duda={!!dudaPago}
                    ponerTexto={(t) => { setTextoPago(t); if (!t.trim()) ed.poner('pagoCuenta', '') }} lista={(t) => cuentasQueEncajan(t, cuentasPago?.lista ?? [], 8)}
                    texto={(c) => `${c.codigo} · ${c.nombre}`} elegir={(c) => { ed.poner('pagoCuenta', c.codigo); setTextoPago(null) }} />
                  <input readOnly tabIndex={-1} aria-label="Nombre de la cuenta del pago" value={nombrePago} title={nombrePago || undefined} placeholder="Pendiente de pagar" data-duda={dudaPago ? 'si' : undefined} />
                </div>
                <div className="kf-pago-fechas">
                  <label className="kf-rotulo-chico">Vence<CasillaFecha id="kf-vence" etiqueta="Vence" iso={b.vence} hoy={hoy} poner={(x) => ed.poner('vence', x)} /></label>
                  <label className="kf-rotulo-chico">Fecha del pago<CasillaFecha id="kf-pago-fecha" etiqueta="La fecha del pago" iso={pagoCuenta ? pagoFecha : ''} hoy={hoy} poner={(x) => ed.poner('pagoFecha', x)} /></label>
                  <label className="kf-rotulo-chico">Importe<input className="kf-cifra" readOnly tabIndex={-1} aria-label="Importe del pago" value={cifra(importePago)} /></label>
                </div>
              </div>
            </div>

            {duda && (
              <Duda texto={duda.texto}
                principal={{ texto: `Dejar ${duda.dejar.cuenta}`, hacer: () => { ponerGasto(0, { cuenta: duda.dejar.cuenta }); setDecidida(`${invoiceId}:${provId}`) } }}
                secundario={{ texto: `Cambiar a ${duda.cambiar.cuenta}`, hacer: () => { ponerGasto(0, { cuenta: duda.cambiar.cuenta }); setDecidida(`${invoiceId}:${provId}`) } }} />
            )}

            {dudaPago && (
              <Duda texto={textoDudaPago(dudaPago, (c) => cuentasPago?.nombres.get(c) ?? '').texto}
                principal={{ texto: `Dejar ${dudaPago.cuentas[0]}`, hacer: () => ed.poner('pagoCuenta', dudaPago.cuentas[0]) }}
                secundario={{ texto: `Cambiar a ${dudaPago.cuentas[1]}`, hacer: () => ed.poner('pagoCuenta', dudaPago.cuentas[1]) }} />
            )}

            <AsientoQueSale lineas={previa && totales.total !== 0 ? previa.lineas : []} etiqueta={etiqueta}
              editar={!aMano && id ? { texto: 'Editar el asiento', hacer: () => setCompleta(true) } : null} />
          </>}
        </div>
        <AyudaTeclas />
        </div>
        <PanelDocumento documento={documento} acepta={ACEPTA_PAPEL} raya={{ usuario: userId }}
          sinDocumento={{ marcado: b.sinPdf, motivo: b.motivoSinPdf, poner: (m, motivo) => { ed.poner('sinPdf', m); ed.poner('motivoSinPdf', m ? motivo : '') } }}
          alElegir={(file) => { setFichero({ file, url: URL.createObjectURL(file) }); ed.poner('documento', file.name) }}
          otra={{ nombre: 'El mayor del proveedor', contenido: <MayorDelProveedor apuntes={mayor?.apuntes ?? null} subcuenta={subcuenta} hay={!!provId} /> }} />
      </div>
    </div>
  )
}

function Mas({ aMano, abrirCompleta }: { aMano: boolean; abrirCompleta: () => void }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <div className="kf-mas">
      <button type="button" className="kf-boton-hueco" aria-expanded={abierto} onClick={() => setAbierto((x) => !x)}>Más</button>
      {abierto && (
        <ul className="kf-mas-menu" onMouseLeave={() => setAbierto(false)}>
          {!aMano && <li><button type="button" onClick={() => { setAbierto(false); abrirCompleta() }}>La ficha completa (abono, alta del proveedor, historial, descartar…)</button></li>}
          <li><Link to={rutaDocumentos('por-revisar')}>Volver a la lista de por revisar</Link></li>
        </ul>
      )}
    </div>
  )
}

function MayorDelProveedor({ apuntes, subcuenta, hay }: { apuntes: { fecha: string; documento: string; concepto: string; debe: number; haber: number }[] | null; subcuenta: string; hay: boolean }) {
  if (!hay) return <p className="kf-panel-nota">Elige el proveedor y sale su mayor.</p>
  if (!apuntes) return <p className="kf-panel-nota" aria-busy="true">Leyendo su mayor…</p>
  if (!apuntes.length) return <p className="kf-panel-nota">La {subcuenta || 'subcuenta del proveedor'} no tiene apuntes todavía.</p>
  const ultimos = apuntes.slice(-30).reverse()
  return (
    <>
      <table className="kf-mayor" aria-label={`El mayor de la ${subcuenta}`}>
        <thead><tr><th>Fecha</th><th>Documento</th><th>Concepto</th><th className="kf-cifra">Debe</th><th className="kf-cifra">Haber</th></tr></thead>
        <tbody>{ultimos.map((a, i) => <tr key={i}><td>{a.fecha.slice(8, 10)}/{a.fecha.slice(5, 7)}/{a.fecha.slice(0, 4)}</td><td>{a.documento}</td><td>{a.concepto}</td><td className="kf-cifra">{a.debe ? cifra(a.debe) : ''}</td><td className="kf-cifra">{a.haber ? cifra(a.haber) : ''}</td></tr>)}</tbody>
      </table>
      {subcuenta && <p className="kf-panel-nota"><Link to={rutaMayor(subcuenta)}>Ver el mayor entero de la {subcuenta}</Link></p>}
    </>
  )
}
