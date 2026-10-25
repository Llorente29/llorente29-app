// supabase/functions/_shared/verifactu/xml.ts
//
// V03 · E1 · EL MENSAJE A HACIENDA: un envío (RegFactuSistemaFacturacion) con
// sus registros de alta y de anulación, tal y como están en verifactu_registro.
//
// El orden de cada elemento es el de los XSD OFICIALES, bajados de la AEAT por
// la sonda (docs/conta/v03/aeat/SuministroLR.xsd y SuministroInformacion.xsd,
// 25/10). Una prueba valida lo que sale de aquí contra esos mismos XSD con
// xmllint: no contra lo que creemos que dicen.
//
// Aquí no se calcula nada: la huella, la cadena, el desglose y los importes ya
// vienen escritos en el registro (la base los escribió con su cerrojo). Lo que
// se envía es lo que se guardó, byte a byte en lo que entra en la huella.
//
// Núcleo sin Deno: lo usan la función conta-verifactu y las pruebas.

export const NS_SOAP = 'http://schemas.xmlsoap.org/soap/envelope/'
const BASE = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/'
export const NS_LR = BASE + 'SuministroLR.xsd'
export const NS_SF = BASE + 'SuministroInformacion.xsd'

/** El sistema informático que factura (declaración responsable, respuesta 1 de Julio). */
export interface SistemaInformatico {
  /** Quien produce el sistema: su nombre y NIF. */
  nombreRazon: string
  nif: string
  nombre: string // «Sumied»
  id: string // «SU»
  version: string
  numeroInstalacion: string
}

export interface Destinatario {
  nombre: string
  nif?: string
  codigo_pais?: string
  id_type?: string
  id?: string
}

export interface LineaDesglose {
  impuesto?: string
  clave_regimen?: string
  calificacion?: string
  exenta?: string
  tipo?: number | string
  base: number | string
  cuota?: number | string
  tipo_recargo?: number | string
  cuota_recargo?: number | string
}

/** Un registro tal y como lo devuelve verifactu_cola_tomar (to_jsonb de la fila). */
export interface Registro {
  id: string
  tipo: 'alta' | 'anulacion'
  subsanacion: boolean
  rechazo_previo: 'N' | 'S' | 'X' | null
  sin_registro_previo: boolean
  nif_emisor: string
  nombre_emisor: string
  num_serie: string
  fecha_expedicion: string // AAAA-MM-DD
  fecha_operacion: string | null
  tipo_factura: string | null
  tipo_rectificativa: 'S' | 'I' | null
  rectificadas: { nif: string; num_serie: string; fecha: string }[] | null
  descripcion: string | null
  destinatarios: Destinatario[] | null
  desglose: LineaDesglose[] | null
  cuota_total: number | string | null
  importe_total: number | string | null
  primer_registro: boolean
  anterior_num_serie: string | null
  anterior_fecha: string | null
  huella_anterior: string | null
  fecha_hora_huso: string
  huella: string
}

export class RegistroNoValido extends Error {
  readonly registroId: string
  constructor(registroId: string, mensaje: string) {
    super(mensaje)
    this.name = 'RegistroNoValido'
    this.registroId = registroId
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** AAAA-MM-DD → DD-MM-AAAA (el «fecha» de los XSD). */
export function fechaXml(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) throw new Error(`Fecha sin formato AAAA-MM-DD: ${iso}`)
  return `${m[3]}-${m[2]}-${m[1]}`
}

/** Un importe o un tipo con dos decimales y punto (ImporteSgn12.2Type, Tipo2.2Type). */
export function dosDecimales(v: number | string): string {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) throw new Error(`Importe que no es un número: ${v}`)
  return n.toFixed(2)
}

type Nodo = string | null | undefined | false
const sf = (nombre: string, ...hijos: Nodo[]) => `<sf:${nombre}>${hijos.filter(Boolean).join('')}</sf:${nombre}>`
const txt = (nombre: string, v: string) => sf(nombre, esc(v))

