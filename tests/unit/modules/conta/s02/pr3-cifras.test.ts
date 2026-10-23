// tests/unit/modules/conta/s02/pr3-cifras.test.ts
//
// S02 · PR 3 («las cifras»): una sola fuente por concepto. Regla 31: la
// población es la REAL de producción, cuenta Foodint
// (51ad1792-6629-4ef7-833a-b57b09a86710), empresa Llorente29 Food, S.L.
// (658728c0-fcd7-46ef-a860-d4e5e6eb21d9), todo con account_id y company_id
// (regla 9), medida el 22/10 por la noche con las funciones de la tanda 0490
// tal como están escritas (las cifras que pasó el agente del SQL; sustituyen
// a las de p1_cifras.md de la mañana, entre medias se validaron asientos):
//   · conta_pendientes: para mirar 78, por aclarar 22, bancos 5 / 57 / 2,
//     asientos por validar 0.
//   · conta_saldo_bancos: las tres filas de abajo.
//   · 40/41/43/44: las 27 subcuentas con saldo de journal_ledger a 22/10,
//     consultadas aquí (lista y sumas pegadas abajo).
//   · Impuestos: p1_cifras.md (111/115/303 3T presentados; 202 2P y 3P not_required).
//
// Lo que se prueba: que el cliente pinta lo que dice cada función, con la
// misma vara en todos los sitios (barra = «Te toca hoy» = «Pendiente de ti»;
// tarjeta de bancos = Bancos; tarjetas de terceros = sus barritas = Contactos).

import { describe, expect, it } from 'vitest'
import {
  apoyoDebes, apoyoTeDeben, cifraBancos, cifrasTerceros, cuentasDePendientes, desgloseContable, filaDeSaldo, frasePorValidar, fraseSegunElBanco,
  grupoDeCuenta, saldoDeContacto, sumaEntera, type SaldoBanco,
} from '@/modules/conta/lib/cifrasLibro'
import { dePendientes, deSaldoBanco, deSaldoTercero } from '@/modules/conta/services/cifrasService'
import { cuentasDeLaBarra, frasesDeLaBarra } from '@/modules/conta/esqueleto/cuentasBarra'
import { contadoresDeCuentas } from '@/modules/conta/esqueleto/contadoresPestanas'
import { chipsDelInicio } from '@/modules/conta/marco/nuevo/teTocaHoy'
import { dudas, puntoDeMes, resumenDudas, saldoDe } from '@/modules/conta/lib/inicio'
import { cifraPlazo, etiquetaVentana, tituloVentana, vistaDeFila, type Calendario, type Declaracion, type FilaCalendario } from '@/modules/conta/impuestos/calendario'
import { euros, eurosExactos } from '@/modules/conta/lib/formato'

// ── conta_pendientes ────────────────────────────────────────────────────────

// compras_decidir llega SIEMPRE null y las filas crudas en compras_filas (las agrupa
// el cliente); compras_mirar dio 0 recepciones con pregunta y 0 sin camino (p1 §0).
const PENDIENTES_22_10 = {
  compras_decidir: null, compras_filas: { recepciones: [], sin_camino: [], fichas: [] },
  facturas_para_mirar: 78, facturas_por_aclarar: 22, asientos_por_validar: 0,
  bancos_confirmar: 5, bancos_aclarar: 57, bancos_validar: 2,
}

