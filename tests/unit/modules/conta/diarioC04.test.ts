// C04 · Tarea 4: lo que deciden las pantallas del libro (src/modules/conta/lib/diario.ts).
// Datos inventados: dos locales (Norte, Sur), una marca propia y una cedida.

import { describe, expect, it } from 'vitest'
import {
  cifras, deDondeSale, estadoDe, estadoMes, filtrar, filtrosVisibles, importe, loQueHeHechoYo, mesAnterior, finDeMes,
  nombreDeUso, numeroVisible, pasosCierre, pastillas, problemasMano, sePuedeCerrar, cuadreMano, type ApunteDiario, type AsientoDiario, type LineaMano,
} from '@/modules/conta/lib/diario'

const NORTE = 'loc-norte'; const SUR = 'loc-sur'

function apunte(p: Partial<ApunteDiario>): ApunteDiario {
  return {
    posicion: 1, cuentaId: 'c', cuenta: '57000000', nombreCuenta: 'Caja', tituloOficial: null, debe: 0, haber: 0, concepto: null, localId: NORTE, local: 'Norte',
    comun: false, marcaId: null, marca: null, cedida: false, documento: null, iva: null, retencion: null, ...p,
  }
}
function asiento(p: Partial<AsientoDiario>): AsientoDiario {
  return {
    id: 'a', serie: 1, numero: null, fecha: '2026-10-05', concepto: 'Ventas del día · Norte', origen: 'sales_day', origenId: 'o', estado: 'propuesto',
    confianza: 'seguro', porque: 'cuadra con 212 tickets', razones: [], documento: null, terceroId: null, creadoPor: 'Folvy', creadoEn: '2026-10-06T01:00:00Z',
    validadoPor: null, validadoEn: null, anuladoPor: null, anuladoEn: null, motivoAnulacion: null, anuladoCon: null, anulaA: null, traido: null,
    huella: null, huellaAnterior: null, cadena: null,
    apuntes: [apunte({ debe: 110 }), apunte({ cuenta: '70000000', haber: 100, marcaId: 'm1', marca: 'Propia A' }), apunte({ cuenta: '47700010', haber: 10 })],
    ...p,
  }
}

describe('filtros por origen', () => {
  const libro = [
    asiento({ id: '1' }),
    asiento({ id: '2', origen: 'supplier_invoice', serie: 2, estado: 'validado', numero: 4, validadoPor: 'Ana' }),
    asiento({ id: '3', origen: 'supplier_invoice', serie: 2, estado: 'anulado', numero: 3, anuladoCon: '4' }),
    asiento({ id: '4', origen: 'reversal', serie: 2, estado: 'validado', numero: 5, anulaA: '3' }),
  ]
  it('solo salen los orígenes que la empresa tiene; Todos y Para revisar siempre', () => {
    const ids = filtrosVisibles(libro).map((f) => f.id)
    expect(ids).toEqual(['todos', 'revisar', 'ventas', 'compras', 'anulados'])
    expect(filtrosVisibles([]).map((f) => f.id)).toEqual(['todos', 'revisar'])
  })
  it('cada filtro dice cuántos tiene, y Todos enseña también lo anulado (regla 7)', () => {
    const f = Object.fromEntries(filtrosVisibles(libro).map((x) => [x.id, x.n]))
    expect(f).toMatchObject({ todos: 4, revisar: 1, ventas: 1, compras: 3, anulados: 2 })
  })
  it('el contraasiento sale con el origen de lo que anula', () => {
    expect(filtrar(libro, 'compras').map((a) => a.id)).toContain('4')
  })
  it('lo que espera revisión va primero; luego lo último arriba', () => {
    expect(filtrar(libro, 'todos').map((a) => a.id)).toEqual(['1', '4', '2', '3'])
  })
})

