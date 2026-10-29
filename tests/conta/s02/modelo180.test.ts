// S02 · El fichero del 180, contra el diseño del anexo VI del BOE.
//
// La empresa, los arrendadores y el inmueble son INVENTADOS (NIF con su
// control bien hecho, nombres de prueba): nada real en el repositorio. Las
// posiciones que se miran a mano salen del texto del anexo VI vigente (el que
// también guarda docs/conta/fuentes/textos/orden-modelo-180.txt en prosa):
// registro 1, «BASE … (posiciones 146 a 160)» y «RETENCIONES … 161-175»;
// registro 2, «80-92 IMPORTE», «93-94 ENTERO», «95-96 DECIMAL», «135-139 TIPO
// DE VÍA», «321-322 CÓDIGO PROVINCIA», «323-327 CÓDIGO POSTAL». Así la prueba
// no es un espejo del generador (regla 31).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { comprobar180, FicheroNoVale, generar180, provinciasDelAnexo, SALTO, type Datos180, type Perceptor180 } from '../../../supabase/functions/_shared/impuestos/modelo180'
import { DR180 } from '../../../supabase/functions/_shared/impuestos/dr180'
// @ts-expect-error: el script es .mjs sin tipos
import { leer, moduloTs, REFERENCIA, MODULO, FUENTE } from '../../../scripts/conta/s02/dr180.mjs'

const inmueble: Perceptor180['inmueble'] = {
  situacion: '1', catastral: '0000000AA0000A0001AA', tipoVia: 'CL', nombreVia: 'Calle de Prueba', numero: '12',
  municipio: 'Madrid', codigoMunicipio: '28079', provincia: '28', cp: '28001',
}
const base = (o: Partial<Datos180> = {}): Datos180 => ({
  ejercicio: 2025,
  nif: 'B00000000',
  nombre: 'Empresa de Prueba, S.L.',
  contacto: { telefono: '600 000 000', nombre: 'Prueba Prueba, Persona' },
  numero: '1800000000001',
  perceptores: [
    { nif: 'E00000000', nombre: 'Comunidad de Prueba, C.B.', provincia: '28', base: 10389.04, porcentaje: 19, retenciones: 1973.92, inmueble },
    { nif: '00000000T', nombre: 'Uno Uno, Ana', provincia: '08', base: 2500, porcentaje: 19, retenciones: 475, inmueble: { ...inmueble, situacion: '4', catastral: null, numero: null } },
  ],
  ...o,
})
const regs = (f: string) => f.slice(0, -2).split(SALTO)
const en = (r: string, desde: number, hasta: number) => r.slice(desde - 1, hasta)

describe('el diseño, sacado del anexo VI del BOE', () => {
  it('el JSON y el módulo son los que salen del bloque guardado (scripts/conta/s02/dr180.mjs comprobar)', () => {
    const ref = leer(readFileSync(FUENTE, 'utf8'))
    expect(readFileSync(REFERENCIA, 'utf8')).toBe(JSON.stringify(ref, null, 2) + '\n')
    expect(readFileSync(MODULO, 'utf8')).toBe(moduloTs(ref))
  })
  it('500 posiciones, los dos registros enteros; la versión de 2023', () => {
    expect(DR180.longitud).toBe(500)
    expect(DR180.boe).toBe('BOE-A-2023-24412')
    for (const t of ['1', '2'] as const) {
      const cubre = DR180.registros[t].reduce((s, c) => s + c.lon, 0)
      expect(cubre).toBe(500)
    }
  })
  it('las provincias del anexo VI: 01-53, sin el 98 del 190', () => {
    const p = provinciasDelAnexo()
    expect(p.size).toBe(53)
    expect(p.has('23')).toBe(true)
    expect(p.has('98')).toBe(false)
  })
})

