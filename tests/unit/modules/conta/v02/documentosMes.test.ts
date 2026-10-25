// tests/unit/modules/conta/v02/documentosMes.test.ts
//
// V02d · Documentos, con la población real (regla 31): las 25 fuentes de
// Foodint como estaban el 25/10 (fixtures/foodint-20261025-antes.json, con
// los 17 avisos en rojo que vio Julio) y como quedan con la tanda 1912 y
// conta_puerta_al_dia (…-despues.json: Tspoonlab sin sus tres abonos del
// 30/09, el ritmo aprendido por días de lo que nadie tocó, lo que cubren los
// extractos, el corte del 01/10, la familia, el canal y el correo). Los ids y
// los NIF no son los de verdad; las fechas, los ritmos y los nombres, sí.
// La tabla de cada aviso: docs/conta/v02/avisos-foodint-20261025.md.

import { describe, expect, it } from 'vitest'
import antes from './fixtures/foodint-20261025-antes.json'
import despues from './fixtures/foodint-20261025-despues.json'
import { juntarPeriodos, loQueFalta, faltaDe, type DatosFuentes, type Fuente } from '@/modules/conta/lib/puerta'
import {
  avisoDe, cabeceraMes, columnaDe, filasDocumentos, gruposEsperas, iniciales, nombreBonito, primeras, ritmo,
} from '@/modules/conta/lib/documentosMes'

const HOY = '2026-10-25'
const ANTES = antes as unknown as DatosFuentes
const DESPUES = despues as unknown as DatosFuentes
const fuente = (d: DatosFuentes, nombre: string) => d.fuentes.find((f) => f.nombre === nombre) as Fuente
const tarde = (d: DatosFuentes) => loQueFalta(d, HOY).filter((x) => x.estado.que === 'tarde')

describe('los 17 avisos de Foodint, antes y después (la misma vara a los dos lados)', () => {
  it('antes: 17 en rojo, como los vio Julio el 25/10', () => {
    expect(tarde(ANTES)).toHaveLength(17)
  })
  it('después: quedan los verdaderos; fuera Nobleza Vacuna, los tres extractos y el septiembre de Tspoonlab', () => {
    const de = tarde(DESPUES).map((x) => x.de)
    expect(de).not.toContain('NOBLEZA VACUNA')
    expect(de.filter((x) => x.startsWith('Extracto'))).toEqual([])
    expect(tarde(DESPUES).find((x) => x.de === 'TSPOONLAB, S.L.')?.que).toBe('Factura de octubre')
    expect(tarde(DESPUES)).toHaveLength(13)
  })
})

