// tests/unit/ci/datosPersonales.test.ts
//
// W12 · Regla T11: el comprobador de datos personales (scripts/ci/datos-personales.mjs).
// Los datos «que parecen reales» se CALCULAN aquí (cifras al azar fijas + su
// letra o su control): así este fichero no lleva ninguno escrito, y el propio
// comprobador no lo para.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buscar, dniValido, ibanValido, inventadoALaVista, leerLista, lineasAnadidas, mensaje, nafValido, LISTA,
} from '../../../scripts/ci/datos-personales.mjs'

const LETRAS = 'TRWAGMYFPDXBNJZSQVHLCKE'
const dni = (n: string) => `${n}${LETRAS[Number(n) % 23]}`
const nie = (p: 'X' | 'Y' | 'Z', n: string) => `${p}${n}${LETRAS[Number(`${'XYZ'.indexOf(p)}${n}`) % 23]}`
function iban(ccc: string) {
  const s = `${ccc}142800`
  let r = 0
  for (const c of s) r = (r * 10 + Number(c)) % 97
  return `ES${String(98 - r).padStart(2, '0')}${ccc}`
}
const naf = (prov: string, num: string) => {
  const p = Number(prov), n = Number(num)
  const base = n < 10_000_000 ? p * 10_000_000 + n : p * 100_000_000 + n
  return `${prov}${num}${String(base % 97).padStart(2, '0')}`
}

describe('regla T11 · los dígitos de control', () => {
  it('DNI, NIE, IBAN y NAF que pasan su control', () => {
    const d = dni('48151623')
    expect(dniValido(d.slice(0, 8), d[8])).toBe(true)
    expect(dniValido(d.slice(0, 8), d[8] === 'A' ? 'B' : 'A')).toBe(false)
    expect(ibanValido(iban('21007314958264019375'))).toBe(true)
    expect(ibanValido(iban('21007314958264019375').replace(/5$/, '6'))).toBe(false)
    expect(nafValido(naf('28', '51749362'))).toBe(true)
  })
})

describe('regla T11 · lo que para y lo que deja pasar', () => {
  it('para un DNI, un NIE y un IBAN que parecen reales, con su línea', () => {
    const t = `una línea\nproveedor: { nif: '${dni('48151623')}' }\nrider ${nie('Z', '3519274')} y cuenta ${iban('21007314958264019375')}`
    const h = buscar(t)
    expect(h.map((x) => [x.tipo, x.linea])).toEqual([['DNI', 2], ['NIE', 3], ['IBAN', 3]])
  })
  it('un NAF solo si la línea habla de la Seguridad Social (12 cifras sueltas son cualquier cosa)', () => {
    expect(buscar(`naf: ${naf('28', '51749362')}`).map((x) => x.tipo)).toEqual(['NAF'])
    expect(buscar(`importe ${naf('28', '51749362')}`)).toEqual([])
  })
  it('deja pasar lo inventado a la vista: todo ceros, cifras repetidas, escaleras, el banco 9999', () => {
    const t = [dni('00000000'), dni('12345678'), dni('22222222'), nie('X', '0000002'), nie('Y', '1234567'),
      iban('99990001510200012345'), iban('00491500051234567892'), iban('01829103210000000013')].join(' ')
    expect(buscar(t)).toEqual([])
    expect(inventadoALaVista('DNI', dni('48151623'))).toBe(false)
  })
  it('una cuenta contable seguida de «y» no es un DNI (los tres falsos positivos del informe)', () => {
    expect(buscar('las cuentas 70000000 y 40700001 y 43000001 y las demás')).toEqual([])
  })
  it('lo de la lista de inventados pasa; la lista ignora sus comentarios', () => {
    const v = dni('48151623')
    expect(buscar(`nif ${v}`, leerLista(`# cabecera\n${v}   # inventado de una prueba\n`))).toEqual([])
    const lista = leerLista(readFileSync(LISTA, 'utf8'))
    expect(lista.size).toBeGreaterThan(0)
    for (const x of lista) expect(x).toMatch(/^[0-9A-Z]+$/)
  })
  it('el mensaje dice qué ha pasado, dónde y qué hacer', () => {
    const [h] = buscar(`nif ${dni('48151623')}`)
    const m = mensaje(h, '`tests/fixtures/x.json`, línea 12')
    expect(m).toContain('Hay un DNI que parece real')
    expect(m).toContain('`tests/fixtures/x.json`, línea 12')
    expect(m).toContain('Qué hacer: cámbialo por uno inventado')
    expect(m).toContain(LISTA)
  })
})

describe('regla T11 · solo lo que añade el PR', () => {
  it('las líneas añadidas, con su fichero y su número de línea', () => {
    const diff = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1,0 +5,2 @@', '+uno', '+dos', '@@ -9 +12 @@', '-viejo', '+tres'].join('\n')
    expect(lineasAnadidas(diff)).toEqual([
      { fichero: 'x', linea: 5, texto: 'uno' }, { fichero: 'x', linea: 6, texto: 'dos' }, { fichero: 'x', linea: 12, texto: 'tres' },
    ])
  })
})
