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
// completa»): los abonos, la comisión de una plataforma, el IBAN, pagar y
// descartar.
//
// K07 · Una factura, una sola ficha (Julio, 20/11): la validada y la descartada
// se abren aquí también, la misma pantalla con las casillas sin poder escribir,
// la franja «Contabilizada · asiento N» (o «Descartada») y el asiento validado
// con su número. «Cambiar el documento» en el panel (en una contabilizada,
// confirmando: conta_recibida_documento_cambiar, 2004), el historial en «Más»,
// y ‹ vuelve a la que se acaba de validar. Los abonos siguen en la de hoy.
//
// K04b · El emisor que no se reconoce: la franja dice «Mira esto · No conozco
// al que la emite», el NIF y el nombre leídos quedan en sus casillas («PDF») y
// debajo, en ámbar, «Darlo de alta» (AltaDesdeFactura, la de la ficha de hoy)
// y «Es uno que ya tengo» (el foco al proveedor, con su lista abierta). Hasta
// que tenga proveedor no se valida, y si se intenta, lo dice.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as KE, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { rutaDocumentos, rutaFichaProveedor, rutaMayor, rutaRecibidaAMano, rutaRevisarFactura } from '@/config/navegacion'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { useAnalitica, useHosteleria } from '@/modules/conta/marco/nuevo/contexto'
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
  apuntarFactura, guardarCambiosRecibida, leerExtrasFacturas, leerFactura, leerFichaRecibida, plazoDeLaFicha, ponerPapelRecibida,
  proveedoresDeLaCuenta, urlDelPapel, verPropuestaFactura, leerAntesDelInicio, sinPapelRecibida, leerDescarte, recuperarFactura,
} from '@/modules/conta/services/documentosService'
import { leerAsiento, localesDeLaCuenta } from '@/modules/conta/services/diarioService'
import { guardarRecibidaAMano, tiposDeIvaRecibida } from '@/modules/conta/services/recibidaAManoService'
import { refrescarCuentasMenu } from '@/modules/conta/marco/useCuentasMenu'
import { CasillaFecha, Duda, EstadoFicha, NombreDeCuenta } from '../ficha/piezas'
import { Barra, BotonMas, Casilla as KCasilla, OtrosDatos, Ventana } from '../piezas/Ventana'
import { CasillaLupa } from '../piezas/Lupa'
import { CasillaImporte } from '../piezas/Importe'
import { MOTIVO_IMPORTE_DUDOSO, importeDudoso, leerImporte } from '../piezas/logica'
import { aVisual, cambioDeLinea, conIvaDeducible, filasDePago, otroPago, pagoPorHacer, rotuloDeLaSuma, sumaDeContrapartidas } from './fichaErp10'
import { cuadreDeTramos, filasDeIva } from './k13'
import { apuntarUnPago, borrarPago, cambiarPago, leerPagos, sePuedeCambiarPago } from './pagosServicio'
import { plataformasDeLaCuenta } from '@/modules/conta/services/asientoGeneralService'
import './fichaErp10.css'
import './ficha17b.css'
import { accionDocumento, etiquetaValidado, franjaContabilizada, franjaDescartada, claveSePuedeModificar, franjaModificando, lineasQueCambian, porqueNoModificar, laAnterior, lineasDelHistorial, opcionesDeMas, textoCasillaProveedor, queFichaSeAbre, textoCambioAlGuardar, type ModoRecibida, type OpcionMas } from './contabilizada'
import { cambiarDocumentoContabilizada, leerHistorial, salioAErp10 } from './documentoServicio'
import { PanelDocumento } from '../ficha/PanelDocumento'
import { cifra } from '../ficha/textos'
import { useUltimo } from '../ficha/useUltimo'
import { modificarRecibida, sePuedeModificar } from './modificarServicio'
import { ModificarAsiento } from './ModificarAsiento'
import { Buscador } from '../ficha/Buscador'
import { cuentasQueEncajan, queHaceIntro, type CuentaDelPlan } from '../ficha/teclas'
import { origenes } from './origen'
import { crearProveedor, NifRepetidoError } from '@/modules/conta/services/proveedorService'
import { revisarAlta, textoNifRepetido, type ProveedorExistente } from '@/modules/conta/lib/altaProveedor'
import { tipoEntidadPorNif } from '@/modules/conta/lib/nif'
import { casillasVacias, comprobacionesDe, dondeVaElFoco, dudaDelGasto, emisorDesconocido, estadoDeLaFicha, etiquetaDelAsiento, franjaProveedorSolo, gastoEnAmbar, nombreDePestana, puedeGuardar, trimestreDe } from './estado'
import { calendarioDe, cuentasAMano, delProveedor, deshacerProveedorSolo, gastoAprendido, gastoPropuesto as leerGastoPropuesto, cabeceraDeLaFactura, guardarCabecera, marcasParaPoner, catalogosDeLaRecibida, guardarOtrosDatos, otrosDatosDeLaFactura, trimestresPresentados, mayorDelProveedor, noEsLaMisma, otrasDelProveedor, proveedorSolo, subcuentasDeProveedores, textoOperacion, cuentasDeContrapartida, codigosDeProveedores, guardarTramos, leerCodigosCortos, leerTramos, type TramoFicha } from './servicio'
import { cuentaDelProveedorEnElAsiento } from './proveedorEnAsiento'
import { faltasParaValidar, laRepetida, textoNoSeValida, textoRepetida } from './validarSoloLoCompleto'
import { avisoInmovilizado } from './contrapartida'
import { proveedoresQueEncajan } from './buscarProveedor'
import { OPERACIONES, esOperacion, origenOperacion, textoDeOperacion, trimestrePropuesto, trimestresParaElegir } from './cabecera'
import { PAGO_VACIO, cuentaDeLaCasilla, fechaDelPago, primerasDeLaLupa, propuestaDelPago, queHaceElPago, textoAsientoDelPago, textoDudaPago, textoPendiente, type QueHaceElPago } from './pago'
import { apuntarPago, cuentasDePago, hayLiquidacion, pagoDelProveedor } from './pagoServicio'
import RevisarFacturaPage from '@/modules/conta/documentos/RevisarFacturaPage'
import { AltaDesdeFactura } from '@/modules/conta/documentos/ProveedorDesdeFactura'
import { fraseAltaEnFactura } from '@/modules/conta/lib/altaProveedor'
import { CrearDesdeBuscador } from '@/modules/conta/plan/CrearDesdeBuscador'

