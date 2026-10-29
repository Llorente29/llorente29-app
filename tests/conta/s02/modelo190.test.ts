// S02 · El fichero del 190, contra el diseño del anexo del BOE.
//
// La empresa y los perceptores son INVENTADOS (NIF con su control bien hecho,
// nombres de prueba): nada real en el repositorio. Las posiciones que se
// miran a mano salen del texto del anexo (orden-modelo-190.txt, «## [an]»):
// registro 1, total de percepciones en 136-144, importe en 146-160 y
// retenciones en 161-175; registro 2, NIF del perceptor en 18-26, provincia en
// 76-77, clave en 78, íntegra en 82-94 y retenciones en 95-107. Así la prueba
// no es un espejo del generador (regla 31).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  alfanumerico, comprobar190, FicheroNoVale, generar190, nif, nifValido, provinciasDelAnexo, SALTO, type Datos190,
} from '../../../supabase/functions/_shared/impuestos/modelo190'
import { DR190 } from '../../../supabase/functions/_shared/impuestos/dr190'
// @ts-expect-error: el script es .mjs sin tipos
import { leer, moduloTs, REFERENCIA, MODULO, TEXTO } from '../../../scripts/conta/s02/dr190.mjs'

const base = (o: Partial<Datos190> = {}): Datos190 => ({
  ejercicio: 2026,
  nif: 'B00000000', // control 0: válido
  nombre: 'Empresa de Prueba, S.L.',
  contacto: { telefono: '600 000 000', nombre: 'Prueba Prueba, Persona', correo: 'prueba@example.com' },
  numero: '1900000000001',
  perceptores: [
    { nif: '00000000T', nombre: 'Uno Uno, Ana', provincia: '28', clave: 'A', integra: 20000, retenciones: 2400.5, anioNacimiento: 1990, gastos: 1270.25 },
    { nif: '00000001R', nombre: 'Dos Dos, Íñigo', provincia: '08', clave: 'G', subclave: '01', integra: 1000, retenciones: 150 },
  ],
  ...o,
})
const regs = (f: string) => f.slice(0, -2).split(SALTO)
const en = (r: string, desde: number, hasta: number) => r.slice(desde - 1, hasta)

describe('el diseño, sacado del anexo del BOE', () => {
  it('el JSON y el módulo son los que salen del texto (scripts/conta/s02/dr190.mjs comprobar)', () => {
    const ref = leer(readFileSync(TEXTO, 'utf8'))
    expect(readFileSync(REFERENCIA, 'utf8')).toBe(JSON.stringify(ref, null, 2) + '\n')
    expect(readFileSync(MODULO, 'utf8')).toBe(moduloTs(ref))
  })

  it('500 posiciones; el registro 1 entero descrito y en el 2 solo falta 323-387', () => {
    expect(DR190.longitud).toBe(500)
    expect(DR190.sinDescribir['1']).toEqual([])
    expect(DR190.sinDescribir['2']).toEqual([{ desde: 323, hasta: 387 }])
  })

  it('las provincias salen del anexo: 01-53 y 98; Jaén, de la versión de 2022 (la vigente la perdió)', () => {
    expect(DR190.provincias.find((x) => x.codigo === '23')?.fuente).toMatch(/2022-12-20 · BOE-A-2022-21459/)
    expect(DR190.provincias.filter((x) => !x.fuente.startsWith('versión · vigente desde 2025-12-13')).map((x) => x.codigo)).toEqual(['23'])
    const p = provinciasDelAnexo()
    expect(p.has('28')).toBe(true)
    expect(p.has('53')).toBe(true)
    expect(p.has('98')).toBe(true)
    expect(p.has('54')).toBe(false)
    expect(p.size).toBe(54)
  })
})

describe('formato', () => {
  it('alfanumérico: mayúsculas, sin acentos ni signos; la Ñ se queda', () => {
    expect(alfanumerico('Dos Dos, Íñigo', 20)).toBe('DOS DOS IÑIGO       ')
  })
  it('NIF ajustado a la derecha con ceros', () => {
    expect(nif('1234567L')).toBe('01234567L')
  })
  it('NIF: control de DNI, NIE y entidad', () => {
    expect(nifValido('00000000T')).toBe(true)
    expect(nifValido('00000000A')).toBe(false)
    expect(nifValido('X0000000T')).toBe(true)
    expect(nifValido('B00000000')).toBe(true)
    expect(nifValido('B00000001')).toBe(false)
  })
})