describe('estado, importe y pastillas', () => {
  it('cada estado con su texto y su tono', () => {
    expect(estadoDe(asiento({}))).toEqual({ texto: 'Para revisar', tono: 'ambar' })
    expect(estadoDe(asiento({ estado: 'validado', validadoPor: 'Folvy (validación automática de ventas)' }))).toEqual({ texto: 'Hecho por Folvy', tono: 'verde' })
    expect(estadoDe(asiento({ estado: 'validado', validadoPor: 'Ana' })).texto).toBe('Validado')
    expect(estadoDe(asiento({ estado: 'anulado' })).tono).toBe('gris')
    expect(estadoDe(asiento({ estado: 'borrador' })).texto).toBe('Borrador')
  })
  it('el importe es la suma del Debe', () => expect(importe(asiento({}))).toBe(110))
  it('un local por nombre, varios contados, la marca cedida dicha', () => {
    expect(pastillas(asiento({}))).toEqual([{ texto: 'Norte', tono: 'azul' }, { texto: 'Marcas propias', tono: 'neutro' }])
    const dos = asiento({ apuntes: [apunte({ debe: 1 }), apunte({ localId: SUR, local: 'Sur', haber: 1, marcaId: 'm2', marca: 'Marca A', cedida: true })] })
    expect(pastillas(dos)).toEqual([{ texto: '2 locales', tono: 'azul' }, { texto: 'Marca A · cedida', tono: 'ambar' }])
    expect(pastillas(asiento({ apuntes: [apunte({ localId: null, local: null, comun: true, debe: 1 })] }))).toEqual([{ texto: 'Común', tono: 'azul' }])
  })
  it('de dónde sale, en palabras', () => {
    expect(deDondeSale(asiento({ origen: 'manual', creadoPor: 'Ana' }))).toBe('A mano · Ana')
    expect(deDondeSale(asiento({ origen: 'migrated', traido: { programa: 'Diez', serie: '2', numero: '154' } }))).toBe('Traído de Diez · serie 2 nº 154')
    expect(deDondeSale(asiento({ origen: 'supplier_invoice', documento: 'F-12' }))).toBe('Factura de proveedor · F-12')
  })
})

describe('las cuatro cifras y el mes', () => {
  const cierres = [{ mes: '2026-09-01', tipo: 'manual' as const, quien: 'Ana' }, { mes: '2026-08-01', tipo: 'migrated' as const, quien: null }]
  it('un mes abierto dice hasta dónde está cerrado; uno traído no se toca', () => {
    expect(estadoMes('2026-10-01', cierres)).toEqual({ cerrado: false, texto: 'Abierto', apoyo: 'septiembre cerrado' })
    expect(estadoMes('2026-08-01', cierres)).toMatchObject({ cerrado: true, texto: 'Traído' })
    expect(estadoMes('2026-09-01', cierres)).toMatchObject({ cerrado: true, texto: 'Cerrado', apoyo: 'cerrado por Ana' })
  })
  it('asientos del mes, lo que espera (de cualquier mes) y el resultado por local', () => {
    const libro = [
      asiento({ id: '1', estado: 'validado', numero: 1 }),
      asiento({ id: '2', estado: 'validado', numero: 2, origen: 'supplier_invoice' }),
      asiento({ id: '3', fecha: '2026-09-30' }),
      asiento({ id: '4', estado: 'borrador', origen: 'manual' }),
    ]
    const c = cifras(libro, '2026-10-01', cierres, { total: 1234.5, porLocal: [{ nombre: 'Norte', resultado: 1500 }, { nombre: 'Sur', resultado: -265.5 }] })
    expect(c.asientosMes).toBe(2)
    expect(c.apoyoAsientos).toBe('1 de ventas del día · 1 factura')
    expect(c.revisar).toBe(2)
    expect(c.apoyoRevisar).toBe('1 propuestos por Folvy · 1 borradores')
    expect(c.resultado).toBe(1234.5)
    expect(c.apoyoResultado).toBe('Norte +1.500 · Sur −266')
  })
  it('meses: el anterior y su último día', () => {
    expect(mesAnterior('2026-01-01')).toBe('2025-12-01')
    expect(finDeMes('2026-02-01')).toBe('2026-02-28')
  })
})

describe('lo que he hecho yo', () => {
  it('lo validado por Folvy, con Deshacer; lo propuesto, con su porqué', () => {
    const r = loQueHeHechoYo([
      asiento({ id: '1', estado: 'validado', validadoPor: 'Folvy (validación automática de ventas)', validadoEn: '2026-10-06T02:00:00Z' }),
      asiento({ id: '2', concepto: 'Liquidación Glovo', porque: 'separé lo cedido' }),
      asiento({ id: '3', estado: 'validado', validadoPor: 'Ana' }),
    ])
    expect(r.map((x) => [x.asientoId, x.deshacer])).toEqual([['1', true], ['2', false]])
    expect(r[1]).toMatchObject({ titulo: 'Dejé «Liquidación Glovo» para revisar', apoyo: 'separé lo cedido' })
  })
})