describe('cada causa, con su caso real', () => {
  it('Tspoonlab: los tres abonos del 30/09 no son la factura; septiembre es de antes del corte', () => {
    const t = fuente(DESPUES, 'TSPOONLAB, S.L.')
    expect(t.llegadas).not.toContain('2026-09-30')
    const x = faltaDe(t, HOY, 5, 14, '2026-10-01')!
    expect([x.o.dia, x.estado.texto]).toEqual(['2026-10-01', 'Se retrasa 24 días'])
    // Sin el corte, pediría septiembre (es lo que Diez ya tiene).
    expect(faltaDe(t, HOY, 5, 14, null)?.o.dia).toBe('2026-10-01')
  })
  it('Nobleza Vacuna factura a fin de mes: la de octubre toca el 31, aún a tiempo', () => {
    expect(faltaDe(fuente(DESPUES, 'NOBLEZA VACUNA'), HOY)?.estado).toEqual({ que: 'a_tiempo', texto: 'Aún a tiempo' })
  })
  it('los extractos: el del 23/10 cubre la semana del 13 al 19, solo o junto con el anterior', () => {
    for (const n of ['Extracto · BBVA ···0133', 'Extracto · BBVA ···4525', 'Extracto · Cuenta principal']) {
      expect(faltaDe(fuente(DESPUES, n), HOY)?.estado.que, n).toBe('a_tiempo')
    }
    expect(juntarPeriodos([['2026-10-15', '2026-10-20'], ['2026-10-01', '2026-10-13']])).toEqual([['2026-10-01', '2026-10-20']])
    expect(juntarPeriodos([['2026-10-01', '2026-10-05'], ['2026-10-12', '2026-10-20']])).toHaveLength(2)
  })
  it('Glovo y Just Eat facturan el 15 y a fin de mes: falta la del 15/10, 10 días, no «15 días tarde»', () => {
    for (const n of ['GLOVOAPP SPAIN PLATFORM', 'JUST EAT, S.L.']) {
      const x = faltaDe(fuente(DESPUES, n), HOY, 5, 14, '2026-10-01')!
      expect([x.o.hasta, x.estado.texto], n).toEqual(['2026-10-15', 'Se retrasa 10 días'])
    }
  })
  it('Cloudtown factura a primeros de mes: falta desde el día 4, 21 días', () => {
    expect(faltaDe(fuente(DESPUES, 'CLOUDTOWN BRANDS, S.L.'), HOY)?.estado.texto).toBe('Se retrasa 21 días')
  })
  it('Europastry factura por entrega: se espera la siguiente desde la última (23/10), aún a tiempo', () => {
    expect(faltaDe(fuente(DESPUES, 'EUROPASTRY, S.A.'), HOY)?.estado.que).toBe('a_tiempo')
  })
})

