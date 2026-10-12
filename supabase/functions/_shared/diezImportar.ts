// supabase/functions/_shared/diezImportar.ts
//
// C04b · T3 · Traer el histórico de Diez a Folvy. Orquesta, no decide: lee de
// Diez mes a mes, convierte cada asiento con convertirAsiento (diezMapeo.ts) y
// escribe con las funciones de la base de 20261019T0150, que son las que
// hacen cumplir las reglas (número de Diez, cadena, idempotencia, ejercicio
// abierto, corte). Lo que lee y lo que escribe llegan inyectados: las pruebas
// lo ejercitan sin red y sin base, con el Diez simulado.
//
// Lo medido que manda aquí (T2 §10):
//   · el histórico se trae por FECHA hasta el corte (30/09/2026); lo de
//     octubre entra por la lectura diaria. Un asiento posterior al corte que
//     viniera en el mes se aparta y se cuenta, no se escribe;
//   · el orden de escritura es (fecha, serie, número): es el de la cadena de
//     huellas, el mismo en cada intento;
//   · nada se pierde en silencio: lo que no se convierte, lo que la base
//     rechaza y lo que cambió en Diez salen en el parte con su clave y su
//     motivo (regla 8).

import type { Apunte } from './diezCliente.ts'
import { pendienteDeDocumento, type OrigenDocumento } from './diezDocumentos.ts'
import { claveDiez, convertirAsiento, type AsientoFolvy, type Rechazo } from './diezMapeo.ts'

export interface LectorDiez {
  apuntesDelMes(aaaamm: string): Promise<Apunte[]>
  subcuentas(): Promise<Record<string, unknown>[]>
}
/** Una llamada a una función de la base (supabase.rpc con service_role). Lanza si la base da error. */
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>

export type ConfigImportacion = {
  lector: LectorDiez
  rpc: Rpc
  empresa: string // company.id
  lectura: string // import_run.id, en curso
  desde: string // AAAAMM
  hasta: string // AAAAMM
  corte: string // AAAA-MM-DD: lo posterior no se trae
  tandas?: number // asientos por llamada (200)
  avisar?: (texto: string) => void
}

export type ParteImportacion = {
  meses: number
  leidos: number
  rechazadosAlConvertir: Rechazo[]
  fueraDelCorte: string[]
  ejercicios: { codigo: string; id?: string; problema?: string }[]
  subcuentas: { nuevas: number; estaban: number; rechazadas: { code: string; motivo: string }[] }
  traidos: number
  yaEstaban: number
  distintos: { clave: string; id: string }[]
  rechazados: { clave: string; motivo: string }[]
}

