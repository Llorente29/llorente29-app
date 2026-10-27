// tests/unit/modules/multitenancy/f01MarcasLast.test.ts
//
// F01 · PR 1 · Las marcas de Last contra un Postgres DE VERDAD (regla 31), con
// la población real de El Delicioso (f01/poblacion.sql): las migraciones 1320,
// 1322 y 1321 tal cual, y sus vueltas atrás.
//   · Detectar: El Delicioso (sin vincular) y Van Van (nueva) salen; las demás,
//     vinculadas; la tienda de Plaza Castilla (cerrada) no cuenta.
//   · El ensayo del alta de El Delicioso: 19 matrículas, 18 platos (las dos
//     Cachapas son una), 10 del almacén, 8 sin receta; no toca nada.
//   · La 1321: el socio de las cedidas de sus facturas, y El Delicioso
//     terminado sin duplicar; pasarla dos veces no cambia nada.
//   · El sembrado de siempre, dos veces: sin «duplicate key» con las archivadas.
//   · Las vueltas atrás dejan la base como estaba.

import { spawnSync } from 'node:child_process'
import { chmodSync, chownSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const raiz = resolve(__dirname, '../../../..')
const leer = (f: string) => readFileSync(join(raiz, f), 'utf8')
const CUENTA = 'a0000000-0000-4000-8000-000000000001'
const ORG = '0c000000-0000-4000-8000-000000000001'
const FOODINT = '51ad1792-6629-4ef7-833a-b57b09a86710'
const conCuenta = (q: string) => q.split(FOODINT).join(CUENTA)

const bin = (() => {
  const base = '/usr/lib/postgresql'
  if (!existsSync(base)) return null
  const v = readdirSync(base).filter((d) => existsSync(join(base, d, 'bin', 'pg_ctl'))).sort().pop()
  return v ? join(base, v, 'bin') : null
})()
const listo = !!bin && spawnSync('psql', ['--version']).status === 0
const PUERTO = String(56000 + Math.floor(Math.random() * 900))
let dir = ''
const comoPostgres = userInfo().uid === 0
const run = (exe: string, args: string[]) =>
  comoPostgres ? spawnSync('runuser', ['-u', 'postgres', '--', exe, ...args], { encoding: 'utf8' }) : spawnSync(exe, args, { encoding: 'utf8' })
function sql(q: string): string {
  const r = spawnSync('psql', ['-h', dir, '-p', PUERTO, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: q, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr || `psql salió con ${r.status}`)
  return r.stdout.trim()
}
const json = <T>(q: string): T => JSON.parse(sql(q)) as T
type Marca = { nombre: string; estado: string; platos: number; locales: { nombre: string }[]; canales: string[]; propuesta: { socio: string | null; socio_marcas: number; propia: boolean } }
type Carta = { matriculas: number; platos: number; ya_estaban: number; creados: number; del_almacen: string[]; sin_receta: number; juntados: { plato: string; con: string }[]; archivadas: unknown[] }
const marcas = () => json<Marca[]>(`select public._f01_marcas_last('${CUENTA}')`)
const ensayo = () => json<{ carta: Carta; locales: { nombre: string }[]; nueva: boolean }>(
  `select public._f01_alta_marca('${CUENTA}', '${ORG}', 'El Delicioso Latin Food ', 'El Delicioso Latin Food', false, 'X', true, null, null)`)
const foto = () => sql(`select (select count(*) from menu_item) || '/' || (select count(*) from recipe_item) || '/' || (select count(*) from brand_licensing_agreement)
  || '/' || (select count(*) from menu_item where recipe_item_id is null) || '/' || (select count(*) from external_brand_alta)`)

describe.skipIf(!listo)('F01 · marcas de Last, con la población real de El Delicioso', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'f01-marcas-'))
    if (comoPostgres) { chmodSync(dir, 0o777); chownSync(dir, 102, 104) }
    const ini = run(join(bin!, 'initdb'), ['-D', join(dir, 'datos'), '-A', 'trust', '-U', 'postgres', '--no-sync'])
    if (ini.status !== 0) throw new Error(ini.stderr)
    const arr = run(join(bin!, 'pg_ctl'), ['-D', join(dir, 'datos'), '-o', `-k ${dir} -p ${PUERTO} -c listen_addresses='' -c fsync=off`, '-w', 'start', '-l', join(dir, 'log')])
    if (arr.status !== 0) throw new Error(arr.stderr || readFileSync(join(dir, 'log'), 'utf8'))
    sql(leer('tests/unit/modules/multitenancy/f01/esquema.sql'))
    sql(leer('supabase/migrations/20261027T1320_f01_marcas_last.sql'))
    sql(leer('supabase/migrations/20261027T1322_f01_sembrado_y_socio.sql'))
    sql(leer('tests/unit/modules/multitenancy/f01/poblacion.sql'))
  }, 90_000)

  afterAll(() => {
    if (!dir) return
    run(join(bin!, 'pg_ctl'), ['-D', join(dir, 'datos'), '-m', 'immediate', 'stop'])
    rmSync(dir, { recursive: true, force: true })
  })

  it('detecta El Delicioso (sin vincular) y Van Van (nueva), en sus locales ACTIVOS', () => {
    const m = marcas()
    const pend = m.filter((x) => x.estado === 'nueva' || x.estado === 'sin_vincular').map((x) => `${x.nombre}:${x.estado}`)
    expect(pend.sort()).toEqual(['El Delicioso Latin Food:sin_vincular', 'Van Van:nueva'])
    const ed = m.find((x) => x.nombre === 'El Delicioso Latin Food')!
    // Plaza Castilla cerró: su tienda de Last no cuenta.
    expect(ed.locales.map((l) => l.nombre)).toEqual(['Foodint Alcalá', 'Foodint Carabanchel'])
    expect(ed.canales.sort()).toEqual(['glovo', 'uber'])
    expect(ed.platos).toBe(18)
    expect(ed.propuesta).toEqual({ propia: false, socio: 'CLOUDTOWN BRANDS SL', socio_marcas: 2 })
    // Van Van: solo Alcalá (la otra tienda no es de ningún local).
    expect(m.find((x) => x.nombre === 'Van Van')!.locales.map((l) => l.nombre)).toEqual(['Foodint Alcalá'])
  })

  it('el ensayo del alta cuenta la carta de verdad y no toca nada', () => {
    const antes = foto()
    const r = ensayo()
    expect(r.nueva).toBe(false)
    expect(r.carta.matriculas).toBe(19)
    expect(r.carta.platos).toBe(18)
    expect(r.carta.ya_estaban).toBe(9)
    expect(r.carta.creados).toBe(10)
    expect(r.carta.del_almacen).toHaveLength(10)
    expect(r.carta.sin_receta).toBe(8)
    expect(r.carta.juntados).toEqual([{ plato: 'CACHAPA QUESUDA DL', con: 'CACHAPA QUESUDA (DL)' }])
    expect(r.carta.archivadas).toEqual([])
    expect(foto()).toBe(antes)
  })

  it('la 1321: el socio de las cedidas de sus facturas y El Delicioso terminado sin duplicar', () => {
    sql(conCuenta(leer('supabase/migrations/20261027T1321_f01_socios_y_el_delicioso.sql')))
    expect(sql(`select string_agg(b.name || ' · ' || a.owner_name || ' · ' || coalesce(a.revenue_share_pct::text, 'sin %'), ' | ' order by b.name)
                  from brand_licensing_agreement a join brand b on b.id = a.brand_id`))
      .toBe('Ay Mamita Bowls · CLOUDTOWN BRANDS SL · sin % | Big Mike´s Burger Joint · CLOUDTOWN BRANDS SL · sin % | El Delicioso Latin Food · CLOUDTOWN BRANDS SL · sin %')
    // Dos Coyotes no tiene pedidos: sin factura, sin ficha (no se inventa).
    const ed = `brand_id = 'b0000000-0000-4000-8000-000000000003'`
    expect(sql(`select count(*) || '/' || count(recipe_item_id) from menu_item where ${ed} and archived_at is null`)).toBe('19/19')
    expect(sql(`select count(distinct recipe_item_id) from menu_item where ${ed} and name like 'CACHAPA%'`)).toBe('1')
    expect(sql(`select count(*) from recipe_item where created_by_name = 'F01 · tanda' and type = 'dish'`)).toBe('8')
    expect(sql(`select count(*) from brand_location_availability where ${ed}`)).toBe('2')
    expect(marcas().find((x) => x.nombre === 'El Delicioso Latin Food')!.estado).toBe('vinculada')
    // Otra vez: nada cambia.
    const antes = foto()
    sql(conCuenta(leer('supabase/migrations/20261027T1321_f01_socios_y_el_delicioso.sql')))
    expect(foto()).toBe(antes)
  })

  it('el sembrado de siempre, dos veces: la archivada se cuenta, nada se duplica', () => {
    // Cada llamada es una sesión: el permiso (de mentira) va en la misma.
    const admin = `select set_config('prueba.admin', 'si', false) \\g /dev/null\n`
    const una = json<{ productos_base_creados: number; no_en_la_foto: { marca: string; plato: string; motivo: string }[] }>(
      `${admin}select row_to_json(s) from public.seed_catalog_canonical('${CUENTA}', false) s`)
    expect(una.no_en_la_foto).toContainEqual(expect.objectContaining({ marca: 'Ay Mamita Bowls', plato: 'Nestea Limón', motivo: 'archivada' }))
    const dos = json<{ productos_base_creados: number }>(`${admin}select row_to_json(s) from public.seed_catalog_canonical('${CUENTA}', false) s`)
    expect(dos.productos_base_creados).toBe(0)
    expect(sql(`select count(*) from menu_item where external_id = 'd0000000-0000-4000-8000-000000000015' and brand_id = 'b0000000-0000-4000-8000-000000000001'`)).toBe('1')
  })

  it('las vueltas atrás de la 1321, la 1322 y la 1320 dejan la base como estaba', () => {
    sql(`create or replace function public._restaurar_funcion(p_firma text, p_migracion text) returns text language plpgsql as $$
           declare v funcion_respaldo; begin select * into v from funcion_respaldo where firma = p_firma and migracion = p_migracion;
           execute v.definicion; delete from funcion_respaldo where firma = p_firma and migracion = p_migracion; return 'ok'; end $$`)
    sql(conCuenta(leer('supabase/vuelta-atras/20261027T1321_f01_socios_y_el_delicioso.down.sql')))
    expect(sql(`select count(*) from brand_licensing_agreement`)).toBe('0')
    expect(sql(`select count(*) || '/' || count(recipe_item_id) from menu_item where brand_id = 'b0000000-0000-4000-8000-000000000003' and archived_at is null`)).toBe('9/0')
    sql(leer('supabase/vuelta-atras/20261027T1322_f01_sembrado_y_socio.down.sql'))
    sql(leer('supabase/vuelta-atras/20261027T1320_f01_marcas_last.down.sql'))
    expect(sql(`select to_regclass('public.external_brand_alta') is null and to_regprocedure('public._f01_marcas_last(uuid)') is null`)).toBe('t')
    expect(sql(`select is_nullable from information_schema.columns where table_name = 'brand_licensing_agreement' and column_name = 'revenue_share_pct'`)).toBe('NO')
  })
})