describe('Documentos (tablero 22): las dos columnas', () => {
  const { mandar, subir } = filasDocumentos(DESPUES, HOY)
  it('«Te lo tienen que mandar»: alquileres por su local, la gestoría y los proveedores, lo más tarde arriba', () => {
    expect(mandar.filter((x) => x.dias > 0).map((x) => [x.nombre, x.que, x.aviso.texto])).toEqual([
      ['Alquiler de Camichi 4', 'El de octubre', 'Se retrasa 24 días'],
      ['Alquiler de Cañaveral 75', 'Los 3 de octubre', 'Se retrasa 24 días'],
      ['Tspoonlab', 'Factura de octubre', 'Se retrasa 24 días'],
      ['Cloudtown Brands', 'Factura de octubre', 'Se retrasa 21 días'],
      ['Asesoría QBO', 'Nóminas de septiembre', 'Se retrasa 20 días'],
      ['Last Systems', 'Factura de octubre', 'Se retrasa 20 días'],
      ['Iberdrola Clientes', 'Factura de octubre', 'Se retrasa 12 días'],
    ])
    expect(mandar.find((x) => x.nombre === 'Asesoría QBO')?.correo).toBe('contacto@asesoriaqbo.es')
  })
  it('ninguna persona en Documentos: los alquileres se nombran por el local', () => {
    const nombres = [...mandar, ...subir].map((x) => x.nombre).join(' | ')
    for (const p of ['Ana', 'Fernández', 'Gómez', 'Pilar', 'Susana', 'Silvia', 'Juan Grande']) expect(nombres).not.toContain(p)
  })
  it('«Lo tienes que subir tú»: cada plataforma con su factura de comisiones en una fila, y el banco', () => {
    expect(subir.filter((x) => x.dias > 0).map((x) => [x.nombre, x.que, x.aviso.texto])).toEqual([
      ['Uber', 'Liquidación del 28 de septiembre al 4 de octubre y su factura', 'Se retrasa 21 días'],
      ['Glovo', 'Liquidación del 1 al 15 de octubre y su factura', 'Se retrasa 10 días'],
      ['Just Eat', 'Liquidación del 1 al 15 de octubre y su factura', 'Se retrasa 10 días'],
    ])
    expect(subir.filter((x) => x.familia === 'banco').map((x) => x.aviso.tono)).toEqual(['gris', 'gris', 'gris'])
  })
  it('la columna de cada familia', () => {
    for (const familia of ['alquiler', 'suministro', 'proveedor', 'gestoria'] as const) expect(columnaDe({ familia, tipo: 'proveedor' })).toBe('mandar')
    for (const familia of ['plataforma', 'banco'] as const) expect(columnaDe({ familia, tipo: 'proveedor' })).toBe('subir')
    // Sin familia (la base de antes), por su tipo.
    expect(columnaDe({ tipo: 'intermediario' })).toBe('subir')
    expect(columnaDe({ tipo: 'nominas' })).toBe('mandar')
  })
  it('se ven 3 por columna y «Y N más» detrás de «Ver todo» (nada se esconde)', () => {
    const p = primeras(mandar)
    expect(p.vistas).toHaveLength(3)
    expect(p.resto).toBe(mandar.length - 3)
    expect(p.texto).toBe(`Y ${mandar.length - 3} más`)
    const q = primeras(subir)
    expect(q.texto).toBe(`Y ${subir.length - 3} más que aún están a tiempo`)
  })
  it('los avisos: gris aún a tiempo, ámbar «Se retrasa N días», rojo solo «Hace más de un mes»', () => {
    expect(avisoDe({ que: 'a_tiempo', texto: 'Aún a tiempo' })).toEqual({ tono: 'gris', texto: 'Aún a tiempo' })
    const t = fuente(DESPUES, 'LAST SYSTEMS S.L.')
    expect(avisoDe(faltaDe(t, HOY)!.estado)).toEqual({ tono: 'ambar', texto: 'Se retrasa 20 días' })
    expect(avisoDe(faltaDe(t, '2026-11-04')!.estado)).toEqual({ tono: 'ambar', texto: 'Se retrasa 30 días' })
    // El 05/11 la de octubre (día 5) lleva 31 días: rojo, «Hace más de un mes».
    expect(avisoDe(faltaDe(t, '2026-11-05')!.estado)).toEqual({ tono: 'rojo', texto: 'Hace más de un mes' })
    expect(avisoDe({ que: 'tarde', dias: 31, texto: 'Hace más de un mes', grave: true })).toEqual({ tono: 'rojo', texto: 'Hace más de un mes' })
  })
  it('la cabecera de octubre: lo que se espera este mes desde el corte, con lo que ya está', () => {
    // Olimpo, mensual el 19 (respuesta 1: el local ya no impide aprender su ritmo), ya tiene la de octubre.
    expect(cabeceraMes(DESPUES, HOY)).toEqual({ mes: 'octubre', total: 42, ya: 13, retrasan: 16, aTiempo: 13 })
    // Apagado en la empresa: no cuenta nada.
    expect(cabeceraMes({ ...DESPUES, ajustes: { lo_que_falta: false, margen: 5 } }, HOY).total).toBe(0)
  })
})

describe('los nombres, como se dicen', () => {
  it('sin la forma jurídica y sin mayúsculas, con sus tildes', () => {
    expect(nombreBonito('TSPOONLAB, S.L.')).toBe('Tspoonlab')
    expect(nombreBonito('XFERA MOVILES, S.A.U.')).toBe('Xfera Móviles')
    expect(nombreBonito('IBERDROLA CLIENTES SAU')).toBe('Iberdrola Clientes')
    expect(nombreBonito('OLIMPO GOURMET, S.L')).toBe('Olimpo Gourmet')
    expect(nombreBonito('JUAN GRANDE SANCHO Y HERMANAS, C.B.')).toBe('Juan Grande Sancho y Hermanas, C.B.')
    expect(nombreBonito('ANA FERNANDEZ MEGINA')).toBe('Ana Fernández Megina')
    expect(nombreBonito('Silvia Gómez Antonio')).toBe('Silvia Gómez Antonio')
  })
  it('las letras del círculo', () => {
    expect(iniciales('Asesoría QBO')).toBe('QBO')
    expect(iniciales('BBVA ···0133')).toBe('BB')
    expect(iniciales('Last Systems')).toBe('LS')
    expect(iniciales('Iberdrola')).toBe('I')
    expect(iniciales('Juan Grande Sancho y Hermanas, C.B.')).toBe('JG')
  })
})