describe('conta_pendientes: una lista y un total, la misma vara', () => {
  const c = { ...cuentasDePendientes(dePendientes(PENDIENTES_22_10)), terceros: 0 }

  it('lee las claves del contrato y Bancos es 5 + 57 + 2 = 64', () => {
    expect(c).toMatchObject({ compras: 0, recibidas: 78, aclarar: 22, libros: 0, bancos: 64, bancosConfirmar: 5, bancosAclarar: 57, bancosValidar: 2 })
  })

  it('Compras = decidir + para mirar + por aclarar: 0 + 78 + 22 = 100 (antes no contaba las por aclarar)', () => {
    expect(cuentasDeLaBarra(c)).toEqual({ inicio: 164, contabilidad: 0, compras: 100, bancos: 64, contactos: 0 })
  })

  it('el chip DICE qué es lo que cuenta (regla 7): la pantalla a la que lleva tiene «Por revisar» y «Por aclarar»', () => {
    const f = frasesDeLaBarra(c)
    expect(f.compras).toBe('78 facturas por revisar, 22 facturas por aclarar')
    expect(f.bancos).toBe('5 para confirmar, 57 por aclarar, 2 por validar')
    expect(f.contabilidad).toBeUndefined()
    expect(contadoresDeCuentas(c)['compras.recibidas']).toEqual({ n: 100, tono: 'neutro', frase: '78 facturas por revisar, 22 facturas por aclarar', partes: [{ n: 78, frase: '78 facturas por revisar' }, { n: 22, frase: '22 facturas por aclarar' }] })
  })

  it('«Te toca hoy», la barra de Inicio y «Pendiente de ti» suman lo mismo: 164', () => {
    const chips = chipsDelInicio(c)
    const enChips = chips.reduce((s, x) => s + (typeof x.numero === 'number' ? x.numero : 0), 0)
    expect(enChips).toBe(164)
    expect(cuentasDeLaBarra(c).inicio).toBe(enChips)
    // Pendiente de ti: la misma lista (las claves con algo), con bancos (antes no estaba).
    const lista = dudas([], c)
    expect(lista.map((d) => d.id)).toEqual(chips.filter((x) => typeof x.numero === 'number' && x.numero > 0).map((x) => (x.id === 'libros' ? 'revisar' : x.id)))
    expect(lista.map((d) => d.titulo)).toEqual(['78 facturas recibidas para revisar', '22 facturas recibidas por aclarar', '64 movimientos del banco por decidir'])
    expect(lista.find((d) => d.id === 'bancos')?.apoyo).toBe('5 para confirmar, 57 por aclarar, 2 por validar.')
    // Y su total es el de la barra, no cuántas filas (antes: «3 dudas» por 164 cosas).
    expect(resumenDudas(cuentasDeLaBarra(c).inicio)).toBe('164 cosas pendientes')
  })

  it('las por aclarar llevan a su pestaña', () => {
    expect(chipsDelInicio(c).find((x) => x.id === 'aclarar')).toMatchObject({ numero: 22, ruta: '/conta/documentos?ver=por-aclarar' })
  })

  it('lo que no se ha podido contar no dice 0: una parte de Bancos a null, Bancos a null', () => {
    const p = dePendientes({ ...PENDIENTES_22_10, bancos_validar: null })
    expect(cuentasDePendientes(p).bancos).toBeNull()
    expect(dePendientes({}).facturasParaMirar).toBeNull()
    expect(sumaEntera([1, null])).toBeNull()
    expect(sumaEntera([5, 57, 2])).toBe(64)
  })

  it('si la base devuelve las filas de compras sin agrupar, se agrupan aquí (agruparAMirar)', () => {
    expect(dePendientes({ compras_filas: { recepciones: [], sin_camino: [], fichas: [] } }).comprasDecidir).toBe(0)
    // Así lo devuelve la 0490: compras_decidir null y las filas al lado.
    expect(dePendientes({ compras_decidir: null, compras_filas: { recepciones: [], sin_camino: [], fichas: [] } }).comprasDecidir).toBe(0)
    // Sin filas (compras_mirar falló en la base): no se ha podido contar.
    expect(dePendientes({ compras_decidir: null, compras_filas: null }).comprasDecidir).toBeNull()
  })
})

// ── conta_saldo_bancos ──────────────────────────────────────────────────────

