// supabase/functions/_shared/verifactu/respuesta.ts
//
// V03 · E1 · LO QUE CONTESTA HACIENDA a un envío, en lo que guarda la base
// (verifactu_cola_respuesta): el estado del envío, el TiempoEsperaEnvio nuevo,
// el CSV, y cada registro con su estado, su código y su texto.
//
// Los nombres y los valores son los del XSD OFICIAL de la respuesta
// (docs/conta/v03/aeat/RespuestaSuministro.xsd, 25/10):
//   · EstadoEnvio: Correcto · ParcialmenteCorrecto · Incorrecto
//   · RespuestaLinea (0 a 1.000): IDFactura, Operacion/TipoOperacion (Alta ·
//     Anulacion), EstadoRegistro (Correcto · AceptadoConErrores · Incorrecto),
//     CodigoErrorRegistro, DescripcionErrorRegistro, RegistroDuplicado.
// Un rechazo del envío entero (los 4xxx de errores.properties) no trae
// RespuestaLinea: llega como un Fault de SOAP, con el código en el texto.
//
// Cada línea se casa con su registro por lo que la AEAT devuelve (operación,
// número y fecha), no por un id nuestro: Hacienda no lo conoce.
//
// El 3000 («registro duplicado») no es un rechazo: es que el registro YA está
// en Hacienda (se envió y se perdió la respuesta). Vale lo que diga su
// EstadoRegistroDuplicado.
//
// Sin DOMParser (Deno no lo trae): el XML de la AEAT es plano y conocido, y se
// lee por sus etiquetas, con cualquier prefijo.

import { fechaXml, type Registro } from './xml.ts'

export type EstadoRegistro = 'Correcto' | 'AceptadoConErrores' | 'Incorrecto'

export interface LineaRespuesta {
  id: string
  estado: EstadoRegistro
  codigo: number | null
  descripcion: string | null
}

/** Lo que recibe verifactu_cola_respuesta (menos la respuesta entera, que pone quien llama). */
export interface Leido {
  estado_envio: 'Correcto' | 'ParcialmenteCorrecto' | 'Incorrecto'
  tiempo_espera_s: number | null
  csv: string | null
  registros: LineaRespuesta[]
  /** Líneas que vinieron y no casan con ningún registro del envío (no debería haber ninguna). */
  sin_casar: number
}

/** El envío entero rechazado (Fault de SOAP). */
export class EnvioRechazado extends Error {
  readonly codigo: number | null
  constructor(codigo: number | null, mensaje: string) {
    super(mensaje)
    this.name = 'EnvioRechazado'
    this.codigo = codigo
  }
}

/** La respuesta no se entiende: ni respuesta ni Fault. */
export class RespuestaIlegible extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'RespuestaIlegible'
  }
}

const P = '(?:[\\w.-]+:)?'
const desescapar = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

/** El texto del primer elemento con ese nombre (cualquier prefijo), o null. */
function uno(xml: string, nombre: string): string | null {
  const m = new RegExp(`<${P}${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</${P}${nombre}>`).exec(xml)
  return m ? desescapar(m[1].trim()) : null
}

/** Todos los bloques con ese nombre. */
function todos(xml: string, nombre: string): string[] {
  return [...xml.matchAll(new RegExp(`<${P}${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</${P}${nombre}>`, 'g'))].map((m) => m[1])
}

const clave = (op: 'alta' | 'anulacion', num: string, fecha: string) => `${op}|${num}|${fecha}`

export function leerRespuesta(xml: string, registros: Registro[]): Leido {
  const fault = uno(xml, 'Fault')
  if (fault != null) {
    const texto = uno(fault, 'faultstring') ?? fault
    const cod = /(?:Codigo|C[oó]digo)\s*\[?\s*(\d{3,5})/i.exec(texto) ?? /\b(4\d{3})\b/.exec(texto)
    throw new EnvioRechazado(cod ? Number(cod[1]) : null, texto.slice(0, 1500))
  }
  const cuerpo = uno(xml, 'RespuestaRegFactuSistemaFacturacion')
  if (cuerpo == null) throw new RespuestaIlegible('Hacienda ha contestado algo que no es una respuesta al envío.')
  const estado = uno(cuerpo, 'EstadoEnvio')
  if (estado !== 'Correcto' && estado !== 'ParcialmenteCorrecto' && estado !== 'Incorrecto') {
    throw new RespuestaIlegible(`EstadoEnvio desconocido: ${estado ?? 'ninguno'}.`)
  }
  const espera = uno(cuerpo, 'TiempoEsperaEnvio')

  const porClave = new Map(registros.map((r) => [clave(r.tipo, r.num_serie, fechaXml(r.fecha_expedicion)), r.id]))
  const lineas: LineaRespuesta[] = []
  let sinCasar = 0
  for (const l of todos(cuerpo, 'RespuestaLinea')) {
    const id = uno(l, 'IDFactura') ?? ''
    const num = uno(id, 'NumSerieFactura') ?? ''
    const fecha = uno(id, 'FechaExpedicionFactura') ?? ''
    const op = uno(l, 'TipoOperacion') === 'Anulacion' ? 'anulacion' : 'alta'
    const rid = porClave.get(clave(op, num, fecha))
    if (!rid) { sinCasar++; continue }
    // RegistroDuplicado lleva su propio CodigoErrorRegistro: fuera, antes de leer el de la línea.
    const dupBloque = uno(l, 'RegistroDuplicado')
    const propia = l.replace(new RegExp(`<${P}RegistroDuplicado[\\s\\S]*?</${P}RegistroDuplicado>`), '')
    let e = uno(propia, 'EstadoRegistro') as EstadoRegistro | null
    const cod = uno(propia, 'CodigoErrorRegistro')
    const codigo = cod && /^\d+$/.test(cod) ? Number(cod) : null
    if (codigo === 3000) {
      const dup = uno(dupBloque ?? '', 'EstadoRegistroDuplicado')
      if (dup === 'Correcta') e = 'Correcto'
      else if (dup === 'AceptadaConErrores') e = 'AceptadoConErrores'
    }
    if (e !== 'Correcto' && e !== 'AceptadoConErrores' && e !== 'Incorrecto') e = 'Incorrecto'
    lineas.push({ id: rid, estado: e, codigo, descripcion: uno(propia, 'DescripcionErrorRegistro') })
  }
  return {
    estado_envio: estado,
    tiempo_espera_s: espera && /^\d+$/.test(espera) ? Number(espera) : null,
    csv: uno(cuerpo, 'CSV'),
    registros: lineas,
    sin_casar: sinCasar,
  }
}
