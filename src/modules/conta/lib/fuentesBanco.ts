// src/modules/conta/lib/fuentesBanco.ts
//
// B01 · Las tres fuentes de movimientos con un solo modelo (`extractoBanco.ts`):
//
//   · `fichero`: lo que se suelta en «Subir extracto». Norma 43 si lo parece; si
//     no, Excel/CSV con el perfil del banco (reconocido por el IBAN o elegido).
//   · `correo`: el extracto adjunto que llega a la dirección de la empresa.
//     PREPARADO, NO CONECTADO (respuesta 1, P5): el buzón es el encargo E01 y no
//     se hacen dos. Aquí queda su contrato —qué recibe y qué devuelve— con su
//     prueba, para que E01 solo tenga que llamar a `extractosDeCorreo`.
//   · `agregador:<proveedor>`: la conexión directa (PSD2), extra de pago que
//     llega después. Aquí queda la interfaz que tiene que cumplir cualquier
//     proveedor (Salt Edge, Enable Banking, Tink…) y el adaptador a nuestro
//     modelo, probados contra un proveedor SIMULADO. Ni contratos ni claves.
//     Cambiar de proveedor es escribir otra implementación de la interfaz.
//
// Puro (lo asíncrono es solo la interfaz del agregador). Pruebas en
// tests/unit/modules/conta/bancosB01.test.ts.

import { limpiarContraparte, type ExtractoLeido, type MovimientoLeido } from '@/modules/conta/lib/extractoBanco'
import { leerNorma43, pareceNorma43 } from '@/modules/conta/lib/norma43'
import { CsvBancoNoValido, leerCsvBanco, reconocerBanco, type BancoCsv } from '@/modules/conta/lib/lectorCsvBanco'

/** Lo que trae un fichero ya abierto: su texto (Norma 43, CSV) o sus filas (Excel). */
export type ContenidoFichero = { texto: string } | { filas: string[][] }

export class FuenteNoValida extends Error {}

/** Lee un fichero de banco, sea Norma 43 o Excel/CSV. `banco` fuerza el perfil cuando no se reconoce solo. */
export function leerFicheroBanco(contenido: ContenidoFichero, partir: (t: string) => string[][], banco?: BancoCsv): ExtractoLeido {
  if ('texto' in contenido && pareceNorma43(contenido.texto)) return leerNorma43(contenido.texto)
  const filas = 'filas' in contenido ? contenido.filas : partir(contenido.texto)
  const b = banco ?? reconocerBanco(filas)
  if (!b) throw new CsvBancoNoValido('No reconozco el banco de este fichero: no es Norma 43 y sus columnas no son las de ningún banco que conozca. Elige el banco o pide a tu banco el fichero Norma 43 (cuaderno 43).')
  return leerCsvBanco(filas, b)
}

// ── Correo (preparado para E01) ─────────────────────────────────────────────

export interface AdjuntoCorreo { nombre: string; contenido: ContenidoFichero }
export interface CorreoEntrante { para: string; de: string; asunto: string; recibido: string; adjuntos: AdjuntoCorreo[] }

export interface ResultadoCorreo {
  /** El correo era para esta empresa. */
  aceptado: boolean
  motivo: string | null
  extractos: { adjunto: string; extracto: ExtractoLeido | null; error: string | null }[]
  ignorados: { adjunto: string; motivo: string }[]
}

const EXT_EXTRACTO = /\.(n43|q43|aeb|c43|txt|csv|xlsx|xls)$/i

/**
 * El contrato de la fuente `correo`: un correo entrante y la dirección de la
 * empresa → los extractos que trae. Un correo que no es para esta dirección no
 * se mira; un adjunto que no es extracto se ignora diciendo por qué; uno que no
 * se puede leer queda con su error (no tumba a los demás).
 */
export function extractosDeCorreo(c: CorreoEntrante, direccionEmpresa: string, partir: (t: string) => string[][]): ResultadoCorreo {
  const para = c.para.trim().toLowerCase()
  if (para !== direccionEmpresa.trim().toLowerCase()) {
    return { aceptado: false, motivo: `El correo es para ${c.para}, no para la dirección de bancos de la empresa.`, extractos: [], ignorados: [] }
  }
  const r: ResultadoCorreo = { aceptado: true, motivo: null, extractos: [], ignorados: [] }
  for (const a of c.adjuntos) {
    if (!EXT_EXTRACTO.test(a.nombre)) { r.ignorados.push({ adjunto: a.nombre, motivo: 'no es un fichero de extracto (Norma 43, Excel o CSV)' }); continue }
    try {
      r.extractos.push({ adjunto: a.nombre, extracto: leerFicheroBanco(a.contenido, partir), error: null })
    } catch (e) {
      r.extractos.push({ adjunto: a.nombre, extracto: null, error: e instanceof Error ? e.message : String(e) })
    }
  }
  if (c.adjuntos.length === 0) r.motivo = 'El correo no trae ningún adjunto.'
  return r
}

// ── Agregador (interfaz; proveedor de verdad, más adelante) ──────────────────

export interface CuentaAgregador { id: string; iban: string; titular: string | null; divisa: string }
export interface MovimientoAgregador {
  /** Identificador único del movimiento en el proveedor: va a la huella como referencia. */
  id: string
  fecha: string
  fechaValor: string | null
  /** Céntimos con signo. */
  importeCent: number
  concepto: string
  contraparte: string | null
}
export interface PaginaAgregador { saldoInicialCent: number | null; saldoFinalCent: number | null; movimientos: MovimientoAgregador[] }

/** Lo que tiene que cumplir cualquier proveedor de conexión directa. */
export interface ProveedorAgregador {
  /** «saltedge», «enablebanking», «tink»…: va en la fuente `agregador:<id>`. */
  id: string
  nombre: string
  cuentas(conexion: string): Promise<CuentaAgregador[]>
  movimientos(conexion: string, cuenta: string, desde: string, hasta: string): Promise<PaginaAgregador>
}

/** Trae de un proveedor los movimientos de todas las cuentas de una conexión, en nuestro modelo. */
export async function leerDesdeAgregador(p: ProveedorAgregador, conexion: string, desde: string, hasta: string): Promise<ExtractoLeido> {
  if (!/^[a-z0-9-]+$/.test(p.id)) throw new FuenteNoValida(`El identificador del proveedor «${p.id}» no vale para la fuente (solo minúsculas, cifras y guiones).`)
  const cuentas = await p.cuentas(conexion)
  const leidas = await Promise.all(cuentas.map(async (c) => {
    const pag = await p.movimientos(conexion, c.id, desde, hasta)
    const movs: MovimientoLeido[] = [...pag.movimientos]
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
      .map((m) => ({
        fecha: m.fecha, fechaValor: m.fechaValor ?? m.fecha, importeCent: m.importeCent,
        conceptoBanco: [m.concepto, m.contraparte].filter(Boolean).join(' · '),
        conceptoComun: null, conceptoPropio: null, numeroDocumento: null, referencia1: null,
        referencia2: m.id, equivalencia: null, tipoMovimiento: null, contraparte: limpiarContraparte(m.contraparte),
      }))
    return {
      iban: c.iban, identificacion: `${p.nombre} ···· ${c.iban.slice(-4)}`, titular: c.titular, divisa: c.divisa,
      desde, hasta, saldoInicialCent: pag.saldoInicialCent, saldoFinalCent: pag.saldoFinalCent,
      movimientos: movs, control: null, saldosPorFila: null,
    }
  }))
  return { formato: `agregador:${p.id}`, cuentas: leidas, avisos: [] }
}
