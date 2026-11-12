// G06 · Tarea 2 · El enlace en un solo sitio (conta_gc_enlace) y la lectura de GoCardless sin el tope de 1.000.
//   · leerTodas: pide por páginas hasta que una viene vacía, con cualquier tope del servidor (en QBO, 1.536 fichas y
//     solo se veían 1.000: los clientes de GoCardless de las demás salían «sin ficha», un día sí y otro no);
//   · planEnlaces: lo de una persona se escribe siempre; lo automático no pisa lo de una persona ni un conflicto; lo
//     automático que ya no casa se quita;
//   · planLectura entrega lo atado (plan.enlaces), igual que lo que va a los dos enlaces de antes;
//   · index.ts: ninguna lectura sin paginar, y los dos enlaces de antes se siguen escribiendo (cautela del nº 140).
// Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { leerTodas } from '../../../../../../supabase/functions/conta-gocardless-leer/paginas'
import { planEnlaces, personasDeDecisiones, type EnlaceExistente } from '../../../../../../supabase/functions/conta-gocardless-leer/enlace'
import { planLectura, type Antes } from '../../../../../../supabase/functions/conta-gocardless-leer/plan'
import type { DatosGc } from '../../../../../../supabase/functions/conta-gocardless-leer/lectura'

/** Una tabla de mentira con su tope de filas por consulta, como la API. */
const servidor = (n: number, tope: number) => {
  const filas = Array.from({ length: n }, (_, i) => ({ id: i }))
  let pedidos = 0
  const pedir = (desde: number, hasta: number) => { pedidos++; return Promise.resolve({ data: filas.slice(desde, Math.min(hasta + 1, desde + tope)), error: null }) }
  return { pedir, pedidos: () => pedidos }
}

describe('G06 · leerTodas: la lectura sin el tope de 1.000', () => {
  it('las 1.536 fichas de QBO, con un tope de 1.000: todas, y ninguna dos veces', async () => {
    const s = servidor(1536, 1000)
    const todas = await leerTodas<{ id: number }>(s.pedir, 'las fichas')
    expect(todas.length).toBe(1536)
    expect(new Set(todas.map((x) => x.id)).size).toBe(1536)
  })
  it('vale con cualquier tope del servidor (aquí 700, menos que la página)', async () => {
    const todas = await leerTodas<{ id: number }>(servidor(2500, 700).pedir, 'las fichas')
    expect(todas.map((x) => x.id)).toEqual(Array.from({ length: 2500 }, (_, i) => i))
  })
  it('sin filas, una sola consulta; y un error dice qué no se ha podido leer', async () => {
    const s = servidor(0, 1000)
    expect(await leerTodas(s.pedir, 'nada')).toEqual([])
    expect(s.pedidos()).toBe(1)
    await expect(leerTodas(() => Promise.resolve({ data: null, error: { message: 'caído' } }), 'las fichas')).rejects.toThrow('No se ha podido leer las fichas: caído')
  })
})

describe('G06 · planEnlaces: qué escribe la lectura en conta_gc_enlace', () => {
  const ex = (gcClienteId: string, por: EnlaceExistente['por'], estado: EnlaceExistente['estado'] = 'atado'): EnlaceExistente => ({ gcClienteId, por, estado })
  const personas = personasDeDecisiones([
    { tipo: 'enlace', gc_cliente_id: 'CU5', party_id: 'P5', quien: 'U1', quien_name: 'Persona Prueba', cuando: '2026-11-10T10:00:00Z' },
    { tipo: 'enlace', gc_cliente_id: 'CU5', party_id: 'P5', quien: 'U2', quien_name: 'Otra Prueba', cuando: '2026-11-11T10:00:00Z' },
    { tipo: 'no_contar', gc_cliente_id: 'CU6', party_id: 'P6', quien: null, quien_name: null, cuando: '2026-11-11T10:00:00Z' },
  ])
  const p = planEnlaces('E', 'C', '2026-11-12T00:00:00Z',
    [ex('CU1', 'correo'), ex('CU2', 'persona'), ex('CU3', 'correo', 'conflicto'), ex('CU4', 'nif'), ex('CU7', 'nombre', 'propuesto'), ex('CU8', 'correo', 'conflicto')],
    [{ gcClienteId: 'CU1', partyId: 'P1', por: 'nif' }, { gcClienteId: 'CU2', partyId: 'P9', por: 'correo' }, { gcClienteId: 'CU3', partyId: 'P3', por: 'correo' },
      { gcClienteId: 'CU5', partyId: 'P5', por: 'persona' }, { gcClienteId: 'CU7', partyId: 'P7', por: 'correo' }, { gcClienteId: 'CU8', partyId: 'P8', por: 'persona' }],
    personas)
  const de = (gc: string) => p.guardar.find((f) => f.gc_cliente_id === gc)
  it('lo automático pisa lo automático y las propuestas', () => {
    expect(de('CU1')).toMatchObject({ party_id: 'P1', por: 'nif', estado: 'atado' })
    expect(de('CU7')).toMatchObject({ party_id: 'P7', por: 'correo', estado: 'atado' })
  })
  it('lo automático no pisa lo de una persona ni un conflicto', () => {
    expect(de('CU2')).toBeUndefined()
    expect(de('CU3')).toBeUndefined()
  })
  it('lo de una persona se escribe siempre, con quién y cuándo (la decisión más reciente), y resuelve un conflicto', () => {
    expect(de('CU5')).toMatchObject({ party_id: 'P5', por: 'persona', quien: 'U2', quien_name: 'Otra Prueba', decidido_at: '2026-11-11T10:00:00Z' })
    expect(de('CU8')).toMatchObject({ party_id: 'P8', por: 'persona', estado: 'atado' })
  })
  it('lo automático que ya no casa se quita; lo de una persona y los conflictos se quedan', () => {
    expect(p.quitar).toEqual(['CU4'])
    expect(p.respetados).toBe(2)
  })
})

