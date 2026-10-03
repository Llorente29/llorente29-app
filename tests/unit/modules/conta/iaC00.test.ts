// La base de la IA y el alta conversada del C00 (tarea 6). Los títulos del IAE
// y la CNAE son los REALES de la migración de valores de serie (regla 31): se
// buscan aquí igual que los busca la base (título que contiene el término).
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { gruposDe, proponer, normalizar, type Encontrado } from '@/modules/conta/alta/actividades'
import {
  NUMERO_PASO, modelosDeRespuestas, pasoSiguiente, preguntaActual, territorioPorCp, textoDuda, todasLasPreguntas,
  type ContextoAlta,
} from '@/modules/conta/alta/guion'
import { hechoAlAceptar, marcaDe, mismoValor, queHizo, sePuedeDeshacer, type Origen, type Registro } from '@/modules/conta/ia/tipos'

// ── El catálogo real, tal como lo carga la migración 0130 ───────────────────
const sql = readFileSync('supabase/migrations/20261003T0130_c00_valores_de_serie.sql', 'utf8')
const bloque = (tabla: string) => { const i = sql.indexOf(`insert into public.${tabla}`); return sql.slice(i, sql.indexOf(';\n', i)) }
const IAE = [...bloque('iae_heading').matchAll(/\('([0-9_]+)', '([123])', '([a-z]+)', '((?:[^']|'')*)'/g)]
  .map(([, code, section, level, title]) => ({ code, section, level, title: title.replace(/''/g, "'").replace(/­/g, '') }))
const CNAE = [...bloque('cnae_code').matchAll(/\('2025', '([0-9A-Z]+)', (\d), '((?:[^']|'')*)'/g)]
  .map(([, code, level, title]) => ({ code, level: Number(level), title: title.replace(/''/g, "'") }))

/** Como buscarParaGrupos, pero contra el catálogo real en memoria. */
function buscarComoLaBase(texto: string) {
  const grupos = gruposDe(texto)
  const contiene = (t: string, q: string) => normalizar(t).includes(normalizar(q))
  const m = new Map<string, { iae: Encontrado[][]; cnae: Encontrado[][] }>()
  for (const g of grupos) {
    m.set(g.clave, {
      iae: g.iae.map((q) => IAE.filter((x) => ['1', '2'].includes(x.section) && ['grupo', 'epigrafe'].includes(x.level) && contiene(x.title, q)).slice(0, 5)),
      cnae: g.cnae.map((q) => CNAE.filter((x) => x.level === 4 && contiene(x.title, q)).slice(0, 5)),
    })
  }
  return proponer(grupos, m)
}

describe('el catálogo de la prueba es el real', () => {
  it('lee los 1.432 epígrafes y las 664 clases de la CNAE-2025', () => {
    expect(IAE.length).toBe(1432)
    expect(CNAE.filter((c) => c.level === 4).length).toBe(664)
  })
})

describe('de las palabras de la persona al catálogo oficial (§6.4: nunca inventa)', () => {
  it('«Restaurante, y también repartimos a domicilio» → 671 y 677.9, como la maqueta', () => {
    const p = buscarComoLaBase('Restaurante, y también repartimos a domicilio')
    expect(p.map((x) => [x.descripcion, x.iae?.code, x.cnae?.code])).toEqual([
      ['Restaurante', '1_671', '5611'],
      ['Comida a domicilio', '1_6779', '5611'],
    ])
    expect(p[1].iae?.title).toBe('Otros servicios de alimentación propios de la restauración')
  })
  it('un bar: 673 «En cafés y bares» y la CNAE 5630', () => {
    const [x] = buscarComoLaBase('Tenemos un bar de tapas')
    expect([x.descripcion, x.iae?.code, x.cnae?.code]).toEqual(['Bar o cafetería', '1_673', '5630'])
  })
  it('todo lo que propone existe en las tablas', () => {
    for (const frase of ['Restaurante y catering para eventos', 'Cafetería con obrador de panadería', 'Hotel con restaurante', 'Heladería']) {
      for (const x of buscarComoLaBase(frase)) {
        if (x.iae) expect(IAE.some((i) => i.code === x.iae!.code), `${frase}: ${x.iae.code}`).toBe(true)
        if (x.cnae) expect(CNAE.some((c) => c.code === x.cnae!.code), `${frase}: ${x.cnae.code}`).toBe(true)
      }
    }
  })
  it('si no encuentra nada, no propone nada (y la pantalla deja buscar a mano)', () => {
    expect(buscarComoLaBase('xyzzy plof')).toEqual([])
    expect(gruposDe('')).toEqual([])
  })
  it('«pan» suelto no se busca: encontraría «paneles»', () => {
    expect(gruposDe('vendemos pan').flatMap((g) => g.iae)).not.toContain('pan')
    expect(IAE.some((x) => normalizar(x.title).includes('paneles'))).toBe(true)
  })
})