function persona(d: Destinatario, quien: string): string {
  if (d.nif) return sf('IDDestinatario', txt('NombreRazon', d.nombre), txt('NIF', d.nif))
  if (!d.id_type || !d.id) throw new RegistroNoValido(quien, 'Un destinatario sin NIF ni identificación de su país.')
  return sf('IDDestinatario', txt('NombreRazon', d.nombre),
    sf('IDOtro', d.codigo_pais && txt('CodigoPais', d.codigo_pais), txt('IDType', d.id_type), txt('ID', d.id)))
}

function detalle(l: LineaDesglose, quien: string): string {
  if (!l.calificacion === !l.exenta) throw new RegistroNoValido(quien, 'Una línea del desglose sin calificación ni exención (o con las dos).')
  return sf('DetalleDesglose',
    l.impuesto && txt('Impuesto', l.impuesto),
    l.clave_regimen && txt('ClaveRegimen', l.clave_regimen),
    l.calificacion ? txt('CalificacionOperacion', l.calificacion) : txt('OperacionExenta', l.exenta!),
    l.tipo != null && txt('TipoImpositivo', dosDecimales(l.tipo)),
    txt('BaseImponibleOimporteNoSujeto', dosDecimales(l.base)),
    l.cuota != null && txt('CuotaRepercutida', dosDecimales(l.cuota)),
    l.tipo_recargo != null && txt('TipoRecargoEquivalencia', dosDecimales(l.tipo_recargo)),
    l.cuota_recargo != null && txt('CuotaRecargoEquivalencia', dosDecimales(l.cuota_recargo)))
}

function encadenamiento(r: Registro): string {
  if (r.primer_registro) return sf('Encadenamiento', txt('PrimerRegistro', 'S'))
  if (!r.anterior_num_serie || !r.anterior_fecha || !r.huella_anterior) throw new RegistroNoValido(r.id, 'Un registro que no es el primero sin su anterior.')
  return sf('Encadenamiento', sf('RegistroAnterior',
    txt('IDEmisorFactura', r.nif_emisor), txt('NumSerieFactura', r.anterior_num_serie),
    txt('FechaExpedicionFactura', fechaXml(r.anterior_fecha)), txt('Huella', r.huella_anterior)))
}

function sistema(s: SistemaInformatico): string {
  return sf('SistemaInformatico',
    txt('NombreRazon', s.nombreRazon), txt('NIF', s.nif),
    txt('NombreSistemaInformatico', s.nombre), txt('IdSistemaInformatico', s.id),
    txt('Version', s.version), txt('NumeroInstalacion', s.numeroInstalacion),
    // Respuesta 1 de Julio: Sumied solo factura con VERI*FACTU; varios
    // obligados (cada empresa de cada cuenta) en el mismo sistema.
    txt('TipoUsoPosibleSoloVerifactu', 'S'), txt('TipoUsoPosibleMultiOT', 'S'), txt('IndicadorMultiplesOT', 'S'))
}

