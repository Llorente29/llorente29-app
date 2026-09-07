// LA PRUEBA DE CABLEADO de la sección Extras (§9 del encargo, orden de
// construcción). La regla es de Julio, 06/09: «ningún botón sin destino que
// exista». En Cartas el destino era una pestaña y lo fija
// `botonesConDestino.test.ts`. Aquí el destino de los dos botones que ESCRIBEN
// no es una pantalla: es una función de la base. Y ese cable es el único de toda
// la sección que un build verde no toca — TypeScript no sabe cómo se llama una
// función de Postgres, así que un nombre mal escrito o un argumento renombrado
// sale a producción sin que nada chille y revienta al pulsar.
//
// Es exactamente la familia de la regla 30: el registro está bien, la pantalla
// miente sobre él. Aquí sería peor: la pantalla se pinta entera y el botón no
// escribe nada.
//
// SE LEE EL SQL DE VERDAD, no una copia. Mientras las migraciones están sin
// aplicar viven en `docs/pendiente/`; cuando se apliquen pasan a
// `supabase/migrations/` con la versión que registre la base (regla 17). La
// prueba busca en los dos sitios para no ponerse roja el día de la mudanza.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const RAIZ = resolve(__dirname, '../../../..')

/** Todo el SQL de la sección, esté donde esté hoy. */
function elSqlDeExtras(): string {
  const trozos: string[] = []
  for (const dir of ['docs/pendiente', 'supabase/migrations']) {
    const d = resolve(RAIZ, dir)
    if (!existsSync(d)) continue
    for (const f of readdirSync(d)) {
      if (f.endsWith('.sql') && f.includes('extras')) {
        trozos.push(readFileSync(resolve(d, f), 'utf8'))
      }
    }
  }
  return trozos.join('\n')
}

const SQL = elSqlDeExtras()
const SERVICIO = readFileSync(
  resolve(RAIZ, 'src/modules/kitchen/services/extrasService.ts'), 'utf8',
)

/** Los nombres de función que el navegador llama, sacados del servicio. */
function lasQueLlamaLaPantalla(): string[] {
  return [...SERVICIO.matchAll(/rpc as unknown as Rpc\)\(\s*'([a-z0-9_]+)'/g)].map((m) => m[1])
}

/** Los argumentos con los que llama a una de ellas. */
function losArgumentosDe(fn: string): string[] {
  const i = SERVICIO.indexOf(`'${fn}'`)
  const trozo = SERVICIO.slice(i, SERVICIO.indexOf('})', i))
  return [...trozo.matchAll(/^\s{4}(p_[a-z_]+):/gm)].map((m) => m[1])
}

/** Los que declara el SQL para esa misma función. */
function losQueDeclaraElSql(fn: string): string[] {
  const i = SQL.indexOf(`create or replace function public.${fn}(`)
  const cuerpo = SQL.slice(i + fn.length, SQL.indexOf(')\nreturns', i))
  return [...cuerpo.matchAll(/(p_[a-z_]+)\s+[a-z]/g)].map((m) => m[1])
}

describe('el cable entre la pantalla de Extras y la base', () => {
  // Que la prueba mida algo: sin SQL delante no puede decir que todo cuadra.
  it('encuentra el SQL de la sección', () => {
    expect(SQL).toContain('create or replace function public.kitchen_extras_por_nombre(')
    expect(SQL).toContain('create or replace function public.kitchen_extras_poner_lo_que_lleva(')
  })

  it('llama exactamente a las dos funciones de la sección, y no a otra', () => {
    expect(lasQueLlamaLaPantalla().sort()).toEqual([
      'kitchen_extras_poner_lo_que_lleva',
      'kitchen_extras_por_nombre',
    ])
  })

  for (const fn of ['kitchen_extras_por_nombre', 'kitchen_extras_poner_lo_que_lleva']) {
    it(`«${fn}» existe en el SQL con ese nombre exacto`, () => {
      expect(SQL).toContain(`create or replace function public.${fn}(`)
    })

    // PostgREST casa por NOMBRE de argumento, no por posición: un `p_opciones`
    // que en el SQL se llamara `p_copias` daría un 404 al pulsar «Guardar», con
    // la pantalla entera pintada y perfecta.
    it(`los argumentos con los que se llama a «${fn}» existen en el SQL`, () => {
      const pide = losArgumentosDe(fn)
      const hay = losQueDeclaraElSql(fn)
      expect(pide.length).toBeGreaterThan(0)
      for (const a of pide) expect(hay, `${fn}(${hay.join(', ')})`).toContain(a)
    })
  }

  // Lo que devuelve la escritura y lo que la pantalla lee para decir «aplicado a
  // 7 copias»: si la base dejara de mandar `escritos`, la confirmación diría 0 y
  // se leería como que no ha hecho nada (regla 8).
  it('las claves de la respuesta de la escritura son las que se leen', () => {
    for (const clave of ['copias', 'escritos', 'cosas']) {
      expect(SQL, `falta '${clave}' en el jsonb de la escritura`).toContain(`'${clave}',`)
      expect(SERVICIO).toContain(`d.${clave}`)
    }
  })

  // Y las de la lectura que la cabecera escribe tal cual (§15, un solo reloj).
  it('la lectura devuelve los dos días de la ventana y el servicio los mapea', () => {
    for (const clave of ['ventana_desde', 'ventana_hasta']) {
      expect(SQL).toContain(`'${clave}',`)
      expect(SERVICIO).toContain(`d.${clave}`)
    }
  })

  // La escritura se apoya en el índice parcial: sin él, `ON CONFLICT` no tiene
  // dónde agarrarse y la segunda vez que alguien costee el mismo extra la base
  // rechaza la transacción entera.
  it('el ON CONFLICT de la escritura apunta al índice que crea la otra migración', () => {
    expect(SQL).toContain('modifier_recipe_impact_un_confirmado_por_ficha')
    expect(SQL).toContain('on conflict (modifier_option_id, target_recipe_item_id)')
    expect(SQL).toMatch(/on conflict \(modifier_option_id, target_recipe_item_id\)\s*\n\s*where status = 'confirmed'/)
  })
})
