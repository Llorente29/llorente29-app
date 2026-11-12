// G06 · Tarea 3 · El casado por nombre como PROPUESTA, nunca atado solo, y la confirmación con un clic.
//   · normalizarNombre: sin tildes ni signos, palabras en orden;
//   · casar: lo que no casa por NIF ni por correo único y tiene cobro vivo sale propuesto (por el correo repetido o por
//     el nombre), con sus candidatas y su porqué; sigue saliendo también como diferencia (regla 7);
//   · planLectura entrega las propuestas de esta cuenta con las fichas ya en clientes de Sumied;
//   · planEnlaces: la propuesta no pisa lo de una persona (tampoco «sin ficha») ni un conflicto; la que ya no sale se quita;
//   · la migración: confirmar, deshacer y «sin ficha» comprueban el permiso; juntar mueve el enlace.
// Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { casar, normalizarNombre, type ClienteParaCasar, type FichaParaCasar } from '../../../../../../supabase/functions/conta-gocardless-leer/casado'
import { planEnlaces, type EnlaceExistente } from '../../../../../../supabase/functions/conta-gocardless-leer/enlace'
import { planLectura, type Antes } from '../../../../../../supabase/functions/conta-gocardless-leer/plan'
import type { DatosGc } from '../../../../../../supabase/functions/conta-gocardless-leer/lectura'

const ficha = (claveFicha: string, nombre: string, nif: string | null = null, correos: string[] = []): FichaParaCasar =>
  ({ claveFicha, nombre, nif, correos, situacion: 'activo', formaPago: null, emisorSegunCrm: null })
const cliente = (id: string, nombre: string, o: Partial<ClienteParaCasar> = {}): ClienteParaCasar =>
  ({ emisor: 'E', id, nombre, nif: null, correo: null, mandatosVivos: 1, suscripcionesActivas: 1, ...o })

describe('G06 · normalizarNombre', () => {
  it('sin tildes, sin signos, en minúsculas y con las palabras en orden', () => {
    expect(normalizarNombre('  Pérez-Gómez, Ñoño S.L. ')).toBe('gomez l nono perez s')
    expect(normalizarNombre('GÓMEZ PÉREZ ÑOÑO, S. L.')).toBe(normalizarNombre('Ñoño Pérez-Gómez S.L.'))
    expect(normalizarNombre(null)).toBe('')
  })
})

describe('G06 · casar: las propuestas', () => {
  const fichas = [ficha('F1', 'Prueba Uno S.L.', 'B00000001', ['uno@prueba.test']), ficha('F2', 'Prueba Dos'), ficha('F3', 'PRUEBA DOS'),
    ficha('F4', 'Prueba Cuatro', null, ['comun@prueba.test']), ficha('F5', 'Prueba Cinco', null, ['comun@prueba.test']), ficha('F6', 'Prueba Seis')]
  const r = casar(fichas, [
    cliente('CU1', 'otra cosa', { nif: 'B00000001' }),            // NIF: atado, sin propuesta
    cliente('CU2', 'Dos, Prueba'),                                 // mismo nombre que F2 y F3: propuesta con dos
    cliente('CU3', 'otro', { correo: 'comun@prueba.test' }),       // correo en F4 y F5: propuesta por correo
    cliente('CU6', 'SEIS PRUEBA'),                                 // mismo nombre que F6: propuesta con una
    cliente('CU7', 'Prueba Seis', { mandatosVivos: 0, suscripcionesActivas: 0 }), // sin nada vivo: ni propuesta ni diferencia
    cliente('CU8', 'Nadie Se Llama Así'),                          // sin pareja: solo la diferencia
  ], () => 'Emisor')
  const de = (id: string) => r.propuestas.find((p) => p.clienteGcId === id)
  it('lo que casa por NIF no se propone: se ata', () => {
    expect(r.parejas.map((p) => p.clienteGcId)).toEqual(['CU1'])
    expect(de('CU1')).toBeUndefined()
  })
  it('por el nombre: con una ficha o con varias, cada una con su porqué', () => {
    expect(de('CU2')).toMatchObject({ por: 'nombre', claveFichas: ['F2', 'F3'] })
    expect(de('CU2')!.porque).toContain('2 fichas')
    expect(de('CU6')).toMatchObject({ por: 'nombre', claveFichas: ['F6'] })
    expect(de('CU6')!.porque).toContain('¿es esta?')
  })
  it('por el correo que está en varias fichas', () => {
    expect(de('CU3')).toMatchObject({ por: 'correo', claveFichas: ['F4', 'F5'] })
  })
  it('sin nada vivo, nada; sin pareja posible, solo la diferencia (ninguna fila escondida)', () => {
    expect(de('CU7')).toBeUndefined()
    expect(de('CU8')).toBeUndefined()
    const sinFicha = r.diferencias.filter((d) => d.tipo === 'gocardless_sin_ficha').map((d) => d.clienteGcId).sort()
    expect(sinFicha).toEqual(['CU2', 'CU6', 'CU8'])
    expect(r.diferencias.some((d) => d.tipo === 'correo_repetido_en_crm' && d.clienteGcId === 'CU3')).toBe(true)
  })
})

