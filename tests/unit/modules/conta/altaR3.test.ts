// El alta, segunda vuelta (respuesta 3 del C00): «Lo que llevamos», volver a
// un punto, lo que escribe la persona, lo que dice la IA y el IVA de las
// ventas. Contra la población real (regla 31): el catálogo del IAE y la CNAE
// de la migración de valores de serie y las preguntas reales del guion.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  PASOS, preguntaActual, todasLasPreguntas, type ClavePregunta, type ContextoAlta, type PasoAlta, type Pregunta,
} from '@/modules/conta/alta/guion'
import {
  PUNTOS, TOTAL_PUNTOS, cuantosHechos, hechosDeUnaAMedias, loQueLlevamos, puntoQuePide, respuestasParaVolver, sePuedeVolver,
} from '@/modules/conta/alta/llevamos'
import { entender } from '@/modules/conta/alta/entender'
import {
  enTexto, fraseActividades, fraseCuentas, fraseDireccion, fraseModelos, fraseNombre, frasePeriodo,
} from '@/modules/conta/alta/frases'
import { esHosteleria, ivaDeVentas } from '@/modules/conta/lib/ivaVentas'
import { gruposDe, normalizar, proponer, type Encontrado } from '@/modules/conta/alta/actividades'

const sql = readFileSync('supabase/migrations/20261003T0130_c00_valores_de_serie.sql', 'utf8')
const bloque = (tabla: string) => { const i = sql.indexOf(`insert into public.${tabla}`); return sql.slice(i, sql.indexOf(';\n', i)) }
const IAE = [...bloque('iae_heading').matchAll(/\('([0-9_]+)', '([123])', '([a-z]+)', '((?:[^']|'')*)'/g)]
  .map(([, code, section, level, title]) => ({ code, section, level, title }))
const CNAE = [...bloque('cnae_code').matchAll(/\('2025', '([0-9A-Z]+)', (\d), '((?:[^']|'')*)'/g)]
  .map(([, code, level, title]) => ({ code, level: Number(level), title }))

const CUENTA = { nombre: 'Taberna', razonSocial: 'Taberna de Prueba Norte, S.L.', nif: 'B28000016',
  direccion: { calle: 'Calle de la Prueba 12', codigoPostal: '28001', poblacion: 'Madrid', provincia: 'Madrid' } }
const ctx = (c: Partial<ContextoAlta> = {}): ContextoAlta => ({
  cuenta: CUENTA, tipo: 'company', cp: '28001', clases: ['business'], respuestas: {}, hoy: '2026-10-03', ...c,
})
/** Todas las preguntas reales del guion, en la península y en Canarias, con y sin datos en la cuenta. */
const TODAS: Pregunta[] = [ctx(), ctx({ cp: '35001' }), ctx({ cuenta: { nombre: null, razonSocial: null, nif: null, direccion: null } })]
  .flatMap((c) => PASOS.flatMap((p) => todasLasPreguntas(p, c)))

