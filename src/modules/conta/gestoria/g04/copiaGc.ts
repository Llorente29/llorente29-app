// src/modules/conta/gestoria/g04/copiaGc.ts
//
// R19 · paso 0 · La copia de GoCardless (Julio, 25/11): cada lectura de GoCardless guarda, antes de tocar nada de
// Sumied, una copia fechada y sin poder cambiarse de lo que hay de cada empresa (conta_gc_copia y
// conta_gc_copia_fila, la 1115). Aquí: leerla y convertirla en las hojas de su Excel (lo puro lo prueban las
// unitarias, tests/unit/modules/conta/r19/copiaGc.test.ts).
//
// Lo que cuenta cada copia lo cuenta la base (conta_gc_contar_copia): la forma de contar es una sola.

import { rpc, tabla, mensaje } from '@/modules/conta/services/bd'

type Fila = Record<string, unknown>

export interface CuentaDeLaCopia {
  regla: string
  /** AAAA-MM del cobro que cuenta, o null si no hay ninguno por delante. */
  mes: string | null
  suscripciones: number
  clientes: number
  euros: number
  /** Cuántas suscripciones cobran cada día del mes («2026-12-04» → 303). */
  dias?: Record<string, number>
}

export interface Copia {
  id: string
  tomadaAt: string
  por: 'persona' | 'cada_noche' | 'conexion' | 'aviso'
  quien: string | null
  clientes: number
  mandatos: number
  suscripciones: number
  cobros: number
  huella: string
  cuenta: CuentaDeLaCopia | null
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0)
const txt = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))

export function copiaDeFila(f: Fila): Copia {
  const c = f.cuenta as Fila | null
  return {
    id: String(f.id), tomadaAt: String(f.tomada_at), por: (f.por as Copia['por']) ?? 'persona', quien: txt(f.quien_name),
    clientes: num(f.clientes), mandatos: num(f.mandatos), suscripciones: num(f.suscripciones), cobros: num(f.cobros), huella: String(f.huella ?? ''),
    cuenta: c ? { regla: String(c.regla ?? ''), mes: txt(c.mes), suscripciones: num(c.suscripciones), clientes: num(c.clientes), euros: num(c.euros),
      dias: (c.dias as Record<string, number> | undefined) ?? undefined } : null,
  }
}

/** Las copias de una empresa, de la más nueva a la más vieja, con lo que cuenta cada una. */
export async function leerCopias(empresa: string): Promise<Copia[]> {
  const r = await rpc<Fila[] | null>('conta_gc_copias', { p_company: empresa })
  return (r ?? []).map(copiaDeFila)
}

/** Lo copiado de una copia, entero (de 1.000 en 1.000). */
export async function leerFilasCopia(copia: string): Promise<{ tipo: string; gcId: string; datos: Fila }[]> {
  const out: { tipo: string; gcId: string; datos: Fila }[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await tabla('conta_gc_copia_fila').select('tipo, gc_id, datos').eq('copia_id', copia)
      .order('tipo').order('gc_id').range(desde, desde + 999)
    if (error) throw new Error(mensaje('No se ha podido leer la copia de GoCardless', error))
    const filas = (data ?? []) as { tipo: string; gc_id: string; datos: Fila }[]
    out.push(...filas.map((f) => ({ tipo: f.tipo, gcId: f.gc_id, datos: f.datos })))
    if (filas.length < 1000) break
  }
  return out
}

const POR: Record<Copia['por'], string> = { persona: '«Leer ahora»', cada_noche: 'La lectura de cada noche', conexion: 'Al conectar GoCardless', aviso: 'Un aviso de GoCardless' }