describe('G06 · planLectura entrega las propuestas de esta cuenta, con las fichas en clientes de Sumied', () => {
  const datos = { clientes: [{ id: 'CU2', nombre: 'DOS PRUEBA', correo: null, nif: null, creado: '2026-01-01' }],
    mandatos: [{ id: 'MD2', estado: 'active', referencia: null, esquema: 'sepa_core', clienteId: 'CU2', cuentaBancoId: null, creado: '2026-01-01' }],
    suscripciones: [], cobros: [], abonos: [], desde: '2026-05-01' } as unknown as DatosGc
  const antes: Antes = { huellas: new Map(), otrosEmisores: [], formaAntes: new Map(), porDefecto: true, importadas: new Set(), tarifasPropias: new Set(),
    enlaces: new Map(), fichas: [{ partyId: 'P2', ...ficha('F2', 'Prueba Dos') }, { partyId: 'P3', ...ficha('F3', 'Prueba, Dos') }] }
  const plan = planLectura('E', 'C', datos, antes, '2026-11-12', () => 'Emisor')
  it('ni atado ni en los dos enlaces de antes: solo propuesto', () => {
    expect(plan.enlaces).toEqual([])
    expect(plan.filas.clientes.find((f) => f.gc_id === 'CU2')?.party_id).toBeNull()
    expect(plan.propuestas).toEqual([expect.objectContaining({ gcClienteId: 'CU2', por: 'nombre', candidatas: ['P2', 'P3'] })])
  })
})

describe('G06 · planEnlaces con propuestas', () => {
  const ex = (gcClienteId: string, por: EnlaceExistente['por'], estado: EnlaceExistente['estado']): EnlaceExistente => ({ gcClienteId, por, estado })
  const q = (gcClienteId: string, candidatas: string[]) => ({ gcClienteId, candidatas, por: 'nombre' as const, porque: 'Se llama igual.' })
  const p = planEnlaces('E', 'C', '2026-11-12T00:00:00Z',
    [ex('CU1', 'persona', 'atado'), ex('CU2', 'persona', 'sin_ficha'), ex('CU3', 'correo', 'conflicto'), ex('CU4', 'nombre', 'propuesto'),
      ex('CU5', 'nombre', 'propuesto'), ex('CU6', 'correo', 'atado')],
    [], new Map(), [q('CU1', ['P1']), q('CU2', ['P2']), q('CU3', ['P3']), q('CU4', ['P4', 'P9']), q('CU6', ['P6']), q('CU7', ['P7'])])
  const de = (gc: string) => p.guardar.find((f) => f.gc_cliente_id === gc)
  it('se escribe propuesta, con la ficha solo si hay una candidata', () => {
    expect(de('CU4')).toMatchObject({ estado: 'propuesto', party_id: null, candidatas: ['P4', 'P9'], porque: 'Se llama igual.' })
    expect(de('CU7')).toMatchObject({ estado: 'propuesto', party_id: 'P7', por: 'nombre' })
    expect(de('CU6')).toMatchObject({ estado: 'propuesto' })
  })
  it('no pisa lo de una persona (tampoco «sin ficha») ni un conflicto', () => {
    expect(de('CU1')).toBeUndefined()
    expect(de('CU2')).toBeUndefined()
    expect(de('CU3')).toBeUndefined()
  })
  it('la propuesta que ya no sale se quita; lo que pasa de atado a propuesto no', () => {
    expect(p.quitar).toEqual(['CU5'])
  })
})

describe('G06 · La migración de la tarea 3', () => {
  const m = readFileSync('supabase/migrations/20261112T1110_g06_confirmar_enlace.sql', 'utf8')
  it('declara lo que cambia en caliente, con su prueba', () => {
    expect(m).toContain('-- cambia: public.conta_gc_enlace · prueba: supabase/staging/sql/20261112_g06_confirmar_enlace_prueba.sql')
    expect(m).toContain('-- cambia: public._conta_gestoria_juntar · prueba: supabase/staging/sql/20261112_g06_confirmar_enlace_prueba.sql')
  })
  it('confirmar, deshacer y «sin ficha» comprueban el permiso; la de la lectura, solo el servidor', () => {
    for (const f of ['conta_gc_enlace_confirmar', 'conta_gc_enlace_sin_ficha', 'conta_gc_enlace_deshacer']) {
      const cuerpo = m.slice(m.indexOf(`create or replace function public.${f}(`))
      expect(cuerpo.slice(0, 400)).toContain('public._conta_gestoria_puede(p_company)')
    }
    expect(m).toContain('grant execute on function public._conta_gc_enlace_guardar(jsonb) to service_role')
    expect(m).not.toMatch(/_conta_gc_enlace_guardar\(jsonb\) to authenticated/)
  })
  it('juntar mueve el enlace y cambia las candidatas', () => {
    expect(m).toContain("'conta_gestoria_ficha', 'conta_gc_enlace'] loop")
    expect(m).toContain('array_replace(x.candidatas, p_se_va, p_queda)')
  })
  it('no toca recibos, cobros ni facturas', () => {
    expect(m).not.toMatch(/(insert into|update|delete from) public\.(conta_recibo|conta_cobro\b|customer_invoice)/)
  })
})