// ── El guion ────────────────────────────────────────────────────────────────
const SIN_CUENTA = { nombre: null, razonSocial: null, nif: null, direccion: null }
const ctx = (c: Partial<ContextoAlta> = {}): ContextoAlta => ({
  cuenta: SIN_CUENTA, tipo: 'company', cp: '28001', clases: ['business'], respuestas: {}, hoy: '2026-10-03', ...c,
})

describe('el guion del alta', () => {
  it('cinco pasos, como el «3 de 5» de la maqueta', () => {
    expect(NUMERO_PASO.impuestos).toBe(3)
    expect(pasoSiguiente('impuestos')).toBe('cuentas')
    expect(pasoSiguiente('hecho')).toBe('hecho')
  })
  it('D2: lo que tiene la cuenta se propone como respuesta normal', () => {
    const c = ctx({ cuenta: { nombre: 'Taberna', razonSocial: 'Taberna de Prueba Norte, S.L.', nif: 'B28000016', direccion: { calle: 'Calle de la Prueba 12', codigoPostal: '28001', poblacion: 'Madrid', provincia: 'Madrid' } } })
    expect(preguntaActual('nif', c)?.opciones[0].texto).toBe('Sí, B28000016')
    const [nombre, dir] = todasLasPreguntas('nombre', c)
    expect(nombre.texto).toBe('¿Cómo se llama la empresa? El nombre que sale en el NIF.')
    expect(nombre.opciones[0].texto).toBe('Sí, «Taberna de Prueba Norte, S.L.»')
    expect(dir.texto).toBe('¿La dirección fiscal es Calle de la Prueba 12, 28001 Madrid?')
  })
  it('D3: sin datos en la cuenta, el nombre se pregunta sin proponer nada', () => {
    const p = preguntaActual('nombre', ctx())!
    expect(p.opciones).toEqual([])
    expect(p.entrada).toBe('texto')
  })
  it('cada pregunta lleva su «No lo sé», y las que tienen respuesta normal, su porqué', () => {
    for (const paso of ['nif', 'nombre', 'actividad', 'impuestos', 'cuentas', 'banco'] as const) {
      for (const p of todasLasPreguntas(paso, ctx())) {
        expect(p.noLoSe, p.clave).toBeTruthy()
        if (p.opciones.length) expect(p.porque, p.clave).toBeTruthy()
      }
    }
  })
  it('«No lo sé» deja la normal y lo dice', () => {
    const p = preguntaActual('impuestos', ctx())!
    expect(p.clave).toBe('periodo')
    expect(textoDuda(p)).toBe('Lo dejo en «Sí, cada tres meses», que es lo normal, y se lo apunto a tu asesor como duda.')
  })
  it('en Canarias no se pregunta por el IVA', () => {
    expect(todasLasPreguntas('impuestos', ctx({ cp: '35001' })).map((p) => p.clave)).toEqual(['retiene', 'alquiler'])
    expect(territorioPorCp('35001').porque).toBe('Tu código postal (35001) es de Las Palmas, en Canarias: allí no hay IVA, sino IGIC (Ley 37/1992, art. 3).')
    expect(territorioPorCp('51001').territorio).toBe('ceuta_melilla')
  })
  it('los modelos salen de las respuestas, con la regla del núcleo', () => {
    expect(modelosDeRespuestas(ctx({ respuestas: { periodo: 'quarterly', retiene: 'si', alquiler: 'si' } })).modelos).toEqual(['111', '115', '202', '303', '390'])
    expect(modelosDeRespuestas(ctx({ respuestas: { retiene: 'no', alquiler: 'no' } })).modelos).toEqual(['202', '303', '390'])
    // «No lo sé» deja la normal (sí).
    expect(modelosDeRespuestas(ctx({ respuestas: { retiene: '__nolose', alquiler: 'no' } })).modelos).toContain('111')
    expect(modelosDeRespuestas(ctx({ cp: '35001', respuestas: { retiene: 'no', alquiler: 'no' } })).modelos).toEqual(['202'])
  })
})

// ── Marcas y registro ───────────────────────────────────────────────────────
describe('la marca «IA» sale mientras el dato siga valiendo lo que puso la IA (§6.1)', () => {
  const o: Origen[] = [
    { tableKey: 'company_tax_profile', rowId: 'e', field: 'tax_forms', source: 'ai', valueSet: ['111', '303'], reason: 'porque sí', setAt: '' },
    { tableKey: 'company_tax_profile', rowId: 'e', field: 'account_digits', source: 'ai', valueSet: 8, reason: 'ocho', setAt: '' },
  ]
  it('igual → marca; cambiado por la persona → sin marca', () => {
    expect(marcaDe(o, 'company_tax_profile', 'e', 'tax_forms', ['111', '303'])?.reason).toBe('porque sí')
    expect(marcaDe(o, 'company_tax_profile', 'e', 'tax_forms', ['111', '303', '115'])).toBeNull()
    expect(marcaDe(o, 'company_tax_profile', 'e', 'account_digits', 8)).not.toBeNull()
    expect(marcaDe(o, 'company_tax_profile', 'e', 'account_digits', 10)).toBeNull()
    expect(marcaDe(o, 'company', 'e', 'legal_name', 'X')).toBeNull()
  })
  it('compara como la base: 8 = «8», pero no 8 = 10', () => {
    expect(mismoValor(8, '8')).toBe(true)
    expect(mismoValor('quarterly', 'monthly')).toBe(false)
  })
})