/**
 * K06 · El borrador de esta ficha: el de la ficha de hoy y la cuenta del pago con su fecha. null = lo que
 * se propone (la de su ficha, o vacía; K11b: la del último pago solo en la lupa); '' = pendiente de pagar.
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

/**
 * Las casillas que cuentan para Intro, en el orden de la página (data-casilla): K11b, como ERP10 (concepto ERP10, K11
 * 2.1.10), de izquierda a derecha y de arriba abajo. La fecha de la factura está arriba: va antes que el proveedor.
 */
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
  // X21 · Las subcuentas creadas desde los buscadores de esta ficha («No está: crear la …»): ya elegibles y con su nombre.
  const [creadas, setCreadas] = useState<CuentaDelPlan[]>([])
  const [textoTotal, setTextoTotal] = useState<string | null>(null)
  const [fichero, setFichero] = useState<{ file: File; url: string } | null>(null)

  // ── Lo que se lee: lo mismo que la ficha de hoy ──
  const id = aMano ? '' : invoiceId
  const f = useLeer(id ? () => leerFactura(id) : null, `${id}:${vuelta}`)
  // Lo último leído de ESTA factura mientras se vuelve a leer (useUltimo): la ficha no se vacía ni pierde su cuenta.
  const fac = useUltimo(f.datos, id)
  // K07 · En qué está: la validada y la descartada se abren aquí, sin poder escribir.
  const validada = !!fac?.asiento && fac.asiento.estado === 'validado'
  const descartada = fac?.estado === 'descartada'
  // Sin llamar a una función: el compilador de React daría por hecho que lo que sale de ella puede ser «fac» (lo mismo que modoDeLaRecibida).
  const modo: ModoRecibida = aMano ? 'escribir' : descartada ? 'descartada' : validada ? 'contabilizada' : 'escribir'
  const soloLectura = modo !== 'escribir'
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
  // K10 · El proveedor, también por su código en la empresa (como en ERP10).
  const codigosProv = useLeer(accountId && empresa ? () => codigosDeProveedores(accountId, empresa) : null, `${accountId}:${empresa}:codigos-proveedores:${vueltaProv}`).datos ?? null
  const localesL = useLeer(accountId && ejeLocal ? () => localesDeLaCuenta(accountId) : null, `${accountId}:${ejeLocal ? 'con' : 'sin'}:locales`).datos
  const locales = useMemo(() => localesL ?? [], [localesL])
  // K10 · La contrapartida, con cualquier subcuenta: primero las del 6, después el resto (21x, 480…).
  const cuentasGastoL = useLeer(accountId && empresa ? () => cuentasDeContrapartida(accountId, empresa) : null, `${accountId}:${empresa}:contrapartidas`).datos
  const cuentasGasto = useMemo(() => cuentasGastoL ?? [], [cuentasGastoL])
  const tiposIva = useLeer(accountId ? () => tiposDeIvaRecibida(accountId) : null, `${accountId}:tipos-iva`).datos ?? [21, 10, 4, 0]
  const dup = useLeer(accountId && fac ? () => duplicadaDe(accountId, fac.id, fac.proveedor?.id ?? null) : null, `${accountId}:${id}:${fac?.numero}:${fac?.total}:dup:${vuelta}`).datos ?? null
  const calendario = useLeer(accountId && empresa ? () => calendarioDe(accountId, empresa) : null, `${accountId}:${empresa}:calendario`).datos ?? null
  // K10b · La cabecera como ERP10: el tipo de operación, el trimestre, el concepto, las observaciones y la marca.
  const cab = useUltimo(useLeer(accountId && id && !aMano ? () => cabeceraDeLaFactura(accountId, id) : null, `${accountId}:${id}:cabecera:${vuelta}`).datos, id ?? '')
  const marcas = useLeer(accountId ? () => marcasParaPoner(accountId) : null, `${accountId}:marcas`).datos ?? []
  const presentados = useLeer(accountId && empresa ? () => trimestresPresentados(accountId, empresa) : null, `${accountId}:${empresa}:303-presentados`).datos ?? null
  // K11b · «Otros datos» y lo de cada línea (K11a, 0839; las fechas, K11f1), las plataformas (hostelería) y sus catálogos.
  const hosteleria = useHosteleria()
  const otrosL = useUltimo(useLeer(accountId && id ? () => otrosDatosDeLaFactura(accountId, id) : null, `${accountId}:${id}:otros:${vuelta}`).datos, id)
  const catalogos = useLeer(accountId ? () => catalogosDeLaRecibida() : null, `${accountId}:catalogos-recibida`).datos ?? null
  const plataformas = useLeer(accountId && hosteleria ? () => plataformasDeLaCuenta(accountId) : null, `${accountId}:plataformas:${hosteleria ? 'si' : 'no'}`).datos ?? null
  const [otrosAbierto, setOtrosAbierto] = useState<string | null>(null)
  const [guardandoOtros, setGuardandoOtros] = useState(false)
  // K13 · El código corto de cada local, marca y plataforma (2347) y el reparto de cada línea en tramos (0001).
  const codigos = useLeer(accountId ? () => leerCodigosCortos(accountId) : null, `${accountId}:codigos-cortos`).datos ?? null
  const tramosL = useUltimo(useLeer(accountId && id && !aMano ? () => leerTramos(accountId, id) : null, `${accountId}:${id}:tramos:${vuelta}`).datos, id)
  const [tramosEdit, setTramosEdit] = useState<{ de: string; linea: number; tramos: TramoFicha[] } | null>(null)
  const [guardandoTramos, setGuardandoTramos] = useState(false)

  // ── El borrador: lo guardado, como en la ficha de hoy ──
  const vistaDatos = useUltimo(vista.datos, `${id}:${fac?.proveedor?.id ?? ''}`)
  const propuesta = fac?.asiento ? undefined : vistaDatos ? (vistaDatos.propuesta ?? null) : vista.error ? null : undefined
  /** Con su asiento ya propuesto (o validado) la propuesta no se pide; sin él, `propuesta === undefined` es que viene de camino. */
  const asientoGuardado = !!fac?.asiento
  const leyendoPropuesta = !aMano && !!fac && !asientoGuardado && propuesta === undefined
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
    return (campo: string, v: unknown): string => campo === 'pagoCuenta' ? (v && v !== PAGO_VACIO ? String(v) : 'Pendiente de pagar')
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
  // X27 · La «Subcuenta de gasto» de su ficha, puesta ya en la a mano (una vez por proveedor): ver ponerGasto.
  const [gastoFichaPuesto, setGastoFichaPuesto] = useState<string | null>(null)
  const mayor = useUltimo(useLeer(accountId && empresa && delProv?.subcuenta ? () => mayorDelProveedor(accountId, empresa, delProv.subcuenta!.id, hoy) : null, `${accountId}:${empresa}:${delProv?.subcuenta?.id}:mayor:${vuelta}`).datos, `${id}:${provId}`)
  const aprendido = useUltimo(useLeer(empresa && provId && !aMano ? () => gastoAprendido(empresa, provId) : null, `${empresa}:${provId}:${invoiceId}:aprendido:${vuelta}`).datos, `${id}:${provId}`)
  // R14 · Lo que hizo Sumied con el proveedor al leerla, y la cuenta propuesta sin historial (en ámbar, con su porqué).
  // La clave cambia cuando llega lo aprendido: useLeer solo vuelve a leer si cambia la clave, y al pintarse la
  // primera vez lo aprendido aún no está (sin esto, la propuesta no se pedía nunca: e2e 1670).
  const solo = useLeer(id && !aMano ? () => proveedorSolo(id) : null, `${id}:solo:${vuelta}`).datos ?? null
  const propuestoGasto = useLeer(empresa && provId && !aMano && aprendido && !aprendido.cuenta ? () => leerGastoPropuesto(empresa, provId, id ?? null) : null, `${empresa}:${provId}:${invoiceId}:propuesto:${aprendido ? aprendido.cuenta ?? 'sin-historia' : 'esperando'}:${vuelta}`).datos ?? null
  // Una vez por empresa: la subcuenta del proveedor sale de delProveedor (ya leído), no de volver a leer el contexto entero.
  // K11b · 4 · Las cuentas de reserva (IVA y retención de la empresa), siempre: sin la propuesta (aún no ha llegado, o la
  // factura ya tiene su asiento propuesto guardado y no se pide) el asiento se forma igual con lo escrito.
  const aManoCuentas = useLeer(accountId && empresa ? () => cuentasAMano(accountId, empresa) : null, `${accountId}:${empresa}:cuentas-a-mano`).datos ?? null

  // ── K06 · Cómo se paga: la cuenta del pago, propuesta (la de su ficha) o vacía; la del último pago, solo la primera de la lupa ──
  const cuentasPago = useUltimo(useLeer(accountId && empresa ? () => cuentasDePago(accountId, empresa) : null, `${accountId}:${empresa}:cuentas-pago`).datos, empresa ?? '')
  const subProvCodigo = delProv?.subcuenta?.codigo ?? null
  const leePagoProv = !!(accountId && empresa && provId && delProv)
  const pagoProvLeido = useLeer(accountId && empresa && provId && delProv ? () => pagoDelProveedor(accountId, empresa, provId, subProvCodigo) : null, `${accountId}:${empresa}:${provId}:${delProv ? 'leido' : 'leyendo'}:${subProvCodigo}:pago:${vuelta}`)
  const pagoProv = useUltimo(pagoProvLeido.datos, `${id}:${provId}`)
  const liquidacionLeida = useLeer(id && pagoProv?.plataforma ? () => hayLiquidacion(id) : null, `${id}:${pagoProv?.plataforma ? 'p' : '-'}:liquidacion:${vuelta}`)
  const conLiquidacion = liquidacionLeida.datos ?? false
  // K06 · Mientras se lee la propuesta del pago, no se valida: se guardaría «pendiente» sin que nadie lo haya decidido
  // (la e2e #1641 pulsó antes de que llegara la 430 de su liquidación). Si la lectura falla, no se espera: queda lo que haya.
  const leyendoPago = (leePagoProv && !pagoProv && !pagoProvLeido.error) || (!!id && !!pagoProv?.plataforma && liquidacionLeida.datos === null && !liquidacionLeida.error)

  // ── K07 · La contabilizada y la descartada: su asiento validado, si salió a ERP10, su descarte y el historial ──
  const asientoId = validada ? fac?.asiento?.id ?? null : null
  const asientoReal = useLeer(accountId && asientoId ? () => leerAsiento(accountId, asientoId) : null, `${accountId}:${asientoId}:asiento-real:${vuelta}`).datos ?? null
  // X26 · «Modificar» la contabilizada: si se puede (la base dice por qué no) y, mientras se modifica, las cuentas elegidas por línea.
  const [modificando, setModificando] = useState<{ de: string; elegidas: Record<number, string> } | null>(null)
  const enModificar = modificando?.de === invoiceId
  const asientoValidado = !aMano && invoiceId && fac?.asiento?.estado === 'validado' ? fac.asiento.id : null
  const sePuede = useLeer(asientoValidado ? () => sePuedeModificar(invoiceId) : null, claveSePuedeModificar({ invoiceId, asientoValidado, vuelta }))
  const enErp10 = useLeer(accountId && asientoId ? () => salioAErp10(accountId, asientoId) : null, `${accountId}:${asientoId}:erp10:${vuelta}`).datos ?? false
  const descarte = useLeer(descartada && id ? () => leerDescarte(id) : null, `${id}:descarte:${descartada ? 'si' : 'no'}:${vuelta}`).datos ?? null
  const [verHistorial, setVerHistorial] = useState<string | null>(null)
  const historial = useLeer(accountId && id && verHistorial === id ? () => leerHistorial(accountId, id) : null, `${accountId}:${id}:historial:${verHistorial === id ? 'si' : 'no'}:${vuelta}`)
  const [confirmarDoc, setConfirmarDoc] = useState<{ de: string; file: File } | null>(null)
  // ── K09 · La repetida: otra ya contabilizada del mismo proveedor con su número (y si ya se dijo que no es la misma) ──
  const otrasL = useLeer(accountId && id && provId && modo === 'escribir' ? () => otrasDelProveedor(accountId, id, provId) : null, `${accountId}:${id}:${provId}:otras:${modo}:${vuelta}`).datos ?? null
  const [noEs, setNoEs] = useState<{ de: string; motivo: string } | null>(null)
  const [anotando, setAnotando] = useState(false)
  // K09 · Lo que falta y la repetida, lo mismo que dirá la base.
  const faltas = !aMano && modo === 'escribir' && fac ? faltasParaValidar(b) : []
  const repetida = otrasL && modo === 'escribir' ? laRepetida({ id: invoiceId, numero: b.numero, confirmada: otrasL.confirmada, otras: otrasL.otras }) : null
  const [cambiandoDoc, setCambiandoDoc] = useState(false)
  const plataforma = pagoProv?.plataforma ? { ...pagoProv.plataforma, hayLiquidacion: conLiquidacion } : null
  const propuestaPago = pagoProv ? propuestaDelPago({ deLaFicha: pagoProv.deLaFicha, ultimas: pagoProv.ultimas }) : null
  // K11b · Lo que se ve es lo que se apunta: la de la casilla; vaciada (PAGO_VACIO), pendiente de pagar, aunque haya propuesta.
  const pagoCuenta = cuentaDeLaCasilla(b.pagoCuenta, propuestaPago?.cuenta ?? '')
  /** Las cuentas de sus últimos pagos: las primeras al abrir la lupa del pago (nunca escritas en la casilla). */
  const ultimasDelPago = pagoProv ? primerasDeLaLupa({ ultimas: pagoProv.ultimas }) : []
  const pagoFecha = b.pagoFecha ?? fechaDelPago(b.fecha, b.vence, !!pagoProv?.pagoDirecto)
  const origenPago = b.pagoCuenta === null ? propuestaPago?.origen ?? null : null
  const dudaPago = b.pagoCuenta === null && propuestaPago?.duda ? propuestaPago.duda : null
  const nombrePago = pagoCuenta ? cuentasPago?.nombres.get(pagoCuenta) ?? creadas.find((c) => c.codigo === pagoCuenta)?.nombre ?? 'Cuenta' : ''
  // Lo que se escribe en la casilla del pago, de ESTA factura (al pasar a otra, se vuelve a lo suyo).
  const [escrito, setEscrito] = useState<{ de: string; texto: string | null }>({ de: '', texto: null })
  const textoPago = escrito.de === `${aMano}:${invoiceId}` ? escrito.texto : null
  const setTextoPago = (texto: string | null) => setEscrito({ de: `${aMano}:${invoiceId}`, texto })

  // ── K11b · Los pagos hechos, uno por fila (K10c), con sus candados (el motivo, en el `title`) ──
  const pagosL = useUltimo(useLeer(accountId && id && validada ? () => leerPagos(accountId, id, subProvCodigo) : null, `${accountId}:${id}:pagos:${subProvCodigo}:${vuelta}`).datos, id)
  const pagosHechos = useMemo(() => pagosL ?? [], [pagosL])
  const candados = useLeer(pagosHechos.length ? () => Promise.all(pagosHechos.map((p) => sePuedeCambiarPago(p.id).catch((e) => ({ puede: false, porque: e instanceof Error ? e.message : String(e) })))) : null,
    `${pagosHechos.map((p) => p.id).join(',')}:candados:${vuelta}`).datos ?? null
  const [pagoEdit, setPagoEdit] = useState<{ de: string; id: string | null; cuenta: string; fecha: string; concepto: string; importe: string } | null>(null)
  const [haciendoPago, setHaciendoPago] = useState(false)

  // ── El asiento que sale ──
  const cuentasPlan: CuentaDelPlan[] = useMemo(() => [...cuentasGasto.map((c) => ({ codigo: c.codigo, nombre: c.nombre })),
    ...creadas.filter((c) => !cuentasGasto.some((g) => g.codigo === c.codigo))], [cuentasGasto, creadas])
  /** X21 · «No está: crear la …» en los buscadores de cuenta de esta ficha (la empresa, la de la ficha). */
  const crearCuenta = (alCrear: (c: CuentaDelPlan) => void, noVa?: string) => (q: string, cerrar: () => void) => (empresa
    ? <CrearDesdeBuscador accountId={accountId} companyId={empresa} q={q} quien={userName ?? null} noVa={noVa}
        alCrear={(c) => { const n = { codigo: c.code, nombre: c.name }; setCreadas((x) => [...x, n]); alCrear(n); cerrar() }} />
    : null)
  const nombreGasto = useCallback((c: string) => cuentasPlan.find((x) => x.codigo === c)?.nombre ?? nombresProp?.get(c) ?? 'Cuenta', [cuentasPlan, nombresProp])
  const subProv = delProv?.subcuenta ?? null
  // K08 · Sin su subcuenta (un proveedor recién dado de alta), la que le tocará: «Será la 40000002 · Proveedores · …».
  const sinSubcuenta = !!(accountId && empresa && provId && delProv && !delProv.subcuenta)
  const subcuentasProv = useLeer(sinSubcuenta && accountId && empresa ? () => subcuentasDeProveedores(accountId, empresa) : null, `${accountId}:${empresa}:${provId}:${sinSubcuenta ? 'sin' : 'con'}:subcuentas:${vuelta}`).datos ?? null
  const gastoDelAsiento = b.gastos[0]?.cuenta?.trim() || null
  const subCodigo = subProv?.codigo ?? null
  const subNombre = subProv?.nombre ?? null
  // Una cadena nueva: el compilador de React da por alias de «prov» lo que sale de él.
  const provNombreFicha: string | null = prov ? `${prov.nombre}` : null
  const cuentasAsiento = useMemo(() => {
    const p = subCodigo || subcuentasProv ? cuentaDelProveedorEnElAsiento({
      subcuenta: subCodigo ? { codigo: subCodigo, nombre: subNombre ?? '' } : null, proveedor: provNombreFicha, gasto: gastoDelAsiento,
      ocupados: subcuentasProv?.ocupados ?? new Set<string>(), digitos: subcuentasProv?.digitos ?? 8,
    }) : null
    const delProveedor = p ? { codigo: p.codigo, nombre: p.nombre } : null
    if (propuesta) {
      const c = cuentasDeLaPropuesta(propuesta.lineas, (x) => nombresProp?.get(x) ?? 'Cuenta')
      return delProveedor ? { ...c, proveedor: delProveedor } : c
    }
    // Las de reserva, solo cuando ya se sabe que no hay propuesta (o no se pide: a mano, o con su asiento ya propuesto). Mientras
    // la propuesta viene de camino, no: el asiento diría «Falta la cuenta de gasto» antes de que llegue la propuesta (e2e
    // 45261036533, K04: Intro no validaba).
    const sinPropuestaYa = aMano || propuesta === null || !!asientoGuardado
    return aManoCuentas && sinPropuestaYa ? { ...aManoCuentas.cuentas, proveedor: delProveedor } : null
  }, [propuesta, nombresProp, aManoCuentas, subCodigo, subNombre, provNombreFicha, gastoDelAsiento, subcuentasProv, aMano, asientoGuardado])
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
  const ambarGasto = gastoEnAmbar({ aMano, propuesto: propuestoGasto, aprendida: aprendido?.cuenta ?? null, cuentaAhora: b.gastos[0]?.cuenta ?? '' })
  if (ambarGasto) comprobaciones.push(ambarGasto)
  // K10b · La cabecera: el tipo de operación (de su ficha o cambiado en esta), el trimestre en que se deduce.
  const opFicha = delProv?.operacion ?? null
  const opFactura = cab?.operacion ?? null
  const origenOp = aMano ? (opFicha ? 'De su ficha' : null) : origenOperacion(opFactura, opFicha)
  const trim = presentados && b.fecha ? trimestrePropuesto({ fecha: b.fecha, deduceEn: cab?.deduceEn ?? null, presentados }) : null
  const trimestres = presentados && b.fecha ? trimestresParaElegir(b.fecha, presentados) : []
  const cabEscribible = !aMano && !soloLectura && !!fac && !!cab?.disponible
  if (trim?.aviso) {
    // En la franja ámbar, con una frase: sustituye a la del periodo («El 3T está cerrado»), no se suma.
    const x = { id: 'periodo', tono: 'ambar' as const, texto: trim.aviso.replace(/\.$/, '') }
    const i = comprobaciones.findIndex((c) => c.id === 'periodo')
    if (i >= 0) comprobaciones[i] = x; else comprobaciones.push(x)
  }
  const [guardandoCab, setGuardandoCab] = useState(false)
  const [textoConcepto, setTextoConcepto] = useState<{ k: string; v: string } | null>(null)
  const [textoObs, setTextoObs] = useState<{ k: string; v: string } | null>(null)
  /** Guarda en el momento lo cambiado en la cabecera (conta_recibida_cabecera) y lo dice (regla 8). */
  async function ponerCabecera(c: Parameters<typeof guardarCabecera>[1]) {
    if (!fac || guardandoCab) return
    setGuardandoCab(true)
    try {
      const r = await guardarCabecera(fac.id, c, userName ?? null)
      setAviso({ tono: 'ok', texto: r.texto }); setVuelta((v) => v + 1)
    } catch (e) {
      setAviso({ tono: 'mal', texto: `No se ha guardado: ${e instanceof Error ? e.message.replace(/\.$/, '') : String(e)}.` })
    } finally { setGuardandoCab(false) }
  }
  // K04b · El emisor que no se reconoce, y lo que falta: la franja no dice «Rellenada» con casillas vacías.
  const leidoEmisor = leido ? { nombre: leido.proveedor.nombre ?? fac?.propuesto?.nombre ?? null, nif: leido.proveedor.nif ?? fac?.propuesto?.nif ?? null }
    : fac?.propuesto ? { nombre: fac.propuesto.nombre, nif: fac.propuesto.nif } : null
  const emisor = fac ? emisorDesconocido({ aMano, proveedorId: provId, leido: leidoEmisor, proveedores }) : null
  const vacias = aMano ? [] : casillasVacias({ proveedor: !!provId, numero: b.numero, fecha: b.fecha, total: totales.total, cuentaGasto: b.gastos.some((g) => g.cuenta.trim() !== '') })
  const estado = estadoDeLaFicha({ aMano, leida: !!fac?.lectura, comprobaciones, hayDudaGasto: !!duda || !!dudaPago, desconocido: emisor?.que === 'alta', vacias })
  const [altaAbierta, setAltaAbierta] = useState<string | null>(null)
  const franjaSolo = franjaProveedorSolo({ aMano, solo, proveedorId: provId, nombre: prov?.nombre ?? fac?.proveedor?.nombre ?? null, validada: !!fac?.asiento })
  const [abrirProveedor, setAbrirProveedor] = useState(0)
  useNombreDePestana(nombreDePestana(aMano ? prov?.nombre : prov?.nombre ?? fac?.proveedor?.nombre ?? emisor?.nombre, !aMano))

  // ── Guardar, validar y pasar ──
  // K07 · ‹ después de validar y pasar vuelve a la que se acaba de validar (ya no está en la cola), y › desde ella, aquí.
  const deDonde = state as { vieneDe?: string; despues?: string } | null
  const siguiente = pos >= 0 && pos < ids.length - 1 ? ids[pos + 1] : pos < 0 && deDonde?.despues && deDonde.despues !== invoiceId ? deDonde.despues : null
  const anterior = laAnterior({ vieneDe: deDonde?.vieneDe ?? null, actual: invoiceId, enLaCola: pos > 0 ? ids[pos - 1] : null })
  const ir = useCallback((destino: string, aviso?: string, mas?: { vieneDe?: string; despues?: string }) => {
    const q = conCambio(search, { fila: destino })
    recordarLista(LISTA_RECIBIDAS, `${rutaDocumentos()}${q}`)
    navegar(`${rutaRevisarFactura(destino)}${q}`, aviso || mas ? { state: { aviso, ...mas } } : undefined)
  }, [search, navegar])
  // El aviso: el de la factura de antes (lo que dijo al pasar), hasta que esta diga el suyo.
  const avisoDeAntes = (state as { aviso?: string } | null)?.aviso ?? null
  const claveAviso = `${aMano}:${invoiceId}:${avisoDeAntes ?? ''}`
  const [propio, setPropio] = useState<{ k: string; a: Aviso | null } | null>(null)
  const aviso: Aviso | null = propio && propio.k === claveAviso ? propio.a : avisoDeAntes ? { tono: 'ok', texto: avisoDeAntes } : null
  const setAviso = (a: Aviso | null) => setPropio({ k: claveAviso, a })
  const [deshaciendo, setDeshaciendo] = useState(false)
  const deshacerSolo = async () => {
    if (!id || deshaciendo) return
    setDeshaciendo(true)
    try {
      const texto = await deshacerProveedorSolo(id, userName)
      ed.reiniciar({ ...b, proveedorId: '' })
      setAviso({ tono: 'ok', texto }); setVueltaProv((v) => v + 1); setVuelta((v) => v + 1)
    } catch (e) { setAviso({ tono: 'mal', texto: `No he podido deshacerlo: ${e instanceof Error ? e.message : String(e)}` }) } finally { setDeshaciendo(false) }
  }
  // R14 · «+ Nuevo proveedor» en la de a mano: el NIF y el nombre en la misma fila, sin salir y sin perder lo escrito.
  const [nuevo, setNuevo] = useState<{ nif: string; nombre: string; fallo: string | null; ocupado: boolean; repetido?: ProveedorExistente | null } | null>(null)
  const crearNuevo = async () => {
    if (!nuevo || nuevo.ocupado || !accountId) return
    const r = revisarAlta({ nombre: nuevo.nombre, nif: nuevo.nif }, proveedores.map((p) => ({ id: p.id, name: p.nombre, taxId: p.nif })))
    const fallo = r.errores.nombre ?? r.errores.nif ?? null
    // X24 · El NIF de otro (comparado como la base): «Ya tienes a … con este NIF», con «Abrirlo», en ámbar.
    if (fallo) { setNuevo({ ...nuevo, fallo, repetido: r.errores.nombre ? null : r.repetido }); return }
    setNuevo({ ...nuevo, ocupado: true, fallo: null })
    try {
      const creado = await crearProveedor({ accountId, name: nuevo.nombre, taxId: r.nif, taxIdType: r.nif ? 'nif_es' : null, nifComprobado: !!r.nif,
        entityKind: r.nif ? tipoEntidadPorNif(r.nif) : null, createdBy: userId ?? null, createdByName: userName ?? null })
      ed.poner('proveedorId', creado.id); setTextoProv(null); setNuevo(null); setVueltaProv((v) => v + 1)
      setAviso({ tono: 'ok', texto: `Dado de alta ${creado.name}${creado.taxId ? ` (${creado.taxId})` : ''} y elegido en esta factura. Su subcuenta se crea al validarla.` })
    } catch (e) { setNuevo({ ...nuevo, ocupado: false, fallo: e instanceof Error ? e.message : String(e), repetido: e instanceof NifRepetidoError ? e.repetido : null }) }
  }
  const [guardando, setGuardando] = useState(false)
  useEffect(() => () => { if (fichero) URL.revokeObjectURL(fichero.url) }, [fichero])

  // K06 · Qué hace al validar la cuenta del pago que hay en la casilla, y hacerlo (siempre una frase, regla 8).
  const importePago = Math.round(totales.total * 100) / 100
  const queElPago = (): QueHaceElPago => queHaceElPago({ cuenta: pagoCuenta, fecha: pagoFecha, hoy, importe: importePago,
    tesorerias: cuentasPago?.tesorerias ?? new Map<string, string>(), plataforma, cuentaProveedor: subProvCodigo })
  const asientoDelPago = modo === 'contabilizada' ? null
    : textoAsientoDelPago(queElPago(), { nombre: (c) => cuentasPago?.nombres.get(c) ?? creadas.find((x) => x.codigo === c)?.nombre ?? '', cuentaProveedor: subProvCodigo, importe: `${cifra(importePago)} €` })
  async function elPago(facturaId: string, empresaId: string): Promise<string> {
    const q = queElPago()
    if (q.que === 'pendiente') return textoPendiente(q.porque)
    if (q.que === 'liquidacion') return `Se paga con su liquidación: la ${q.cuenta}${plataforma ? ` de ${plataforma.nombre}` : ''} la descuenta, no pasa por el banco.`
    try { return await apuntarPago({ companyId: empresaId, facturaId, pago: q, quien: userName }) }
    catch (e) { return `El pago no se ha apuntado (${e instanceof Error ? e.message.replace(/\.$/, '') : String(e)}): queda pendiente de pagar.` }
  }

  /** K09 · «No es la misma: …», escrita: la base la guarda con su motivo y queda en el historial; ya se puede validar. */
  async function anotarNoEsLaMisma(otraId: string, motivo: string) {
    if (!fac || anotando || !motivo.trim()) return
    setAnotando(true)
    try {
      const texto = await noEsLaMisma(fac.id, otraId, motivo.trim(), userName)
      setAviso({ tono: 'ok', texto }); setNoEs(null); setVuelta((v) => v + 1)
    } catch (e) {
      setAviso({ tono: 'mal', texto: `No se ha anotado: ${e instanceof Error ? e.message.replace(/\.$/, '') : String(e)}. Sigue sin validarse.` })
    } finally { setAnotando(false) }
  }

  /** K07 · «Cambiar el documento»: en una de por revisar se pone al guardar (sin perder lo escrito); en una contabilizada, confirmando. */
  function alCambiarDocumento(file: File) {
    if (modo === 'contabilizada') { setConfirmarDoc({ de: invoiceId, file }); return }
    setFichero({ file, url: URL.createObjectURL(file) }); ed.poner('documento', file.name)
    setAviso({ tono: 'ok', texto: textoCambioAlGuardar(file.name) })
  }
  async function cambiarYa(file: File) {
    if (!fac || cambiandoDoc) return
    setConfirmarDoc(null); setCambiandoDoc(true)
    try {
      const texto = await cambiarDocumentoContabilizada({ id: fac.id, account_id: fac.account_id }, file, userName)
      setAviso({ tono: 'ok', texto }); setVuelta((v) => v + 1)
    } catch (e) {
      setAviso({ tono: 'mal', texto: `No se ha cambiado el documento: ${e instanceof Error ? e.message.replace(/\.$/, '') : String(e)}. Sigue el de antes.` })
    } finally { setCambiandoDoc(false) }
  }
  async function recuperarla() {
    if (!fac) return
    try {
      const estado = await recuperarFactura(fac.id, userName)
      setAviso({ tono: 'ok', texto: `Recuperada: es una factura y vuelve a «${estado === 'en_revision' ? 'en revisión' : estado}».` })
      refrescarCuentasMenu(); setVuelta((v) => v + 1)
    } catch (e) { setAviso({ tono: 'mal', texto: `No se ha recuperado: ${e instanceof Error ? e.message.replace(/\.$/, '') : String(e)}.` }) }
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
      if (!r.conTanda) return 'No se ha guardado: la base de datos aún no está preparada para guardar la ficha.'
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
    if (enModificar) { await guardarModificacion(); return }
    // K07 · La contabilizada y la descartada no se guardan (Intro fuera de una casilla llega aquí aunque el botón esté apagado): se dice.
    if (soloLectura) {
      setAviso({ tono: 'falta', texto: modo === 'contabilizada' ? 'Ya está contabilizada: no hay nada que guardar. Pasa a la siguiente con ›.' : 'Está descartada: no se guarda. Si es una factura, «Más › Recuperarla».' }); return
    }
    // K13 · Un reparto que no suma su línea no se valida, y se dice cuánto falta (Julio, 24/11).
    const repartoAbierto = tramosEdit?.de === invoiceId ? tramosEdit : null
    if (repartoAbierto) {
      const deLaLinea = b.gastos.length === 1 ? totales.base + (totales.recargo ?? 0) : num(b.gastos[repartoAbierto.linea]?.importe ?? '') ?? 0
      const c = cuadreDeTramos(repartoAbierto.linea + 1, deLaLinea, repartoAbierto.tramos)
      if (!c.cuadra) { setAviso({ tono: 'falta', texto: `${c.texto} No se valida hasta que sume.` }); return }
    }
    if (guardandoCab) { setAviso({ tono: 'falta', texto: 'Aún estoy guardando la cabecera (el tipo, el trimestre, el concepto…): vuelve a pulsar en un momento. No he validado nada.' }); return }
    if (leyendoPago) { setAviso({ tono: 'falta', texto: 'Aún estoy leyendo cómo se paga (la cuenta del pago que propongo): vuelve a pulsar en un momento. No he guardado nada.' }); return }
    if (textoPago !== null && textoPago.trim() !== '' && textoPago.trim() !== pagoCuenta) {
      setAviso({ tono: 'falta', texto: `La cuenta del pago «${textoPago.trim()}» no está elegida: elígela de la lista o vacía la casilla (pendiente de pagar). No he guardado nada.` }); return
    }
    if (leyendoPropuesta) { setAviso({ tono: 'falta', texto: 'Aún estoy leyendo la propuesta (la cuenta de gasto que propongo): vuelve a pulsar en un momento. No he guardado nada.' }); return }
    setGuardando(true); setAviso(null)
    try {
      if (aMano) { await guardarNueva(); return }
      if (!fac) return
      // K09 · Lo que falta, o la repetida: se guarda lo escrito si se puede, y no se valida (la base tampoco la
      // validaría). Se dice qué falta aunque guardar no haya podido (sin la cuenta de gasto, por ejemplo).
      const noValeAntes = textoNoSeValida({ faltas, repetida, guardada: false })
      if (noValeAntes) {
        const hubo = ed.hay
        const g0 = hubo ? await guardarCambios().catch(() => false as const) : false
        setAviso({ tono: 'falta', texto: textoNoSeValida({ faltas, repetida, guardada: hubo && g0 === true }) ?? noValeAntes }); setVuelta((v) => v + 1); return
      }
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
      if (siguiente) { ir(siguiente, texto, { vieneDe: fac.id }); return }
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
    setTimeout(() => casillasDe(raiz.current)[0]?.focus(), 0)
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

  // X26 · Guardar lo modificado: solo las líneas de gasto cuya cuenta ha cambiado; la base lo hace en el mismo asiento.
  async function guardarModificacion() {
    if (!modificando || !asientoReal) return
    const lineas = lineasQueCambian(asientoReal.apuntes.map((a) => ({ posicion: a.posicion, cuenta: a.cuenta })), modificando.elegidas)
    if (!lineas.length) { setAviso({ tono: 'falta', texto: 'No has cambiado ninguna cuenta. Esc lo deja como estaba.' }); return }
    setGuardando(true)
    try {
      const texto = await modificarRecibida(invoiceId, lineas, userName ?? null)
      setModificando(null); setAviso({ tono: 'ok', texto }); setVuelta((v) => v + 1)
    } catch (e) { setAviso({ tono: 'mal', texto: `No se ha modificado: ${e instanceof Error ? e.message.replace(/\.$/, '') : String(e)}.` }) }
    finally { setGuardando(false) }
  }
  const cancelarModificacion = () => { setModificando(null); setAviso({ tono: 'ok', texto: 'Sin modificar: la factura y su asiento se quedan como estaban.' }) }

  // ── K11b · «Otros datos» y los datos de cada línea: se guardan al momento, como la cabecera (conta_recibida_otros_datos) ──
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\.$/, '')
  async function ponerOtros(c: Parameters<typeof guardarOtrosDatos>[1]) {
    if (!fac || guardandoOtros) return
    setGuardandoOtros(true)
    try { const r = await guardarOtrosDatos(fac.id, c, userName ?? null); setAviso({ tono: 'ok', texto: r.texto }); setVuelta((v) => v + 1) }
    catch (e) { setAviso({ tono: 'mal', texto: `No se ha guardado: ${msg(e)}.` }) }
    finally { setGuardandoOtros(false) }
  }
  const datoDe = (i: number) => otrosL?.lineas.find((l) => l.posicion === i) ?? null
  /** La marca de la línea: la suya (K11a); en la primera, si no tiene, la de la factura (K10b, la que lleva su asiento). */
  const marcaDe = (i: number) => datoDe(i)?.marcaId ?? (i === 0 ? cab?.marcaId ?? null : null)
  function ponerDatoLinea(i: number, c: { concepto?: string | null; marca?: string | null; plataforma?: string | null }) {
    // Con una sola línea, la marca es la de la factura (K10b, la que lleva todo su asiento); con varias, la de cada línea (K11a).
    if (i === 0 && b.gastos.length === 1 && c.marca !== undefined && !datoDe(0)?.marcaId && c.concepto === undefined && c.plataforma === undefined) { void ponerCabecera({ marca: c.marca }); return }
    // Solo lo que cambia (20261123T1750): la base deja como está lo que no viene, así que una lectura que aún no ha
    // vuelto no puede borrar la marca al elegir la plataforma, ni al revés.
    void ponerOtros({ lineas: [cambioDeLinea(i, c)] })
  }

  // ── K11b · Un pago más, cambiar uno o borrarlo (K10c). El de un banco, una tarjeta o la caja espera el cargo en Bancos. ──
  const [borrarArmado, setBorrarArmado] = useState<string | null>(null)
  async function guardarPago() {
    if (!pagoEdit || !fac || !empresa || haciendoPago) return
    const importe = leerImporte(pagoEdit.importe)
    const cuenta = pagoEdit.cuenta.trim()
    if (!cuenta || !pagoEdit.fecha || !(importe > 0)) { setAviso({ tono: 'falta', texto: 'Al pago le falta su subcuenta, su fecha o su importe: no se ha guardado.' }); return }
    setHaciendoPago(true)
    try {
      const concepto = pagoEdit.concepto.trim() || null
      let texto: string
      if (pagoEdit.id) texto = await cambiarPago({ pagoId: pagoEdit.id, cuenta, fecha: pagoEdit.fecha, importe, concepto, quien: userName ?? null })
      else {
        const tes = cuentasPago?.tesorerias.get(cuenta)
        texto = tes ? await apuntarPago({ companyId: empresa, facturaId: fac.id, pago: { que: 'banco', tesoreriaId: tes, cuenta, fecha: pagoEdit.fecha, importe }, quien: userName ?? null })
          : await apuntarUnPago({ companyId: empresa, invoiceId: fac.id, cuenta, fecha: pagoEdit.fecha, importe, concepto, quien: userName ?? null })
      }
      setPagoEdit(null); setAviso({ tono: 'ok', texto }); setVuelta((v) => v + 1); refrescarCuentasMenu()
    } catch (e) { setAviso({ tono: 'mal', texto: `No se ha guardado el pago: ${msg(e)}.` }) }
    finally { setHaciendoPago(false) }
  }
  async function borrarUnPago(pagoId: string) {
    if (haciendoPago) return
    if (borrarArmado !== pagoId) { setBorrarArmado(pagoId); return }
    setBorrarArmado(null); setHaciendoPago(true)
    try {
      const texto = await borrarPago({ pagoId, motivo: 'Borrado desde la ficha de la factura', quien: userName ?? null })
      setPagoEdit(null); setAviso({ tono: 'ok', texto }); setVuelta((v) => v + 1); refrescarCuentasMenu()
    } catch (e) { setAviso({ tono: 'mal', texto: `No se ha borrado el pago: ${msg(e)}.` }) }
    finally { setHaciendoPago(false) }
  }

  // ── El teclado: Intro (decisiones 11 y 12), las flechas de la cola y Esc ──
  const raiz = useRef<HTMLDivElement>(null)
  // K11b · 4 · Intro en una lupa elige y pasa a la casilla siguiente (como ERP10), en el orden de la pantalla.
  const pasarDe = (id: string) => {
    const lista = casillasDe(raiz.current)
    const s = lista[lista.findIndex((x) => x.id === id) + 1]
    if (s) { s.focus(); if (s instanceof HTMLInputElement) s.select() }
  }
  const alPulsar = (e: KE<HTMLDivElement>) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing) return
    const t = e.target as HTMLElement
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const lista = casillasDe(raiz.current)
      const sobre = t.closest('button, a, summary') ? 'boton' : t.closest('textarea') ? 'texto' : null
      // X26 · Modificando, Intro guarda (lo dice la franja), esté donde esté el foco: las casillas apagadas de la
      // contabilizada también cuentan en el orden, y la del asiento no sería la última.
      if (enModificar && sobre !== 'boton') { e.preventDefault(); void guardarYSiguiente(); return }
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
      if (enModificar) { cancelarModificacion(); return }   // X26 · Esc, mientras se modifica: lo deja como estaba.
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
      else if (enModificar) cancelarModificacion()
      else if (pestana?.cerrar) pestana.cerrar()
    }
    window.addEventListener('keydown', fuera)
    return () => window.removeEventListener('keydown', fuera)
  })

  // El foco, donde hay que mirar (dondeVaElFoco): en la duda si la hay (Intro la contesta, otro Intro guarda); en la
  // nueva, la primera casilla de la pantalla (K11b: la fecha de la factura). Se vuelve a mirar cada vez que la ficha termina de pintarse o aparece la duda (la duda puede
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
    // K11b · En la nueva, el foco entra por la primera casilla de la pantalla, de izquierda a derecha y de arriba abajo,
    // como ERP10 (Julio, respuesta K11b · 2): hoy, la fecha de la factura. dondeVaElFoco dice «proveedor» porque la
    // emitida (que va después, con las mismas piezas) aún entra por su cliente.
    const x = donde === 'proveedor' ? casillasDe(raiz.current)[0] : raiz.current?.querySelector<HTMLElement>('.kf-duda .kf-boton-ambar')
    if (!x) return
    x.focus()
    focoPuesto.current = claveFicha
  }, [claveFicha, pintada, aMano, duda, emisor, seVe])

  // ── Lo que no es de esta ficha: la de hoy, dentro de la pestaña ──
  const esUnAbono = !!fac && esAbono(fac)
  if (queFichaSeAbre({ aMano, completa, abono: esUnAbono }) === 'completa') {
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
  // X27 · A mano, al elegir el proveedor, la cuenta de gasto vacía toma la «Subcuenta de gasto» de su ficha (una vez
  // por proveedor: si se cambia a mano, se queda lo escrito). Las que llegan de un documento ya la toman en su propuesta.
  const claveGastoFicha = aMano && provId && delProv?.gasto ? `${provId}:${delProv.gasto}` : null
  if (claveGastoFicha && gastoFichaPuesto !== claveGastoFicha) {
    setGastoFichaPuesto(claveGastoFicha)
    if (!b.gastos[0]?.cuenta?.trim() && delProv?.gasto) ponerGasto(0, { cuenta: delProv.gasto })
  }
  const subcuenta = delProv?.subcuenta?.codigo ?? ''
  const conEstaFactura = mayor ? mayor.saldo + (validada ? 0 : totales.total) : null
  const cola = !aMano && pos >= 0 ? `${pos + 1} de ${ids.length} por revisar` : aMano ? 'Nueva' : ''
  // K10b · Sin propuesta, su porqué (regla 8: nunca «Se forma al escribir» en silencio; e2e 44960214725, «le falta el NIF»).
  const porqueSinPropuesta = !aMano && !fac?.asiento && vistaDatos && vistaDatos.propuesta === null ? vistaDatos.porque : null
  // Lo escrito a mano sin propuesta sigue saliendo (regla 30): «Sin propuesta» solo cuando el asiento está vacío; el porqué, siempre.
  const etiqueta = previa ? etiquetaDelAsiento({ debe: previa.debe, haber: previa.haber, cuadra: previa.cuadra, faltan: previa.faltan, lineas: previa.lineas.length, sinPropuesta: porqueSinPropuesta })
    : porqueSinPropuesta ? etiquetaDelAsiento({ debe: 0, haber: 0, cuadra: false, faltan: [], lineas: 0, sinPropuesta: porqueSinPropuesta }) : { texto: 'Se forma al escribir', tono: 'vacio' as const }
  const documento = aMano
    ? (fichero ? { url: fichero.url, foto: !/pdf/i.test(fichero.file.type), titulo: fichero.file.name } : null)
    : fichero ? { url: fichero.url, foto: !/pdf/i.test(fichero.file.type), titulo: fichero.file.name }
    : papel.datos ? (papel.datos.url ? { url: papel.datos.url, foto: /^image\//i.test(fac?.llegada?.tipo ?? '') || /\.(jpe?g|png)$/i.test(fac?.llegada?.archivo ?? fac?.papel ?? ''), titulo: `El documento de la ${fac?.numero ?? 'factura'}` } : null) : undefined
  const puede = puedeGuardar({ guardando, validada, descartada })
  // K07 · La franja, el asiento y «Más» de la contabilizada y la descartada.
  const pagada = fac?.estado === 'pagada' || !!extra?.pagada
  const franja = repetida ? { tono: 'ambar' as const, fuerte: 'Mira esto ·', resto: `Repetida: ${textoRepetida(repetida)}` }
    : modo === 'contabilizada' && enModificar ? franjaModificando(fac?.asiento?.numero ?? null)
    : modo === 'contabilizada' ? franjaContabilizada({ numero: fac?.asiento?.numero ?? null, pagada, enErp10 })
    : modo === 'descartada' ? franjaDescartada({ motivo: descarte?.motivo ?? null, quien: descarte?.quien ?? null }) : estado
  const lineasValidado = (asientoReal?.apuntes ?? []).map((x) => ({ codigo: x.cuenta, nombre: x.nombreCuenta, debe: x.debe || null, haber: x.haber || null }))
  const hayDocumento = !!documento
  const opciones = opcionesDeMas({ modo, aMano, hayDocumento, porPagar: modo === 'contabilizada' && !pagada })
  const docAccion = accionDocumento({ modo, hayDocumento })
  const lineasHistorial = historial.datos ? lineasDelHistorial(historial.datos, validada ? { numero: fac?.asiento?.numero ?? null, cuando: asientoReal?.validadoEn ?? null, quien: asientoReal?.validadoPor ?? null } : null) : []
  const alPulsarMas = (o: OpcionMas) => {
    if (o.hace === 'completa') { setCompleta(true); return }
    if (o.id === 'historial') setVerHistorial(invoiceId)
    else if (o.id === 'abrir' && documento) window.open(documento.url, '_blank', 'noopener')
    else if (o.id === 'recuperar') void recuperarla()
    else if (o.id === 'documento') raiz.current?.querySelector<HTMLInputElement>(docAccion?.que === 'poner' ? '.kf-soltar input[type=file]' : '[data-prueba="cambiar-documento"]')?.click()
  }
  const conceptoTexto = propuesta?.concepto ?? (prov ? `${b.numero || 'Factura'}-${prov.nombre}` : '')

  // ── K11b · La ficha como ERP10 (maqueta nucleo_17a): lo que se calcula para pintarla ──
  const pct = otrosL?.ivaDeducible ?? 100
  // Las contrapartidas suman la base (con su recargo); lo que no se deduce del IVA (al 50 %, la mitad de la cuota) va al
  // gasto en el asiento, repartido por línea (conIvaDeducible), y en una sola línea se ve en su importe.
  const baseGasto = totales.base + (totales.recargo ?? 0)
  const noDeducible = Math.round(totales.iva * (100 - pct)) / 100
  const unaLinea = b.gastos.length === 1
  const importeLinea = (i: number) => (unaLinea ? baseGasto : num(b.gastos[i]?.importe ?? ''))
  const suma = sumaDeContrapartidas(b.gastos.map((_, i) => importeLinea(i)), baseGasto)
  const rotuloSuma = rotuloDeLaSuma(suma, cifra)
  const pagoProp = modo === 'contabilizada' ? null : { cuenta: pagoCuenta, fecha: pagoFecha, concepto: `PAGO ${b.numero || 'FACTURA'} ${prov?.nombre ?? ''}`.trim() }
  const pagos = filasDePago({ total: importePago, pagos: pagosHechos, propuesta: pagoProp, cifra })
  // K11b · 4 · El pago que se apunta al validar, en la visualización (como la maqueta 17a): al debe el proveedor, al haber su cuenta.
  const pagoSinHacer = !pagosHechos.length && modo !== 'contabilizada' ? pagos.filas.find((x) => x.id === null) ?? null : null
  const visualPago = pagoSinHacer ? pagoPorHacer({ proveedor: cuentasAsiento?.proveedor ?? null, cuenta: pagoSinHacer.cuenta,
    nombreCuenta: cuentasPago?.nombres.get(pagoSinHacer.cuenta.trim()) ?? '', importe: pagoSinHacer.importe }) : []
  const enEdicion = pagoEdit?.de === invoiceId ? pagoEdit : null
  const registrosPago = (cuentasPago?.lista ?? []).map((c) => ({ id: c.codigo, codigo: c.codigo, descripcion: c.nombre }))
  // K13 · Local, marca y plataforma por su código corto (003, MIL, GLO; 2347): con Intro, el código elige; la lupa busca
  // por código y por nombre. Sin código (la base aún sin la 2347), el nombre, como hasta ahora.
  const codigoDe = (tabla: 'locations' | 'brand' | 'sales_channel', id: string) => codigos?.find((c) => c.tabla === tabla && c.id === id)?.codigo ?? null
  const marcasLupa = marcas.map((m) => ({ id: m.id, codigo: codigoDe('brand', m.id) ?? m.codigo, descripcion: m.nombre }))
  const plataformasLupa = (plataformas ?? []).map((x) => ({ ...x, codigo: codigoDe('sales_channel', x.id) ?? x.codigo }))
  const localesLupa = locales.map((l) => ({ id: l.id, codigo: codigoDe('locations', l.id) ?? l.nombre, descripcion: l.nombre }))
  // K11b · 4 · El local de cada línea, con su lupa: «Común» (o «Sin locales», en gris) y los locales de la cuenta.
  // K13 · «Común» va sin código (vacío e Intro, como en ERP10); su nombre, en la casilla gris de al lado.
  const comunLocal = { id: aMano && ejeLocal ? LOCAL_COMUN : '', codigo: '', descripcion: ejeLocal ? 'Común a todos los locales' : 'Sin locales' }
  const registrosLocal = [comunLocal, ...localesLupa]
  const tituloLocal = (v: string | null | undefined) => {
    const r = localesLupa.find((l) => l.id === v)
    if (r) return r.id === localPropuesto ? `${r.descripcion} (su ficha)` : r.descripcion
    return !ejeLocal ? 'Sin locales' : v === LOCAL_COMUN || (!aMano && !v) ? 'Común a todos los locales' : 'Elige el local (F4 abre la lista)'
  }
  const nombreDelLocal = (v: string | null | undefined) => (!ejeLocal ? 'Sin locales' : localesLupa.find((l) => l.id === v)?.descripcion ?? (v === LOCAL_COMUN || (!aMano && !v) ? 'Común' : ''))
  // K13 · Los tramos de cada línea (0001): los que se están escribiendo, los guardados (dos o más) o, sin reparto, uno solo
  // con la analítica de la línea y su importe.
  const tramosEnEdicion = tramosEdit?.de === invoiceId ? tramosEdit : null
  const tramosDe = (i: number): { tramos: TramoFicha[]; reparto: boolean } => {
    if (tramosEnEdicion?.linea === i) return { tramos: tramosEnEdicion.tramos, reparto: true }
    const g = tramosL?.get(i)
    if (g && g.length > 1) return { tramos: g, reparto: true }
    return { tramos: [{ localId: b.gastos[i]?.local || null, marcaId: marcaDe(i), canalId: datoDe(i)?.canalId ?? null, importe: importeLinea(i) ?? 0 }], reparto: false }
  }
  const cuadreEdicion = tramosEnEdicion ? cuadreDeTramos(tramosEnEdicion.linea + 1, importeLinea(tramosEnEdicion.linea) ?? 0, tramosEnEdicion.tramos) : null
  // K13 · El I.V.A.: dos grupos por fila; dos filas al principio y, al usar el último hueco libre, otra vacía (sin ⊕).
  const filasIva = soloLectura ? Math.max(2, Math.ceil(b.iva.length / 2)) : filasDeIva(b.iva.length)
  const tipoLibre = () => String(tiposIva.find((t) => !b.iva.some((l) => l.tipo === String(t))) ?? 21)
  async function guardarLosTramos(linea: number, tramos: TramoFicha[]) {
    if (!fac || guardandoTramos) return
    setGuardandoTramos(true)
    try { const r = await guardarTramos(fac.id, linea, tramos, userName ?? null); setTramosEdit(null); setAviso({ tono: 'ok', texto: r.texto }); setVuelta((v) => v + 1) }
    catch (e) { setAviso({ tono: 'mal', texto: `No se ha guardado el reparto: ${msg(e)}.` }) }
    finally { setGuardandoTramos(false) }
  }
  /** Un cambio en los tramos de una línea: se guarda en cuanto suman su importe; si no, se queda escrito y lo dice. */
  function cambiarTramos(linea: number, tramos: TramoFicha[]) {
    const habia = (tramosL?.get(linea)?.length ?? 0) > 1
    if (tramos.length < 2) {
      if (habia) void guardarLosTramos(linea, [])
      setTramosEdit(null)
      return
    }
    const c = cuadreDeTramos(linea + 1, importeLinea(linea) ?? 0, tramos)
    if (c.cuadra && tramos.every((t) => t.importe > 0)) { setTramosEdit({ de: invoiceId, linea, tramos }); void guardarLosTramos(linea, tramos); return }
    setTramosEdit({ de: invoiceId, linea, tramos })
  }
  const ejercicio = (b.fecha || hoy).slice(0, 4)
  const comprobacion = (id: string) => comprobaciones.find((c) => c.id === id && c.tono !== 'bien') ?? null
  /** El ámbar de una comprobación: su motivo en el `title` (sin frases) y `data-comprobacion`; si no, de dónde sale el dato. */
  const marcaComprobacion = (id: string, deDonde?: string | null): { title?: string; datos?: Record<`data-${string}`, string> } => {
    const c = comprobacion(id)
    return c ? { title: c.texto, datos: { 'data-comprobacion': id } } : deDonde ? { title: deDonde } : {}
  }
  const fechaCorta = (iso: string | null | undefined) => (iso ? iso.split('-').reverse().join('/') : '')
  const otrosAbiertos = otrosAbierto === invoiceId
  const visualFactura = aVisual(modo === 'contabilizada' ? lineasValidado : previa && totales.total !== 0 ? conIvaDeducible(previa.lineas, pct) : [])


  return (
    <div className="kf-ficha kf-recibida kr" ref={raiz} onKeyDown={(e) => { marcarTocada(); alPulsar(e) }} onPointerDown={marcarTocada} data-prueba="ficha-recibida-nucleo" aria-busy={cargando || leyendoPago || leyendoPropuesta || undefined}>
      {salida.aviso}
      <div className="kf-cuerpo kr-cuerpo">
        <div className="kf-izquierda kr-izquierda">
          <Ventana id="kr" titulo={aMano ? 'Introducción de facturas recibidas · nueva' : 'Introducción de facturas recibidas'} pestanas={['Datos factura']}
            alCerrar={() => (pestana?.cerrar ? pestana.cerrar() : salida.pedirSalir(() => navegar(rutaDocumentos('por-revisar'))))}>
            <Barra
              guardar={{ hacer: () => void guardarYSiguiente(), puede: puede && !cargando, titulo: enModificar ? 'Guardar lo modificado (Intro)' : 'Guardar, validar y la siguiente (Intro)', datos: { 'data-guardar-y-siguiente': '' } }}
              cancelar={{ hacer: () => (enModificar ? cancelarModificacion() : ed.descartar()), puede: ed.hay || enModificar, titulo: 'Cancelar lo escrito (Esc)' }}
              nuevo={{ hacer: () => salida.pedirSalir(() => navegar(rutaRecibidaAMano())), puede: !aMano, titulo: 'Factura nueva, a mano' }}
              anterior={{ hacer: () => { if (anterior) salida.pedirSalir(() => ir(anterior, undefined, anterior === deDonde?.vieneDe ? { despues: invoiceId } : undefined)) }, puede: !aMano && !!anterior, titulo: 'La anterior' }}
              siguiente={{ hacer: () => { if (siguiente) salida.pedirSalir(() => ir(siguiente)) }, puede: !aMano && !!siguiente, titulo: 'La siguiente' }}
              documento={{ hacer: () => alPulsarMas({ id: 'abrir', texto: '' } as OpcionMas), puede: !!documento, hay: !!documento, titulo: documento ? 'Abrir el documento' : 'Sin documento' }}
              extra={<>
                {provId && <Link className="kp-barra-texto" to={`/conta/proveedores/${provId}`} data-prueba="ficha-proveedor">Ficha proveedor</Link>}
                {!cargando && modo === 'contabilizada' && !enModificar && (
                  <button type="button" className="kp-barra-texto" data-prueba="modificar" disabled={!sePuede.datos?.puede}
                    title={porqueNoModificar(sePuede.datos ?? (sePuede.error ? { puede: false, porque: sePuede.error } : null)) ?? 'Modificar las cuentas del asiento, con el mismo número'}
                    onClick={() => { setModificando({ de: invoiceId, elegidas: {} }); setAviso(null) }}>Modificar</button>
                )}
                {enModificar && <span className="kf-modificar" data-prueba="modificando" />}
                <Mas aMano={aMano} opciones={opciones} alPulsar={alPulsarMas} abrirCompleta={() => setCompleta(true)} />
              </>}
              aviso={<>
                {!cargando && <EstadoFicha {...franja} />}
                {aviso && <span className="kp-aviso" data-tono={aviso.tono === 'ok' ? 'bien' : 'ambar'} role="status" data-prueba="aviso-ficha" title={aviso.texto}>{aviso.texto}</span>}
                {cola && <span className="kf-cola">{cola}</span>}
              </>}
            />
            {confirmarDoc?.de === invoiceId && (
              <div data-prueba="confirmar-documento"><Duda fuerte="Confirma." texto={<>{docAccion?.que === 'cambiar_contabilizada' ? docAccion.confirmar : ''} El nuevo: «{confirmarDoc.file.name}». El asiento no cambia.</>}
                principal={{ texto: 'Cambiarlo', hacer: () => void cambiarYa(confirmarDoc.file) }}
                secundario={{ texto: 'Dejar el de antes', hacer: () => setConfirmarDoc(null) }} /></div>
            )}
            {verHistorial === invoiceId && (
              <section className="kf-historial" role="dialog" aria-label="El historial de la factura" data-prueba="historial">
                <header><h3>El historial de la {fac?.numero ?? 'factura'}</h3><button type="button" className="kf-enlace" onClick={() => setVerHistorial(null)}>Cerrar</button></header>
                {historial.error ? <p className="kf-panel-nota" role="alert">{historial.error}</p>
                  : !historial.datos ? <p className="kf-panel-nota" aria-busy="true">Leyendo su historial…</p>
                  : lineasHistorial.length ? <ol>{lineasHistorial.map((x, i) => <li key={i}>{x.texto}<small>{x.cuando} · {x.quien}</small></li>)}</ol>
                  : <p className="kf-panel-nota">Aún no se ha cambiado nada de esta factura.</p>}
              </section>
            )}
            <div className="kr-pantalla">
              {cargando ? <p className="kf-panel-nota" aria-busy="true">Abriendo la factura…</p> : (
              <div className="kr-lienzo" style={{ ['--kr-iva-mas' as string]: String(filasIva - 2) } as CSSProperties}>
              <fieldset className="kf-solo-lectura kr-campos" disabled={soloLectura} data-solo-lectura={soloLectura ? 'si' : undefined}>
                {/* ── Datos factura (17b: tres filas) ── */}
                <h2 className="kr-hd" style={{ top: 0 }} data-pieza="bloque"><span>Datos factura</span></h2>
                <Caja sitio="f1-1" rotulo="Tipo de introducción" para="kr-tipo" rotuloGris gris><input id="kr-tipo" readOnly tabIndex={-1} value="Factura recibida" /></Caja>
                {/* El periodo: el ejercicio con su lupa (elige el trimestre en que se deduce; los presentados no salen) y su descripción. */}
                <Caja sitio="f1-2" rotulo="Periodo contable" para="kr-ejercicio" ambar={!!comprobacion('periodo')} {...marcaComprobacion('periodo')}>
                  <CasillaLupa id="kr-ejercicio" etiqueta="Ejercicio" registros={trimestres.filter((t) => !t.presentado).map((t) => ({ id: t.inicio, codigo: ejercicio, descripcion: t.texto }))}
                    valor={trim?.trimestre?.inicio ?? null} vista={() => ejercicio} gris={!cabEscribible || trimestres.length === 0 || guardandoCab}
                    titulo={trim?.elegido ? 'Elegido en esta factura (F4 abre los trimestres)' : 'El de su fecha (F4 abre los trimestres)'}
                    poner={(r) => { if (r) void ponerCabecera({ deduce_en: r.id }) }} />
                </Caja>
                <Caja sitio="f1-3" gris><input id="kf-deduce" aria-label="Se deduce en" readOnly tabIndex={-1} value={trim?.trimestre?.texto ?? trimestreDe(b.fecha)} /></Caja>
                {/* El documento: el número del asiento (lo pone el programa al validarla); su lupa, las otras facturas del proveedor. */}
                <Caja sitio="f1-4" rotulo="Documento" para="kf-serie" gris>
                  <input id="kf-serie" readOnly tabIndex={-1} value={fac?.asiento?.numero ? String(fac.asiento.numero) : ''} title={fac?.asiento?.numero ? `Serie 2 · asiento ${fac.asiento.numero}` : 'Lo pone el programa al validarla'} />
                  <LupaSola etiqueta="Las facturas del proveedor" puede={!!provId} hacer={() => provId && navegar(`${rutaDocumentos('todas')}${rutaDocumentos('todas').includes('?') ? '&' : '?'}proveedor=${encodeURIComponent(provId)}`)} />
                </Caja>
                <Caja sitio="f1-5" rotulo="Fecha introducción" para="kr-contable" gris={!cabEscribible} title={otrosL?.fechaContable ? 'La fecha contable escrita en «Otros datos»' : 'La de la factura'}>
                  {cabEscribible && otrosL
                    ? <CasillaFecha id="kr-contable" ayuda="" etiqueta="Fecha introducción" iso={otrosL.fechaContable ?? b.fecha} hoy={hoy} casilla={false}
                        poner={(x) => { if (x !== (otrosL.fechaContable ?? b.fecha)) void ponerOtros({ fecha_contable: x && x !== b.fecha ? x : null }) }} />
                    : <input id="kr-contable" readOnly tabIndex={-1} value={fechaCorta(otrosL?.fechaContable ?? b.fecha)} />}
                  <Calendario para="kr-contable" />
                </Caja>
                <Caja sitio="f1-6" rotulo="Fecha factura" para="kf-fecha" title={origen.fecha ?? undefined}>
                  <CasillaFecha id="kf-fecha" ayuda="" etiqueta="Fecha factura" iso={b.fecha} hoy={hoy} poner={(x) => ed.poner('fecha', x)} />
                  <Calendario para="kf-fecha" />
                </Caja>

                <Caja sitio="f2-1" rotulo="Proveedor" para="kf-proveedor" ambar={!!emisor} title={emisor ? `No conozco al que la emite${emisor.nombre ? `: ${emisor.nombre}` : ''}` : origen.proveedor ?? undefined}>
                  <Buscador id="kf-proveedor" lupa etiqueta="Proveedor" cargando={proveedoresL === null} enfocar={abrirProveedor} duda={!!emisor} valor={textoProv ?? (provId ? textoCasillaProveedor({ subcuenta, futura: cuentasAsiento?.proveedor?.codigo ?? '', nombre: prov?.nombre ?? null }) : '')} cuenta={subcuenta || null}
                    placeholder={aMano ? 'Código o NIF' : undefined}
                    ponerTexto={setTextoProv} lista={(t) => proveedoresQueEncajan(t, proveedores, codigosProv ?? new Map())}
                    texto={(p) => `${p.nombre}${codigosProv?.get(p.id) ? ` · ${codigosProv.get(p.id)}` : ''}${p.nif ? ` · ${p.nif}` : ''}`} elegir={(p) => { if (emisor) void elegirYGuardar(p.id, p.nombre, `Elegido ${p.nombre}.`); else { ed.poner('proveedorId', p.id); setTextoProv(null) } }} />
                </Caja>
                {aMano && !provId && !nuevo && (
                  <button type="button" className="kr-nuevo-proveedor" data-prueba="nuevo-proveedor" aria-label="Nuevo proveedor" title="Nuevo proveedor" onClick={() => setNuevo({ nif: '', nombre: textoProv?.trim() ?? '', fallo: null, ocupado: false })}>+ Nuevo</button>
                )}
                {/* El saldo a la fecha; su lupa, el mayor del proveedor. */}
                <Caja sitio="f2-2" rotulo="Saldo a la fecha" para="kr-saldo" gris num>
                  <input id="kr-saldo" readOnly tabIndex={-1} data-prueba="saldo-proveedor" value={mayor ? cifra(mayor.saldo) : ''}
                    title={conEstaFactura !== null ? `Con esta factura: ${cifra(conEstaFactura)}` : undefined} />
                  <LupaSola etiqueta="El mayor del proveedor" puede={!!subcuenta} hacer={() => subcuenta && navegar(rutaMayor(subcuenta))} />
                </Caja>
                {nuevo ? (<>
                  <Caja sitio="f2-3" rotulo="N.I.F." para="kf-nif"><input id="kf-nif" data-casilla autoCapitalize="characters" autoFocus value={nuevo.nif}
                    onChange={(e) => setNuevo({ ...nuevo, nif: e.target.value, fallo: null, repetido: null })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void crearNuevo() } }} /></Caja>
                  <Caja sitio="f2-4" rotulo="Nombre" para="kf-nombre"><input id="kf-nombre" data-casilla value={nuevo.nombre}
                    onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value, fallo: null })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void crearNuevo() } }} /></Caja>
                </>) : (<>
                  {/* El NIF; su lupa busca el proveedor por su NIF. */}
                  <Caja sitio="f2-3" rotulo="N.I.F." para="kf-nif" ambar={!!comprobacion('nif')} {...marcaComprobacion('nif', origen.nif)}>
                    <input id="kf-nif" readOnly tabIndex={-1} value={prov?.nif ?? emisor?.nif ?? ''} />
                    <LupaSola etiqueta="Buscar el proveedor por su NIF" puede={!soloLectura} hacer={() => { setTextoProv(prov?.nif ?? emisor?.nif ?? ''); setAbrirProveedor((n) => n + 1) }} />
                  </Caja>
                  <Caja sitio="f2-4" rotulo="Nombre" para="kf-nombre"><input id="kf-nombre" readOnly tabIndex={-1} value={prov?.nombre ?? emisor?.nombre ?? ''} title={prov?.nombre ?? emisor?.nombre ?? undefined} /></Caja>
                </>)}

                <Caja sitio="f3-1" rotulo="Nº Factura" para="kf-numero" ambar={!!comprobacion('repetida')} {...marcaComprobacion('repetida', origen.numero)}>
                  <input id="kf-numero" data-casilla value={b.numero} onChange={(e) => ed.poner('numero', e.target.value)} />
                </Caja>
                <Caja sitio="f3-2" rotulo="Concepto asiento" para="kf-concepto" title={cab?.concepto ? 'Escrito en esta factura' : origen.concepto ?? undefined}>
                  {cabEscribible ? (
                    <input id="kf-concepto" data-casilla maxLength={200} value={textoConcepto?.k === invoiceId ? textoConcepto.v : conceptoTexto} title={conceptoTexto}
                      onChange={(e) => setTextoConcepto({ k: invoiceId ?? '', v: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur() } }}
                      onBlur={() => {
                        if (textoConcepto?.k !== invoiceId) return
                        const v = textoConcepto.v.trim(); setTextoConcepto(null)
                        if (v !== conceptoTexto.trim()) void ponerCabecera({ concepto: v || null })
                      }} />
                  ) : <input id="kf-concepto" readOnly tabIndex={-1} value={conceptoTexto} title={conceptoTexto} />}
                </Caja>
                {/* El tipo de operación: la lupa delante y el ⊕ («Otros datos») detrás, como la 17b. */}
                <Caja sitio="f3-3" rotulo="Tipo de operación" para="kf-operacion" lupa="antes" gris ambar={origenOp === 'Cambiado en esta factura'}
                  mas={!aMano && otrosL ? <BotonMas17 etiqueta="Otros datos" abierto={otrosAbiertos} hacer={() => setOtrosAbierto((x) => (x === invoiceId ? null : invoiceId))} /> : undefined}>
                  {cabEscribible ? (
                    <CasillaLupa id="kf-operacion" etiqueta="Tipo de operación" registros={OPERACIONES.map((o) => ({ id: o.valor, codigo: o.corto, descripcion: o.texto }))}
                      valor={opFactura ?? opFicha ?? null} vista={(r) => r.descripcion} gris={guardandoCab} titulo={`${textoDeOperacion(opFactura ?? opFicha)}${origenOp ? ` · ${origenOp}` : ''}` || undefined}
                      poner={(r) => { const v = r && esOperacion(r.id) ? r.id : null; void ponerCabecera({ operacion: v === opFicha ? null : v }) }} />
                  ) : <input id="kf-operacion" readOnly tabIndex={-1} value={textoDeOperacion(opFactura ?? opFicha) || (textoOperacion(delProv?.regimen ?? null) ?? '')} title={textoDeOperacion(opFactura ?? opFicha) || undefined} />}
                  {origenOp && <span className="kf-origen kr-oculto" data-prueba="origen-operacion" title={origenOp}>{origenOp === 'De su ficha' ? 'De su ficha' : 'Cambiado'}</span>}
                </Caja>

                {/* ── I.V.A. · Retención · Total factura: tres títulos; el IVA, dos grupos por fila, y crece sin ⊕ ── */}
                <h2 className="kr-hd3" style={{ left: '0.59%', width: '46.96%' }} data-pieza="bloque"><span>I.V.A.</span></h2>
                <h2 className="kr-hd3" style={{ left: '48.48%', width: '38.88%' }}><span>Retención</span></h2>
                <h2 className="kr-hd3" style={{ left: '88.06%', width: '9.37%' }} data-subrayado="si"><span>Total factura</span></h2>
                {Array.from({ length: filasIva * 2 }, (_, idx) => {
                  const l = b.iva[idx] ?? null
                  const fila = Math.floor(idx / 2)
                  const g = idx % 2
                  const libre = !l && idx === b.iva.length && !soloLectura
                  const campo = (k: number) => (fila < 2 ? `iva${fila + 1}-${g * 3 + k}` : undefined)
                  const estilo = { ['--kr-iva-fila' as string]: String(fila) } as CSSProperties
                  const rot = (t: string) => (fila === 0 ? t : undefined)
                  const tocar = (c: Partial<LineaIva>) => {
                    if (l) ponerIva(idx, c)
                    else if (libre) ed.poner('iva', [...b.iva, rehacerCuota({ base: '', tipo: tipoLibre(), cuota: '', ...c })])
                  }
                  return (
                    <div key={`iva-${idx}`} style={{ display: 'contents' }}>
                      <Caja sitio={`iva-${g * 3 + 1}`} campo={campo(1)} rotulo={rot('Base')} para={`kr-base-${idx}`} centro num estilo={estilo}>
                        <input id={`kr-base-${idx}`} data-casilla={l ? '' : undefined} aria-label={l ? `Base ${idx + 1}` : libre ? 'Otro tipo de IVA: base' : 'Hueco del IVA'} value={l?.base ?? ''} readOnly={!l && !libre} tabIndex={l || libre ? undefined : -1}
                          onChange={(e) => tocar({ base: e.target.value })}
                          data-ambar={l && importeDudoso(l.base) ? 'si' : undefined} title={l && importeDudoso(l.base) ? MOTIVO_IMPORTE_DUDOSO : undefined}
                          onBlur={() => { if (!l) return; const n = num(l.base); if (n !== null && !importeDudoso(l.base)) ponerIva(idx, { base: importeEs(n) }) }} />
                      </Caja>
                      <Caja sitio={`iva-${g * 3 + 2}`} campo={campo(2)} rotulo={rot('%')} para={`kr-tipo-${idx}`} centro estilo={estilo}>
                        <select id={`kr-tipo-${idx}`} data-casilla={l ? '' : undefined} aria-label={l ? `Tipo de IVA ${idx + 1}` : libre ? 'Otro tipo de IVA: %' : 'Hueco del IVA: %'} value={l?.tipo ?? ''} disabled={!l && !libre} tabIndex={l || libre ? undefined : -1}
                          onChange={(e) => { if (e.target.value) tocar({ tipo: e.target.value }) }}>
                          {!l && <option value="" />}
                          {[...new Set([...tiposIva.map(String), ...(l ? [l.tipo] : [])])].filter(Boolean).map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </Caja>
                      <Caja sitio={`iva-${g * 3 + 3}`} campo={campo(3)} rotulo={rot('Cuota')} para={`kr-cuota-${idx}`} centro num estilo={estilo}>
                        <input id={`kr-cuota-${idx}`} aria-label={l ? `Cuota ${idx + 1}` : libre ? 'Otro tipo de IVA: cuota' : 'Hueco del IVA: cuota'} value={l?.cuota ?? ''} tabIndex={-1} readOnly={!l} onChange={(e) => l && ponerIva(idx, { cuota: e.target.value }, false)} />
                        {l && b.iva.length > 1 && !soloLectura && <button type="button" className="kr-quitar" aria-label={`Quitar el tipo ${l.tipo} %`} tabIndex={-1} onClick={() => ed.poner('iva', b.iva.filter((_, j) => j !== idx))}>×</button>}
                      </Caja>
                    </div>
                  )
                })}
                <Caja sitio="iva-7" campo="iva1-7" rotulo="Tipo de retención" para="kr-retencion">
                  <CasillaLupa id="kr-retencion" etiqueta="Retención" registros={TIPOS_RETENCION.map((t) => ({ id: String(t), codigo: String(t), descripcion: `${t} %` }))}
                    valor={b.retencion?.tipo ?? null} vista={(r) => r.descripcion} datos={{ 'data-casilla': '' }} alIntro={() => pasarDe('kr-retencion')}
                    titulo={b.retencion ? `Retención del ${b.retencion.tipo} %` : 'Sin retención (F4 abre los tipos)'}
                    poner={(r) => ed.poner('retencion', r ? rehacerRetencion({ tipo: r.id, importe: '' }, totales.base) : null)} />
                </Caja>
                <Caja sitio="iva-8" campo="iva1-8" rotulo="Base" para="kr-ret-base" centro num gris><input id="kr-ret-base" readOnly tabIndex={-1} value={b.retencion ? cifra(totales.base) : ''} /></Caja>
                <Caja sitio="iva-9" campo="iva1-9" rotulo="%" para="kr-ret-tipo" centro gris><input id="kr-ret-tipo" readOnly tabIndex={-1} value={b.retencion?.tipo ?? ''} /></Caja>
                <Caja sitio="iva-10" campo="iva1-10" rotulo="Cuota" para="kr-ret-cuota" centro num gris><input id="kr-ret-cuota" readOnly tabIndex={-1} value={b.retencion?.importe ?? ''} /></Caja>
                <Caja sitio="iva-11" campo="iva1-11" num total ambar={!!comprobacion('suma')} {...marcaComprobacion('suma')}>
                  {aMano
                    ? <input id="kr-total" data-casilla aria-label="Total factura" placeholder="0,00"
                        value={textoTotal ?? (totales.total ? importeEs(totales.total) : '')}
                        title="Escríbelo y sale la base, con un solo tipo de IVA y la retención de su ficha"
                        onFocus={(e) => { setTextoTotal(totales.total ? importeEs(totales.total) : ''); e.target.select() }}
                        onChange={(e) => setTextoTotal(e.target.value)}
                        onBlur={() => {
                          const n = textoTotal !== null && !importeDudoso(textoTotal) ? leerImporte(textoTotal) : null
                          if (n !== null && Number.isFinite(n) && Math.round(n * 100) !== Math.round(totales.total * 100)) { const r = desdeElTotal(b, n); if (r) { ed.poner('iva', r.iva); ed.poner('retencion', r.retencion) } }
                          setTextoTotal(null)
                        }} />
                    : <input id="kr-total" readOnly tabIndex={-1} aria-label="Total factura" data-prueba="total" value={cifra(totales.total)} />}
                </Caja>
              </fieldset>

              {/* ── Contrapartida/s: fila 1, la subcuenta y su nombre, el concepto y el importe; fila 2, el reparto ── */}
              <h2 className="kr-hd" style={{ top: 'calc(var(--kr-hd-contra) + var(--kr-extra))' }} data-pieza="bloque">
                <span>Contrapartida/s</span>
                <span className="kr-hd-der" data-ambar={cuadreEdicion?.texto || rotuloSuma.motivo ? 'si' : undefined} title={cuadreEdicion?.texto ?? rotuloSuma.motivo ?? undefined}>
                  {cuadreEdicion?.texto ? <span data-prueba="reparto-no-suma">{cuadreEdicion.texto}</span>
                    : !unaLinea ? <span data-prueba="suma-contrapartidas">{rotuloSuma.texto}</span> : null}
                  <span data-prueba="n-lineas">{b.gastos.length} {b.gastos.length === 1 ? 'línea' : 'líneas'}</span>
                  {!soloLectura && <BotonMas etiqueta="Otra línea" hacer={() => ed.poner('gastos', [...b.gastos, { cuenta: b.gastos[0]?.cuenta ?? '', local: '', importe: '' }])} />}
                </span>
              </h2>
              <fieldset className="kf-solo-lectura kr-campos" disabled={soloLectura} data-solo-lectura={soloLectura ? 'si' : undefined}>
              <div className="kr-lineas" role="table" aria-label="Las contrapartidas" data-hosteleria={hosteleria ? 'si' : undefined}>
                {b.gastos.map((g, i) => {
                  const d = datoDe(i)
                  const { tramos, reparto } = tramosDe(i)
                  const primera = i === 0
                  const c = (x: string) => (primera ? x : undefined)
                  const durante = guardandoCab || guardandoOtros || guardandoTramos
                  return (
                    <div className="kr-linea" role="row" key={i} data-linea={i} style={{ ['--kr-tramos-mas' as string]: String(tramos.length - 1) } as CSSProperties}>
                      <Caja sitio="c1-1" campo={c('c1-1')} rotulo={primera ? 'Subcuenta gasto' : undefined} para={`kf-cuenta-${i}`}
                        ambar={(!!duda && primera) || (primera && !!comprobacion('gasto-propuesto'))} title={primera ? (duda?.texto ?? comprobacion('gasto-propuesto')?.texto) : undefined}>
                        <Buscador id={`kf-cuenta-${i}`} lupa etiqueta={`Cuenta de gasto ${i + 1}`} cargando={cuentasGastoL === null} valor={textoCuenta[i] ?? g.cuenta} cuenta={g.cuenta || null} duda={!!duda && primera}
                          ponerTexto={(t) => { setTextoCuenta((x) => ({ ...x, [i]: t })); if (!t.trim()) ponerGasto(i, { cuenta: '' }) }} lista={(t) => cuentasQueEncajan(t, cuentasPlan, 8)}
                          texto={(x) => `${x.codigo} · ${x.nombre}`} elegir={(x) => { ponerGasto(i, { cuenta: x.codigo }); setTextoCuenta((y) => { const z = { ...y }; delete z[i]; return z }) }}
                          crear={crearCuenta((x) => { ponerGasto(i, { cuenta: x.codigo }); setTextoCuenta((y) => { const z = { ...y }; delete z[i]; return z }) })} />
                      </Caja>
                      <Caja sitio="c1-2" campo={c('c1-2')} gris><NombreDeCuenta etiqueta={`Nombre de la cuenta ${i + 1}`} valor={g.cuenta ? nombreGasto(g.cuenta) : ''} /></Caja>
                      <Caja sitio="c1-3" campo={c('c1-3')} rotulo={primera ? 'Concepto de gastos' : undefined} para={`kr-concepto-${i}`}>
                        <input id={`kr-concepto-${i}`} aria-label={`Concepto de gastos ${i + 1}`} maxLength={200} disabled={aMano || !cabEscribible} key={`${invoiceId}:c:${i}:${d?.concepto ?? ''}`} defaultValue={d?.concepto ?? ''}
                          placeholder={conceptoTexto} title={d?.concepto || conceptoTexto || undefined}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur() } }}
                          onBlur={(e) => { const v = e.currentTarget.value.trim() || null; if (v !== (d?.concepto ?? null)) ponerDatoLinea(i, { concepto: v }) }} />
                      </Caja>
                      <Caja sitio="c1-4" campo={c('c1-4')} rotulo={primera ? 'Importe' : undefined} para={`kr-importe-${i}`} num>
                        {unaLinea
                          ? <input id={`kr-importe-${i}`} aria-label={`Importe del gasto ${i + 1}`} readOnly tabIndex={-1} value={importeEs(baseGasto + noDeducible)} title={pct < 100 ? `La base y el ${100 - pct} % del IVA que no se deduce` : undefined} />
                          : <CasillaImporte id={`kr-importe-${i}`} etiqueta={`Importe del gasto ${i + 1}`} valor={g.importe} poner={(t) => ponerGasto(i, { importe: t })} />}
                        {!unaLinea && !soloLectura && <button type="button" className="kr-quitar" aria-label={`Quitar la cuenta ${i + 1}`} tabIndex={-1} onClick={() => ed.poner('gastos', b.gastos.filter((_, j) => j !== i))}>×</button>}
                      </Caja>
                      {tramos.map((t, k) => {
                        const uno = !reparto
                        const cc = (x: string) => (primera && k === 0 ? x : undefined)
                        const estilo = { ['--kr-tramo-n' as string]: String(k) } as CSSProperties
                        const sufijo = k === 0 ? (primera ? '' : ` ${i + 1}`) : ` ${i + 1}.${k + 1}`
                        const cambiar = (x: Partial<TramoFicha>) => cambiarTramos(i, tramos.map((y, j) => (j === k ? { ...y, ...x } : y)))
                        const idLocal = uno ? `kr-local-${i}` : `kr-local-${i}-${k}`
                        const idMarca = uno ? (primera ? 'kf-marca' : `kr-marca-${i}`) : `kr-marca-${i}-${k}`
                        const idCanal = uno ? `kr-plataforma-${i}` : `kr-plataforma-${i}-${k}`
                        return (
                          <div key={k} style={{ display: 'contents' }} data-tramo={k}>
                            <Caja sitio="c2-1" campo={cc('c2-1')} rotulo={k === 0 ? 'Local' : undefined} para={idLocal} estilo={estilo}>
                              <CasillaLupa id={idLocal} etiqueta={`Local${sufijo}`} registros={registrosLocal} valor={ejeLocal ? t.localId ?? (uno ? g.local ?? '' : '') : ''}
                                gris={!ejeLocal || (!uno && durante)} datos={ejeLocal ? { 'data-casilla': '' } : undefined}
                                titulo={tituloLocal(t.localId)} alIntro={() => pasarDe(idLocal)}
                                poner={(r) => (uno ? ponerGasto(i, { local: r ? r.id : '' }) : cambiar({ localId: r?.id || null }))} />
                            </Caja>
                            <Caja sitio="c2-2" campo={cc('c2-2')} gris estilo={estilo}><input aria-label={`Nombre del local${sufijo}`} readOnly tabIndex={-1} value={nombreDelLocal(t.localId)} title={nombreDelLocal(t.localId) || undefined} /></Caja>
                            {/* La marca y la plataforma, solo en una empresa de hostelería (K11b). */}
                            {hosteleria && <>
                            <Caja sitio="c2-3" campo={cc('c2-3')} rotulo={k === 0 ? 'Marca' : undefined} para={idMarca} estilo={estilo}>
                              <CasillaLupa id={idMarca} etiqueta={`Marca${sufijo}`} registros={marcasLupa} valor={t.marcaId ?? null}
                                gris={!cabEscribible || durante} datos={cabEscribible ? { 'data-casilla': '' } : undefined} alIntro={() => pasarDe(idMarca)}
                                titulo={marcasLupa.find((m) => m.id === t.marcaId)?.descripcion ?? 'Sin marca'}
                                poner={(r) => (uno ? ponerDatoLinea(i, { marca: r?.id ?? null }) : cambiar({ marcaId: r?.id ?? null }))} />
                            </Caja>
                            <Caja sitio="c2-4" campo={cc('c2-4')} gris estilo={estilo}><input aria-label={`Nombre de la marca${sufijo}`} readOnly tabIndex={-1} value={marcasLupa.find((m) => m.id === t.marcaId)?.descripcion ?? ''} title={marcasLupa.find((m) => m.id === t.marcaId)?.descripcion} /></Caja>
                            <Caja sitio="c2-5" campo={cc('c2-5')} rotulo={k === 0 ? 'Plataforma' : undefined} para={idCanal} estilo={estilo}>
                              <CasillaLupa id={idCanal} etiqueta={`Plataforma${sufijo}`} registros={plataformasLupa} valor={t.canalId ?? null}
                                gris={!cabEscribible || durante} datos={cabEscribible ? { 'data-casilla': '' } : undefined} alIntro={() => pasarDe(idCanal)}
                                titulo={plataformasLupa.find((x) => x.id === t.canalId)?.descripcion ?? 'Sin plataforma'}
                                poner={(r) => (uno ? ponerDatoLinea(i, { plataforma: r?.id ?? null }) : cambiar({ canalId: r?.id ?? null }))} />
                            </Caja>
                            <Caja sitio="c2-6" campo={cc('c2-6')} gris estilo={estilo}><input aria-label={`Nombre de la plataforma${sufijo}`} readOnly tabIndex={-1} value={plataformasLupa.find((x) => x.id === t.canalId)?.descripcion ?? ''} title={plataformasLupa.find((x) => x.id === t.canalId)?.descripcion} /></Caja>
                            </>}
                            <Caja sitio="c2-7" campo={cc('c2-7')} rotulo={k === 0 ? 'Importe' : undefined} para={`kr-tramo-${i}-${k}`} num estilo={estilo}
                              mas={k === tramos.length - 1 ? <BotonMas17 etiqueta={`Otro tramo del reparto de la línea ${i + 1}`} puede={cabEscribible && !durante}
                                titulo={cabEscribible ? 'Repartir la línea: otro local, marca o plataforma con su importe' : 'El reparto se escribe en una factura guardada'}
                                hacer={() => setTramosEdit({ de: invoiceId, linea: i, tramos: [...tramos, { localId: null, marcaId: null, canalId: null, importe: 0 }] })} /> : undefined}>
                              {uno
                                ? <input id={`kr-tramo-${i}-${k}`} aria-label={`Importe del reparto${sufijo}`} readOnly tabIndex={-1} value={importeEs(t.importe)} />
                                : <CasillaImporte id={`kr-tramo-${i}-${k}`} etiqueta={`Importe del tramo${sufijo}`} valor={t.importe ? importeEs(t.importe) : ''}
                                    poner={(x) => { const n = leerImporte(x); if (!x.trim() || !(n > 0)) cambiarTramos(i, tramos.filter((_, j) => j !== k)); else cambiar({ importe: n }) }} />}
                            </Caja>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
              </fieldset>
              {!soloLectura && avisoInmovilizado(b.gastos.map((g) => g.cuenta)) && (
                <p className="kf-aviso-linea kr-oculto" data-prueba="aviso-inmovilizado">{avisoInmovilizado(b.gastos.map((g) => g.cuenta))}</p>
              )}

              {/* ── Pago factura: una fila por pago (K10c); el ⊕, apagado hasta validar ── */}
              <h2 className="kr-hd" style={{ top: 'calc(var(--kr-hd-pago) + var(--kr-extra))' }} data-pieza="bloque">
                <span>Pago factura</span>
                {modo === 'contabilizada' && (
                  <span className="kr-hd-der" data-ambar={pagos.ambar ? 'si' : undefined} title={pagos.motivo ?? undefined}>
                    <span data-prueba="pendiente">{pagos.pendiente > 0.005 ? `Pendiente ${cifra(pagos.pendiente)}` : 'Pagada'}</span>
                    {/* Validada, el ⊕ de otro pago va aquí: detrás del importe están el ✎ y la 🗑 de cada pago (K10c). */}
                    <BotonMas etiqueta="Otro pago" texto={otroPago(pagosHechos.length).replace(/^otro pago · /, '')}
                      hacer={() => { if (enEdicion) return; setBorrarArmado(null); setPagoEdit({ de: invoiceId, id: null, cuenta: '', fecha: hoy, concepto: `PAGO ${b.numero} ${prov?.nombre ?? ''}`.trim(), importe: pagos.pendiente > 0 ? importeEs(pagos.pendiente) : '' }) }} />
                  </span>
                )}
              </h2>
              <div className="kr-pagos" role="table" aria-label="Los pagos de la factura">
                {pagos.filas.map((f, i) => {
                  const cnd = f.id ? candados?.[pagosHechos.findIndex((p) => p.id === f.id)] ?? null : null
                  const editando = enEdicion && enEdicion.id === f.id && f.id !== null
                  const primera = i === 0
                  const c = (x: string) => (primera ? x : undefined)
                  const r = (x: string) => (primera ? x : undefined)
                  // Sin validar, el ⊕ de otro pago detrás del importe, apagado (17b; se apunta una vez validada, K10c).
                  const masPago = f.id === null ? <BotonMas17 etiqueta="Otro pago" puede={false} titulo="Otro pago: se apunta una vez validada la factura" hacer={() => undefined} /> : undefined
                  if (f.id === null) {
                    // La propuesta del K06: se apunta al validar.
                    return (
                      <div className="kr-pago-fila" role="row" key="propuesta" data-propuesta="si">
                        <Caja sitio="p1-1" campo={c('p1-1')} rotulo={r('Periodo')} para="kr-pago-periodo" gris><input id="kr-pago-periodo" aria-label="Periodo del pago" readOnly tabIndex={-1} value={f.ejercicio} /></Caja>
                        <Caja sitio="p1-2" campo={c('p1-2')} gris><input aria-label="Descripción del periodo del pago" readOnly tabIndex={-1} value={trimestreDe(pagoFecha || b.fecha)} /></Caja>
                        <Caja sitio="p1-3" campo={c('p1-3')} rotulo={r('Docum.')} para="kr-pago-doc" gris><input id="kr-pago-doc" aria-label="Documento del pago" readOnly tabIndex={-1} value="" title="Lo pone el programa al apuntarlo" /></Caja>
                        <Caja sitio="p1-4" campo={c('p1-4')} rotulo={r('Subcuenta pago')} para="kf-pago" ambar={!!dudaPago} datos={{ 'data-prueba': 'pago-cuenta' }}
                          title={dudaPago ? textoDudaPago(dudaPago, (x) => cuentasPago?.nombres.get(x) ?? '').texto : [nombrePago, origenPago].filter(Boolean).join(' · ') || undefined}>
                          <Buscador id="kf-pago" lupa etiqueta="La cuenta del pago" cargando={!cuentasPago} valor={textoPago ?? pagoCuenta} cuenta={pagoCuenta || null} duda={!!dudaPago}
                            ponerTexto={(t) => { setTextoPago(t); if (!t.trim()) ed.poner('pagoCuenta', PAGO_VACIO) }} lista={(t) => cuentasQueEncajan(t, [...(cuentasPago?.lista ?? []), ...creadas], 8)}
                            inicial={() => ultimasDelPago.map((x) => [...(cuentasPago?.lista ?? []), ...creadas].find((y) => y.codigo === x) ?? { codigo: x, nombre: cuentasPago?.nombres.get(x) ?? 'La de su último pago' })}
                            texto={(x) => `${x.codigo} · ${x.nombre}`} elegir={(x) => { ed.poner('pagoCuenta', x.codigo); setTextoPago(null) }}
                            crear={crearCuenta((x) => { ed.poner('pagoCuenta', x.codigo); setTextoPago(null) })} />
                        </Caja>
                        <Caja sitio="p1-5" campo={c('p1-5')} rotulo={r('Fecha')} para="kf-pago-fecha"><CasillaFecha id="kf-pago-fecha" ayuda="" etiqueta="La fecha del pago" iso={pagoCuenta ? pagoFecha : ''} hoy={hoy} poner={(x) => ed.poner('pagoFecha', x)} /></Caja>
                        <Caja sitio="p1-6" campo={c('p1-6')} rotulo={r('Concepto')} para="kr-pago-concepto" gris>
                          <input id="kr-pago-concepto" aria-label="Concepto del pago" readOnly tabIndex={-1} value={pagoCuenta ? f.concepto : ''} title={[pagoCuenta ? f.concepto : '', asientoDelPago].filter(Boolean).join(' · ') || undefined} data-prueba="pago-asiento" />
                        </Caja>
                        <Caja sitio="p1-7" campo={c('p1-7')} rotulo={r('Importe')} para="kr-pago-importe" num gris mas={masPago}>
                          <input id="kr-pago-importe" readOnly tabIndex={-1} aria-label="Importe del pago" value={cifra(importePago)} />
                          {origenPago && <span className="kf-origen kr-oculto" data-prueba="origen-pago" title={origenPago}>{origenPago}</span>}
                        </Caja>
                      </div>
                    )
                  }
                  if (editando && enEdicion) {
                    return (
                      <div className="kr-pago-fila" role="row" key={f.id} data-editando="si">
                        <Caja sitio="p1-1" campo={c('p1-1')} rotulo={r('Periodo')} gris><input aria-label="Periodo del pago" readOnly tabIndex={-1} value={enEdicion.fecha.slice(0, 4)} /></Caja>
                        <Caja sitio="p1-2" campo={c('p1-2')} gris><input aria-label="Descripción del periodo del pago" readOnly tabIndex={-1} value={trimestreDe(enEdicion.fecha)} /></Caja>
                        <Caja sitio="p1-3" campo={c('p1-3')} rotulo={r('Docum.')} gris><input aria-label="Documento del pago" readOnly tabIndex={-1} value={f.documento} /></Caja>
                        <Caja sitio="p1-4" campo={c('p1-4')} rotulo={r('Subcuenta pago')} para={`kr-pago-cuenta-${i}`}>
                          <CasillaLupa id={`kr-pago-cuenta-${i}`} etiqueta="Subcuenta pago" registros={registrosPago} valor={enEdicion.cuenta || null} poner={(x) => setPagoEdit({ ...enEdicion, cuenta: x?.codigo ?? '' })} />
                        </Caja>
                        <Caja sitio="p1-5" campo={c('p1-5')} rotulo={r('Fecha')} para={`kr-pago-fecha-${i}`}><CasillaFecha id={`kr-pago-fecha-${i}`} ayuda="" etiqueta="Fecha del pago" iso={enEdicion.fecha} hoy={hoy} poner={(x) => setPagoEdit({ ...enEdicion, fecha: x })} /></Caja>
                        <Caja sitio="p1-6" campo={c('p1-6')} rotulo={r('Concepto')}><input aria-label="Concepto del pago" value={enEdicion.concepto} onChange={(e) => setPagoEdit({ ...enEdicion, concepto: e.target.value })} /></Caja>
                        <Caja sitio="p1-7" campo={c('p1-7')} rotulo={r('Importe')} para={`kr-pago-importe-${i}`} num>
                          <CasillaImporte id={`kr-pago-importe-${i}`} etiqueta="Importe del pago" valor={enEdicion.importe} poner={(t) => setPagoEdit({ ...enEdicion, importe: t })}
                            teclas={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void guardarPago() } }} />
                          <span className="kr-pago-botones">
                            <button type="button" className="kr-boton" disabled={haciendoPago} title="Guardar el pago (Intro)" aria-label="Guardar el pago" onClick={() => void guardarPago()}>✓</button>
                            <button type="button" className="kr-boton" disabled={haciendoPago} title="Dejarlo como estaba (Esc)" aria-label="Dejar el pago como estaba" onClick={() => setPagoEdit(null)}>✕</button>
                          </span>
                        </Caja>
                      </div>
                    )
                  }
                  const bloqueado = cnd ? !cnd.puede : true
                  return (
                    <div className="kr-pago-fila" role="row" key={f.id} data-pago={f.id}>
                      <Caja sitio="p1-1" campo={c('p1-1')} rotulo={r('Periodo')} gris><input aria-label="Periodo del pago" readOnly tabIndex={-1} value={f.ejercicio} /></Caja>
                      <Caja sitio="p1-2" campo={c('p1-2')} gris><input aria-label="Descripción del periodo del pago" readOnly tabIndex={-1} value={trimestreDe(f.fecha)} /></Caja>
                      <Caja sitio="p1-3" campo={c('p1-3')} rotulo={r('Docum.')} gris><input aria-label="Documento del pago" readOnly tabIndex={-1} value={f.documento} /></Caja>
                      <Caja sitio="p1-4" campo={c('p1-4')} rotulo={r('Subcuenta pago')} gris><input aria-label="Subcuenta pago" readOnly tabIndex={-1} value={f.cuenta} title={pagosHechos.find((p) => p.id === f.id)?.nombreCuenta ?? undefined} /></Caja>
                      <Caja sitio="p1-5" campo={c('p1-5')} rotulo={r('Fecha')} gris><input aria-label="Fecha del pago" readOnly tabIndex={-1} value={fechaCorta(f.fecha)} /></Caja>
                      <Caja sitio="p1-6" campo={c('p1-6')} rotulo={r('Concepto')} gris><input aria-label="Concepto del pago" readOnly tabIndex={-1} value={f.concepto} title={f.concepto} /></Caja>
                      <Caja sitio="p1-7" campo={c('p1-7')} rotulo={r('Importe')} num gris>
                        <input aria-label="Importe del pago" readOnly tabIndex={-1} value={cifra(f.importe)} />
                        <span className="kr-pago-botones">
                          <button type="button" className="kr-boton" aria-label={`Cambiar el pago ${f.documento}`} disabled={bloqueado || haciendoPago || !!enEdicion}
                            title={bloqueado ? (cnd?.porque ?? 'Comprobando si se puede cambiar…') : 'Cambiar el pago (el asiento conserva su número)'}
                            onClick={() => { setBorrarArmado(null); setPagoEdit({ de: invoiceId, id: f.id, cuenta: f.cuenta, fecha: f.fecha, concepto: f.concepto, importe: importeEs(f.importe) }) }}>✎</button>
                          <button type="button" className="kr-boton" data-armado={borrarArmado === f.id ? 'si' : undefined} aria-label={`Borrar el pago ${f.documento}`} disabled={bloqueado || haciendoPago || !!enEdicion}
                            title={bloqueado ? (cnd?.porque ?? 'Comprobando si se puede borrar…') : borrarArmado === f.id ? 'Pulsa otra vez para borrarlo: la serie se renumera' : 'Borrar el pago y su asiento'}
                            onClick={() => f.id && void borrarUnPago(f.id)}>{borrarArmado === f.id ? '¿?' : '🗑'}</button>
                        </span>
                      </Caja>
                    </div>
                  )
                })}
                {enEdicion && enEdicion.id === null && (
                  <div className="kr-pago-fila" role="row" data-editando="si" data-nuevo="si">
                    <Caja sitio="p1-1" gris><input aria-label="Periodo del pago" readOnly tabIndex={-1} value={enEdicion.fecha.slice(0, 4)} /></Caja>
                    <Caja sitio="p1-2" gris><input aria-label="Descripción del periodo del pago" readOnly tabIndex={-1} value={trimestreDe(enEdicion.fecha)} /></Caja>
                    <Caja sitio="p1-3" gris><input aria-label="Documento del pago" readOnly tabIndex={-1} value="" /></Caja>
                    <Caja sitio="p1-4" para="kr-pago-cuenta-nuevo"><CasillaLupa id="kr-pago-cuenta-nuevo" etiqueta="Subcuenta pago" registros={registrosPago} valor={enEdicion.cuenta || null} poner={(x) => setPagoEdit({ ...enEdicion, cuenta: x?.codigo ?? '' })} /></Caja>
                    <Caja sitio="p1-5"><CasillaFecha id="kr-pago-fecha-nuevo" ayuda="" etiqueta="Fecha del pago" iso={enEdicion.fecha} hoy={hoy} poner={(x) => setPagoEdit({ ...enEdicion, fecha: x })} /></Caja>
                    <Caja sitio="p1-6"><input aria-label="Concepto del pago" value={enEdicion.concepto} onChange={(e) => setPagoEdit({ ...enEdicion, concepto: e.target.value })} /></Caja>
                    <Caja sitio="p1-7" num>
                      <CasillaImporte id="kr-pago-importe-nuevo" etiqueta="Importe del pago" valor={enEdicion.importe} poner={(t) => setPagoEdit({ ...enEdicion, importe: t })}
                        teclas={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void guardarPago() } }} />
                      <span className="kr-pago-botones">
                        <button type="button" className="kr-boton" disabled={haciendoPago} title="Apuntar el pago (Intro)" aria-label="Apuntar el pago" onClick={() => void guardarPago()}>✓</button>
                        <button type="button" className="kr-boton" disabled={haciendoPago} title="No apuntarlo (Esc)" aria-label="No apuntar el pago" onClick={() => setPagoEdit(null)}>✕</button>
                      </span>
                    </Caja>
                  </div>
                )}
              </div>

              {/* ── Observaciones, de todo el ancho: con la factura, no van al asiento ── */}
              <h2 className="kr-hd" style={{ top: 'calc(var(--kr-hd-obs) + var(--kr-extra))' }} data-pieza="bloque"><span>Observaciones</span></h2>
              <Caja sitio="obs-1" campo="obs-1">
                <input id="kf-observaciones" aria-label="Observaciones" maxLength={2000} readOnly={!cabEscribible} title="Se guardan con la factura; no van al asiento"
                  value={textoObs?.k === invoiceId ? textoObs.v : cab?.observaciones ?? ''}
                  onChange={(e) => setTextoObs({ k: invoiceId ?? '', v: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur() } }}
                  onBlur={() => {
                    if (textoObs?.k !== invoiceId) return
                    const v = textoObs.v.trim(); setTextoObs(null)
                    if (v !== (cab?.observaciones ?? '')) void ponerCabecera({ observaciones: v || null })
                  }} />
              </Caja>

              {otrosAbiertos && otrosL && (
                <OtrosDatos alCerrar={() => setOtrosAbierto(null)}>
                  <h3 className="kp-ancha kr-otros-titulo">Otros datos de la factura</h3>
                  <KCasilla rotulo="Fecha contable" htmlFor="kr-fecha-contable">
                    <CasillaFecha id="kr-fecha-contable" etiqueta="Fecha contable" iso={otrosL.fechaContable ?? b.fecha} hoy={hoy} casilla={false}
                      poner={(x) => { if (x !== (otrosL.fechaContable ?? b.fecha)) void ponerOtros({ fecha_contable: x && x !== b.fecha ? x : null }) }} />
                  </KCasilla>
                  <KCasilla rotulo="Fecha fiscal" htmlFor="kr-fecha-fiscal">
                    <CasillaFecha id="kr-fecha-fiscal" etiqueta="Fecha fiscal" iso={otrosL.fechaFiscal ?? b.fecha} hoy={hoy} casilla={false}
                      poner={(x) => { if (x !== (otrosL.fechaFiscal ?? b.fecha)) void ponerOtros({ fecha_fiscal: x && x !== b.fecha ? x : null }) }} />
                  </KCasilla>
                  <KCasilla rotulo="Tipo de factura" htmlFor="kr-tipo-factura" className="kp-ancha" ambar={!otrosL.tipoElegido && otrosL.tipoFactura !== 'F1'}>
                    <CasillaLupa id="kr-tipo-factura" etiqueta="Tipo de factura" registros={(catalogos?.tiposFactura ?? []).map((x) => ({ id: x.codigo, codigo: x.codigo, descripcion: x.nombre }))}
                      valor={otrosL.tipoFactura} poner={(x) => { if (x && x.id !== otrosL.tipoFactura) void ponerOtros({ tipo_factura: x.id }) }} />
                  </KCasilla>
                  <KCasilla rotulo="Clave de régimen especial" htmlFor="kr-clave" className="kp-ancha" ambar={!otrosL.claveElegida && otrosL.claveRegimen !== '01'}>
                    <CasillaLupa id="kr-clave" etiqueta="Clave de régimen especial" registros={(catalogos?.clavesRegimen ?? []).map((x) => ({ id: x.codigo, codigo: x.codigo, descripcion: x.nombre }))}
                      valor={otrosL.claveRegimen} poner={(x) => { if (x && x.id !== otrosL.claveRegimen) void ponerOtros({ clave_regimen: x.id }) }} />
                  </KCasilla>
                  <label className="kr-marca"><input type="checkbox" checked={otrosL.noIva} disabled={guardandoOtros} onChange={(e) => void ponerOtros({ no_iva: e.target.checked })} /> No incluir en declaración de IVA</label>
                  <label className="kr-marca"><input type="checkbox" checked={otrosL.rectificacion} disabled={guardandoOtros} onChange={(e) => void ponerOtros({ rectificacion: e.target.checked })} /> Rectificación de deducciones</label>
                  <KCasilla rotulo="% IVA deducible" htmlFor="kr-deducible" mide="cifra" ambar={otrosL.ivaDeducible !== 100}>
                    <input id="kr-deducible" className="kp-num" inputMode="decimal" defaultValue={String(otrosL.ivaDeducible).replace('.', ',')} key={`${invoiceId}:${otrosL.ivaDeducible}`}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur() } }}
                      onBlur={(e) => { const n = leerImporte(e.currentTarget.value); if (Number.isFinite(n) && n !== otrosL.ivaDeducible) void ponerOtros({ iva_deducible: n }) }} />
                  </KCasilla>
                  <h3 className="kp-ancha kr-otros-titulo">Datos modelo 347</h3>
                  <label className="kr-marca kp-ancha"><input type="checkbox" checked={otrosL.no347} disabled={guardandoOtros} onChange={(e) => void ponerOtros({ no_347: e.target.checked })} /> No incluir en modelo 347</label>
                </OtrosDatos>
              )}

              {/* ── Abajo: la duda (solo si la hay, en una línea) y la visualización del asiento, hasta abajo ── */}
              <div className="kr-abajo">
                <div className="kr-dudas">
                  {nuevo && (
                    <div className="kf-duda" role="group" aria-label="Nuevo proveedor" data-prueba="nuevo-proveedor-abierto">
                      <p>{nuevo.repetido ? <span data-prueba="nif-repetido" role="alert"><strong>Mira esto ·</strong> {nuevo.fallo ?? textoNifRepetido(nuevo.repetido.name)}{nuevo.repetido.id && <> <Link className="kf-enlace" to={rutaFichaProveedor(nuevo.repetido.id)}>Abrirlo</Link></>}</span>
                        : nuevo.fallo ? <span className="kf-error" role="alert">{nuevo.fallo}</span> : 'Nuevo proveedor: su NIF y su nombre, arriba.'}</p>
                      <div>
                        <button type="button" className="kf-boton-ambar" disabled={nuevo.ocupado} onClick={() => void crearNuevo()}>{nuevo.ocupado ? 'Dando de alta…' : 'Darlo de alta y elegirlo'}</button>
                        <button type="button" className="kf-boton-hueco" disabled={nuevo.ocupado} onClick={() => setNuevo(null)}>Cancelar</button>
                      </div>
                    </div>
                  )}
                  {repetida && (
                    <p className="kf-aviso kf-repetida" data-tono="falta" data-prueba="repetida">
                      <strong>Mira esto ·</strong> {textoRepetida(repetida)} <Link className="kf-enlace" to={rutaRevisarFactura(repetida.id)}>Abrirla</Link>
                      <label className="kf-no-es"><input type="checkbox" checked={noEs?.de === invoiceId} onChange={(e) => setNoEs(e.target.checked ? { de: invoiceId, motivo: '' } : null)} /> No es la misma:</label>
                      {noEs?.de === invoiceId && <>
                        <input aria-label="Por qué no es la misma" placeholder="por qué (otro ejercicio…)" value={noEs.motivo} onChange={(e) => setNoEs({ de: invoiceId, motivo: e.target.value })} />
                        <button type="button" className="kf-enlace" disabled={anotando || !noEs.motivo.trim()} onClick={() => void anotarNoEsLaMisma(repetida.id, noEs.motivo)}>{anotando ? 'Anotando…' : 'Anotarlo'}</button>
                      </>}
                    </p>
                  )}
                  {franjaSolo && (
                    <Duda fuerte={franjaSolo.fuerte} texto={franjaSolo.texto}
                      secundario={franjaSolo.deshacer ? { texto: deshaciendo ? 'Deshaciendo…' : 'Deshacer', hacer: () => void deshacerSolo() } : undefined} />
                  )}
                  {emisor?.que === 'alta' && altaAbierta !== invoiceId && (
                    <Duda texto={`No conozco al que la emite${emisor.nombre ? `: ${emisor.nombre}` : ''}${emisor.nif ? ` · NIF ${emisor.nif}` : ''}. ${solo?.que === 'no' && solo.motivo ? `${solo.motivo} ` : ''}Hasta que tenga proveedor no se valida.`}
                      principal={{ texto: 'Darlo de alta', hacer: () => setAltaAbierta(invoiceId) }}
                      secundario={{ texto: 'Es uno que ya tengo', hacer: () => setAbrirProveedor((n) => n + 1) }} />
                  )}
                  {emisor?.que === 'es_uno_tuyo' && (
                    <Duda texto={`El NIF de la factura${emisor.nif ? ` (${emisor.nif})` : ''} es el de ${emisor.nombre}.`}
                      principal={{ texto: `Es ${emisor.nombre}: elegirlo`, hacer: () => void elegirYGuardar(emisor.proveedorId, emisor.nombre, `Elegido ${emisor.nombre}: el NIF de la factura es el suyo.`) }}
                      secundario={{ texto: 'Es uno que ya tengo', hacer: () => setAbrirProveedor((n) => n + 1) }} />
                  )}
                  {duda && !soloLectura && (
                    <Duda texto={duda.texto}
                      principal={{ texto: `Dejar ${duda.dejar.cuenta}`, hacer: () => { ponerGasto(0, { cuenta: duda.dejar.cuenta }); setDecidida(`${invoiceId}:${provId}`) } }}
                      secundario={{ texto: `Cambiar a ${duda.cambiar.cuenta}`, hacer: () => { ponerGasto(0, { cuenta: duda.cambiar.cuenta }); setDecidida(`${invoiceId}:${provId}`) } }} />
                  )}
                  {dudaPago && !soloLectura && (
                    <Duda texto={textoDudaPago(dudaPago, (x) => cuentasPago?.nombres.get(x) ?? '').texto}
                      principal={{ texto: `Dejar ${dudaPago.cuentas[0]}`, hacer: () => ed.poner('pagoCuenta', dudaPago.cuentas[0]) }}
                      secundario={{ texto: `Cambiar a ${dudaPago.cuentas[1]}`, hacer: () => ed.poner('pagoCuenta', dudaPago.cuentas[1]) }} />
                  )}
                </div>
                {emisor?.que === 'alta' && altaAbierta === invoiceId && accountId && fac && (
                  <div className="kr-alta">
                    <AltaDesdeFactura accountId={accountId} otros={proveedores.map((p) => ({ id: p.id, name: p.nombre, taxId: p.nif }))}
                      leido={{ nombre: emisor.nombre, nif: emisor.nif, direccion: leido?.proveedor.direccion ?? null, correo: leido?.proveedor.email ?? null, telefono: leido?.proveedor.telefono ?? null, web: leido?.proveedor.web ?? null }}
                      factura={{ id: fac.id, numero: fac.numero ?? null }} alCancelar={() => setAltaAbierta(null)}
                      alCrear={(p) => { setAltaAbierta(null); void elegirYGuardar(p.id, p.name, fraseAltaEnFactura(p.name)) }} />
                  </div>
                )}

                {/* ── Visualización del asiento (17b): recuadro rojo hasta abajo; la cabecera fija y las líneas que se desplazan ── */}
                {!(modo === 'contabilizada' && enModificar && asientoReal) && (<>
                  <h2 className="kr-hd" data-pieza="bloque" data-prueba="titulo-visual"><span>Visualización del asiento</span></h2>
                  <div className="kf-asiento kr-visual-marco" aria-label="El asiento que sale">
                    <div className="kr-visual-cabeza">
                      <span>Factura{modo === 'contabilizada' && fac?.asiento?.numero ? ` · asiento 2 / ${fac.asiento.numero}` : ''}</span>
                      <span className="kf-etiqueta" data-tono={modo === 'contabilizada' ? 'bien' : etiqueta.tono} data-prueba="cuadra" title={porqueSinPropuesta ?? undefined}>
                        {modo === 'contabilizada' ? etiquetaValidado(fac?.asiento?.numero ?? null) : etiqueta.texto}
                      </span>
                      <span>{fechaCorta(otrosL?.fechaContable ?? b.fecha)}</span>
                      <span className="kr-visual-ed" aria-hidden="true" title="Ver y retocar el asiento: llega con la ventana del asiento (K13, PR 2)">✎</span>
                    </div>
                    <div className="kr-visual-cuerpo">
                      {porqueSinPropuesta && <p className="kr-visual-nota" data-prueba="sin-propuesta">{porqueSinPropuesta}</p>}
                      <AsientoVisto lineas={visualFactura} cifra={cifra} />
                      {pagoSinHacer && visualPago.length > 0 && (
                        <div className="kr-visual-asiento" data-asiento-pago="por-hacer">
                          <div className="kr-visual-cabeza"><span title="Se apunta al validar la factura">Pago</span><span className="kr-visual-fecha" style={{ marginLeft: 'auto' }}>{fechaCorta(pagoSinHacer.fecha)}</span></div>
                          <AsientoVisto lineas={visualPago} cifra={cifra} />
                        </div>
                      )}
                      {pagosHechos.map((p) => (
                        <div className="kr-visual-asiento" key={p.id} data-asiento-pago={p.id}>
                          <div className="kr-visual-cabeza"><span>Pago{p.numero !== null ? ` · asiento ${p.serie ?? 4} / ${p.numero}` : ''}</span><span style={{ marginLeft: 'auto' }}>{fechaCorta(p.fecha)}</span></div>
                          <AsientoVisto lineas={aVisual(p.apuntes.map((a) => ({ codigo: a.cuenta, nombre: a.nombre, debe: a.debe || null, haber: a.haber || null })))} cifra={cifra} />
                        </div>
                      ))}
                    </div>
                  </div>
                </>)}
                {modo === 'contabilizada' && enModificar && asientoReal && (
                  <ModificarAsiento apuntes={asientoReal.apuntes.map((a) => ({ posicion: a.posicion, cuenta: a.cuenta, nombre: a.nombreCuenta, debe: a.debe, haber: a.haber }))}
                    plan={cuentasPago?.lista ?? []} nombre={(x) => cuentasPago?.nombres.get(x) ?? asientoReal.apuntes.find((a) => a.cuenta === x)?.nombreCuenta ?? ''}
                    elegidas={modificando?.elegidas ?? {}} elegir={(pos, x) => setModificando((m) => (m ? { ...m, elegidas: { ...m.elegidas, [pos]: x } } : m))} />
                )}
              </div>
              </div>
              )}
            </div>
          </Ventana>
        </div>
        <PanelDocumento documento={documento} acepta={ACEPTA_PAPEL} raya={{ usuario: userId }}
          sinDocumento={soloLectura ? undefined : { marcado: b.sinPdf, motivo: b.motivoSinPdf, poner: (m, motivo) => { ed.poner('sinPdf', m); ed.poner('motivoSinPdf', m ? motivo : '') } }}
          alElegir={docAccion?.que === 'poner' ? (file) => { if (modo === 'contabilizada') { setConfirmarDoc({ de: invoiceId, file }); return } setFichero({ file, url: URL.createObjectURL(file) }); ed.poner('documento', file.name) } : undefined}
          alCambiar={docAccion && docAccion.que !== 'poner' ? alCambiarDocumento : undefined} cambiando={cambiandoDoc}
          otra={{ nombre: 'El mayor del proveedor', contenido: <MayorDelProveedor apuntes={mayor?.apuntes ?? null} subcuenta={subcuenta} hay={!!provId} /> }} />
      </div>
    </div>
  )
}