/** Los meses AAAAMM entre dos, ambos incluidos. */
export function mesesEntre(desde: string, hasta: string): string[] {
  if (!/^\d{6}$/.test(desde) || !/^\d{6}$/.test(hasta) || desde > hasta) throw new Error(`Meses no válidos: ${desde}–${hasta}`)
  const out: string[] = []
  let y = Number(desde.slice(0, 4)), m = Number(desde.slice(4))
  while (y * 100 + m <= Number(hasta)) { out.push(`${y}${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++ } }
  return out
}

/** El orden de la cadena: fecha, serie, número. */
export const ordenarAsientos = (xs: AsientoFolvy[]) =>
  [...xs].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.serie - b.serie || a.numero - b.numero)

export function enTandas<T>(xs: T[], n: number): T[][] {
  if (!(n > 0)) throw new Error('El tamaño de la tanda tiene que ser positivo')
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

/** Lo que viaja a conta_diez_importar: solo lo que la base usa. */
export const paraLaBase = (a: AsientoFolvy) => ({
  ejercicio: a.ejercicio, serie: a.serie, numero: a.numero, fecha: a.fecha, concepto: a.concepto,
  tipoAsiento: a.tipoAsiento, huella: a.huella, lineas: a.lineas,
})

type RespuestaImportar = { traidos: number; yaEstaban: number; distintos: { clave: string; id: string }[]; rechazados: { clave: string; motivo: string }[] }
type RespuestaSubcuentas = { nuevas: number; estaban: number; rechazadas: { code: string; motivo: string }[] }

export type Preparado = {
  meses: number
  leidos: number
  asientos: AsientoFolvy[] // en el orden de la cadena
  rechazadosAlConvertir: Rechazo[]
  fueraDelCorte: string[]
  subcuentas: { code: string; nombre: string }[] // las que usan, con el nombre de Diez
}

/**
 * Leer y convertir, sin escribir nada: lo comparten las dos formas de escribir
 * (rpc en las pruebas, psql en la tanda de producción). Si Diez diera dos
 * veces la misma clave, para.
 */
export async function prepararHistorico(cfg: Pick<ConfigImportacion, 'lector' | 'desde' | 'hasta' | 'corte' | 'avisar'>): Promise<Preparado> {
  const avisar = cfg.avisar ?? (() => {})
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cfg.corte)) throw new Error(`Corte no válido: ${cfg.corte}`)
  const p: Preparado = { meses: 0, leidos: 0, asientos: [], rechazadosAlConvertir: [], fueraDelCorte: [], subcuentas: [] }
  const vistas = new Set<string>()
  for (const mes of mesesEntre(cfg.desde, cfg.hasta)) {
    const apuntes = await cfg.lector.apuntesDelMes(mes)
    p.meses++
    p.leidos += apuntes.length
    for (const a of apuntes) {
      const clave = claveDiez(a)
      // El listado puede repetir (no se ha visto, pero no se supone): una clave, una vez.
      if (vistas.has(clave)) throw new Error(`Diez ha dado dos veces el asiento ${clave} en ${mes}: se para sin escribir nada`)
      vistas.add(clave)
      const c = await convertirAsiento(a)
      if ('rechazo' in c) { p.rechazadosAlConvertir.push(c.rechazo); continue }
      if (c.ok.fecha > cfg.corte) { p.fueraDelCorte.push(clave); continue }
      p.asientos.push(c.ok)
    }
    avisar(`${mes}: ${apuntes.length} asientos leídos`)
  }
  p.asientos = ordenarAsientos(p.asientos)
  const usadas = [...new Set(p.asientos.flatMap((a) => a.lineas.map((l) => l.cuenta)))].sort()
  if (usadas.length) {
    const nombres = new Map((await cfg.lector.subcuentas()).map((s) => [String(s.Codigo ?? '').trim(), String(s.Descripcion ?? '').trim()]))
    p.subcuentas = usadas.map((code) => ({ code, nombre: nombres.get(code) ?? '' }))
  }
  return p
}

/**
 * El documento que espera un asiento traído: solo las facturas (series 1 y 2)
 * llevan uno. Su origen sale del tercero (la subcuenta 40/41/43 del asiento,
 * con el nombre de Diez), con la misma regla que pendienteDeDocumento: los
 * de plataformas y riders, por su portal (E04); el resto, de las carpetas de
 * Drive (la tanda de documentos).
 */
export function documentoEsperado(a: AsientoFolvy, nombres: Map<string, string>): OrigenDocumento | null {
  if (a.serie !== 1 && a.serie !== 2) return null
  const tercero = a.lineas.find((l) => /^4[013]/.test(l.cuenta))
  return pendienteDeDocumento(tercero ? nombres.get(tercero.cuenta) ?? '' : '').origen
}

export async function importarHistorico(cfg: ConfigImportacion): Promise<ParteImportacion> {
  const avisar = cfg.avisar ?? (() => {})
  const prep = await prepararHistorico(cfg)
  const parte: ParteImportacion = {
    meses: prep.meses, leidos: prep.leidos, rechazadosAlConvertir: prep.rechazadosAlConvertir, fueraDelCorte: prep.fueraDelCorte,
    ejercicios: [], subcuentas: { nuevas: 0, estaban: 0, rechazadas: [] }, traidos: 0, yaEstaban: 0, distintos: [], rechazados: [],
  }

  // Los ejercicios traídos (uno de Folvy no se toca: la base lo rechaza y aquí se dice).
  for (const codigo of [...new Set(prep.asientos.map((a) => a.ejercicio))].sort()) {
    try {
      const id = await cfg.rpc('conta_diez_ejercicio', { p_company: cfg.empresa, p_code: codigo, p_starts: `${codigo}-01-01`, p_ends: `${codigo}-12-31` })
      parte.ejercicios.push({ codigo, id: String(id) })
    } catch (e) {
      parte.ejercicios.push({ codigo, problema: e instanceof Error ? e.message : String(e) })
    }
  }

  // Las subcuentas que usan los asientos y el plan no tiene, con el nombre que les da Diez.
  if (prep.subcuentas.length) {
    const r = (await cfg.rpc('conta_diez_subcuentas', { p_company: cfg.empresa, p_run: cfg.lectura, p_cuentas: prep.subcuentas })) as RespuestaSubcuentas
    parte.subcuentas = { nuevas: r.nuevas, estaban: r.estaban, rechazadas: r.rechazadas ?? [] }
  }

  // Escribir, en el orden de la cadena y por tandas.
  for (const tanda of enTandas(prep.asientos, cfg.tandas ?? 200)) {
    const r = (await cfg.rpc('conta_diez_importar', { p_company: cfg.empresa, p_run: cfg.lectura, p_asientos: tanda.map(paraLaBase) })) as RespuestaImportar
    parte.traidos += r.traidos
    parte.yaEstaban += r.yaEstaban
    parte.distintos.push(...(r.distintos ?? []))
    parte.rechazados.push(...(r.rechazados ?? []))
    avisar(`tanda de ${tanda.length}: ${r.traidos} traídos, ${r.yaEstaban} ya estaban, ${(r.rechazados ?? []).length} rechazados`)
  }
  return parte
}

/** El parte en palabras, para la lectura y para la pantalla (regla 8: con contenido). */
export function resumenParte(p: ParteImportacion): string {
  const piezas = [
    `${p.traidos} asientos traídos de ${p.leidos} leídos en ${p.meses} meses`,
    p.yaEstaban ? `${p.yaEstaban} ya estaban` : '',
    p.distintos.length ? `${p.distintos.length} cambiados en Diez después de traerlos (no se pisan)` : '',
    p.rechazados.length ? `${p.rechazados.length} rechazados por la base` : '',
    p.rechazadosAlConvertir.length ? `${p.rechazadosAlConvertir.length} que no se pueden convertir` : '',
    p.fueraDelCorte.length ? `${p.fueraDelCorte.length} posteriores al corte (entran por el día a día)` : '',
    p.subcuentas.nuevas ? `${p.subcuentas.nuevas} subcuentas nuevas traídas de Diez` : '',
    p.ejercicios.some((e) => e.problema) ? `ejercicios con problema: ${p.ejercicios.filter((e) => e.problema).map((e) => e.codigo).join(', ')}` : '',
  ].filter(Boolean)
  return piezas.join(' · ')
}

/** ¿Está entero? Todo lo leído traído o ya estaba, y nada pendiente de explicar. */
export const parteLimpio = (p: ParteImportacion) =>
  p.rechazados.length === 0 && p.distintos.length === 0 && p.rechazadosAlConvertir.length === 0 &&
  p.subcuentas.rechazadas.length === 0 && p.ejercicios.every((e) => !e.problema)
