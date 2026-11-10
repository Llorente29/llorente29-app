// src/modules/conta/portal/tipos.ts
//
// GP · Tarea 3 · Lo que devuelve cada lectura del portal (las funciones
// conta_portal_* de la 1530 y la 1720). Los nombres, como vienen de la base.

export interface Marca { nombre: string; logo_ruta: string | null; color: string | null; correo: string | null; telefono: string | null; empresa_id: string | null }
export interface ClienteDeEntrada { cliente_id: string; cliente: string; permiso: 'todo' | 'facturas_documentos'; gestoria: Marca }

export interface Peticion { id: string; tipo: 'firmar' | 'subir' | 'contestar'; titulo: string; detalle: string | null; fecha_limite: string | null; creada: string }
export interface Proximo {
  recibo_id: string; mes: string; estado: string; estado_texto: string; total_cent: number; anterior_cent: number | null
  lineas: unknown; cambios: unknown; cargo_el: string | null; parado: string[]
  /** La 2030 (T4): los últimos dígitos y el país de la cuenta en que se carga. Sin la 2030, no vienen. */
  cuenta_final?: string | null; cuenta_pais?: string | null
  incidencia: { id: string; texto: string; creada: string; parado: boolean | null } | null
}
export interface Devuelto { recibo_id: string; mes: string; importe_cent: number; devuelto_el: string | null; gc_estado: string | null; en_marcha: { tipo: string; estado: string; url: string | null; creada: string } | null }
export interface Novedad { tipo: 'factura' | 'impuesto' | 'alta' | 'mensaje'; id: string; titulo: string; cuando: string; total?: number; periodo?: string; ejercicio?: number; importe?: number; resultado?: string; alta?: string; estado?: string; desde?: string }
export interface Inicio {
  gestoria: Marca
  cliente: { id: string; nombre: string; nif: string | null }
  yo: { nombre: string; correo: string; permiso: 'todo' | 'facturas_documentos' }
  peticiones: Peticion[]
  proximo: Proximo | null
  devueltos: Devuelto[]
  pagar_devuelto: ('banco' | 'tarjeta')[]
  mensajes_sin_leer: number
  puede_subir: boolean
  novedades: Novedad[]
}

export interface Factura { id: string; numero: string; fecha: string; anio: number; tipo: string; base: number; iva: number; retencion: number; total: number; concepto: string | null; recibo_mes: string | null; tiene_pdf: boolean; estado: string }
export interface Facturas { facturas: Factura[] }

export interface ReciboPago { id: string; mes: string; importe_cent: number; estado: string; estado_texto: string; cargo_el: string | null; cobrado_el: string | null; factura_id: string | null }
export interface Pagos { pagado_anio_cent: number; devueltos: Devuelto[]; proximo: Proximo | null; recibos: ReciboPago[] }

export interface Documentos {
  puede_subir: boolean
  impuestos: { id: string; modelo: string; ejercicio: number; periodo: string; presentado: string; resultado: string | null; importe: number | null; justificante: boolean }[]
  nominas: { id: string; nombre: string; carpeta: string; trabajador: string; fecha: string }[]
  subidas: { id: string; nombre: string; estado: string; subida: string; contabilizada: boolean }[]
  /** nº 19.1 (la 0005): lo que ha firmado, con su PDF firmado. Sin la 0005, no viene. */
  firmados?: { id: string; titulo: string; firmada: string; pdf: boolean }[]
}

export interface Trabajadores {
  trabajadores: { linea_id: string; nombre: string; desde: string; hasta: string | null; servicio: string; nuevo: boolean }[]
  peticiones: { id: string; tipo: 'alta' | 'baja'; nombre: string; fecha: string; estado: 'pedida' | 'hecha' | 'rechazada'; pedida: string; resuelta: string | null; motivo: string | null }[]
}

export interface Mensaje { id: string; de: 'cliente' | 'gestoria'; autor: string; texto: string; adjuntos: { ruta: string; nombre: string }[]; cuando: string; leido: string | null }
export interface Mensajes { mensajes: Mensaje[] }

export interface Cuenta {
  domiciliacion: { estado: string; firmada: string | null; cuenta_final: string | null; cuenta_pais: string | null; banco: string | null } | null
  cambio_en_marcha: { estado: string; url: string | null; creada: string } | null
  datos: { razon_social: string; nif: string | null; direccion: string; correo_facturas: string | null } | null
  cambio_datos_abierto: boolean
  personas: { id: string; nombre: string; correo: string; permiso: 'todo' | 'facturas_documentos'; soy_yo: boolean; ha_entrado: boolean }[]
  contratado: unknown
  empresa_id: string | null
}

export type Pestana = 'inicio' | 'facturas' | 'pagos' | 'documentos' | 'trabajadores' | 'mensajes' | 'cuenta'