function Mas({ aMano, opciones, alPulsar, abrirCompleta }: { aMano: boolean; opciones: readonly OpcionMas[]; alPulsar: (o: OpcionMas) => void; abrirCompleta: () => void }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <div className="kf-mas">
      <button type="button" className="kf-boton-hueco" aria-expanded={abierto} onClick={() => setAbierto((x) => !x)}>Más</button>
      {abierto && (
        <ul className="kf-mas-menu" onMouseLeave={() => setAbierto(false)}>
          {opciones.map((o) => <li key={o.id}><button type="button" data-mas={o.id} onClick={() => { setAbierto(false); alPulsar(o) }}>{o.texto}{o.dato && <small> · {o.dato}</small>}</button></li>)}
          {!aMano && <li><button type="button" onClick={() => { setAbierto(false); abrirCompleta() }}>La ficha completa (lo que aún no está aquí)</button></li>}
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

// ── K13 · Las piezas de la 17b ──

/**
 * Una casilla de la maqueta 17b: su caja en su sitio (`data-sitio`; las medidas, en ficha17b.css) y, en la primera línea,
 * su `data-campo`, el de la maqueta (lo compara la e2e k13/calco). El rótulo encima, en azul; la caja, blanca; en gris el
 * texto de las que no se escriben; en ámbar, la que conviene mirar. La lupa, detrás (o delante, `lupa="antes"`); el ⊕, `mas`.
 */
function Caja({ sitio, campo, rotulo, para, centro = false, rotuloGris = false, gris = false, ambar = false, num = false, total = false, lupa, mas, title, datos, estilo, children }: {
  sitio: string; campo?: string; rotulo?: string; para?: string; centro?: boolean; rotuloGris?: boolean; gris?: boolean; ambar?: boolean; num?: boolean; total?: boolean
  lupa?: 'antes'; mas?: ReactNode; title?: string; datos?: Readonly<Record<`data-${string}`, string>>; estilo?: CSSProperties; children: ReactNode
}) {
  return (
    <div className="kr-c" data-sitio={sitio} data-campo={campo ?? (sitio.startsWith('f') || sitio === 'obs-1' ? sitio : undefined)} data-gris={gris ? 'si' : undefined} data-ambar={ambar ? 'si' : undefined}
      data-num={num ? 'si' : undefined} data-total={total ? 'si' : undefined} data-lupa={lupa} title={title} style={estilo} {...datos}>
      {rotulo !== undefined && <label className="kr-rot" htmlFor={para} data-centro={centro ? 'si' : undefined} data-gris={rotuloGris ? 'si' : undefined}>{rotulo}</label>}
      {children}
      {mas}
    </div>
  )
}

const LUPA = <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.4" /><path d="M15.5 15.5l5 5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>

/** La lupa de una casilla que no se escribe (el documento, el saldo, el NIF): abre lo que se busca desde ella. */
function LupaSola({ etiqueta, hacer, puede = true }: { etiqueta: string; hacer: () => void; puede?: boolean }) {
  return <button type="button" className="kr-lupa-sola" tabIndex={-1} aria-label={etiqueta} title={etiqueta} disabled={!puede} onClick={hacer}>{LUPA}</button>
}

/** El calendario detrás de una fecha, como ERP10: lleva a su casilla, que se escribe como en ERP10 (01/07/2026). */
function Calendario({ para }: { para: string }) {
  return <button type="button" className="kr-cal" tabIndex={-1} aria-label="Ir a la fecha" title="Escribe la fecha: 01/07/2026, 1/7/26 o 01072026" onClick={() => document.getElementById(para)?.focus()} />
}

/** El ⊕ de la 17b detrás de su casilla: otro tramo, otro pago u «Otros datos». Apagado, dice por qué. */
function BotonMas17({ etiqueta, hacer, puede = true, abierto, titulo }: { etiqueta: string; hacer: () => void; puede?: boolean; abierto?: boolean; titulo?: string }) {
  return (
    <button type="button" className="kr-mas" aria-label={etiqueta} title={titulo ?? etiqueta} aria-expanded={abierto} disabled={!puede} onClick={hacer} data-pieza="mas">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 7v10M7 12h10" stroke="currentColor" strokeWidth="2.2" /></svg>
    </button>
  )
}

/** Un asiento visto como en la 17b: el debe a la izquierda («importe (cuenta) nombre») y el haber a la derecha. */
function AsientoVisto({ lineas, cifra: c }: { lineas: ReturnType<typeof aVisual>; cifra: (n: number) => string }) {
  const debe = lineas.filter((l) => l.lado === 'debe')
  const haber = lineas.filter((l) => l.lado === 'haber')
  if (!debe.length && !haber.length) return null
  return (
    <div className="kr-visual-cols">
      <div aria-label="Debe">{debe.map((l, i) => <div className="kr-al" key={i} title={`${l.cuenta} · ${l.nombre}`}><b className="kp-num">{c(l.importe)}</b> <i className="kp-visual-cuenta">({l.cuenta})</i><span>{l.nombre}</span></div>)}</div>
      <div aria-label="Haber">{haber.map((l, i) => <div className="kr-ar" key={i} title={`${l.cuenta} · ${l.nombre}`}><span>{l.nombre}</span><span><i className="kp-visual-cuenta">({l.cuenta})</i> <span className="kp-num">{c(l.importe)}</span></span></div>)}</div>
    </div>
  )
}