describe('cierre del mes', () => {
  it('solo lo que la empresa tiene; 0 de 0 no sale', () => {
    const p = pasosCierre({ diasVenta: { total: 60, asentadas: 60 }, facturas: { total: 3, asentadas: 2 }, liquidaciones: { total: 0, asentadas: 0 }, socios: null, nominas: null, pendientes: 1, cerrado: false })
    expect(p.map((x) => x.texto)).toEqual(['Días de ventas asentados: 60 de 60', 'Facturas de proveedor: 2 de 3', '1 asiento espera revisión', 'Cerrar el mes'])
    expect(sePuedeCerrar(p)).toEqual({ puede: false, falta: 'Falta: facturas de proveedor: 2 de 3; 1 asiento espera revisión.' })
  })
  it('una empresa sin ventas ni plataformas (cuenta B): solo revisión y cierre', () => {
    const p = pasosCierre({ diasVenta: null, facturas: { total: 2, asentadas: 2 }, liquidaciones: null, socios: null, nominas: null, pendientes: 0, cerrado: false })
    expect(sePuedeCerrar(p).puede).toBe(true)
  })
})

describe('asiento a mano', () => {
  const plan = new Set(['62100000', '57200001'])
  const l = (p: Partial<LineaMano>): LineaMano => ({ cuenta: '', debe: '', haber: '', localId: NORTE, comun: false, concepto: '', ...p })
  it('cuadra en vivo y dice cuánto falta y dónde', () => {
    expect(cuadreMano([l({ debe: '1.200,50' }), l({ haber: '1200' })]).texto).toBe('No cuadra: faltan 0,50 € en el Haber')
    expect(cuadreMano([l({ debe: '1.200,50' }), l({ haber: '1200,5' })]).cuadra).toBe(true)
  })
  it('dice lo que falta, apunte por apunte', () => {
    const r = problemasMano('', '2026-10-05', [l({ cuenta: '62100000', debe: '10', haber: '5' }), l({ cuenta: '99999999', haber: '10', localId: null })], plan)
    expect(r).toEqual([
      'Ponle un concepto.',
      'Apunte 1: va al Debe o al Haber, uno de los dos.',
      'Apunte 2: la 99999999 no es una cuenta de apunte de tu plan.',
      'Apunte 2: elige el local, o márcalo como común.',
      'No cuadra: faltan 5,00 € en el Debe',
    ])
  })
  it('bien hecho: nada que decir', () => {
    expect(problemasMano('Alquiler', '2026-10-05', [l({ cuenta: '62100000', debe: '1000' }), l({ cuenta: '57200001', haber: '1000', localId: null, comun: true })], plan)).toEqual([])
  })
})

// Respuesta 3, punto 1: cada serie numera aparte; «1» a secas sale repetido.
describe('el número del asiento lleva su serie', () => {
  it('palabra y número; sin número, la raya', () => {
    expect(numeroVisible({ serie: 1, numero: 3 })).toBe('Ventas 3')
    expect(numeroVisible({ serie: 2, numero: 1 })).toBe('Compras 1')
    expect(numeroVisible({ serie: 4, numero: 2 })).toBe('General 2')
    expect(numeroVisible({ serie: 9, numero: 1 })).toBe('Nóminas 1')
    expect(numeroVisible({ serie: 3, numero: 1287 })).toBe('Banco 1.287')
    expect(numeroVisible({ serie: 1, numero: null })).toBe('—')
  })
})

// Respuesta 3, punto 3. Filas REALES del plan de la cuenta A en staging-conta
// (company_account, 12/10), con su kind, name y plain_name tal cual.
describe('la cuenta por su nombre de uso', () => {
  const REALES = [
    { code: '62300000', kind: 'template', name: 'Servicios de profesionales independientes', plainName: 'Asesoría, abogado, notario.', uso: 'Asesoría, abogado, notario' },
    { code: '64000000', kind: 'template', name: 'Sueldos y salarios', plainName: 'Nóminas, en bruto.', uso: 'Nóminas, en bruto' },
    { code: '40000002', kind: 'own', name: 'Proveedores · Hermanos Ruiz', plainName: null, uso: 'Proveedores · Hermanos Ruiz' },
    { code: '47200021', kind: 'own', name: 'IVA soportado 21 %', plainName: null, uso: 'IVA soportado 21 %' },
    // Hoja de serie sin «qué se apunta aquí»: su título, nunca un literal de reserva (regla 30).
    { code: '52000000', kind: 'template', name: 'Préstamos a corto plazo de entidades de crédito', plainName: null, uso: 'Préstamos a corto plazo de entidades de crédito' },
  ]
  for (const c of REALES) it(`${c.code}: «${c.uso}»`, () => expect(nombreDeUso(c)).toBe(c.uso))
  it('una subcuenta propia manda su nombre aunque tenga «qué se apunta aquí»', () => {
    expect(nombreDeUso({ kind: 'own', name: 'Comisiones de plataformas', plainName: 'Lo que te cobran Glovo, Uber y Just Eat.' })).toBe('Comisiones de plataformas')
  })
})
