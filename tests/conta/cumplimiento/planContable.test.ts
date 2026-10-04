// tests/conta/cumplimiento/planContable.test.ts
//
// C02 · Pruebas de carga de la serie del plan contable
// (scripts/conta/lib/planContable.mjs + supabase/conta/pgc/). Contra el texto
// REAL del BOE descargado por Actions, no contra ejemplos inventados (regla 31):
// los recuentos son los del cuadro, y los fallos se fabrican tocando una
// corrección real, que es lo que puede pasar de verdad (el BOE corrige una
// errata, alguien edita una cita, aparece una diferencia nueva).

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import correcciones from '../../../supabase/conta/pgc/correcciones.json'
import serie from '../../../supabase/conta/pgc/serie.json'
import {
  PLANES, choques, construirSerie, cuadro, hojas, rellenar, revisarCorreccion, quintaParte, textoVigente,
} from '../../../scripts/conta/lib/planContable.mjs'

type Plan = 'pymes' | 'general'
const texto = (plan: Plan) => readFileSync(`docs/conta/fuentes/textos/${PLANES[plan].fuente}.txt`, 'utf8')
const T = { pymes: texto('pymes'), general: texto('general') }
type Corr = (typeof correcciones.correcciones)[number]
const conCambio = (plan: Plan, code: string, cambio: (c: Corr) => Corr) => ({
  ...correcciones,
  correcciones: correcciones.correcciones.map((c) => (c.plan === plan && c.code === code ? cambio(structuredClone(c)) : c)),
})

describe('el cuadro del BOE, tal cual (antes de corregir)', () => {
  it.each([
    ['pymes', 772, 615, { 2: 62, 3: 347, 4: 353, 5: 10 }],
    ['general', 896, 712, { 2: 78, 3: 420, 4: 388, 5: 10 }],
  ] as const)('%s: %i códigos y %i hojas', (plan, total, nHojas, porDigitos) => {
    const c = cuadro(T[plan], plan).filter((x: { code: string }) => x.code.length > 1)
    expect(c).toHaveLength(total)
    const n: Record<number, number> = {}
    for (const x of c) n[x.code.length] = (n[x.code.length] ?? 0) + 1
    expect(n).toEqual(porDigitos)
    expect(hojas(new Set(c.map((x: { code: string }) => x.code)))).toHaveLength(nHojas)
  })

  it('pymes no tiene grupos 8 ni 9; el general sí', () => {
    expect(cuadro(T.pymes, 'pymes').some((x: { code: string }) => /^[89]/.test(x.code))).toBe(false)
    const g = cuadro(T.general, 'general').filter((x: { code: string }) => x.code.length === 1).map((x: { code: string }) => x.code)
    expect(g).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
  })

  it('las notas de la consolidación no se cuelan en el título', () => {
    const c = new Map(cuadro(T.general, 'general').map((x: { code: string; name: string }) => [x.code, x.name]))
    expect(c.get('199')).toBe('Acciones o participaciones emitidas consideradas como pasivos financieros pendientes de inscripción')
    expect(c.get('6993')).toBe('Pérdidas por deterioro de créditos a corto plazo, otras empresas')
  })

  it('un subgrupo en dos líneas es un solo título (24 de pymes)', () => {
    const c = new Map(cuadro(T.pymes, 'pymes').map((x: { code: string; name: string }) => [x.code, x.name]))
    expect(c.get('24')).toBe('INVERSIONES FINANCIERAS A LARGO PLAZO EN PARTES VINCULADAS')
  })
})

describe('la serie: cuadro + correcciones con cita (D1)', () => {
  it.each([
    ['pymes', 772, 615, 8],
    ['general', 897, 713, 10],
  ] as const)('%s: %i códigos, %i hojas, %i corregidas y ningún hallazgo', (plan, total, nHojas, nCorr) => {
    const { cuentas, hallazgos } = construirSerie(T[plan], plan, correcciones)
    expect(hallazgos).toEqual([])
    const sinGrupos = cuentas.filter((c: { code: string }) => c.code.length > 1)
    expect(sinGrupos).toHaveLength(total)
    expect(cuentas.filter((c: { hoja: boolean }) => c.hoja)).toHaveLength(nHojas)
    expect(cuentas.filter((c: { correccion: string | null }) => c.correccion)).toHaveLength(nCorr)
  })

  it('cada corrección tiene su cita en la versión vigente del texto descargado', () => {
    for (const c of correcciones.correcciones) {
      const bloque = textoVigente(T[c.plan as Plan], c.cita.bloque)
      expect(bloque, `${c.plan} ${c.code}`).not.toBeNull()
      for (const l of c.cita.literal) expect(bloque, `${c.plan} ${c.code}`).toContain(l)
    }
  })

  it('las erratas que motivaron D1 quedan corregidas', () => {
    const nombre = (plan: Plan, code: string) =>
      construirSerie(T[plan], plan, correcciones).cuentas.find((c: { code: string }) => c.code === code)?.name
    expect(nombre('pymes', '232')).toBe('Instalaciones técnicas en montaje')
    expect(nombre('pymes', '606')).toBe('Descuentos sobre compras por pronto pago')
    expect(nombre('general', '500')).toBe('Obligaciones y bonos a corto plazo')
    expect(nombre('general', '501')).toBe('Obligaciones y bonos convertibles a corto plazo')
    expect(nombre('general', '502')).toBe('Acciones o participaciones a corto plazo consideradas como pasivos financieros')
    expect(nombre('general', '74')).toBe('SUBVENCIONES, DONACIONES Y LEGADOS')
  })

  it('cero choques al rellenar las hojas, de 6 a 12 dígitos (D2, D3)', () => {
    for (const plan of ['pymes', 'general'] as const) {
      const h = construirSerie(T[plan], plan, correcciones).cuentas.filter((c: { hoja: boolean }) => c.hoja).map((c: { code: string }) => c.code)
      for (let d = 6; d <= 12; d++) expect(choques(h, d), `${plan} a ${d}`).toEqual([])
    }
  })

  it('rellenar TODOS los códigos sí chocaría: por eso a la empresa solo le llegan las hojas', () => {
    const todos = cuadro(T.pymes, 'pymes').filter((x: { code: string }) => x.code.length > 1).map((x: { code: string }) => x.code)
    expect(choques(todos, 8).length).toBeGreaterThan(0)
    expect(rellenar('4700', 8)).toBe('47000000')
  })

  it('toda cuenta de 2 o más dígitos tiene su padre en la serie', () => {
    for (const plan of ['pymes', 'general'] as const) {
      const { cuentas } = construirSerie(T[plan], plan, correcciones)
      const codigos = new Set(cuentas.map((c: { code: string }) => c.code))
      for (const c of cuentas) if (c.code.length > 1) expect(codigos.has(c.parent), `${plan} ${c.code}`).toBe(true)
    }
  })
})

