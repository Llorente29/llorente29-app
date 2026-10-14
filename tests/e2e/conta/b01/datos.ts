// tests/e2e/conta/b01/datos.ts
//
// B01 · Lo que comparten las dos pruebas de staging del frente B (motor y
// pantallas): el Norma 43 inventado de los tres bancos de la semilla
// (supabase/seeds/conta/seed_b01_staging.sql), el cliente de la base con la
// sesión del administrador de A (la misma RLS que la pantalla) y «deshacer
// todo», que deja los bancos B01 sin casados vivos ni propuestas.
// Datos inventados. Ninguna tarjeta dada de alta sobrevive a una prueba.

import { createClient } from '@supabase/supabase-js'
import { STAGING_URL, anonKey, pedirSesion, CUENTA_A } from '../sesion'
import { escribirNorma43 } from '@/modules/conta/lib/norma43'
import type { Bd, Consulta } from '@/modules/conta/services/bancosNucleo'

export const EMPRESA_A = '3b34403a-a7d6-4a48-a8d7-737e8cababdc'
export const BANCOS_B01 = ['b0100000-0000-4000-8000-0000000000b1', 'b0100000-0000-4000-8000-0000000000b2', 'b0100000-0000-4000-8000-0000000000b3']

export const FICHERO = escribirNorma43([
  { entidad: '0182', oficina: '9101', cuenta: '0000000011', nombre: 'TABERNA DE PRUEBA NORTE', desde: '2026-10-01', hasta: '2026-10-13', saldoInicialCent: 4_500_000, movimientos: [
    { fecha: '2026-10-02', importeCent: -49_888, comun: '03', ref1: '000000000477', concepto: 'RECIBO SUMINISTROS B01 DEL NORTE FRA B01-0477' },
    { fecha: '2026-10-03', importeCent: -1_250, comun: '17', concepto: 'COMISION MANTENIMIENTO' },
    { fecha: '2026-10-06', importeCent: -150_000, comun: '04', concepto: 'TRASPASO A CUENTA B01 SUR' },
    { fecha: '2026-10-08', importeCent: 341_218, comun: '04', ref2: 'B01-LIQ-0107', concepto: 'TRANSFERENCIA DE GLOVO LIQUIDACION 1-7 OCT' },
    { fecha: '2026-10-09', importeCent: -310_477, comun: '15', concepto: 'ADEUDO TGSS CUOTAS SEPTIEMBRE' },
    { fecha: '2026-10-09', importeCent: 127_817, comun: '04', ref1: '000000088213', concepto: 'TRANSFERENCIA RECIBIDA REF 88213' },
    { fecha: '2026-10-10', importeCent: -8_640, comun: '12', concepto: 'PAGO CON TARJETA MERCADO CENTRAL 0937' },
    { fecha: '2026-10-13', importeCent: -25_000, comun: '04', concepto: 'TRANSFERENCIA A SUMINISTROS B01 DEL NORTE' },
  ] },
  { entidad: '0182', oficina: '9102', cuenta: '0000000012', nombre: 'TABERNA DE PRUEBA NORTE', desde: '2026-10-01', hasta: '2026-10-13', saldoInicialCent: 800_000, movimientos: [
    { fecha: '2026-10-06', importeCent: 150_000, comun: '04', concepto: 'TRASPASO DE CUENTA B01 NORTE' },
    { fecha: '2026-10-07', importeCent: -4_530, comun: '03', concepto: 'RECIBO TELEFONO' },
    { fecha: '2026-10-12', importeCent: -310, comun: '17', concepto: 'COMISION TRANSFERENCIA' },
  ] },
  { entidad: '0182', oficina: '9103', cuenta: '0000000013', nombre: 'TABERNA DE PRUEBA NORTE', desde: '2026-10-01', hasta: '2026-10-13', saldoInicialCent: 250_000, movimientos: [
    { fecha: '2026-10-05', importeCent: 200_000, comun: '02', concepto: 'INGRESO EFECTIVO' },
    { fecha: '2026-10-11', importeCent: -22_000, comun: '04', concepto: 'TRANSFERENCIA A HERMANOS RUIZ' },
    { fecha: '2026-10-12', importeCent: -6_000, comun: '12', concepto: 'PAGO CON TARJETA GASOLINERA' },
    // Respuesta 3: un pago con una tarjeta que nadie ha dado de alta → «Por aclarar: tarjeta acabada en 1234, ¿de quién es?».
    { fecha: '2026-10-13', importeCent: -3_475, comun: '12', concepto: 'COMPRA TARJ. 1234 FERRETERIA LOPEZ' },
  ] },
])

type Fila = Record<string, unknown>

/** La base con la sesión del administrador de A. */
export async function baseDeA() {
  const sesion = await pedirSesion(CUENTA_A.email)
  const cliente = createClient(STAGING_URL, anonKey(), {
    global: { headers: { Authorization: `Bearer ${sesion.access_token}` } }, auth: { persistSession: false, autoRefreshToken: false },
  })
  const bd: Bd = {
    tabla: (t) => cliente.from(t) as unknown as Consulta,
    rpc: async <T,>(nombre: string, args: Record<string, unknown>) => {
      const { data, error } = await cliente.rpc(nombre, args)
      if (error) throw new Error(`${nombre}: ${error.message}`)
      return data as T
    },
  }
  const contarAsientosA = async () => {
    const { count, error } = await cliente.from('journal_entry').select('id', { count: 'exact', head: true }).eq('company_id', EMPRESA_A)
    if (error) throw new Error(error.message)
    return count ?? 0
  }
  /** Sin casados vivos ni propuestas en los bancos B01, y sin tarjetas dadas de alta en ellos. */
  const deshacerTodo = async (motivo: string) => {
    const { data: vivos } = await cliente.from('bank_match').select('id, movement_id, kind, bank_movement!inner(treasury_account_id)')
      .eq('status', 'vivo').in('bank_movement.treasury_account_id', BANCOS_B01)
    const hechos = new Set<string>()
    for (const v of (vivos ?? []) as Fila[]) {
      if (hechos.has(String(v.id))) continue
      const r = await bd.rpc<{ deshechos: string[] }>('bank_deshacer', { p_match: v.id, p_motivo: motivo })
      for (const d of r.deshechos ?? []) hechos.add(String(d))
    }
    const { data: pendientes } = await cliente.from('bank_movement').select('id').in('treasury_account_id', BANCOS_B01).in('status', ['propuesto', 'por_aclarar'])
    for (const m of (pendientes ?? []) as Fila[]) await bd.rpc('bank_proponer', { p_movement: m.id, p_estado: 'pendiente', p_confianza: null, p_porque: null, p_propuesta: null })
    const { data: tarjetas } = await cliente.from('bank_card').select('id').in('treasury_account_id', BANCOS_B01).eq('is_active', true)
    for (const t of (tarjetas ?? []) as Fila[]) await bd.rpc('bank_tarjeta_baja', { p_id: t.id })
  }
  return { cliente, bd, contarAsientosA, deshacerTodo }
}