describe('generar180: un año con dos arrendadores', () => {
  const f = generar180(base())
  const [r1, a, b] = regs(f)

  it('tres registros de 500, cada uno con su CRLF', () => {
    expect(f.length).toBe(3 * 502)
  })
  it('registro 1: totales en su sitio y el sello en blanco', () => {
    expect(en(r1, 1, 8)).toBe('11802025')
    expect(en(r1, 9, 17)).toBe('B00000000')
    expect(en(r1, 58, 58)).toBe('T')
    expect(en(r1, 108, 120)).toBe('1800000000001')
    expect(en(r1, 136, 144)).toBe('000000002')
    expect(en(r1, 145, 145)).toBe(' ')
    expect(en(r1, 146, 160)).toBe('000000001288904') // 12.889,04
    expect(en(r1, 161, 175)).toBe('000000000244892') // 2.448,92
    expect(en(r1, 176, 500).trim()).toBe('')
  })
  it('registro 2: base, porcentaje, retención, situación, catastral y dirección', () => {
    expect(en(a, 18, 26)).toBe('E00000000')
    expect(en(a, 76, 77)).toBe('28')
    expect(en(a, 78, 78)).toBe('1')
    expect(en(a, 79, 79)).toBe(' ')
    expect(en(a, 80, 92)).toBe('0000001038904')
    expect(en(a, 93, 96)).toBe('1900')
    expect(en(a, 97, 109)).toBe('0000000197392')
    expect(en(a, 110, 113)).toBe('0000')
    expect(en(a, 114, 114)).toBe('1')
    expect(en(a, 115, 134)).toBe('0000000AA0000A0001AA')
    expect(en(a, 135, 139)).toBe('CL   ')
    expect(en(a, 140, 189).trimEnd()).toBe('CALLE DE PRUEBA')
    expect(en(a, 190, 192)).toBe('NUM')
    expect(en(a, 193, 197)).toBe('12   ')
    expect(en(a, 286, 315).trimEnd()).toBe('MADRID')
    expect(en(a, 316, 320)).toBe('28079')
    expect(en(a, 321, 322)).toBe('28')
    expect(en(a, 323, 327)).toBe('28001')
    expect(en(a, 328, 500).trim()).toBe('')
  })
  it('sin referencia catastral: situación 4, catastral en blanco y «S/N» sin número', () => {
    expect(en(b, 114, 114)).toBe('4')
    expect(en(b, 115, 134)).toBe(' '.repeat(20))
    expect(en(b, 190, 192)).toBe('S/N')
  })
  it('la comprobación lo relee y suma lo mismo', () => {
    expect(comprobar180(f, { ejercicio: 2025, nif: 'B00000000' })).toEqual({ ok: true, fallos: [], registros: 2, perceptores: 2, base: 12889.04, retenciones: 2448.92 })
  })
  it('un arrendador con dos inmuebles cuenta una vez en el total de perceptores', () => {
    const d = base()
    d.perceptores.push({ ...d.perceptores[0], base: 100, retenciones: 19 })
    expect(en(regs(generar180(d))[0], 136, 144)).toBe('000000002')
  })
})

describe('lo que no deja', () => {
  const fallos = (d: Datos180) => { try { generar180(d); return [] } catch (e) { return (e as FicheroNoVale).fallos } }
  it('situación 1 sin referencia catastral, sin calle y sin código postal', () => {
    const d = base({ perceptores: [{ ...base().perceptores[0], inmueble: { ...inmueble, catastral: '', nombreVia: '', cp: '280' } }] })
    const t = fallos(d).join(' ')
    expect(t).toMatch(/referencia catastral tiene 20/)
    expect(t).toMatch(/falta la calle/)
    expect(t).toMatch(/código postal del inmueble/)
  })
  it('un año anterior al diseño y un número que no empieza por 180', () => {
    expect(fallos(base({ ejercicio: 2022 })).join(' ')).toMatch(/2023 en adelante/)
    expect(fallos(base({ numero: '1900000000001' })).join(' ')).toMatch(/empieza por 180/)
  })
  it('la comprobación caza un total que no suma y un sello escrito', () => {
    const [r1, ...resto] = regs(generar180(base()))
    const malo = r1.slice(0, 145) + '000000001288905' + r1.slice(160)
    expect(comprobar180([malo, ...resto].map((r) => r + SALTO).join('')).fallos.join(' ')).toMatch(/de base y los perceptores suman/)
    const sello = r1.slice(0, 490) + 'X' + r1.slice(491)
    expect(comprobar180([sello, ...resto].map((r) => r + SALTO).join('')).fallos.join(' ')).toMatch(/sello electrónico/)
  })
})