describe('«Lo que llevamos»: seis puntos, hecho, preguntándose o por hacer', () => {
  it('son seis, como el «4 de 6» de la maqueta, y cada pregunta del guion es de un punto', () => {
    expect(TOTAL_PUNTOS).toBe(6)
    const deAlgunPunto = new Set(PUNTOS.flatMap((p) => p.preguntas))
    for (const q of TODAS) expect(deAlgunPunto.has(q.clave), q.clave).toBe(true)
  })
  it('a mitad de las cuentas, como N1b: 4 de 6, las cuentas preguntándose y el banco por hacer', () => {
    const p = loQueLlevamos({ paso: 'cuentas', actual: 'cuentas', valores: {} })
    expect(p.map((x) => x.estado)).toEqual(['hecho', 'hecho', 'hecho', 'hecho', 'actual', 'falta'])
    expect(cuantosHechos(p)).toBe(4)
  })
  it('en el paso del nombre, cada punto se da por hecho al contestarlo, también con «No lo sé»', () => {
    expect(loQueLlevamos({ paso: 'nombre', actual: 'direccion', valores: { quien: 'Taberna · B28000016' } }).map((x) => x.estado).slice(0, 2)).toEqual(['hecho', 'actual'])
    expect(loQueLlevamos({ paso: 'nombre', actual: 'direccion', valores: {}, contestadas: ['nombre'] })[0].estado).toBe('hecho')
    expect(loQueLlevamos({ paso: 'nombre', actual: 'nombre', valores: {} })[0].estado).toBe('actual')
  })
  it('el aviso «Alta a medias» cuenta lo mismo con lo que trae la lista de empresas', () => {
    expect(hechosDeUnaAMedias('cuentas', true, true)).toBe(4)
    expect(hechosDeUnaAMedias('nombre', true, false)).toBe(1)
    expect(hechosDeUnaAMedias('nombre', false, false)).toBe(0)
    expect(hechosDeUnaAMedias('hecho', true, true)).toBe(6)
    expect(hechosDeUnaAMedias(null, false, false)).toBe(0)
  })
})

describe('volver a un punto, sin botón «anterior»', () => {
  it('solo a lo hecho, y no con el alta terminada', () => {
    const p = loQueLlevamos({ paso: 'cuentas', actual: 'cuentas', valores: {} })
    expect(sePuedeVolver(p[1], 'cuentas')).toBe(true)
    expect(sePuedeVolver(p[4], 'cuentas')).toBe(false) // lo de ahora
    expect(sePuedeVolver(p[5], 'cuentas')).toBe(false) // lo que falta no se adelanta
    expect(sePuedeVolver(p[1], 'hecho')).toBe(false)
  })
  it('se repregunta solo lo del punto: «Dónde» no vuelve a preguntar el nombre', () => {
    const def = PUNTOS.find((x) => x.clave === 'donde')!
    const delPaso = todasLasPreguntas('nombre', ctx()).map((q) => q.clave)
    const r = respuestasParaVolver(def, delPaso)
    expect(r).toEqual({ nombre: '__ya' })
    expect(preguntaActual('nombre', ctx({ respuestas: r }))?.clave).toBe('direccion')
    const quien = respuestasParaVolver(PUNTOS[0], delPaso)
    expect(preguntaActual('nombre', ctx({ respuestas: quien }))?.clave).toBe('nombre')
  })
  it('también vale decirlo', () => {
    expect(puntoQuePide('cambia la dirección')).toBe('donde')
    expect(puntoQuePide('Cámbiame el nombre, que está mal')).toBe('quien')
    expect(puntoQuePide('me he equivocado en la actividad')).toBe('actividad')
    expect(puntoQuePide('corrige el IBAN')).toBe('banco')
    expect(puntoQuePide('cambiar el plan contable')).toBe('cuentas')
    // Sin «cambia» no es volver: es contestar.
    expect(puntoQuePide('la dirección es Calle Mayor 1')).toBeNull()
    expect(puntoQuePide('restaurante y reparto a domicilio')).toBeNull()
  })
})

