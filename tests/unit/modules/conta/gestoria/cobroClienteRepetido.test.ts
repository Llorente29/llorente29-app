// G01b · La lectura de GoCardless fallaba desde las 07:22 UTC del 07/11 con
// «ON CONFLICT DO UPDATE command cannot affect row a second time»: dos
// clientes de GoCardless de la misma empresa casaban con el mismo cliente de
// Sumied, y los dos iban a conta_cobro_cliente (clave company_id, party_id) en
// la misma tanda. Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { fraseDeLectura, planLectura, type Antes } from '../../../../../supabase/functions/conta-gocardless-leer/plan'
import type { DatosGc } from '../../../../../supabase/functions/conta-gocardless-leer/lectura'

const E = 'empresa-a'
const cliente = (id: string, nif: string | null, correo: string | null) => ({ id, nombre: `CLIENTE PRUEBA ${id}`, correo, nif, creado: '2026-01-01' })
const mandato = (id: string, clienteId: string, estado = 'active') => ({ id, estado, referencia: null, esquema: 'sepa_core', clienteId, cuentaBancoId: null, creado: '2026-01-01' })
const datos = (clientes: DatosGc['clientes'], mandatos: DatosGc['mandatos']): DatosGc => ({ clientes, mandatos, suscripciones: [], cobros: [], abonos: [], desde: '2026-05-01' })
const antes = (extra: Partial<Antes> = {}): Antes => ({
  huellas: new Map(), otrosEmisores: [], formaAntes: new Map(), porDefecto: true, importadas: new Set(), tarifasPropias: new Set(),
  fichas: [
    { partyId: 'P1', bitrixId: 'F1', nombre: 'CLIENTE PRUEBA UNO', nif: 'B00000001', correos: ['uno@prueba.test'], situacion: 'activo', formaPago: null, emisorSegunBitrix: null },
    { partyId: 'P2', bitrixId: 'F2', nombre: 'CLIENTE PRUEBA DOS', nif: 'B00000002', correos: [], situacion: 'activo', formaPago: null, emisorSegunBitrix: null },
  ],
  ...extra,
})
const claves = (filas: Record<string, unknown>[]) => filas.map((f) => `${f.company_id}|${f.party_id}`)

describe('G01b · conta_cobro_cliente sin repetidos en una tanda', () => {
  it('reproduce el fallo: dos clientes de GoCardless con el mismo NIF casan con la misma ficha, y la tanda lleva un solo cliente de Sumied una vez', () => {
    // CU1 y CU2: el mismo NIF (dos altas del mismo cliente en GoCardless); CU3 casa por correo con la misma ficha.
    const plan = planLectura(E, 'cuenta', datos(
      [cliente('CU1', 'B00000001', null), cliente('CU2', 'B00000001', null), cliente('CU3', null, 'uno@prueba.test'), cliente('CU4', 'B00000002', null)],
      [mandato('MD1', 'CU1', 'cancelled'), mandato('MD2', 'CU2'), mandato('MD3', 'CU2'), mandato('MD4', 'CU3'), mandato('MD5', 'CU4')],
    ), antes(), '2026-11-07', () => 'Emisor A')
    const k = claves(plan.cobroCliente)
    expect(k).toEqual([...new Set(k)])
    expect(k.sort()).toEqual([`${E}|P1`, `${E}|P2`])
    // Para la forma de cobro, el de más mandatos activos (CU2, con dos); los tres siguen leídos con su cliente de Sumied.
    expect(plan.cobroCliente.find((f) => f.party_id === 'P1')?.gc_cliente_id).toBe('CU2')
    expect(plan.filas.clientes.filter((f) => f.party_id === 'P1').map((f) => f.gc_id)).toEqual(['CU1', 'CU2', 'CU3'])
    // Y lo dice la frase de la lectura (regla 7: no se esconde).
    expect(plan.resumen.clientesConVariosEnGc).toBe(1)
    expect(fraseDeLectura('Emisor A', plan, 0, 0)).toContain('1 cliente de Sumied tiene más de un cliente en esta cuenta de GoCardless: para la forma de cobro se usa el enlazado a mano o, si no, el de más mandatos activos.')
  })

  it('lo enlazado a mano en la ficha manda sobre lo casado', () => {
    const plan = planLectura(E, 'cuenta', datos([cliente('CU1', 'B00000001', null), cliente('CU9', null, null)], [mandato('MD1', 'CU1'), mandato('MD2', 'CU1')]),
      antes({ enlaces: new Map([['CU9', 'P1']]) }), '2026-11-07', () => 'Emisor A')
    expect(claves(plan.cobroCliente)).toEqual([`${E}|P1`])
    expect(plan.cobroCliente[0].gc_cliente_id).toBe('CU9')
  })

  it('sin repetidos, la frase no cambia', () => {
    const plan = planLectura(E, 'cuenta', datos([cliente('CU1', 'B00000001', null)], [mandato('MD1', 'CU1')]), antes(), '2026-11-07', () => 'Emisor A')
    expect(plan.resumen.clientesConVariosEnGc).toBe(0)
    expect(fraseDeLectura('Emisor A', plan, 0, 0)).not.toContain('más de un cliente')
  })
})