// conta_saldo_bancos a 22/10 (noche): validado, propuesto, extracto y su fecha, sin casar.
const BANCOS_22_10: SaldoBanco[] = [
  deSaldoBanco({ treasury_account_id: 't1', nombre: 'Cuenta principal', cuenta: '57200001', libro_validado: '-974.97', libro_propuesto: '0', extracto_saldo: '479.19', extracto_hasta: '2026-10-14', sin_casar: '1454.16', sin_casar_n: 21 }),
  deSaldoBanco({ treasury_account_id: 't2', nombre: 'BBVA ···4525', cuenta: '57200002', libro_validado: '752.01', libro_propuesto: '-90.39', extracto_saldo: '162.57', extracto_hasta: '2026-10-13', sin_casar: '-209.05', sin_casar_n: 18 }),
  deSaldoBanco({ treasury_account_id: 't3', nombre: 'BBVA ···0133', cuenta: '57200003', libro_validado: '-4080.73', libro_propuesto: '0', extracto_saldo: '1496.17', extracto_hasta: '2026-10-14', sin_casar: '5576.90', sin_casar_n: 22 }),
]

describe('conta_saldo_bancos: Inicio y Bancos leen la misma fila', () => {
  it('«En contabilidad» es lo validado (−4.303,69), y lo propuesto va aparte (−90,39)', () => {
    const c = cifraBancos(BANCOS_22_10)
    expect(c.validado).toBe(-4303.69)
    expect(c.propuesto).toBe(-90.39)
    expect(frasePorValidar(c.propuesto, euros)).toBe('y −90,39 € por validar')
    expect(frasePorValidar(0, euros)).toBeNull()
  })

  it('«Según el banco» es el extracto, con su fecha (y las dos si no son la misma)', () => {
    const c = cifraBancos(BANCOS_22_10)
    expect(c.extracto).toEqual({ saldo: 2137.93, desde: '2026-10-13', hasta: '2026-10-14', bancos: 3, de: 3 })
    expect(fraseSegunElBanco(c.extracto, euros)).toBe('Según el banco, del 13/10 al 14/10: 2.137,93 €')
    expect(fraseSegunElBanco(cifraBancos([BANCOS_22_10[2]]).extracto, euros)).toBe('Según el banco, a 14/10: 1.496,17 €')
    const sinUno = [BANCOS_22_10[0], { ...BANCOS_22_10[1], extractoSaldo: null, extractoHasta: null }]
    expect(fraseSegunElBanco(cifraBancos(sinUno).extracto, euros)).toBe('Según el banco, a 14/10: 479,19 € (1 de 2 bancos)')
  })

  it('Bancos › Movimientos: «En contabilidad» del ···4525 (661,62, con propuestos) es 752,01 validado y −90,39 por validar', () => {
    expect(desgloseContable(BANCOS_22_10[1], 66162)).toEqual({ validado: 752.01, propuesto: -90.39 })
    // Con el punto de partida del corte (otro número), no se dice: no sumaría.
    expect(desgloseContable(BANCOS_22_10[1], 66000)).toBeNull()
    // Sin propuestos no hay nada que desglosar.
    expect(desgloseContable(BANCOS_22_10[2], -408073)).toBeNull()
    expect(eurosExactos(-90.39)).toBe('−90,39 €')
  })

  it('un banco sin su 572 (libro_* null) no suma ni dice 0; la cuenta de hoy no sabe lo propuesto', () => {
    const sin572 = deSaldoBanco({ treasury_account_id: 't4', nombre: 'Sin cuenta', cuenta: '', libro_validado: null, libro_propuesto: null, extracto_saldo: null, extracto_hasta: null, sin_casar: null, sin_casar_n: null })
    expect(sin572.libroValidado).toBeNull()
    expect(cifraBancos([...BANCOS_22_10, sin572])).toMatchObject({ validado: -4303.69, propuesto: -90.39 })
    expect(cifraBancos([{ ...BANCOS_22_10[0], libroPropuesto: null }]).propuesto).toBeNull()
  })
})

// ── conta_saldos_terceros ───────────────────────────────────────────────────