describe('el registro, en palabras', () => {
  const r = (x: Partial<Registro>): Registro => ({
    id: '1', action: 'poner', source: 'ai', tableKey: 'company_tax_profile', field: 'vat_period', before: 'monthly', after: 'quarterly',
    reason: 'r', doneAt: '2026-10-03T10:00:00Z', doneForName: 'Admin Norte', undoneAt: null, undoneByName: null, suggestionId: null, ...x,
  })
  it('dice qué hizo y sobre qué', () => {
    expect(queHizo(r({}))).toBe('Cambió cada cuánto presentas el IVA: cada tres meses')
    expect(queHizo(r({ field: 'tax_forms', before: null, after: ['111', '303'] }))).toBe('Puso los modelos que presentas: 111, 303')
    expect(queHizo(r({ source: 'import', field: 'legal_name', before: null, after: 'Taberna, S.L.' }))).toBe('Trajo de tu cuenta la razón social: Taberna, S.L.')
    expect(queHizo(r({ action: 'anadir_actividad', after: { description: 'Restaurante' } }))).toBe('Añadió la actividad «Restaurante»')
    // Dejar el valor de serie que ya tenía es ponerlo, no cambiarlo (lo vio la captura del 03/10).
    expect(queHizo(r({ field: 'account_digits', before: 8, after: '8' }))).toBe('Puso los dígitos de las cuentas: 8')
    expect(queHizo(r({ field: 'tax_forms', before: [], after: ['111', '303'] }))).toBe('Puso los modelos que presentas: 111, 303')
    expect(queHizo(r({ field: 'tax_forms', before: ['303'], after: ['111', '303'] }))).toBe('Cambió los modelos que presentas: 111, 303')
    // La forma jurídica, por su nombre del catálogo y no por su código («nif_b»).
    expect(queHizo(r({ field: 'legal_form_code', before: null, after: 'nif_b', afterName: 'Sociedades de responsabilidad limitada' })))
      .toBe('Puso el tipo de empresa: Sociedades de responsabilidad limitada')
  })
  it('lo deshecho no se vuelve a deshacer y dice quién', () => {
    expect(sePuedeDeshacer(r({ undoneAt: '2026-10-03', undoneByName: 'Admin Norte' }))).toEqual({ ok: false, motivo: 'Deshecho por Admin Norte' })
    expect(hechoAlAceptar({ id: 's', kind: 'modelo', reasonKey: 'modelo_115', title: '', why: '', payload: { modelo: '115' } }))
      .toBe('Añadido el modelo 115 a lo que presentas. Si no era así, lo deshaces en «Lo que ha hecho Folvy».')
  })
})

// ── Regla 40 ────────────────────────────────────────────────────────────────
describe('regla 40: lo que los servicios nombran entre comillas existe en las migraciones', () => {
  const todo = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
  for (const fichero of ['iaService', 'altaService']) {
    const s = readFileSync(`src/modules/conta/services/${fichero}.ts`, 'utf8')
    it(`${fichero}: tablas`, () => {
      for (const t of new Set([...s.matchAll(/tabla\('([a-z_]+)'\)/g)].map((m) => m[1]))) {
        expect(todo, t).toMatch(new RegExp(`create table if not exists public\\.${t} \\(`))
      }
    })
    it(`${fichero}: funciones`, () => {
      for (const f of new Set([...s.matchAll(/rpc(?:<[^>]+>)?\('([a-z_]+)'/g)].map((m) => m[1]))) {
        expect(todo, f).toMatch(new RegExp(`create or replace function public\\.${f}\\(`))
      }
    })
  }
  it('los campos que la IA puede poner son columnas de verdad', () => {
    const m = todo.match(/conta_ia_campo_permitido[\s\S]*?\$\$([\s\S]*?)\$\$/)![1]
    const cuerpo = (t: string) => todo.match(new RegExp(`create table if not exists public\\.${t} \\(([\\s\\S]*?)\\n\\);`))?.[1] ?? ''
    for (const [, tabla, lista] of m.matchAll(/p_tabla = '([a-z_]+)' and p_campo in \(([^)]*)\)/g)) {
      for (const c of [...lista.matchAll(/'([a-z_]+)'/g)].map((x) => x[1])) expect(cuerpo(tabla), `${tabla}.${c}`).toMatch(new RegExp(`\\b${c}\\b`))
    }
  })
})