export function registroAlta(r: Registro, s: SistemaInformatico): string {
  if (r.tipo !== 'alta' || !r.tipo_factura || !r.desglose?.length || r.cuota_total == null || r.importe_total == null) {
    throw new RegistroNoValido(r.id, 'Un alta sin tipo de factura, desglose o importes.')
  }
  if (r.desglose.length > 12) throw new RegistroNoValido(r.id, 'Más de 12 líneas de desglose (el máximo de Hacienda).')
  const rect = r.rectificadas?.length
    ? sf('FacturasRectificadas', ...r.rectificadas.map((x) => sf('IDFacturaRectificada',
        txt('IDEmisorFactura', x.nif.replace(/^ES/i, '').toUpperCase()), txt('NumSerieFactura', x.num_serie), txt('FechaExpedicionFactura', fechaXml(x.fecha)))))
    : null
  return sf('RegistroAlta',
    txt('IDVersion', '1.0'),
    sf('IDFactura', txt('IDEmisorFactura', r.nif_emisor), txt('NumSerieFactura', r.num_serie), txt('FechaExpedicionFactura', fechaXml(r.fecha_expedicion))),
    txt('NombreRazonEmisor', r.nombre_emisor),
    r.subsanacion && txt('Subsanacion', 'S'),
    r.rechazo_previo && txt('RechazoPrevio', r.rechazo_previo),
    txt('TipoFactura', r.tipo_factura),
    r.tipo_rectificativa && txt('TipoRectificativa', r.tipo_rectificativa),
    rect,
    r.fecha_operacion && r.fecha_operacion !== r.fecha_expedicion && txt('FechaOperacion', fechaXml(r.fecha_operacion)),
    txt('DescripcionOperacion', (r.descripcion ?? '').slice(0, 500) || 'Venta'),
    r.destinatarios?.length && sf('Destinatarios', ...r.destinatarios.map((d) => persona(d, r.id))),
    sf('Desglose', ...r.desglose.map((l) => detalle(l, r.id))),
    txt('CuotaTotal', dosDecimales(r.cuota_total)),
    txt('ImporteTotal', dosDecimales(r.importe_total)),
    encadenamiento(r),
    sistema(s),
    txt('FechaHoraHusoGenRegistro', r.fecha_hora_huso),
    txt('TipoHuella', '01'),
    txt('Huella', r.huella))
}

export function registroAnulacion(r: Registro, s: SistemaInformatico): string {
  if (r.tipo !== 'anulacion') throw new RegistroNoValido(r.id, 'No es una anulación.')
  return sf('RegistroAnulacion',
    txt('IDVersion', '1.0'),
    sf('IDFactura', txt('IDEmisorFacturaAnulada', r.nif_emisor), txt('NumSerieFacturaAnulada', r.num_serie),
      txt('FechaExpedicionFacturaAnulada', fechaXml(r.fecha_expedicion))),
    r.sin_registro_previo && txt('SinRegistroPrevio', 'S'),
    r.rechazo_previo && r.rechazo_previo !== 'X' && txt('RechazoPrevio', r.rechazo_previo),
    encadenamiento(r),
    sistema(s),
    txt('FechaHoraHusoGenRegistro', r.fecha_hora_huso),
    txt('TipoHuella', '01'),
    txt('Huella', r.huella))
}

/** El cuerpo: la cabecera (quien está obligado) y de 1 a 1.000 registros, en el orden de la cadena. */
export function cuerpoEnvio(obligado: { nombre: string; nif: string }, registros: Registro[], s: SistemaInformatico): string {
  if (registros.length < 1 || registros.length > 1000) throw new Error(`Un envío lleva de 1 a 1.000 registros, no ${registros.length}.`)
  const otro = registros.find((r) => r.nif_emisor !== obligado.nif)
  if (otro) throw new RegistroNoValido(otro.id, 'Un envío solo lleva registros de su obligado.')
  return `<sfLR:RegFactuSistemaFacturacion xmlns:sfLR="${NS_LR}" xmlns:sf="${NS_SF}">`
    + `<sfLR:Cabecera>${sf('ObligadoEmision', txt('NombreRazon', obligado.nombre), txt('NIF', obligado.nif))}</sfLR:Cabecera>`
    + registros.map((r) => `<sfLR:RegistroFactura>${r.tipo === 'alta' ? registroAlta(r, s) : registroAnulacion(r, s)}</sfLR:RegistroFactura>`).join('')
    + `</sfLR:RegFactuSistemaFacturacion>`
}

/** El sobre SOAP entero. */
export function sobreEnvio(obligado: { nombre: string; nif: string }, registros: Registro[], s: SistemaInformatico): string {
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="${NS_SOAP}"><soapenv:Header/><soapenv:Body>`
    + cuerpoEnvio(obligado, registros, s) + `</soapenv:Body></soapenv:Envelope>`
}
