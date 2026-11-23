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

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as KE } from 'react'
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
import { Barra, Bloque, BotonMas, Casilla as KCasilla, OtrosDatos, Ventana } from '../piezas/Ventana'
import { CasillaLupa } from '../piezas/Lupa'
import { CasillaImporte } from '../piezas/Importe'
import { MOTIVO_IMPORTE_DUDOSO, importeDudoso, leerImporte } from '../piezas/logica'
import { aVisual, cuadriculaIva, filasDePago, otraLinea, otroPago, rotuloDeLaSuma, sumaDeContrapartidas } from './fichaErp10'
import { apuntarUnPago, borrarPago, cambiarPago, leerPagos, sePuedeCambiarPago } from './pagosServicio'
import { plataformasDeLaCuenta } from '@/modules/conta/services/asientoGeneralService'
import './fichaErp10.css'
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
import { calendarioDe, cuentasAMano, delProveedor, deshacerProveedorSolo, gastoAprendido, gastoPropuesto as leerGastoPropuesto, cabeceraDeLaFactura, guardarCabecera, marcasParaPoner, catalogosDeLaRecibida, guardarOtrosDatos, otrosDatosDeLaFactura, trimestresPresentados, mayorDelProveedor, noEsLaMisma, otrasDelProveedor, proveedorSolo, subcuentasDeProveedores, textoOperacion, cuentasDeContrapartida, codigosDeProveedores } from './servicio'
import { cuentaDelProveedorEnElAsiento } from './proveedorEnAsiento'
import { faltasParaValidar, laRepetida, textoNoSeValida, textoRepetida } from './validarSoloLoCompleto'
import { avisoInmovilizado } from './contrapartida'
import { proveedoresQueEncajan } from './buscarProveedor'
import { OPERACIONES, cortoDeOperacion, esOperacion, marcaCorta, origenOperacion, textoDeOperacion, trimestrePropuesto, trimestresParaElegir } from './cabecera'
import { fechaDelPago, propuestaDelPago, queHaceElPago, textoAsientoDelPago, textoDudaPago, textoPendiente, type QueHaceElPago } from './pago'
import { apuntarPago, cuentasDePago, hayLiquidacion, pagoDelProveedor } from './pagoServicio'
import RevisarFacturaPage from '@/modules/conta/documentos/RevisarFacturaPage'
import { AltaDesdeFactura } from '@/modules/conta/documentos/ProveedorDesdeFactura'
import { fraseAltaEnFactura } from '@/modules/conta/lib/altaProveedor'
import { CrearDesdeBuscador } from '@/modules/conta/plan/CrearDesdeBuscador'

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
  // X27 · La «Subcuenta de gasto» de su ficha, puesta ya en la a mano (una vez por proveedor): ver ponerGasto.
  const [gastoFichaPuesto, setGastoFichaPuesto] = useState<string | null>(null)
  const mayor = useUltimo(useLeer(accountId && empresa && delProv?.subcuenta ? () => mayorDelProveedor(accountId, empresa, delProv.subcuenta!.id, hoy) : null, `${accountId}:${empresa}:${delProv?.subcuenta?.id}:mayor:${vuelta}`).datos, `${id}:${provId}`)
  const aprendido = useUltimo(useLeer(empresa && provId && !aMano ? () => gastoAprendido(empresa, provId) : null, `${empresa}:${provId}:${invoiceId}:aprendido:${vuelta}`).datos, `${id}:${provId}`)
  const sinPropuesta = aMano || propuesta === null
  // R14 · Lo que hizo Sumied con el proveedor al leerla, y la cuenta propuesta sin historial (en ámbar, con su porqué).
  // La clave cambia cuando llega lo aprendido: useLeer solo vuelve a leer si cambia la clave, y al pintarse la
  // primera vez lo aprendido aún no está (sin esto, la propuesta no se pedía nunca: e2e 1670).
  const solo = useLeer(id && !aMano ? () => proveedorSolo(id) : null, `${id}:solo:${vuelta}`).datos ?? null
  const propuestoGasto = useLeer(empresa && provId && !aMano && aprendido && !aprendido.cuenta ? () => leerGastoPropuesto(empresa, provId, id ?? null) : null, `${empresa}:${provId}:${invoiceId}:propuesto:${aprendido ? aprendido.cuenta ?? 'sin-historia' : 'esperando'}:${vuelta}`).datos ?? null
  // Una vez por empresa: la subcuenta del proveedor sale de delProveedor (ya leído), no de volver a leer el contexto entero.
  const aManoCuentas = useLeer(accountId && empresa && sinPropuesta ? () => cuentasAMano(accountId, empresa) : null, `${accountId}:${empresa}:cuentas-a-mano`).datos ?? null

  // ── K06 · Cómo se paga: la cuenta del pago, propuesta (la 430 de su liquidación, la del último pago) o vacía ──
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
  const pagoCuenta = b.pagoCuenta ?? propuestaPago?.cuenta ?? ''
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
    return aManoCuentas ? { ...aManoCuentas.cuentas, proveedor: delProveedor } : null
  }, [propuesta, nombresProp, aManoCuentas, subCodigo, subNombre, provNombreFicha, gastoDelAsiento, subcuentasProv])
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
    if (guardandoCab) { setAviso({ tono: 'falta', texto: 'Aún estoy guardando la cabecera (el tipo, el trimestre, el concepto…): vuelve a pulsar en un momento. No he validado nada.' }); return }
    if (leyendoPago) { setAviso({ tono: 'falta', texto: 'Aún estoy leyendo cómo se paga (la cuenta del pago que propongo): vuelve a pulsar en un momento. No he guardado nada.' }); return }
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
    if (i === 0 && c.marca !== undefined && !datoDe(0)?.marcaId && c.concepto === undefined && c.plataforma === undefined) { void ponerCabecera({ marca: c.marca }); return }
    const d = datoDe(i)
    void ponerOtros({ lineas: [{
      posicion: i, concepto: c.concepto !== undefined ? c.concepto : d?.concepto ?? null,
      marca: c.marca !== undefined ? c.marca : d?.marcaId ?? null, plataforma: c.plataforma !== undefined ? c.plataforma : d?.canalId ?? null,
    }] })
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
  // La base de las contrapartidas: la base con su recargo y lo que no se deduce del IVA (al 50 %, la mitad de la cuota va al gasto).
  const baseGasto = totales.base + (totales.recargo ?? 0) + Math.round(totales.iva * (100 - pct)) / 100
  const unaLinea = b.gastos.length === 1
  const importeLinea = (i: number) => (unaLinea ? baseGasto : num(b.gastos[i]?.importe ?? '') )
  const suma = sumaDeContrapartidas(b.gastos.map((_, i) => importeLinea(i)), baseGasto)
  const rotuloSuma = rotuloDeLaSuma(suma, cifra)
  const pagoProp = modo === 'contabilizada' ? null : { cuenta: pagoCuenta, fecha: pagoFecha, concepto: `PAGO ${b.numero || 'FACTURA'} ${prov?.nombre ?? ''}`.trim() }
  const pagos = filasDePago({ total: importePago, pagos: pagosHechos, propuesta: pagoProp, cifra })
  const enEdicion = pagoEdit?.de === invoiceId ? pagoEdit : null
  const registrosPago = (cuentasPago?.lista ?? []).map((c) => ({ id: c.codigo, codigo: c.codigo, descripcion: c.nombre }))
  const marcasLupa = marcas.map((m) => ({ id: m.id, codigo: marcaCorta(m.nombre), descripcion: m.nombre }))
  const plataformasLupa = plataformas ?? []
  const localesLupa = locales.map((l) => ({ id: l.id, codigo: l.nombre, descripcion: l.nombre }))
  const ejercicio = (b.fecha || hoy).slice(0, 4)
  const comprobacion = (id: string) => comprobaciones.find((c) => c.id === id && c.tono !== 'bien') ?? null
  /** El ámbar de una comprobación: su motivo en el `title` (sin frases) y `data-comprobacion`; si no, de dónde sale el dato. */
  const marcaComprobacion = (id: string, deDonde?: string | null): { title?: string; datos?: Record<`data-${string}`, string> } => {
    const c = comprobacion(id)
    return c ? { title: c.texto, datos: { 'data-comprobacion': id } } : deDonde ? { title: deDonde } : {}
  }
  const fechaCorta = (iso: string | null | undefined) => (iso ? iso.split('-').reverse().join('/') : '')
  const otrosAbiertos = otrosAbierto === invoiceId
  const visualFactura = aVisual(modo === 'contabilizada' ? lineasValidado : previa && totales.total !== 0 ? previa.lineas : [])
  const filasVisual = (l: ReturnType<typeof aVisual>) => {
    const d = l.filter((x) => x.lado === 'debe'); const h = l.filter((x) => x.lado === 'haber')
    return Array.from({ length: Math.max(d.length, h.length) }, (_, i) => ({ d: d[i] ?? null, h: h[i] ?? null }))
  }

  return (
    <div className="kf-ficha kf-recibida kr" ref={raiz} onKeyDown={(e) => { marcarTocada(); alPulsar(e) }} onPointerDown={marcarTocada} data-prueba="ficha-recibida-nucleo" aria-busy={cargando || leyendoPago || undefined}>
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
              {cargando ? <p className="kf-panel-nota" aria-busy="true">Abriendo la factura…</p> : <>
              <fieldset className="kf-solo-lectura kr-campos" disabled={soloLectura} data-solo-lectura={soloLectura ? 'si' : undefined}>
                {/* ── Datos factura ── */}
                <Bloque titulo="Datos factura" className="kr-datos">
                  <div className="kr-fila kr-fila-1">
                    <KCasilla rotulo="Tipo de introducción" htmlFor="kr-tipo" gris><input id="kr-tipo" readOnly tabIndex={-1} value="Factura recibida" /></KCasilla>
                    <KCasilla rotulo="Periodo contable" htmlFor="kf-deduce" className="kr-periodo" ambar={!!comprobacion('periodo')} {...marcaComprobacion('periodo')}>
                      <input id="kr-ejercicio" aria-label="Ejercicio" readOnly tabIndex={-1} value={ejercicio} />
                      {cabEscribible && trimestres.length > 0 ? (
                        <select id="kf-deduce" aria-label="Se deduce en" value={trim?.trimestre?.inicio ?? ''} disabled={guardandoCab} title={trim?.elegido ? 'Elegido en esta factura' : 'El de su fecha'}
                          onChange={(e) => void ponerCabecera({ deduce_en: e.target.value || null })}>
                          {trimestres.map((t) => <option key={t.inicio} value={t.inicio} disabled={t.presentado}>{t.texto}{t.presentado ? ' · presentado' : ''}</option>)}
                        </select>
                      ) : <input id="kf-deduce" aria-label="Se deduce en" readOnly tabIndex={-1} value={trim?.trimestre?.texto ?? trimestreDe(b.fecha)} />}
                    </KCasilla>
                    <KCasilla rotulo="Documento" htmlFor="kf-serie" gris><input id="kf-serie" readOnly tabIndex={-1} value={fac?.asiento?.numero ? String(fac.asiento.numero) : ''} title={fac?.asiento?.numero ? `Serie 2 · asiento ${fac.asiento.numero}` : 'Lo pone el programa al validarla'} /></KCasilla>
                    <KCasilla rotulo="Fecha introducción" htmlFor="kr-contable" gris={!otrosL?.fechaContable}>
                      <input id="kr-contable" readOnly tabIndex={-1} value={fechaCorta(otrosL?.fechaContable ?? b.fecha)} title={otrosL?.fechaContable ? 'La fecha contable escrita en «Otros datos»' : 'La de la factura; otra, en «Otros datos»'} />
                    </KCasilla>
                    <KCasilla rotulo="Fecha factura" htmlFor="kf-fecha" title={origen.fecha ?? undefined}><CasillaFecha id="kf-fecha" etiqueta="Fecha factura" iso={b.fecha} hoy={hoy} poner={(x) => ed.poner('fecha', x)} /></KCasilla>
                  </div>
                  <div className="kr-fila kr-fila-2">
                    <KCasilla rotulo="Proveedor" htmlFor="kf-proveedor" ambar={!!emisor} title={emisor ? `No conozco al que la emite${emisor.nombre ? `: ${emisor.nombre}` : ''}` : origen.proveedor ?? undefined}>
                      <Buscador id="kf-proveedor" etiqueta="Proveedor" cargando={proveedoresL === null} enfocar={abrirProveedor} duda={!!emisor} valor={textoProv ?? (provId ? textoCasillaProveedor({ subcuenta, futura: cuentasAsiento?.proveedor?.codigo ?? '', nombre: prov?.nombre ?? null }) : '')} cuenta={subcuenta || null}
                        placeholder={aMano ? 'Código o NIF' : undefined}
                        ponerTexto={setTextoProv} lista={(t) => proveedoresQueEncajan(t, proveedores, codigosProv ?? new Map())}
                        texto={(p) => `${p.nombre}${codigosProv?.get(p.id) ? ` · ${codigosProv.get(p.id)}` : ''}${p.nif ? ` · ${p.nif}` : ''}`} elegir={(p) => { if (emisor) void elegirYGuardar(p.id, p.nombre, `Elegido ${p.nombre}.`); else { ed.poner('proveedorId', p.id); setTextoProv(null) } }} />
                    </KCasilla>
                    <KCasilla rotulo="Saldo a la fecha" htmlFor="kr-saldo" gris>
                      <input id="kr-saldo" className="kp-num" readOnly tabIndex={-1} data-prueba="saldo-proveedor" value={mayor ? cifra(mayor.saldo) : ''}
                        title={conEstaFactura !== null ? `Con esta factura: ${cifra(conEstaFactura)}` : undefined} />
                    </KCasilla>
                    {nuevo ? (<>
                      <KCasilla rotulo="N.I.F." htmlFor="kf-nif"><input id="kf-nif" data-casilla autoCapitalize="characters" autoFocus value={nuevo.nif}
                        onChange={(e) => setNuevo({ ...nuevo, nif: e.target.value, fallo: null, repetido: null })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void crearNuevo() } }} /></KCasilla>
                      <KCasilla rotulo="Nombre" htmlFor="kf-nombre"><input id="kf-nombre" data-casilla value={nuevo.nombre}
                        onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value, fallo: null })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void crearNuevo() } }} /></KCasilla>
                    </>) : (<>
                      <KCasilla rotulo="N.I.F." htmlFor="kf-nif" ambar={!!comprobacion('nif')} {...marcaComprobacion('nif', origen.nif)}><input id="kf-nif" readOnly tabIndex={-1} value={prov?.nif ?? emisor?.nif ?? ''} /></KCasilla>
                      <KCasilla rotulo="Nombre" htmlFor="kf-nombre" gris><input id="kf-nombre" readOnly tabIndex={-1} value={prov?.nombre ?? emisor?.nombre ?? ''} title={prov?.nombre ?? emisor?.nombre ?? undefined} /></KCasilla>
                    </>)}
                  </div>
                  <div className="kr-fila kr-fila-3">
                    <KCasilla rotulo="Nº Factura" htmlFor="kf-numero" ambar={!!comprobacion('repetida')} {...marcaComprobacion('repetida', origen.numero)}>
                      <input id="kf-numero" data-casilla value={b.numero} onChange={(e) => ed.poner('numero', e.target.value)} />
                    </KCasilla>
                    <KCasilla rotulo="Concepto asiento" htmlFor="kf-concepto" title={cab?.concepto ? 'Escrito en esta factura' : origen.concepto ?? undefined}>
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
                    </KCasilla>
                    <KCasilla rotulo="Tipo de operación" htmlFor="kf-operacion" ambar={origenOp === 'Cambiado en esta factura'}
                      mas={!aMano && otrosL ? <BotonMas etiqueta="Otros datos" abierto={otrosAbiertos} hacer={() => setOtrosAbierto((x) => (x === invoiceId ? null : invoiceId))} /> : undefined}>
                      {cabEscribible ? (
                        <select id="kf-operacion" aria-label="Tipo de operación" value={opFactura ?? opFicha ?? ''} disabled={guardandoCab} title={`${textoDeOperacion(opFactura ?? opFicha)}${origenOp ? ` · ${origenOp}` : ''}`}
                          onChange={(e) => { const v = esOperacion(e.target.value) ? e.target.value : null; void ponerCabecera({ operacion: v === opFicha ? null : v }) }}>
                          {!opFactura && !opFicha && <option value="">—</option>}
                          {OPERACIONES.map((o) => <option key={o.valor} value={o.valor} title={o.texto}>{o.corto}</option>)}
                        </select>
                      ) : <input id="kf-operacion" readOnly tabIndex={-1} value={cortoDeOperacion(opFactura ?? opFicha) || (textoOperacion(delProv?.regimen ?? null) ?? '')} title={textoDeOperacion(opFactura ?? opFicha) || undefined} />}
                      {/* De dónde sale, sin frase: en el `title` de la casilla; aquí, la marca corta que leen las pruebas. */}
                      {origenOp && <span className="kf-origen kr-oculto" data-prueba="origen-operacion" title={origenOp}>{origenOp === 'De su ficha' ? 'De su ficha' : 'Cambiado'}</span>}
                    </KCasilla>
                  </div>
                  {aMano && !provId && !nuevo && (
                    <button type="button" className="kp-mas kr-nuevo-proveedor" data-prueba="nuevo-proveedor" onClick={() => setNuevo({ nif: '', nombre: textoProv?.trim() ?? '', fallo: null, ocupado: false })}>＋ Nuevo proveedor</button>
                  )}
                  {nuevo && (
                    <div className="kf-nuevo-proveedor" role="group" aria-label="Nuevo proveedor" data-prueba="nuevo-proveedor-abierto">
                      <button type="button" className="kf-enlace-plano" disabled={nuevo.ocupado} onClick={() => void crearNuevo()}>{nuevo.ocupado ? 'Dando de alta…' : 'Darlo de alta y elegirlo'}</button>
                      <button type="button" className="kf-enlace-plano" disabled={nuevo.ocupado} onClick={() => setNuevo(null)}>Cancelar</button>
                      {nuevo.repetido ? (
                        <p className="kf-aviso kf-repetida" data-tono="falta" role="alert" data-prueba="nif-repetido">
                          <strong>Mira esto ·</strong> {nuevo.fallo ?? textoNifRepetido(nuevo.repetido.name)}{nuevo.repetido.id && <> <Link className="kf-enlace" to={rutaFichaProveedor(nuevo.repetido.id)}>Abrirlo</Link></>}
                        </p>
                      ) : nuevo.fallo && <p className="kf-error" role="alert">{nuevo.fallo}</p>}
                    </div>
                  )}
                </Bloque>
              </fieldset>
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
                    <CasillaLupa id="kr-tipo-factura" etiqueta="Tipo de factura" registros={(catalogos?.tiposFactura ?? []).map((c) => ({ id: c.codigo, codigo: c.codigo, descripcion: c.nombre }))}
                      valor={otrosL.tipoFactura} poner={(r) => { if (r && r.id !== otrosL.tipoFactura) void ponerOtros({ tipo_factura: r.id }) }} />
                  </KCasilla>
                  <KCasilla rotulo="Clave de régimen especial" htmlFor="kr-clave" className="kp-ancha" ambar={!otrosL.claveElegida && otrosL.claveRegimen !== '01'}>
                    <CasillaLupa id="kr-clave" etiqueta="Clave de régimen especial" registros={(catalogos?.clavesRegimen ?? []).map((c) => ({ id: c.codigo, codigo: c.codigo, descripcion: c.nombre }))}
                      valor={otrosL.claveRegimen} poner={(r) => { if (r && r.id !== otrosL.claveRegimen) void ponerOtros({ clave_regimen: r.id }) }} />
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
              <fieldset className="kf-solo-lectura kr-campos" disabled={soloLectura} data-solo-lectura={soloLectura ? 'si' : undefined}>
                {/* ── I.V.A. · Retención · Total factura ── */}
                <Bloque titulo="I.V.A. · Retención · Total factura" className="kr-iva">
                  <div className="kr-iva-rejilla">
                    <div className="kr-iva-tipos">
                      {cuadriculaIva(b.iva.map((l, i) => ({ l, i }))).map((fila, f) => (
                        <div className="kr-iva-fila" key={f}>
                          {fila.map((x, k) => x ? (
                            <div className="kr-iva-tipo" key={k}>
                              <KCasilla rotulo={f === 0 ? 'Base' : ''} htmlFor={`kr-base-${x.i}`}>
                                <input id={`kr-base-${x.i}`} className="kp-num" data-casilla aria-label={`Base ${x.i + 1}`} value={x.l.base} onChange={(e) => ponerIva(x.i, { base: e.target.value })}
                                  data-ambar={importeDudoso(x.l.base) ? 'si' : undefined} title={importeDudoso(x.l.base) ? MOTIVO_IMPORTE_DUDOSO : undefined}
                                  onBlur={() => { const n = num(x.l.base); if (n !== null && !importeDudoso(x.l.base)) ponerIva(x.i, { base: importeEs(n) }) }} />
                              </KCasilla>
                              <KCasilla rotulo={f === 0 ? '%' : ''} htmlFor={`kr-tipo-${x.i}`}>
                                <select id={`kr-tipo-${x.i}`} data-casilla aria-label={`Tipo de IVA ${x.i + 1}`} className="kp-num" value={x.l.tipo} onChange={(e) => ponerIva(x.i, { tipo: e.target.value })}>
                                  {[...new Set([...tiposIva.map(String), x.l.tipo])].filter(Boolean).map((t) => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </KCasilla>
                              <KCasilla rotulo={f === 0 ? 'Cuota' : ''} htmlFor={`kr-cuota-${x.i}`}>
                                <input id={`kr-cuota-${x.i}`} className="kp-num" aria-label={`Cuota ${x.i + 1}`} value={x.l.cuota} tabIndex={-1} onChange={(e) => ponerIva(x.i, { cuota: e.target.value }, false)} />
                                {b.iva.length > 1 && <button type="button" className="kr-quitar" aria-label={`Quitar el tipo ${x.l.tipo} %`} tabIndex={-1} onClick={() => ed.poner('iva', b.iva.filter((_, j) => j !== x.i))}>×</button>}
                              </KCasilla>
                            </div>
                          ) : (
                            <div className="kr-iva-tipo kr-iva-vacio" key={k}>
                              {k === 0 || fila[0] ? (
                                <button type="button" className="kr-iva-otro" tabIndex={-1} title="Otro tipo de IVA"
                                  onClick={() => ed.poner('iva', [...b.iva, { base: '', tipo: String(tiposIva.find((t) => !b.iva.some((l) => l.tipo === String(t))) ?? 21), cuota: '' }])}>
                                  <span /><span /><span />
                                </button>
                              ) : <span />}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="kr-retencion">
                      <KCasilla rotulo="Tipo retención" htmlFor="kr-retencion">
                        <select id="kr-retencion" data-casilla aria-label="Retención" value={b.retencion?.tipo ?? ''} onChange={(e) => ed.poner('retencion', e.target.value ? rehacerRetencion({ tipo: e.target.value, importe: '' }, totales.base) : null)}>
                          <option value="">—</option>
                          {TIPOS_RETENCION.map((t) => <option key={t} value={String(t)}>{t} %</option>)}
                        </select>
                      </KCasilla>
                      <KCasilla rotulo="Base" htmlFor="kr-ret-base" gris><input id="kr-ret-base" className="kp-num" readOnly tabIndex={-1} value={b.retencion ? cifra(totales.base) : ''} /></KCasilla>
                      <KCasilla rotulo="%" htmlFor="kr-ret-tipo" gris><input id="kr-ret-tipo" className="kp-num" readOnly tabIndex={-1} value={b.retencion?.tipo ?? ''} /></KCasilla>
                      <KCasilla rotulo="Cuota" htmlFor="kr-ret-cuota" gris><input id="kr-ret-cuota" className="kp-num" readOnly tabIndex={-1} value={b.retencion?.importe ?? ''} /></KCasilla>
                    </div>
                    <KCasilla rotulo="Total factura" htmlFor="kr-total" className="kr-total" ambar={!!comprobacion('suma')} {...marcaComprobacion('suma')}>
                      {aMano
                        ? <input id="kr-total" className="kp-num kr-total-cifra" data-casilla aria-label="Total factura" placeholder="0,00"
                            value={textoTotal ?? (totales.total ? importeEs(totales.total) : '')}
                            title="Escríbelo y sale la base, con un solo tipo de IVA y la retención de su ficha"
                            onFocus={(e) => { setTextoTotal(totales.total ? importeEs(totales.total) : ''); e.target.select() }}
                            onChange={(e) => setTextoTotal(e.target.value)}
                            onBlur={() => {
                              const n = textoTotal !== null && !importeDudoso(textoTotal) ? leerImporte(textoTotal) : null
                              if (n !== null && Number.isFinite(n) && Math.round(n * 100) !== Math.round(totales.total * 100)) { const r = desdeElTotal(b, n); if (r) { ed.poner('iva', r.iva); ed.poner('retencion', r.retencion) } }
                              setTextoTotal(null)
                            }} />
                        : <input id="kr-total" className="kp-num kr-total-cifra" readOnly tabIndex={-1} aria-label="Total factura" data-prueba="total" value={cifra(totales.total)} />}
                    </KCasilla>
                  </div>
                </Bloque>

                {/* ── Contrapartida/s: una fila por línea (pieza 12) ── */}
                <Bloque titulo="Contrapartida/s" className="kr-contra" >
                  <div className="kr-contra-rejilla" data-hosteleria={hosteleria ? 'si' : undefined} role="table" aria-label="Las contrapartidas">
                    <div className="kr-contra-cabeza" role="row">
                      <span role="columnheader">Subcuenta gasto</span><span role="columnheader" />
                      <span role="columnheader">Concepto de gastos</span><span role="columnheader">Local</span>
                      {hosteleria && <><span role="columnheader">Marca</span><span role="columnheader">Plataforma</span></>}
                      <span role="columnheader" className="kp-num">Importe</span><span role="columnheader" />
                    </div>
                    {b.gastos.map((g, i) => {
                      const d = datoDe(i)
                      return (
                        <div className="kr-contra-fila" role="row" key={i} data-una={unaLinea ? 'si' : undefined}>
                          <span className="kr-celda" data-ambar={(!!duda && i === 0) || (i === 0 && !!comprobacion('gasto-propuesto')) ? 'si' : undefined} title={i === 0 ? (duda?.texto ?? comprobacion('gasto-propuesto')?.texto) : undefined}>
                            <Buscador id={`kf-cuenta-${i}`} etiqueta={`Cuenta de gasto ${i + 1}`} cargando={cuentasGastoL === null} valor={textoCuenta[i] ?? g.cuenta} cuenta={g.cuenta || null} duda={!!duda && i === 0}
                              ponerTexto={(t) => { setTextoCuenta((x) => ({ ...x, [i]: t })); if (!t.trim()) ponerGasto(i, { cuenta: '' }) }} lista={(t) => cuentasQueEncajan(t, cuentasPlan, 8)}
                              texto={(c) => `${c.codigo} · ${c.nombre}`} elegir={(c) => { ponerGasto(i, { cuenta: c.codigo }); setTextoCuenta((x) => { const y = { ...x }; delete y[i]; return y }) }}
                              crear={crearCuenta((c) => { ponerGasto(i, { cuenta: c.codigo }); setTextoCuenta((x) => { const y = { ...x }; delete y[i]; return y }) })} />
                          </span>
                          <span className="kr-celda"><NombreDeCuenta etiqueta={`Nombre de la cuenta ${i + 1}`} valor={g.cuenta ? nombreGasto(g.cuenta) : ''} duda={!!duda && i === 0} /></span>
                          <span className="kr-celda">
                            <input aria-label={`Concepto de gastos ${i + 1}`} maxLength={200} disabled={aMano || !cabEscribible} key={`${invoiceId}:c:${i}:${d?.concepto ?? ''}`} defaultValue={d?.concepto ?? ''}
                              placeholder={conceptoTexto} title={d?.concepto || conceptoTexto || undefined}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur() } }}
                              onBlur={(e) => { const v = e.currentTarget.value.trim() || null; if (v !== (d?.concepto ?? null)) ponerDatoLinea(i, { concepto: v }) }} />
                          </span>
                          <span className="kr-celda">
                            <select aria-label={i === 0 ? 'Local' : `Local ${i + 1}`} data-casilla={ejeLocal ? '' : undefined} disabled={!ejeLocal} value={g.local ?? ''} onChange={(e) => ponerGasto(i, { local: e.target.value })}>
                              {aMano && ejeLocal && <option value="">Elige</option>}
                              <option value={aMano && ejeLocal ? LOCAL_COMUN : ''}>{ejeLocal ? 'Común' : 'Sin locales'}</option>
                              {localesLupa.map((l) => <option key={l.id} value={l.id}>{l.descripcion}{l.id === localPropuesto ? ' (su ficha)' : ''}</option>)}
                            </select>
                          </span>
                          {hosteleria && <>
                            <span className="kr-celda">
                              <select id={i === 0 ? 'kf-marca' : undefined} aria-label={i === 0 ? 'Marca' : `Marca ${i + 1}`} value={marcaDe(i) ?? ''} disabled={!cabEscribible || guardandoCab || guardandoOtros}
                                title={marcasLupa.find((m) => m.id === marcaDe(i))?.descripcion ?? 'Sin marca'} onChange={(e) => ponerDatoLinea(i, { marca: e.target.value || null })}>
                                <option value="">—</option>
                                {marcasLupa.map((m) => <option key={m.id} value={m.id} title={m.descripcion}>{m.codigo}</option>)}
                              </select>
                            </span>
                            <span className="kr-celda">
                              <select aria-label={i === 0 ? 'Plataforma' : `Plataforma ${i + 1}`} value={d?.canalId ?? ''} disabled={!cabEscribible || guardandoOtros}
                                title={plataformasLupa.find((p) => p.id === d?.canalId)?.descripcion ?? 'Sin plataforma'} onChange={(e) => ponerDatoLinea(i, { plataforma: e.target.value || null })}>
                                <option value="">—</option>
                                {plataformasLupa.map((p) => <option key={p.id} value={p.id} title={p.descripcion}>{p.descripcion}</option>)}
                              </select>
                            </span>
                          </>}
                          <span className="kr-celda">
                            {unaLinea
                              ? <input className="kp-num" aria-label={`Importe del gasto ${i + 1}`} readOnly tabIndex={-1} value={importeEs(baseGasto)} title={pct < 100 ? `La base y el ${100 - pct} % del IVA que no se deduce` : undefined} />
                              : <CasillaImporte id={`kr-importe-${i}`} etiqueta={`Importe del gasto ${i + 1}`} valor={g.importe} poner={(t) => ponerGasto(i, { importe: t })} />}
                          </span>
                          <span className="kr-celda">{!unaLinea && <button type="button" className="kr-quitar" aria-label={`Quitar la cuenta ${i + 1}`} tabIndex={-1} onClick={() => ed.poner('gastos', b.gastos.filter((_, j) => j !== i))}>×</button>}</span>
                        </div>
                      )
                    })}
                  </div>
                  <div className="kr-pie">
                    {!soloLectura && <BotonMas etiqueta="Otra línea" texto={otraLinea(b.gastos.length)} hacer={() => ed.poner('gastos', [...b.gastos, { cuenta: b.gastos[0]?.cuenta ?? '', local: '', importe: '' }])} />}
                    {!unaLinea && <span className="kr-suma" data-ambar={rotuloSuma.motivo ? 'si' : undefined} title={rotuloSuma.motivo ?? undefined} data-prueba="suma-contrapartidas">{rotuloSuma.texto}</span>}
                  </div>
                  {!soloLectura && avisoInmovilizado(b.gastos.map((g) => g.cuenta)) && (
                    <p className="kf-aviso-linea" data-prueba="aviso-inmovilizado">{avisoInmovilizado(b.gastos.map((g) => g.cuenta))}</p>
                  )}
                </Bloque>
              </fieldset>

              {/* ── Pago factura: una fila por pago (K10c) ── */}
              <Bloque titulo="Pago factura" className="kr-pago">
                <div className="kr-pago-rejilla" role="table" aria-label="Los pagos de la factura">
                  <div className="kr-pago-cabeza" role="row">
                    <span role="columnheader">Periodo</span><span role="columnheader">Docum.</span><span role="columnheader">Subcuenta pago</span>
                    <span role="columnheader">Fecha</span><span role="columnheader">Concepto</span><span role="columnheader" className="kp-num">Importe</span><span role="columnheader" />
                  </div>
                  {pagos.filas.map((f, i) => {
                    const c = f.id ? candados?.[pagosHechos.findIndex((p) => p.id === f.id)] ?? null : null
                    const editando = enEdicion && enEdicion.id === f.id && f.id !== null
                    if (f.id === null) {
                      // La propuesta del K06: se apunta al validar.
                      return (
                        <div className="kr-pago-fila" role="row" key="propuesta" data-propuesta="si">
                          <input aria-label="Periodo del pago" readOnly tabIndex={-1} value={f.ejercicio} />
                          <input aria-label="Documento del pago" readOnly tabIndex={-1} value="" title="Lo pone el programa al apuntarlo" />
                          <span className="kr-celda" data-prueba="pago-cuenta" data-ambar={dudaPago ? 'si' : undefined} title={dudaPago ? textoDudaPago(dudaPago, (x) => cuentasPago?.nombres.get(x) ?? '').texto : [nombrePago, origenPago].filter(Boolean).join(' · ') || undefined}>
                            <Buscador id="kf-pago" etiqueta="La cuenta del pago" cargando={!cuentasPago} valor={textoPago ?? pagoCuenta} cuenta={pagoCuenta || null} duda={!!dudaPago}
                              ponerTexto={(t) => { setTextoPago(t); if (!t.trim()) ed.poner('pagoCuenta', '') }} lista={(t) => cuentasQueEncajan(t, [...(cuentasPago?.lista ?? []), ...creadas], 8)}
                              texto={(x) => `${x.codigo} · ${x.nombre}`} elegir={(x) => { ed.poner('pagoCuenta', x.codigo); setTextoPago(null) }}
                              crear={crearCuenta((x) => { ed.poner('pagoCuenta', x.codigo); setTextoPago(null) })} />
                          </span>
                          <CasillaFecha id="kf-pago-fecha" etiqueta="La fecha del pago" iso={pagoCuenta ? pagoFecha : ''} hoy={hoy} poner={(x) => ed.poner('pagoFecha', x)} />
                          <input aria-label="Concepto del pago" readOnly tabIndex={-1} value={pagoCuenta ? f.concepto : ''} title={[pagoCuenta ? f.concepto : '', asientoDelPago].filter(Boolean).join(' · ') || undefined} data-prueba="pago-asiento" />
                          <input className="kp-num" readOnly tabIndex={-1} aria-label="Importe del pago" value={cifra(importePago)} />
                          <span>{origenPago && <span className="kf-origen kr-oculto" data-prueba="origen-pago" title={origenPago}>{origenPago}</span>}</span>
                        </div>
                      )
                    }
                    if (editando && enEdicion) {
                      return (
                        <div className="kr-pago-fila" role="row" key={f.id} data-editando="si">
                          <input aria-label="Periodo del pago" readOnly tabIndex={-1} value={enEdicion.fecha.slice(0, 4)} />
                          <input aria-label="Documento del pago" readOnly tabIndex={-1} value={f.documento} />
                          <CasillaLupa id={`kr-pago-cuenta-${i}`} etiqueta="Subcuenta pago" registros={registrosPago} valor={enEdicion.cuenta || null} poner={(r) => setPagoEdit({ ...enEdicion, cuenta: r?.codigo ?? '' })} />
                          <CasillaFecha id={`kr-pago-fecha-${i}`} etiqueta="Fecha del pago" iso={enEdicion.fecha} hoy={hoy} poner={(x) => setPagoEdit({ ...enEdicion, fecha: x })} />
                          <input aria-label="Concepto del pago" value={enEdicion.concepto} onChange={(e) => setPagoEdit({ ...enEdicion, concepto: e.target.value })} />
                          <CasillaImporte id={`kr-pago-importe-${i}`} etiqueta="Importe del pago" valor={enEdicion.importe} poner={(t) => setPagoEdit({ ...enEdicion, importe: t })}
                            teclas={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void guardarPago() } }} />
                          <span className="kr-pago-botones">
                            <button type="button" className="kr-boton" disabled={haciendoPago} title="Guardar el pago (Intro)" aria-label="Guardar el pago" onClick={() => void guardarPago()}>✓</button>
                            <button type="button" className="kr-boton" disabled={haciendoPago} title="Dejarlo como estaba (Esc)" aria-label="Dejar el pago como estaba" onClick={() => setPagoEdit(null)}>✕</button>
                          </span>
                        </div>
                      )
                    }
                    const bloqueado = c ? !c.puede : true
                    return (
                      <div className="kr-pago-fila" role="row" key={f.id} data-pago={f.id}>
                        <input aria-label="Periodo del pago" readOnly tabIndex={-1} value={f.ejercicio} />
                        <input aria-label="Documento del pago" readOnly tabIndex={-1} value={f.documento} />
                        <input aria-label="Subcuenta pago" readOnly tabIndex={-1} value={f.cuenta} title={pagosHechos.find((p) => p.id === f.id)?.nombreCuenta ?? undefined} />
                        <input aria-label="Fecha del pago" readOnly tabIndex={-1} value={fechaCorta(f.fecha)} />
                        <input aria-label="Concepto del pago" readOnly tabIndex={-1} value={f.concepto} title={f.concepto} />
                        <input className="kp-num" aria-label="Importe del pago" readOnly tabIndex={-1} value={cifra(f.importe)} />
                        <span className="kr-pago-botones">
                          <button type="button" className="kr-boton" aria-label={`Cambiar el pago ${f.documento}`} disabled={bloqueado || haciendoPago || !!enEdicion}
                            title={bloqueado ? (c?.porque ?? 'Comprobando si se puede cambiar…') : 'Cambiar el pago (el asiento conserva su número)'}
                            onClick={() => { setBorrarArmado(null); setPagoEdit({ de: invoiceId, id: f.id, cuenta: f.cuenta, fecha: f.fecha, concepto: f.concepto, importe: importeEs(f.importe) }) }}>✎</button>
                          <button type="button" className="kr-boton" data-armado={borrarArmado === f.id ? 'si' : undefined} aria-label={`Borrar el pago ${f.documento}`} disabled={bloqueado || haciendoPago || !!enEdicion}
                            title={bloqueado ? (c?.porque ?? 'Comprobando si se puede borrar…') : borrarArmado === f.id ? 'Pulsa otra vez para borrarlo: la serie se renumera' : 'Borrar el pago y su asiento'}
                            onClick={() => f.id && void borrarUnPago(f.id)}>{borrarArmado === f.id ? '¿?' : '🗑'}</button>
                        </span>
                      </div>
                    )
                  })}
                  {enEdicion && enEdicion.id === null && (
                    <div className="kr-pago-fila" role="row" data-editando="si" data-nuevo="si">
                      <input aria-label="Periodo del pago" readOnly tabIndex={-1} value={enEdicion.fecha.slice(0, 4)} />
                      <input aria-label="Documento del pago" readOnly tabIndex={-1} value="" />
                      <CasillaLupa id="kr-pago-cuenta-nuevo" etiqueta="Subcuenta pago" registros={registrosPago} valor={enEdicion.cuenta || null} poner={(r) => setPagoEdit({ ...enEdicion, cuenta: r?.codigo ?? '' })} />
                      <CasillaFecha id="kr-pago-fecha-nuevo" etiqueta="Fecha del pago" iso={enEdicion.fecha} hoy={hoy} poner={(x) => setPagoEdit({ ...enEdicion, fecha: x })} />
                      <input aria-label="Concepto del pago" value={enEdicion.concepto} onChange={(e) => setPagoEdit({ ...enEdicion, concepto: e.target.value })} />
                      <CasillaImporte id="kr-pago-importe-nuevo" etiqueta="Importe del pago" valor={enEdicion.importe} poner={(t) => setPagoEdit({ ...enEdicion, importe: t })}
                        teclas={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void guardarPago() } }} />
                      <span className="kr-pago-botones">
                        <button type="button" className="kr-boton" disabled={haciendoPago} title="Apuntar el pago (Intro)" aria-label="Apuntar el pago" onClick={() => void guardarPago()}>✓</button>
                        <button type="button" className="kr-boton" disabled={haciendoPago} title="No apuntarlo (Esc)" aria-label="No apuntar el pago" onClick={() => setPagoEdit(null)}>✕</button>
                      </span>
                    </div>
                  )}
                </div>
                <div className="kr-pie">
                  {modo === 'contabilizada' && (
                    <BotonMas etiqueta="Otro pago" texto={otroPago(pagosHechos.length)}
                      hacer={() => { setBorrarArmado(null); setPagoEdit({ de: invoiceId, id: null, cuenta: '', fecha: hoy, concepto: `PAGO ${b.numero} ${prov?.nombre ?? ''}`.trim(), importe: pagos.pendiente > 0 ? importeEs(pagos.pendiente) : '' }) }} />
                  )}
                  {modo === 'contabilizada' && (
                    <span className="kr-suma" data-ambar={pagos.ambar ? 'si' : undefined} title={pagos.motivo ?? undefined} data-prueba="pendiente">
                      {pagos.pendiente > 0.005 ? `Pendiente ${cifra(pagos.pendiente)}` : 'Pagada'}
                    </span>
                  )}
                </div>
              </Bloque>

              {/* ── Observaciones: con la factura, no van al asiento ── */}
              <Bloque titulo="Observaciones" className="kr-obs">
                <input id="kf-observaciones" aria-label="Observaciones" maxLength={2000} readOnly={!cabEscribible} title="Se guardan con la factura; no van al asiento"
                  value={textoObs?.k === invoiceId ? textoObs.v : cab?.observaciones ?? ''}
                  onChange={(e) => setTextoObs({ k: invoiceId ?? '', v: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur() } }}
                  onBlur={() => {
                    if (textoObs?.k !== invoiceId) return
                    const v = textoObs.v.trim(); setTextoObs(null)
                    if (v !== (cab?.observaciones ?? '')) void ponerCabecera({ observaciones: v || null })
                  }} />
              </Bloque>

              {/* Lo que aún se decide con un botón (la repetida, el emisor, la cuenta que duda, el pago que duda). */}
              <div className="kr-dudas">
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
                {emisor?.que === 'alta' && altaAbierta === invoiceId && accountId && fac && (
                  <AltaDesdeFactura accountId={accountId} otros={proveedores.map((p) => ({ id: p.id, name: p.nombre, taxId: p.nif }))}
                    leido={{ nombre: emisor.nombre, nif: emisor.nif, direccion: leido?.proveedor.direccion ?? null, correo: leido?.proveedor.email ?? null, telefono: leido?.proveedor.telefono ?? null, web: leido?.proveedor.web ?? null }}
                    factura={{ id: fac.id, numero: fac.numero ?? null }} alCancelar={() => setAltaAbierta(null)}
                    alCrear={(p) => { setAltaAbierta(null); void elegirYGuardar(p.id, p.name, fraseAltaEnFactura(p.name)) }} />
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
                  <Duda texto={textoDudaPago(dudaPago, (c) => cuentasPago?.nombres.get(c) ?? '').texto}
                    principal={{ texto: `Dejar ${dudaPago.cuentas[0]}`, hacer: () => ed.poner('pagoCuenta', dudaPago.cuentas[0]) }}
                    secundario={{ texto: `Cambiar a ${dudaPago.cuentas[1]}`, hacer: () => ed.poner('pagoCuenta', dudaPago.cuentas[1]) }} />
                )}
              </div>

              {/* ── Visualización del asiento (pieza 7): el de la factura y, debajo, el de cada pago, con su número ── */}
              {!(modo === 'contabilizada' && enModificar && asientoReal) && (
                <Bloque titulo="Visualización del asiento" className="kr-visual">
                  <div className="kf-asiento kr-visual-marco" aria-label="El asiento que sale">
                    <table>
                      <tbody className="kr-visual-cabeza"><tr>
                        <th colSpan={2}>Factura{modo === 'contabilizada' && fac?.asiento?.numero ? ` · asiento 2 / ${fac.asiento.numero}` : ''}</th>
                        <th colSpan={2} className="kp-num">
                          <span className="kf-etiqueta" data-tono={modo === 'contabilizada' ? 'bien' : etiqueta.tono} data-prueba="cuadra" title={porqueSinPropuesta ?? undefined}>
                            {modo === 'contabilizada' ? etiquetaValidado(fac?.asiento?.numero ?? null) : etiqueta.texto}
                          </span> {fechaCorta(otrosL?.fechaContable ?? b.fecha)}
                        </th>
                      </tr></tbody>
                      {porqueSinPropuesta && <tbody><tr><td colSpan={4} className="kr-visual-nota" data-prueba="sin-propuesta">{porqueSinPropuesta}</td></tr></tbody>}
                      <tbody>
                        {filasVisual(visualFactura).map((r, i) => (
                          <tr key={i}>
                            <td className="kr-visual-debe">{r.d && <><span className="kp-num">{cifra(r.d.importe)}</span> <span className="kp-visual-cuenta">({r.d.cuenta})</span></>}</td>
                            <td className="kr-visual-nombre" title={r.d?.nombre}>{r.d?.nombre}</td>
                            <td className="kr-visual-nombre kr-visual-haber-nombre" title={r.h?.nombre}>{r.h?.nombre}</td>
                            <td className="kr-visual-haber">{r.h && <><span className="kp-visual-cuenta">({r.h.cuenta})</span> <span className="kp-num">{cifra(r.h.importe)}</span></>}</td>
                          </tr>
                        ))}
                      </tbody>
                      {pagosHechos.map((p) => (
                        <tbody key={p.id} data-asiento-pago={p.id}>
                          <tr className="kr-visual-cabeza"><th colSpan={2}>Pago{p.numero !== null ? ` · asiento ${p.serie ?? 4} / ${p.numero}` : ''}</th><th colSpan={2} className="kp-num">{fechaCorta(p.fecha)}</th></tr>
                          {filasVisual(aVisual(p.apuntes.map((a) => ({ codigo: a.cuenta, nombre: a.nombre, debe: a.debe || null, haber: a.haber || null })))).map((r, i) => (
                            <tr key={i}>
                              <td className="kr-visual-debe">{r.d && <><span className="kp-num">{cifra(r.d.importe)}</span> <span className="kp-visual-cuenta">({r.d.cuenta})</span></>}</td>
                              <td className="kr-visual-nombre" title={r.d?.nombre}>{r.d?.nombre}</td>
                              <td className="kr-visual-nombre kr-visual-haber-nombre" title={r.h?.nombre}>{r.h?.nombre}</td>
                              <td className="kr-visual-haber">{r.h && <><span className="kp-visual-cuenta">({r.h.cuenta})</span> <span className="kp-num">{cifra(r.h.importe)}</span></>}</td>
                            </tr>
                          ))}
                        </tbody>
                      ))}
                    </table>
                  </div>
                </Bloque>
              )}
              {modo === 'contabilizada' && enModificar && asientoReal && (
                <ModificarAsiento apuntes={asientoReal.apuntes.map((a) => ({ posicion: a.posicion, cuenta: a.cuenta, nombre: a.nombreCuenta, debe: a.debe, haber: a.haber }))}
                  plan={cuentasPago?.lista ?? []} nombre={(c) => cuentasPago?.nombres.get(c) ?? asientoReal.apuntes.find((a) => a.cuenta === c)?.nombreCuenta ?? ''}
                  elegidas={modificando?.elegidas ?? {}} elegir={(pos, c) => setModificando((m) => (m ? { ...m, elegidas: { ...m.elegidas, [pos]: c } } : m))} />
              )}
              </>}
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