// journal_ledger a 22/10 (noche), Foodint / Llorente29: subcuenta, nombre, debe − haber.
const SUBCUENTAS_22_10: [string, string, number][] = [
  ['40000001', 'Proveedores · MAKRO DISTRIBUCION MAYORISTA SA', -1484.78],
  ['40000006', 'Proveedores · EUROPASTRY, S.A.', 95.95],
  ['40000007', 'Proveedores · COHELDI, S.L.', 8218.57],
  ['40000011', 'Proveedores · NOBLEZA VACUNA SL', -15288.47],
  ['40000016', 'Proveedores · JULIO GARCIA COLON', 3054.11],
  ['40000018', 'Proveedores · PRODUCTOS LÁCTEOS TGT, S.A.', -2145.37],
  ['40000099', 'Proveedores · FACTURAS POR LOCALIZAR', -31900.00],
  ['40700000', 'Anticipos a proveedores', 100.00],
  ['40700001', 'Saldo prepago Catcher', 1800.00],
  ['41000001', 'Acreedores · JUAN GRANDE SANCHO Y HERMANAS, C.B.', 893.01],
  ['41000008', 'Acreedores · QBO INTEGRITY SL', 1443.60],
  ['41000011', 'Acreedores · XFERA MOVILES, S.A.U.', -29.99],
  ['41000015', 'Acreedores · Gaolania Servicios S.L', -716.89],
  ['41000018', 'Acreedores · FAUSTINO MEDINA REYES', -200.00],
  ['41000023', 'Acreedores · IBERDROLA CLIENTES SAU', -720.02],
  ['41000026', 'Acreedores · VODAFONE', 301.76],
  ['41000027', 'Acreedores · ANA FERNANDEZ MEGINA', 866.36],
  ['41000032', 'Acreedores · Grub Tech Europe S.L.', -275.59],
  ['41000033', 'Acreedores · IBERO AMERICA SYSTEMS SL.', -1334.29],
  ['41000034', 'ENI PLENITUDE IBERIA SL', -1695.54],
  ['43000001', 'GLOVO', 4469.07],
  ['43000002', 'UBER EATS', 43104.94],
  ['43000003', 'JUST EAT', 540.27],
  ['43000004', 'CLOUDTOWN BRANDS', -13275.35],
  ['43000005', 'VENTURE PARTNERSHIP, S.L.', -2044.30],
  ['43000006', 'ADLETA CONSULTING S.L.', -12075.14],
  ['43000101', 'Glovo Ventas', -884.74],
]
// Lo que dio la misma consulta sumada en SQL, cada lado por separado:
//   cli_deudor 48114.28 · cli_acreedor 28279.53 · prov_acreedor (40 sin 407 ni 40000099) 18918.62
//   acre_acreedor (41) 4972.32 · anticipo407 1900.00 · neto4041 39017.58 · neto4344 19834.75
// (y conta_saldos_terceros, según el agente del SQL: debes 23.890,94 = 18.918,62 + 4.972,32).
const TERCEROS = SUBCUENTAS_22_10.map(([c, n, s]) => filaDeSaldo(c, n, s))