describe('lo que el agente tiene que cazar', () => {
  it('una cita que ya no está en el texto', () => {
    const corr = conCambio('pymes', '232', (c) => ({ ...c, cita: { ...c.cita, literal: ['232.\nInstalaciones técnicas en montaje y algo más.'] } }))
    expect(construirSerie(T.pymes, 'pymes', corr).hallazgos.join('\n')).toMatch(/pymes 232: la cita ya no está/)
  })

  it('una corrección sin cita', () => {
    const corr = conCambio('pymes', '606', (c) => ({ ...c, cita: { ...c.cita, literal: [] } }))
    expect(construirSerie(T.pymes, 'pymes', corr).hallazgos).toContain('pymes 606: corrección sin cita. Nada se corrige sin cita.')
  })

  it('el BOE corrige la errata: la corrección sobra', () => {
    const corregido = T.pymes.replace('232.\nPropiedad industrial.', '232.\nInstalaciones técnicas en montaje.')
    expect(corregido).not.toBe(T.pymes)
    expect(construirSerie(corregido, 'pymes', correcciones).hallazgos.join('\n')).toMatch(/pymes 232: el cuadro ya dice «Instalaciones técnicas en montaje»: el BOE ha corregido la errata y esta corrección sobra/)
  })

  it('una diferencia nueva entre el cuadro y la quinta parte, sin corregir ni aceptar', () => {
    const sin = { ...correcciones, correcciones: correcciones.correcciones.filter((c) => !(c.plan === 'general' && c.code === '546')) }
    expect(construirSerie(T.general, 'general', sin).hallazgos.join('\n')).toMatch(/general 546: el cuadro dice .* No está ni corregida ni aceptada/)
  })

  it('una errata que en realidad es otro título (más de 3 caracteres)', () => {
    const corr = conCambio('pymes', '664', (c) => ({ ...c, tituloCorrecto: 'Dividendos de acciones o participaciones consideradas como pasivos financieros' }))
    expect(construirSerie(T.pymes, 'pymes', corr).hallazgos.join('\n')).toMatch(/pymes 664: entre el cuadro y la corrección hay más de 3 caracteres/)
  })

  it('«dos testigos» con un solo testigo no vale', () => {
    const corr = conCambio('general', '546', (c) => ({ ...c, cita: { ...c.cita, literal: [c.cita.literal[0]] } }))
    expect(revisarCorreccion(corr.correcciones.find((c) => c.plan === 'general' && c.code === '546')!, {
      cuadroPorCodigo: new Map(cuadro(T.general, 'general').map((x: { code: string }) => [x.code, x])),
      quinta: quintaParte(T.general, 'general'),
      textoBloque: (id: string) => textoVigente(T.general, id),
    })).toEqual(['general 546: la lista y la definición de la quinta parte no dicen las dos «Intereses a corto plazo de valores representativos de deuda».'])
  })
})

describe('serie.json (lo que se carga) es lo que sale del BOE', () => {
  it('mismos recuentos que la serie construida aquí', () => {
    expect(serie.resumen.pymes.codigosSinGrupos).toBe(772)
    expect(serie.resumen.general.codigosSinGrupos).toBe(897)
    expect(serie.resumen.pymes.hojas).toBe(615)
    expect(serie.resumen.general.hojas).toBe(713)
    expect(serie.cuentas).toHaveLength(779 + 906)
  })

  it('el RD 1/2021 no toca el cuadro de pymes (artículo segundo, comprobado en el propio RD)', () => {
    expect(serie.rd_1_2021_pymes).toMatch(/^RD 1\/2021, artículo segundo: 4 puntos .* ninguno toca la cuarta parte/)
  })

  it('«qué se apunta aquí» solo donde Folvy lo ha escrito; nunca un texto de reserva', () => {
    const conTexto = serie.cuentas.filter((c) => c.plain_name !== null)
    expect(conTexto.length).toBeGreaterThan(50)
    expect(new Set(conTexto.map((c) => c.plain_name)).size).toBeGreaterThan(50)
    expect(serie.cuentas.find((c) => c.plan === 'pymes' && c.code === '621')?.plain_name).toMatch(/alquiler del local/)
  })
})