/** «25/11/2026 15:02», en Madrid. */
export function cuandoEnMadrid(iso: string): string {
  const d = new Date(iso)
  const f = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
  const p = (t: string) => f.find((x) => x.type === t)?.value ?? ''
  return `${p('day')}/${p('month')}/${p('year')} ${p('hour')}:${p('minute')}`
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const eurosTexto = (n: number) => `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

/** La línea de debajo del botón: «Copia del 25/11/2026 15:02 · en diciembre GoCardless cobrará 23.432,34 € a 250 clientes (303 suscripciones)». */
export function lineaDeCopia(c: Copia | null): string {
  if (!c) return 'Aún no hay ninguna copia de GoCardless: se guarda en la próxima lectura (cada noche o con «Leer ahora»).'
  const k = c.cuenta
  const mes = k?.mes ? MESES[Number(k.mes.slice(5, 7)) - 1] : null
  const cobro = k && mes && k.suscripciones > 0
    ? ` · en ${mes} GoCardless cobrará ${eurosTexto(k.euros)} a ${k.clientes.toLocaleString('es-ES')} ${k.clientes === 1 ? 'cliente' : 'clientes'} (${k.suscripciones.toLocaleString('es-ES')} ${k.suscripciones === 1 ? 'suscripción' : 'suscripciones'})`
    : ' · no hay ningún cobro por delante'
  return `Copia del ${cuandoEnMadrid(c.tomadaAt)}${cobro}`
}

const COL = {
  clientes: ['Empresa', 'Cliente de GoCardless', 'Nombre', 'Correo', 'NIF', 'Mandatos vivos', 'Suscripciones activas', 'Leído'],
  mandatos: ['Empresa', 'Mandato', 'Cliente de GoCardless', 'Estado', 'Referencia', 'Esquema', 'Creado', 'Banco', 'Cuenta (final)', 'País'],
  suscripciones: ['Empresa', 'Suscripción', 'Cliente de GoCardless', 'Mandato', 'Concepto', 'Importe', 'Moneda', 'Cada', 'Intervalo', 'Estado', 'Al mes', 'Desde', 'Hasta', 'Próximo cobro', 'Próximo importe'],
  cobros: ['Empresa', 'Cobro', 'Mandato', 'Suscripción', 'Estado', 'Fecha', 'Importe', 'Moneda', 'Motivo', 'Causa', 'Pago al banco'],
  resumen: ['Empresa', 'Copia del', 'Por', 'Quién', 'Clientes', 'Mandatos', 'Suscripciones', 'Cobros', 'Mes que cuenta', 'Suscripciones que cobra', 'Clientes que cobra', 'Euros que cobra', 'Cómo se cuenta', 'Huella'],
}
const n = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

/** Las hojas del Excel de una copia: «Resumen» primero y después lo copiado, tal cual, en palabras de la calle. */
export function hojasDeCopia(empresa: string, c: Copia, filas: { tipo: string; gcId: string; datos: Fila }[]): { nombre: string; filas: Fila[]; columnas: string[] }[] {
  const de = (t: string) => filas.filter((f) => f.tipo === t).map((f) => f.datos)
  return [
    { nombre: 'Resumen', columnas: COL.resumen, filas: [{
      Empresa: empresa, 'Copia del': cuandoEnMadrid(c.tomadaAt), Por: POR[c.por], 'Quién': c.quien ?? '', Clientes: c.clientes, Mandatos: c.mandatos,
      Suscripciones: c.suscripciones, Cobros: c.cobros, 'Mes que cuenta': c.cuenta?.mes ?? '', 'Suscripciones que cobra': c.cuenta?.suscripciones ?? 0,
      'Clientes que cobra': c.cuenta?.clientes ?? 0, 'Euros que cobra': c.cuenta?.euros ?? 0, 'Cómo se cuenta': c.cuenta?.regla ?? '', Huella: c.huella }] },
    { nombre: 'Clientes', columnas: COL.clientes, filas: de('cliente').map((d) => ({ Empresa: empresa, 'Cliente de GoCardless': d.gc_id, Nombre: d.nombre ?? '', Correo: d.correo ?? '',
      NIF: d.nif ?? '', 'Mandatos vivos': n(d.mandatos_vivos), 'Suscripciones activas': n(d.suscripciones_activas), 'Leído': d.leido_at ?? '' })) },
    { nombre: 'Mandatos', columnas: COL.mandatos, filas: de('mandato').map((d) => ({ Empresa: empresa, Mandato: d.gc_id, 'Cliente de GoCardless': d.gc_cliente_id ?? '', Estado: d.estado ?? '',
      Referencia: d.referencia ?? '', Esquema: d.esquema ?? '', Creado: d.creado ?? '', Banco: d.banco ?? '', 'Cuenta (final)': d.cuenta_final ?? '', 'País': d.cuenta_pais ?? '' })) },
    { nombre: 'Suscripciones', columnas: COL.suscripciones, filas: de('suscripcion').map((d) => ({ Empresa: empresa, 'Suscripción': d.gc_id, 'Cliente de GoCardless': d.gc_cliente_id ?? '',
      Mandato: d.mandato_gc_id ?? '', Concepto: d.nombre ?? '', Importe: n(d.importe), Moneda: d.moneda ?? '', Cada: n(d.cada), Intervalo: d.intervalo ?? '', Estado: d.estado ?? '',
      'Al mes': n(d.al_mes), Desde: d.inicio ?? '', Hasta: d.fin ?? '', 'Próximo cobro': d.proximo_cobro_fecha ?? '', 'Próximo importe': n(d.proximo_cobro_importe) })) },
    { nombre: 'Cobros', columnas: COL.cobros, filas: de('cobro').map((d) => ({ Empresa: empresa, Cobro: d.gc_id, Mandato: d.mandato_gc_id ?? '', 'Suscripción': d.suscripcion_gc_id ?? '',
      Estado: d.estado ?? '', Fecha: d.fecha ?? '', Importe: n(d.importe), Moneda: d.moneda ?? '', Motivo: d.motivo_es ?? d.motivo ?? '', Causa: d.causa ?? '', 'Pago al banco': d.payout_gc_id ?? '' })) },
  ]
}

/** «sumied-copia-gocardless-qbo-integrity-2026-11-25-1502.xlsx» */
export function nombreDelExcel(empresa: string, c: Copia): string {
  const limpio = empresa.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  const t = cuandoEnMadrid(c.tomadaAt)
  const [dia, hora] = t.split(' ')
  const [dd, mm, aa] = dia.split('/')
  return `sumied-copia-gocardless-${limpio}-${aa}-${mm}-${dd}-${hora.replace(':', '')}.xlsx`
}