describe('conta_saldos_terceros: «Te deben» y «Debes» del libro, cada lado por su lado', () => {
  it('el grupo de cada subcuenta: la 407 es anticipo y la 40000099, por localizar', () => {
    expect(grupoDeCuenta('40000099', 'Proveedores · FACTURAS POR LOCALIZAR')).toBe('por_localizar')
    expect(grupoDeCuenta('40700001', 'Saldo prepago Catcher')).toBe('anticipo')
    expect(grupoDeCuenta('40000007')).toBe('proveedor')
    expect(grupoDeCuenta('41000034', 'ENI PLENITUDE IBERIA SL')).toBe('acreedor')
    expect(grupoDeCuenta('43000101', 'Glovo Ventas')).toBe('cliente')
    expect(grupoDeCuenta('40600000')).toBe('proveedor')
    expect(grupoDeCuenta('41900000')).toBe('acreedor')
    expect(grupoDeCuenta('47700000')).toBeNull()
    expect(TERCEROS.filter((f) => f.grupo === null)).toEqual([])
  })

  it('las cinco cifras, iguales a las sumas de la base', () => {
    expect(cifrasTerceros(TERCEROS)).toEqual({ teDeben: 48114.28, anticiposClientes: 28279.53, debes: 23890.94, porLocalizar: 31900, anticiposProveedores: 1900 })
    expect(Math.round((18918.62 + 4972.32) * 100) / 100).toBe(23890.94)
  })

  it('antes eran netos: Te deben 19.834,75 (restaba anticipos de clientes) y Debes 39.017,58 (con la 407 y por localizar)', () => {
    const simples = SUBCUENTAS_22_10.map(([code, , s]) => ({ code, templateCode: null, debe: s > 0 ? s : 0, haber: s < 0 ? -s : 0 }))
    expect(saldoDe(simples, ['43', '44'], 'deudor')).toBe(19834.75)
    expect(saldoDe(simples, ['40', '41'], 'acreedor')).toBe(39017.58)
  })

  it('lo que va debajo: los anticipos de clientes y lo por localizar, dichos aparte', () => {
    const c = cifrasTerceros(TERCEROS)
    expect(apoyoTeDeben(c, euros)).toBe('aparte, 28.279,53 € de anticipos de clientes')
    expect(apoyoDebes(c, euros)).toBe('y 31.900 € de facturas por localizar')
  })

  it('las barritas del Inicio con la misma vara que la tarjeta (puntoDeMes)', () => {
    const simples = SUBCUENTAS_22_10.map(([code, name, s]) => ({ code, name, templateCode: null, debe: s > 0 ? s : 0, haber: s < 0 ? -s : 0 }))
    expect(puntoDeMes('2026-10-01', simples)).toMatchObject({ teDeben: 48114.28, debes: 23890.94 })
  })

  it('Contactos: «Te debe / Le debes» de sus subcuentas; «Nada pendiente» solo con el libro a 0', () => {
    const conParty = TERCEROS.map((f) => (f.cuenta === '40000016' ? { ...f, partyId: 'julio' } : f.cuenta === '43000002' ? { ...f, partyId: 'uber' } : f))
    expect(saldoDeContacto(conParty, 'julio')).toEqual({ teDebe: 3054.11, leDebes: 0 })
    expect(saldoDeContacto(conParty, 'uber')).toEqual({ teDebe: 43104.94, leDebes: 0 })
    expect(saldoDeContacto(conParty, 'sin-subcuenta')).toEqual({ teDebe: 0, leDebes: 0 })
  })

  it('las filas de la base, con su grupo; uno desconocido se deduce del código; sin contacto, party_id null', () => {
    expect(deSaldoTercero({ cuenta: '40700001', nombre: 'Saldo prepago Catcher', party_id: null, grupo: 'anticipo', saldo_deudor: '1800', saldo_acreedor: '0' }))
      .toEqual({ cuenta: '40700001', nombre: 'Saldo prepago Catcher', partyId: null, grupo: 'anticipo', saldoDeudor: 1800, saldoAcreedor: 0 })
    expect(deSaldoTercero({ cuenta: '41000034', nombre: 'ENI', party_id: null, grupo: 'otro', saldo_deudor: 0, saldo_acreedor: 1695.54 }).grupo).toBe('acreedor')
    // Las dos sin contacto (ENI, Glovo Ventas) suman en Inicio y no son de ningún contacto.
    expect(saldoDeContacto(TERCEROS, 'cualquiera')).toEqual({ teDebe: 0, leDebes: 0 })
  })
})

// ── conta_impuesto_calendario ───────────────────────────────────────────────

const fila = (modelo: string, periodo: string, presentacion: string, declaracion: Partial<Declaracion> | null): FilaCalendario => ({
  obligacion: `o-${modelo}-${periodo}`, modelo, nombre: modelo, cadencia: modelo === '202' ? 'instalments_202' : 'quarterly', ejercicio: 2026, periodo,
  presentacion, domiciliacion: null, provisional: null, atrasado: false, domicilia: false, cuenta_final: null, se_calcula: modelo === '303',
  declaracion: declaracion ? {
    id: 'r', estado: 'pending', estado_texto: '', resultado: null, importe: null, anterior: null, no_hace_falta: null,
    presentada: null, por: null, errores: 0, avisos: 0, aviso: null, cuadra: true, ...declaracion,
  } as Declaracion : null,
})
const cal = (ventana: string | null, filas: FilaCalendario[]): Calendario => ({
  hoy: '2026-10-22', ventana, desde: '2026-10-01', puede_gestionar: true, filas, siguiente: [],
  presentados: { ano: 2026, desde: '2026-10-01', vencidos: 0, presentados: 0, en_plazo: 0, contabilizados: 0 },
  modelos: [], no_presenta: [], se_pueden_anadir: [], certificado: null, pagos_sin_llegar: [],
})