describe('lo que escribe la persona, con las respuestas reales del guion', () => {
  it('«ni idea» y «pregúntaselo a mi asesor» son «No lo sé» en TODAS las preguntas', () => {
    for (const q of TODAS) {
      expect(entender(q, 'ni idea').tipo, q.clave).toBe('nolose')
      expect(entender(q, 'pregúntaselo a mi asesor').tipo, q.clave).toBe('nolose')
    }
  })
  it('el texto de cada botón, escrito, es ese botón y no otro', () => {
    for (const q of TODAS) {
      for (const o of q.opciones) {
        const e = entender(q, o.texto)
        expect(e, `${q.clave}: «${o.texto}»`).toEqual({ tipo: 'opcion', valor: o.valor, texto: o.texto })
      }
    }
  })
  it('un «sí» o un «no» a secas, en las preguntas de sí o no', () => {
    const retiene = TODAS.find((q) => q.clave === 'retiene')!
    expect(entender(retiene, 'sí, claro')).toMatchObject({ valor: 'si' })
    expect(entender(retiene, 'no')).toMatchObject({ valor: 'no' })
    const cuentas = TODAS.find((q) => q.clave === 'cuentas')!
    expect(entender(cuentas, 'pymes')).toMatchObject({ valor: 'pymes' })
    expect(entender(cuentas, 'el general, por favor')).toMatchObject({ valor: 'normal' })
    const periodo = TODAS.find((q) => q.clave === 'periodo')!
    expect(entender(periodo, 'cada mes')).toMatchObject({ valor: 'monthly' })
  })
  it('lo que no encaja no se adivina', () => {
    const retiene = TODAS.find((q) => q.clave === 'retiene')!
    expect(entender(retiene, 'depende del mes').tipo).toBe('nada')
    expect(entender(retiene, 'sí y no').tipo).toBe('nada')
  })
  it('cada pregunta lleva su «¿Por qué lo pregunto?», con qué pasa si no lo sabes', () => {
    for (const q of TODAS) {
      expect(q.ayuda.length, q.clave).toBeGreaterThan(40)
      expect(q.ayuda, q.clave).toMatch(/Si no |opcional/)
    }
    expect(TODAS.find((q) => q.clave === 'cuentas')!.ayuda).toContain('8 M€')
  })
})

describe('lo que dice la IA: nunca «Apuntado.» a secas', () => {
  it('repite lo entendido en negrita y dice qué ha hecho', () => {
    const f = fraseActividades('somos dark kitchen, solo reparto de comida a domicilio por plataformas',
      [{ descripcion: 'Comida a domicilio', iae: '1_6779' }], 'iva_reducido')
    expect(enTexto(f)).toBe('Entendido: somos dark kitchen, solo reparto de comida a domicilio por plataformas. Lo he apuntado como comida a domicilio (epígrafe 677.9), y el IVA de tus ventas al 10 %.')
    expect(f.filter((x) => x.b).map((x) => x.t)).toEqual(['somos dark kitchen, solo reparto de comida a domicilio por plataformas', 'comida a domicilio', '10 %'])
    expect(enTexto(fraseCuentas('pymes', 8, { code: '2026', startsOn: '2026-01-01', endsOn: '2026-12-31' })))
      .toBe('Entendido: plan de pymes. Te dejo cuentas de 8 dígitos y el ejercicio 2026 abierto, del 01/01/2026 al 31/12/2026.')
    expect(enTexto(fraseModelos(['111', '202', '303', '390']))).toBe('Con eso, presentas los modelos 111, 202, 303 y 390. El porqué de cada uno está en «Tu empresa».')
  })
  it('ninguna frase es «Apuntado.» sin contenido', () => {
    const frases = [fraseNombre('Llorente29 Food, S.L.'), fraseDireccion('Florencio Llorente 29, 28027 Madrid'), frasePeriodo('quarterly'), frasePeriodo('monthly')]
    for (const f of frases) {
      expect(enTexto(f)).not.toMatch(/^Apuntad[oa]\.$/)
      expect(f.some((x) => x.b), enTexto(f)).toBe(true)
    }
  })
})

