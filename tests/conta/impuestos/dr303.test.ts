// I01a · 5 · El fichero del 303 (DR303e26v101), contra el diseño de registro.
//
// La empresa es INVENTADA (NIF B00000000, razón social de prueba, cuenta ES
// con ceros): nada real en el repositorio. Las posiciones que se comprueban
// a mano salen del Excel oficial (página 01: [04] en la 287 y su tipo en la
// 304; [46] en la 1019; página 03: [71] en la 408), para que la prueba no sea
// un espejo del generador (regla 31).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { alfanumerico, comprobar303, FicheroNoVale, generar303, importe, type Datos303 } from '../../../supabase/functions/_shared/impuestos/dr303'
import { DR303E26V101 } from '../../../supabase/functions/_shared/impuestos/dr303e26v101'
// @ts-expect-error: el script es .mjs sin tipos
import { moduloTs, REFERENCIA, MODULO } from '../../../scripts/conta/i01/dr303.mjs'

const IBAN = 'ES0000000000000000000000'
const base = (o: Partial<Datos303> = {}): Datos303 => ({
  ejercicio: 2026, periodo: '3T', nif: 'B00000000', nombre: 'Empresa de Prueba, S.L.', tipo: 'U', redeme: false, sii: false,
  iban: IBAN, programa: { version: '0001', nifDesarrollo: 'B11111111' },
  // 1.000,00 al 10 % (100,00 de cuota) y 500,00 de compras con 50,00 de IVA.
  casillas: { '04': 1000, '06': 100, '27': 100, '28': 500, '29': 50, '45': 50, '46': 50, '64': 50, '65': 100, '66': 50, '69': 50, '71': 50 },
  ...o,
})
const p01 = (f: string) => f.slice(f.indexOf('<T30301000>'), f.indexOf('</T30301000>') + 12)
const p03 = (f: string) => f.slice(f.indexOf('<T30303000>'), f.indexOf('</T30303000>') + 12)
const en = (pag: string, pos: number, lon: number) => pag.slice(pos - 1, pos - 1 + lon)

describe('el diseño, sacado del Excel oficial', () => {
  it('cada hoja: los campos seguidos, sin huecos, y la última posición es su TOTAL', () => {
    for (const [nombre, hoja] of Object.entries(DR303E26V101.hojas)) {
      if (nombre === 'DP30300') continue // la cabecera lleva un campo de longitud variable
      const c = hoja.campos
      for (let i = 1; i < c.length; i++) expect(c[i].pos, `${nombre} ${c[i].n}`).toBe((c[i - 1].pos as number) + (c[i - 1].lon as number))
      const ult = c[c.length - 1]
      expect((ult.pos as number) + (ult.lon as number) - 1).toBe(hoja.total)
    }
    expect([DR303E26V101.hojas.DP30301.total, DR303E26V101.hojas.DP30303.total, DR303E26V101.hojas.DP303DID.total]).toEqual([1581, 1017, 823])
  })

  it('el módulo es el que sale de la referencia (scripts/conta/i01/dr303.mjs comprobar)', () => {
    expect(readFileSync(MODULO, 'utf8')).toBe(moduloTs(JSON.parse(readFileSync(REFERENCIA, 'utf8'))))
  })
})