describe('G06 · planLectura entrega lo atado, igual que los dos enlaces de antes', () => {
  const cliente = (id: string, nif: string | null, correo: string | null) => ({ id, nombre: `CLIENTE PRUEBA ${id}`, correo, nif, creado: '2026-01-01' })
  const mandato = (id: string, clienteId: string) => ({ id, estado: 'active', referencia: null, esquema: 'sepa_core', clienteId, cuentaBancoId: null, creado: '2026-01-01' })
  const datos: DatosGc = { clientes: [cliente('CU1', 'B00000001', null), cliente('CU2', null, 'dos@prueba.test'), cliente('CU3', null, null), cliente('CU9', null, null)],
    mandatos: [mandato('MD1', 'CU1')], suscripciones: [], cobros: [], abonos: [], desde: '2026-05-01' } as DatosGc
  const antes: Antes = { huellas: new Map(), otrosEmisores: [], formaAntes: new Map(), porDefecto: true, importadas: new Set(), tarifasPropias: new Set(),
    enlaces: new Map([['CU9', 'P3']]),
    fichas: [
      { partyId: 'P1', claveFicha: 'F1', nombre: 'UNO', nif: 'B00000001', correos: [], situacion: 'activo', formaPago: null, emisorSegunCrm: null },
      { partyId: 'P2', claveFicha: 'F2', nombre: 'DOS', nif: null, correos: ['dos@prueba.test'], situacion: 'activo', formaPago: null, emisorSegunCrm: null },
      { partyId: 'P3', claveFicha: 'F3', nombre: 'TRES', nif: null, correos: [], situacion: 'activo', formaPago: null, emisorSegunCrm: null },
    ] }
  const plan = planLectura('E', 'C', datos, antes, '2026-11-12', () => 'Emisor')
  it('cada cliente de GoCardless atado, con su ficha y por qué', () => {
    expect([...plan.enlaces].sort((a, b) => a.gcClienteId.localeCompare(b.gcClienteId))).toEqual([
      { gcClienteId: 'CU1', partyId: 'P1', por: 'nif' }, { gcClienteId: 'CU2', partyId: 'P2', por: 'correo' }, { gcClienteId: 'CU9', partyId: 'P3', por: 'persona' }])
  })
  it('lo mismo que va a conta_gc_cliente.party_id (los dos enlaces de antes se siguen escribiendo)', () => {
    const deAntes = plan.filas.clientes.filter((f) => f.party_id).map((f) => `${f.gc_id}|${f.party_id}`).sort()
    expect(plan.enlaces.map((e) => `${e.gcClienteId}|${e.partyId}`).sort()).toEqual(deAntes)
    expect(plan.cobroCliente.map((f) => f.party_id).sort()).toEqual(['P1', 'P2', 'P3'])
  })
})

describe('G06 · index.ts: nada sin paginar y los dos enlaces de antes, igual', () => {
  const f = readFileSync('supabase/functions/conta-gocardless-leer/index.ts', 'utf8')
  it('ninguna lectura de una vez: todas con leerTodas, ordenadas y por páginas', () => {
    expect(f).not.toContain('leerFilas')
    const usos = f.split('leerTodas<').slice(1)
    expect(usos.length).toBeGreaterThanOrEqual(15)
    // Cada una, hasta su .range(d, h): con su .order( delante.
    for (const u of usos) {
      const hasta = u.indexOf('.range(d, h)')
      expect(hasta, u.slice(0, 120)).toBeGreaterThan(0)
      expect(u.slice(0, hasta), u.slice(0, 120)).toContain('.order(')
    }
  })
  it('sigue escribiendo conta_gc_cliente y conta_cobro_cliente, y además conta_gc_enlace', () => {
    expect(f).toContain("await upsert(db, 'conta_gc_cliente', plan.filas.clientes, 'company_id,gc_id')")
    expect(f).toContain("await upsert(db, 'conta_cobro_cliente', plan.cobroCliente, 'company_id,party_id')")
    // G06 · Tarea 3: por la función con la guarda dentro (una confirmación a media lectura no se pisa).
    expect(f).toContain("db.rpc('_conta_gc_enlace_guardar', { p_filas: trozo })")
    expect(f).not.toContain("upsert(db, 'conta_gc_enlace'")
    expect(f).toContain(".in('estado', ['atado', 'propuesto']).in('por', ['nif', 'correo', 'nombre'])")
  })
})
