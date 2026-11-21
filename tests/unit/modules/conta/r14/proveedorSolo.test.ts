// tests/unit/modules/conta/r14/proveedorSolo.test.ts
//
// R14 · El proveedor nuevo se da de alta solo, con su cuenta de gasto.
//   · La tabla de «por lo que vende» se lee de la BASE (la 1110, conta_gasto_por_venta),
//     no de una copia, y se aplica con la misma regla que _conta_gasto_por_venta: cada
//     línea, a la primera fila que tiene una de sus palabras (entera o en plural, sin
//     tildes ni mayúsculas); gana la hoja con más líneas. Nombres de línea INVENTADOS
//     (T11); la regla 31 contra los de verdad va en el parte, contada en el ensayo.
//   · La franja «Proveedor nuevo» con «Deshacer» y la cuenta propuesta en ámbar.
// El alta, el tercero reutilizado, la plataforma, los tres casos en que no se da de alta
// y «Deshacer» viven en SQL: los prueba supabase/staging/sql/20261121_r14_proveedor_solo_prueba.sql.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { estadoDeLaFicha, franjaProveedorSolo, gastoEnAmbar } from '@/modules/conta/nucleo/recibida/estado'

interface Fila { orden: number; hoja: string; que: string; palabras: string[]; porque: string | null }
const TABLA: Fila[] = (() => {
  const sql = readFileSync('supabase/migrations/20261121T1110_r14_proveedor_solo_anade.sql', 'utf8')
  const bloque = /insert into public\.conta_gasto_por_venta[\s\S]*?values([\s\S]*?)on conflict/.exec(sql)
  if (!bloque) throw new Error('No encuentro la tabla en la 1110')
  const filas = [...bloque[1].matchAll(/\((\d+), '(\d+)', '([^']+)', array\[([^\]]*)\], (null|'[^']+')\)/g)]
  return filas.map((m) => ({ orden: Number(m[1]), hoja: m[2], que: m[3], palabras: [...m[4].matchAll(/'([^']+)'/g)].map((x) => x[1]), porque: m[5] === 'null' ? null : m[5].slice(1, -1) }))
})()

// Lo mismo que _r14_sin_tildes y _conta_gasto_por_venta de la 1110.
const sinTildes = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const tiene = (linea: string, w: string) => { const l = ` ${sinTildes(linea)} `, p = sinTildes(w); return [` ${p} `, ` ${p}s `, ` ${p}es `].some((x) => l.includes(x)) }
function porLoQueVende(lineas: string[]): { hoja: string; que: string; porque?: string | null } | null {
  const cuenta = new Map<string, { n: number; orden: number; que: string; porque: string | null }>()
  for (const l of lineas) {
    const f = TABLA.find((x) => x.palabras.some((w) => tiene(l, w)))
    if (!f) continue
    const c = cuenta.get(f.hoja) ?? { n: 0, orden: f.orden, que: f.que, porque: f.porque }
    c.n++; c.orden = Math.min(c.orden, f.orden); cuenta.set(f.hoja, c)
  }
  const [mejor] = [...cuenta].sort(([, a], [, b]) => b.n - a.n || a.orden - b.orden)
  return mejor ? { hoja: mejor[0], que: mejor[1].que, porque: mejor[1].porque } : null
}

describe('la tabla de lo que vende, la de la base', () => {
  it('está entera y en un solo sitio: cada hoja es del 6 y cada palabra sale una vez', () => {
    expect(TABLA.length).toBe(12)
    for (const f of TABLA) expect(f.hoja, f.que).toMatch(/^6\d\d$/)
    const todas = TABLA.flatMap((f) => f.palabras.map(sinTildes))
    expect(new Set(todas).size).toBe(todas.length)
  })
  it.each([
    [['POLLO ENTERO 1,8KG', 'ALITAS DE POLLO CONGELADAS'], '600'],
    [['Hamburguesa de ternera 150 g', 'Pan brioche'], '600'],
    [['Término de potencia P1', 'Término de energía', 'Impuesto eléctrico'], '628'],
    [['Alquiler del local · noviembre'], '621'],
    [['Honorarios asesoría laboral y fiscal'], '623'],
    [['Reparación de la cámara frigorífica', 'Mano de obra', 'Desplazamiento'], '622'],
    [['Servilletas 30x30', 'Vasos de cartón 12 oz', 'Bolsas kraft'], '602'],
    [['Lejía 5 l', 'Desengrasante industrial'], '602'],
    [['Fibra 600 Mb y móvil'], '629'],
    [['Póliza de seguro multirriesgo'], '625'],
    [['Portes'], '624'],
  ])('%j → %s', (lineas, hoja) => {
    expect(porLoQueVende(lineas)?.hoja).toBe(hoja)
  })
  it('lo que no reconoce no se inventa: sin propuesta', () => {
    expect(porLoQueVende(['Concepto varios', 'Referencia 00123'])).toBeNull()
    expect(porLoQueVende([])).toBeNull()
  })
  it('una línea va a la primera fila que la reconoce: «Agua mineral» es bebida (600), «Consumo de agua» es suministro (628)', () => {
    expect(porLoQueVende(['Agua mineral 1,5 l'])?.hoja).toBe('600')
    expect(porLoQueVende(['Consumo de agua del periodo'])?.hoja).toBe('628')
  })
  it('gana la hoja con más líneas: dos de comida y unos portes, comida', () => {
    expect(porLoQueVende(['Portes', 'Queso rallado', 'Tomate triturado'])).toEqual({ hoja: '600', que: 'comida y bebida para la cocina', porque: null })
  })
  it('Julio, 21/11: el combustible que se almacena es 602, con su porqué en una línea; la 628, solo lo que no se almacena', () => {
    for (const l of ['Carbón vegetal 15 kg', 'Leña de encina', 'Briquetas de carbón', 'Pastillas de encendido', 'Bombona de butano 12,5 kg', 'Gas en bombona'])
      expect(porLoQueVende([l]), l).toEqual({ hoja: '602', que: 'combustible para la cocina', porque: 'Combustible para la cocina: 602' })
    for (const l of ['Término de potencia P1', 'Gas canalizado · noviembre', 'Gas natural', 'Consumo de agua del periodo'])
      expect(porLoQueVende([l])?.hoja, l).toBe('628')
  })
})

describe('la franja del proveedor que puso Sumied', () => {
  const solo = { que: 'alta' as const, supplierId: 'p1', deshecho: false }
  it('dado de alta: «Proveedor nuevo: lo ha dado de alta Sumied con lo que trae la factura», con «Deshacer»', () => {
    expect(franjaProveedorSolo({ aMano: false, solo, proveedorId: 'p1', nombre: 'Suministros Inventados, S.L.', validada: false }))
      .toEqual({ fuerte: 'Proveedor nuevo:', texto: 'lo ha dado de alta Sumied con lo que trae la factura.', deshacer: true })
  })
  it('validada, sin «Deshacer»; deshecha, con otro proveedor elegido o a mano, sin franja', () => {
    expect(franjaProveedorSolo({ aMano: false, solo, proveedorId: 'p1', nombre: null, validada: true })?.deshacer).toBe(false)
    expect(franjaProveedorSolo({ aMano: false, solo: { ...solo, deshecho: true }, proveedorId: 'p1', nombre: null, validada: false })).toBeNull()
    expect(franjaProveedorSolo({ aMano: false, solo, proveedorId: 'p2', nombre: null, validada: false })).toBeNull()
    expect(franjaProveedorSolo({ aMano: true, solo, proveedorId: 'p1', nombre: null, validada: false })).toBeNull()
  })
  it('la plataforma es acreedor: va a su ficha y a su 410', () => {
    expect(franjaProveedorSolo({ aMano: false, solo: { ...solo, que: 'plataforma' }, proveedorId: 'p1', nombre: 'Plataforma de Ejemplo', validada: false })?.texto)
      .toBe('Plataforma de Ejemplo es acreedor; la factura va a su ficha y a su 410.')
  })
  it('uno que ya estaba, o uno que no se pudo dar de alta, no lleva franja (el motivo va en «No conozco al que la emite»)', () => {
    expect(franjaProveedorSolo({ aMano: false, solo: { ...solo, que: 'existente' }, proveedorId: 'p1', nombre: null, validada: false })).toBeNull()
    expect(franjaProveedorSolo({ aMano: false, solo: { que: 'no', supplierId: null, deshecho: false }, proveedorId: '', nombre: null, validada: false })).toBeNull()
  })
})

describe('la cuenta propuesta, en ámbar con su porqué', () => {
  const propuesto = { cuenta: '60000000', porque: 'Propuesta: vende pollo y alitas → 600 Compras de mercaderías' }
  it('sin historia y con esa cuenta en la casilla: ámbar, y la franja pide mirarlo y pulsar Intro', () => {
    const c = gastoEnAmbar({ aMano: false, propuesto, aprendida: null, cuentaAhora: '60000000' })
    expect(c).toEqual({ id: 'gasto-propuesto', tono: 'ambar', texto: propuesto.porque })
    const e = estadoDeLaFicha({ aMano: false, leida: true, comprobaciones: [{ id: 'nif', tono: 'bien', texto: 'NIF correcto' }, c!], hayDudaGasto: false })
    expect(`${e.fuerte} ${e.resto}`).toBe('Rellenada por Sumied, con 1 duda. 1 comprobación bien · mira lo ámbar y pulsa Intro.')
  })
  it('la siguiente del mismo proveedor ya tiene historia: sin ámbar', () => {
    expect(gastoEnAmbar({ aMano: false, propuesto, aprendida: '60000000', cuentaAhora: '60000000' })).toBeNull()
  })
  it('si quien la mira cambia la cuenta, o no hay propuesta, sin ámbar', () => {
    expect(gastoEnAmbar({ aMano: false, propuesto, aprendida: null, cuentaAhora: '60200000' })).toBeNull()
    expect(gastoEnAmbar({ aMano: false, propuesto: { cuenta: null, porque: 'No sé qué te vende' }, aprendida: null, cuentaAhora: '' })).toBeNull()
  })
})