describe('generar190: un año con un empleado y un profesional', () => {
  const f = generar190(base())
  const [r1, a, g] = regs(f)

  it('tres registros de 500, cada uno con su CRLF', () => {
    expect(f.length).toBe(3 * 502)
    expect(regs(f).map((r) => r.length)).toEqual([500, 500, 500])
  })

  it('registro 1: identificación y totales en su sitio', () => {
    expect(en(r1, 1, 8)).toBe('11902026')
    expect(en(r1, 9, 17)).toBe('B00000000')
    expect(en(r1, 18, 57).trimEnd()).toBe('EMPRESA DE PRUEBA S L')
    expect(en(r1, 58, 58)).toBe('T')
    expect(en(r1, 59, 67)).toBe('600000000')
    expect(en(r1, 108, 120)).toBe('1900000000001')
    expect(en(r1, 136, 144)).toBe('000000002')
    expect(en(r1, 145, 145)).toBe(' ')
    expect(en(r1, 146, 160)).toBe('000000002100000') // 21.000,00
    expect(en(r1, 161, 175)).toBe('000000000255050') // 2.550,50
    expect(en(r1, 488, 500)).toBe(' '.repeat(13))
  })

  it('registro 2 del empleado: clave A, sin subclave, año de nacimiento y contrato', () => {
    expect(en(a, 18, 26)).toBe('00000000T')
    expect(en(a, 27, 35)).toBe(' '.repeat(9))
    expect(en(a, 76, 77)).toBe('28')
    expect(en(a, 78, 80)).toBe('A00')
    expect(en(a, 82, 94)).toBe('0000002000000')
    expect(en(a, 95, 107)).toBe('0000000240050')
    expect(en(a, 109, 121)).toBe('0'.repeat(13)) // sin especie
    expect(en(a, 153, 156)).toBe('1990')
    expect(en(a, 157, 157)).toBe('3')
    expect(en(a, 168, 168)).toBe('1')
    expect(en(a, 184, 196)).toBe('0000000127025') // gastos deducibles: 1.270,25
    expect(en(a, 323, 387)).toBe(' '.repeat(65))
    expect(en(a, 395, 500)).toBe(' '.repeat(106))
  })

  it('registro 2 del profesional: clave G subclave 01, sin datos de la clave A', () => {
    expect(en(g, 36, 75).trimEnd()).toBe('DOS DOS IÑIGO')
    expect(en(g, 78, 80)).toBe('G01')
    expect(en(g, 153, 156)).toBe('0000')
    expect(en(g, 168, 168)).toBe('0')
    expect(en(g, 184, 196)).toBe('0'.repeat(13))
  })

  it('la comprobación lo relee y suma lo mismo', () => {
    const c = comprobar190(f, { ejercicio: 2026, nif: 'B00000000' })
    expect(c).toEqual({ ok: true, fallos: [], perceptores: 2, integra: 21000, retenciones: 2550.5 })
  })
})

describe('lo que no deja', () => {
  const fallos = (d: Datos190) => { try { generar190(d); return [] } catch (e) { return (e as FicheroNoVale).fallos } }

  it('un NIF mal, una provincia que no existe y una clave G sin subclave', () => {
    const d = base({ perceptores: [{ nif: '00000000A', nombre: 'Uno', provincia: '99', clave: 'G', integra: 1, retenciones: 0 }] })
    const f = fallos(d)
    expect(f.join(' ')).toMatch(/NIF.*no es válido/)
    expect(f.join(' ')).toMatch(/provincia «99»/)
    expect(f.join(' ')).toMatch(/subclave/)
  })

  it('un empleado sin año de nacimiento', () => {
    const d = base({ perceptores: [{ nif: '00000000T', nombre: 'Uno', provincia: '28', clave: 'A', integra: 1, retenciones: 0 }] })
    expect(fallos(d).join(' ')).toMatch(/año de nacimiento/)
  })

  it('un año anterior al diseño, y un 190 sin perceptores', () => {
    expect(fallos(base({ ejercicio: 2024 })).join(' ')).toMatch(/2025 en adelante/)
    expect(fallos(base({ perceptores: [] })).join(' ')).toMatch(/sin percepciones/)
  })

  it('la comprobación caza un total que no suma', () => {
    const f = generar190(base())
    const [r1, ...resto] = regs(f)
    const malo = r1.slice(0, 145) + '000000002100001' + r1.slice(160)
    const c = comprobar190([malo, ...resto].map((r) => r + SALTO).join(''))
    expect(c.ok).toBe(false)
    expect(c.fallos.join(' ')).toMatch(/percepciones y los perceptores suman/)
  })

  it('la comprobación caza algo escrito en 323-387', () => {
    const f = generar190(base())
    const [r1, a, g] = regs(f)
    const malo = a.slice(0, 322) + 'X' + a.slice(323)
    expect(comprobar190([r1, malo, g].map((r) => r + SALTO).join('')).fallos.join(' ')).toMatch(/323-387/)
  })
})