describe('generar303: un 3T de régimen general, a domiciliar', () => {
  const f = generar303(base())

  it('mide lo que dice el diseño: cabecera (328) + 01 (1581) + 03 (1017) + DID (823) + cierre (18)', () => {
    expect(f.length).toBe(328 + 1581 + 1017 + 823 + 18)
    expect(f.startsWith('<T303020263T0000><AUX>')).toBe(true)
    expect(f.endsWith('</T303020263T0000>')).toBe(true)
    expect(f).not.toMatch(/[\r\n\t]/)
  })

  it('las casillas en su sitio, con el formato del diseño', () => {
    const a = p01(f)
    expect(a.length).toBe(1581)
    expect(en(a, 13, 1)).toBe('U')
    expect(en(a, 14, 9)).toBe('B00000000')
    expect(en(a, 23, 80).trimEnd()).toBe('EMPRESA DE PRUEBA S L')
    expect(en(a, 103, 4) + en(a, 107, 2)).toBe('20263T')
    expect(en(a, 111, 1)).toBe('3') // solo régimen general
    expect(en(a, 287, 17)).toBe('00000000000100000') // [04] 1.000,00
    expect(en(a, 304, 5)).toBe('01000') // [05] 10 %
    expect(en(a, 309, 17)).toBe('00000000000010000') // [06] 100,00
    expect(en(a, 1019, 17)).toBe('00000000000005000') // [46] 50,00
    expect(en(p03(f), 216, 5)).toBe('10000') // [65] 100 %
    expect(en(p03(f), 408, 17)).toBe('00000000000005000') // [71] 50,00
    expect(f).toContain(`<T303DID00>${' '.repeat(11)}${IBAN}`)
  })

  it('releído contra el diseño: vale, y salen las mismas casillas', () => {
    const r = comprobar303(f, base())
    expect(r.fallos).toEqual([])
    expect(r.casillas).toMatchObject({ '04': 1000, '06': 100, '27': 100, '29': 50, '45': 50, '46': 50, '66': 50, '71': 50 })
  })
})

describe('generar303: los otros resultados', () => {
  it('a compensar (1T): «C», y los negativos con N delante', () => {
    const f = generar303(base({ periodo: '1T', tipo: 'C', iban: null, casillas: { '04': 100, '06': 10, '27': 10, '28': 500, '29': 50, '45': 50, '46': -40, '64': -40, '65': 100, '66': -40, '69': -40, '71': -40 } }))
    expect(en(p01(f), 1019, 17)).toBe('N0000000000004000')
    expect(comprobar303(f).ok).toBe(true)
  })

  it('cero: «N»', () => {
    const f = generar303(base({ tipo: 'N', iban: null, casillas: { '65': 100 } }))
    expect(en(p01(f), 13, 1)).toBe('N')
    expect(comprobar303(f).ok).toBe(true)
  })
})

describe('generar303: lo que no sale, con su porqué', () => {
  const fallos = (d: Datos303) => { try { generar303(d); return [] } catch (e) { if (e instanceof FicheroNoVale) return e.fallos; throw e } }

  it('el tipo de declaración no casa con el resultado', () => {
    expect(fallos(base({ tipo: 'C' }))).toContain('Sale a ingresar (50.00) y el tipo de declaración es «C».')
  })
  it('una suma que no cuadra se dice con la casilla', () => {
    expect(fallos(base({ casillas: { ...base().casillas, '27': 99 } }))).toContain('La casilla [27] dice 99.00 y la suma del IVA devengado da 100.00.')
  })
  it('para domiciliar hace falta la cuenta', () => {
    expect(fallos(base({ iban: null }))).toEqual(['Para domiciliar hace falta la cuenta (IBAN español).'])
  })
  it('el diseño es de 2026 en adelante', () => {
    expect(fallos(base({ ejercicio: 2025 }))[0]).toBe('Este diseño de registro es para el ejercicio 2026 en adelante, no para 2025.')
  })
  it('un fichero tocado no pasa la comprobación', () => {
    const f = generar303(base())
    const roto = f.replace('<T30303000>', '<T30303001>')
    expect(comprobar303(roto).ok).toBe(false)
    const corto = f.replace(IBAN, IBAN.slice(1))
    expect(comprobar303(corto).fallos.some((x) => /DP303DID: mide/.test(x))).toBe(true)
  })
})

describe('el formato de cada campo', () => {
  it('alfanumérico: mayúsculas, sin acentos ni signos, la Ñ se queda', () => {
    expect(alfanumerico('Panadería Ñandú, S.L. — «la buena»', 30)).toBe('PANADERIA ÑANDU S L LA BUENA  ')
  })
  it('importes: céntimos, ceros a la izquierda y N si es negativo; sin signo no admite negativos', () => {
    expect(importe(1234.5, 17, false)).toBe('00000000000123450')
    expect(importe(-0.01, 17, true)).toBe('N0000000000000001')
    expect(() => importe(-1, 17, false)).toThrow(FicheroNoVale)
  })
})