describe('el IVA de tus ventas, contra el catálogo real', () => {
  it('toda la hostelería del IAE (agrupaciones 67 y 68 de la sección 1) va al 10 %', () => {
    const hosteleria = IAE.filter((x) => x.section === '1' && /^1_6[78]/.test(x.code))
    expect(hosteleria.length).toBe(39)
    for (const x of hosteleria) expect(esHosteleria({ iaeCode: x.code, cnaeCode: null }), x.code).toBe(true)
    // Y nada más del IAE.
    const resto = IAE.filter((x) => !hosteleria.includes(x) && esHosteleria({ iaeCode: x.code, cnaeCode: null }))
    expect(resto.map((x) => x.code)).toEqual([])
  })
  it('toda la CNAE-2025 de las divisiones 55 y 56, y nada más', () => {
    const si = CNAE.filter((x) => esHosteleria({ iaeCode: null, cnaeCode: x.code }))
    expect(si.length).toBeGreaterThan(0)
    for (const x of si) expect(x.code, x.title).toMatch(/^5[56]/)
  })
  it('lo que propone el alta para «restaurante y reparto a domicilio» sale al 10 %, y fuera de la península no', () => {
    expect(gruposDe('Restaurante, y también repartimos a domicilio').map((g) => g.clave)).toEqual(['restaurante', 'domicilio'])
    expect(ivaDeVentas([{ iaeCode: '1_6779', cnaeCode: '5611' }], 'peninsula_baleares')?.codigo).toBe('iva_reducido')
    expect(ivaDeVentas([{ iaeCode: '1_6779', cnaeCode: '5611' }], 'canarias')).toBeNull()
    expect(ivaDeVentas([{ iaeCode: '1_6779', cnaeCode: '5611' }], 'peninsula_baleares')?.porque).toContain('Ley 37/1992, art. 91.Uno.2.2.º')
  })
  it('sin actividad de hostelería no propone nada: no se adivina', () => {
    expect(ivaDeVentas([{ iaeCode: '1_6521', cnaeCode: null }], 'peninsula_baleares')).toBeNull()
    expect(ivaDeVentas([], 'peninsula_baleares')).toBeNull()
  })
})

describe('la frase de la maqueta, contra el catálogo real', () => {
  it('«somos dark kitchen, solo reparto de comida a domicilio por plataformas» es comida a domicilio, y nada más', () => {
    const texto = 'somos dark kitchen, solo reparto de comida a domicilio por plataformas'
    const grupos = gruposDe(texto)
    const contiene = (t: string, q: string) => normalizar(t).includes(normalizar(q))
    const m = new Map<string, { iae: Encontrado[][]; cnae: Encontrado[][] }>()
    for (const g of grupos) m.set(g.clave, {
      iae: g.iae.map((q) => IAE.filter((x) => ['1', '2'].includes(x.section) && ['grupo', 'epigrafe'].includes(x.level) && contiene(x.title.replace(/\u00ad/g, ''), q)).slice(0, 5)),
      cnae: g.cnae.map((q) => CNAE.filter((x) => x.level === 4 && contiene(x.title, q)).slice(0, 5)),
    })
    expect(proponer(grupos, m).map((p) => [p.descripcion, p.iae?.code, p.cnae?.code])).toEqual([['Comida a domicilio', '1_6779', '5611']])
  })
})

describe('el guion nuevo', () => {
  it('las cuentas se eligen: pymes (la normal) o general, y si no, que lo decida el asesor', () => {
    const q = preguntaActual('cuentas', ctx())!
    expect(q.opciones.map((o) => o.texto)).toEqual(['El de pymes, el normal', 'El general'])
    expect(q.normal).toBe('pymes')
    expect(q.noLoSe).toBe('Que lo decida mi asesor')
  })
  it('cada paso, salvo el primero, abre con su transición', () => {
    const primeras = (['nombre', 'actividad', 'impuestos', 'cuentas', 'banco'] as PasoAlta[])
      .map((p) => todasLasPreguntas(p, ctx())[0])
    for (const q of primeras) expect(q.transicion, q.clave).toBeTruthy()
    expect(todasLasPreguntas('impuestos', ctx({ cp: '35001' }))[0].transicion).toBe('Ahora, tus impuestos.')
    const claves: ClavePregunta[] = primeras.map((q) => q.clave)
    expect(claves).toEqual(['nombre', 'actividad', 'periodo', 'cuentas', 'banco'])
  })
})