// p1 §0: 111/115/303 3T filed el 20/10; 202 2P (20/10) y 202 3P (21/12) not_required.
describe('Impuestos: la etiqueta es el mes de la ventana, y lo que no se presenta no es «presentado»', () => {
  it('el 22/10 con la RPC de antes: ventana en diciembre por el 202 3P (not_required) → «Diciembre · Nada que presentar», no «Este mes · Todo presentado»', () => {
    const c = cal('2026-12-01', [fila('202', '2P', '2026-10-20', { estado: 'not_required' }), fila('202', '3P', '2026-12-21', { estado: 'not_required' })])
    expect(cifraPlazo(c)).toEqual({ etiqueta: 'Diciembre', valor: 'Nada que presentar', apoyo: '2 modelos que no hay que presentar', tono: 'ok', texto: true })
    expect(tituloVentana(c)).toBe('Diciembre')
  })

  it('octubre, con lo presentado y el 202 que no: «Todo presentado» solo de los tres que se presentaron', () => {
    const c = cal('2026-10-01', [
      fila('111', '3T', '2026-10-20', { estado: 'filed' }), fila('115', '3T', '2026-10-20', { estado: 'filed' }),
      fila('202', '2P', '2026-10-20', { estado: 'not_required' }), fila('303', '3T', '2026-10-20', { estado: 'filed', resultado: 'to_offset', importe: 3723.44 }),
    ])
    expect(cifraPlazo(c)).toMatchObject({ etiqueta: 'Octubre', valor: 'Todo presentado', apoyo: '3 modelos presentados · 1 modelo que no hay que presentar' })
  })

  it('el 22/10 con la 0490: ventana en enero; los 202 not_required de antes siguen en las filas y no cuentan', () => {
    // Lo que devuelve hoy para Foodint (agente del SQL): ventana 2027-01-01; filas 202 2P (20/10) y
    // 202 3P (21/12) not_required, 111 4T y 115 4T (20/01) sin declaración.
    const c = cal('2027-01-01', [
      fila('202', '2P', '2026-10-20', { estado: 'not_required' }), fila('202', '3P', '2026-12-21', { estado: 'not_required' }),
      { ...fila('111', '4T', '2027-01-20', null), ejercicio: 2026 }, { ...fila('115', '4T', '2027-01-20', null), ejercicio: 2026 },
    ])
    expect(tituloVentana(c)).toBe('Enero · 4.º trimestre')
    expect(etiquetaVentana(c)).toBe('Enero')
    // Con 111 y 115 por presentar: el plazo que toca, nunca «Nada que presentar» ni «Este mes».
    const p = cifraPlazo(c)
    expect(p).toEqual({ etiqueta: 'Presentar hasta el 20/01 · dentro de 90 días', valor: '2 modelos', apoyo: '2 sin calcular aquí', tono: 'normal' })
    expect(JSON.stringify(p)).not.toMatch(/Este mes|Nada que presentar|Todo presentado/)
    // Los not_required se pintan, con lo que son, y no como pendientes.
    expect(vistaDeFila(c.filas[0]).frase).toBe('No hay que presentarlo')
    expect(vistaDeFila(fila('202', '3P', '2026-12-21', { estado: 'not_required', no_hace_falta: 'el impuesto de 2025 salió a cero' })).frase)
      .toBe('No hay que presentarlo: el impuesto de 2025 salió a cero')
  })

  it('sin ventana: «Ningún plazo cerca», nunca «Este mes»', () => {
    expect(etiquetaVentana({ ventana: null })).toBe('Ningún plazo cerca')
    expect(cifraPlazo(cal(null, [])).etiqueta).toBe('Ningún plazo cerca')
    expect(JSON.stringify(cifraPlazo(cal('2027-01-01', [])))).not.toContain('Este mes')
  })
})