describe('«Qué esperas cada mes» (tablero 23)', () => {
  const g = gruposEsperas(DESPUES, HOY)
  it('los grupos, en su orden, con su recuento', () => {
    expect(g.map((x) => [x.titulo, x.recuento])).toEqual([
      ['Alquileres', '2 locales · 4 facturas al mes'],
      ['Luz, agua y teléfono', '2'],
      ['Proveedores', '7'],
      ['Plataformas y reparto', '4'],
      ['Gestoría y nóminas', '1'],
      ['Banco', '3'],
    ])
  })
  it('aquí sí salen las personas; las tres propietarias del mismo local, en una fila', () => {
    const a = g[0].filas.map((x) => [x.nombre, x.detalle, x.activa])
    expect(a).toEqual([
      ['Ana Fernández Megina', 'Alquiler · cada mes, el día 1', true],
      ['Gómez Antonio (3 personas)', 'Alquiler · 3 facturas cada mes, el día 1', true],
      ['Juan Grande Sancho y Hermanas, C.B.', 'Alquiler · cada mes, el día 1', false],
    ])
  })
  it('el local, solo en alquileres y suministros, y solo con más de un local', () => {
    const pide = g.flatMap((x) => x.filas.filter((y) => y.pideLocal).map(() => x.familia))
    expect(new Set(pide)).toEqual(new Set(['alquiler', 'suministro']))
    const unLocal = gruposEsperas({ ...DESPUES, locales: DESPUES.locales!.slice(0, 1) }, HOY)
    expect(unLocal.flatMap((x) => x.filas).some((y) => y.pideLocal)).toBe(false)
  })
  it('las plataformas: la liquidación y su factura de comisiones, una fila', () => {
    expect(g[3].filas.map((x) => [x.nombre, x.detalle, x.ids.length])).toEqual([
      ['Glovo', 'Liquidación cada quincena · y su factura de comisiones', 2],
      ['Just Eat', 'Liquidación cada quincena · y su factura de comisiones', 2],
      ['Riders de Catcher', 'Facturas de los riders cada quincena, el 15 y a fin de mes', 1],
      ['Uber', 'Liquidación cada semana, el domingo · y su factura de comisiones', 2],
    ])
  })
  it('lo que lleva meses sin llegar sale apagado y lo dice', () => {
    const makro = { ...fuente(DESPUES, 'COHELDI, S.L.'), id: 'makro', nombre: 'MAKRO AUTOSERVICIO MAYORISTA, S.A.U.', activa: false, llegadas: ['2026-07-10'], cadencia: 'mensual' as const, dia: 10, cada: null, local: null }
    const x = gruposEsperas({ ...DESPUES, fuentes: [...DESPUES.fuentes, makro] }, HOY).find((y) => y.familia === 'proveedor')!
    expect(x.recuento).toBe('8 · 1 apagado')
    expect(x.filas.at(-1)).toMatchObject({ nombre: 'Makro Autoservicio Mayorista', activa: false, dormida: 'sin facturas desde julio' })
  })
  it('el ritmo, en palabras', () => {
    expect(ritmo({ tipo: 'proveedor', cadencia: 'mensual', dia: 31, dia_semana: null, cada: null })).toBe('cada mes, a fin de mes')
    expect(ritmo({ tipo: 'proveedor', cadencia: 'mensual', dia: 16, dia_semana: null, cada: null })).toBe('cada mes, hacia el día 16')
    expect(ritmo({ tipo: 'intermediario', cadencia: 'semanal', dia: null, dia_semana: 7, cada: null })).toBe('cada semana, el domingo')
    expect(ritmo({ tipo: 'proveedor', cadencia: 'varias', dia: null, dia_semana: null, cada: 10 })).toBe('varias al mes · avisar si pasan 10 días sin ninguna')
  })
})
