// tests/unit/modules/multitenancy/f01bCambiosCarta.test.ts
//
// F01 · PR 2 · Los cambios de carta de una marca de Last (tablero 5) contra un
// Postgres DE VERDAD, sobre la población real de El Delicioso (f01/poblacion.sql)
// con el PR 1 aplicado (1320, 1322 y 1321) y la 1910:
//   · el espejo de los extras: lo que trae Last, y lo que deja de traer;
//   · platos nuevos, platos que ya no están y precios distintos;
//   · los extras sin decidir, con la propuesta de Folvy («Doble de queso» →
//     Queso cheddar loncha · 2 ud, «Huevo frito» → Huevo · 1 ud, «Sin cebolla»
//     → quitar cebolla, falta cuánto, «Salsa picante» → falta);
//   · guardarlos (crea la opción como la importación si aún no existe, sin
//     duplicar) y que dejen de salir; añadir los platos nuevos; poner los
//     precios de Last, con su apunte.

import { spawnSync } from 'node:child_process'
import { chmodSync, chownSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const raiz = resolve(__dirname, '../../../..')
const leer = (f: string) => readFileSync(join(raiz, f), 'utf8')
const CUENTA = 'a0000000-0000-4000-8000-000000000001'
const ORG = '0c000000-0000-4000-8000-000000000001'
const ED = 'b0000000-0000-4000-8000-000000000003'
const conCuenta = (q: string) => q.split('51ad1792-6629-4ef7-833a-b57b09a86710').join(CUENTA)
const bin = (() => {
  const base = '/usr/lib/postgresql'
  if (!existsSync(base)) return null
  const v = readdirSync(base).filter((d) => existsSync(join(base, d, 'bin', 'pg_ctl'))).sort().pop()
  return v ? join(base, v, 'bin') : null
})()
const listo = !!bin && spawnSync('psql', ['--version']).status === 0
const PUERTO = String(57000 + Math.floor(Math.random() * 900))
let dir = ''
const comoPostgres = userInfo().uid === 0
const run = (exe: string, args: string[]) =>
  comoPostgres ? spawnSync('runuser', ['-u', 'postgres', '--', exe, ...args], { encoding: 'utf8' }) : spawnSync(exe, args, { encoding: 'utf8' })
function sql(q: string): string {
  const r = spawnSync('psql', ['-h', dir, '-p', PUERTO, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: q, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr || `psql salió con ${r.status}`)
  return r.stdout.trim()
}
const ADMIN = `select set_config('prueba.admin', 'si', false) \\g /dev/null\n`
const json = <T>(q: string): T => JSON.parse(sql(ADMIN + q)) as T
type Extra = { nombre: string; estado: string; en_folvy: boolean; propuesta: { ficha_nombre: string; tipo: string; cantidad: number | null } | null; modifier_id: string }
type Cambios = { nombre: string; platos_nuevos: { nombre: string }[]; extras_nuevos: Extra[]; retirados: { nombre: string; visto: string | null }[]; precios: { nombre: string; canal: string | null; antes: number; despues: number }[] }
const cambiosED = () => json<Cambios[]>(`select public.f01_cambios_carta('${CUENTA}')`).find((c) => c.nombre === 'El Delicioso Latin Food')!
const extra = (g: string, slot: string, mod: string, nombre: string, cents: number, prods: number[]) =>
  ({ group_id: g, slot_id: slot, modifier_id: mod, group_name: 'Extras', group_min: 0, group_max: 4, name: nombre, price_cents: cents,
     product_ids: prods.map((n) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`) })
const espejo = (filas: unknown[]) => sql(`select public.f01_espejo_extras('${CUENTA}', '${ORG}', '${JSON.stringify(filas).replace(/'/g, "''")}'::jsonb)`)

describe.skipIf(!listo)('F01 · PR 2 · cambios de carta de Last, con la población real de El Delicioso', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'f01b-'))
    if (comoPostgres) { chmodSync(dir, 0o777); chownSync(dir, 102, 104) }
    const ini = run(join(bin!, 'initdb'), ['-D', join(dir, 'datos'), '-A', 'trust', '-U', 'postgres', '--no-sync'])
    if (ini.status !== 0) throw new Error(ini.stderr)
    const arr = run(join(bin!, 'pg_ctl'), ['-D', join(dir, 'datos'), '-o', `-k ${dir} -p ${PUERTO} -c listen_addresses='' -c fsync=off`, '-w', 'start', '-l', join(dir, 'log')])
    if (arr.status !== 0) throw new Error(arr.stderr || readFileSync(join(dir, 'log'), 'utf8'))
    sql(leer('tests/unit/modules/multitenancy/f01/esquema.sql'))
    sql(leer('supabase/migrations/20261027T1320_f01_marcas_last.sql'))
    sql(leer('supabase/migrations/20261027T1322_f01_sembrado_y_socio.sql'))
    sql(leer('tests/unit/modules/multitenancy/f01/poblacion.sql'))
    sql(conCuenta(leer('supabase/migrations/20261027T1321_f01_socios_y_el_delicioso.sql')))
    sql(leer('supabase/migrations/20261027T1910_f01b_cambios_carta.sql'))
    // El almacén que nombran los extras (ud y kg).
    sql(`insert into kitchen_unit (id, account_id, name, dimension, is_base, is_seed, is_active, abbreviation) values
           ('869711c3-0000-4000-8000-0000000000kg'::text::uuid, null, 'Kilo', 'mass', true, true, true, 'kg')`.replace("'869711c3-0000-4000-8000-0000000000kg'::text::uuid", "'869711c3-0000-4000-8000-000000000001'"))
    sql(`update kitchen_unit set abbreviation = 'ud' where id = '869711c3-eabd-4e95-92f2-555efaaba6b0';
         insert into recipe_item (account_id, type, name, base_unit_id) values
           ('${CUENTA}', 'raw', 'Queso cheddar loncha', '869711c3-eabd-4e95-92f2-555efaaba6b0'),
           ('${CUENTA}', 'raw', 'Huevo', '869711c3-eabd-4e95-92f2-555efaaba6b0'),
           ('${CUENTA}', 'raw', 'Cebolla morada', '869711c3-0000-4000-8000-000000000001')`)
  }, 90_000)

  afterAll(() => {
    if (!dir) return
    run(join(bin!, 'pg_ctl'), ['-D', join(dir, 'datos'), '-m', 'immediate', 'stop'])
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin cambios en Last, El Delicioso no tiene nada que decidir', () => {
    const c = cambiosED()
    expect(c.platos_nuevos).toEqual([])
    expect(c.retirados).toEqual([])
    expect(c.precios).toEqual([])
    expect(c.extras_nuevos).toEqual([])
  })

  it('el espejo de los extras guarda lo que trae Last y marca lo que deja de traer', () => {
    expect(JSON.parse(espejo([extra('g1', 's1', 'm1', 'Doble de queso', 150, [6]), extra('g1', 's2', 'm2', 'Huevo frito', 120, [6]),
      extra('g1', 's3', 'm3', 'Sin cebolla', 0, [6]), extra('g1', 's4', 'm4', 'Salsa picante', 80, [6]), extra('g9', 's9', 'm9', 'Otra cosa', 0, [999])]))).toEqual({ vistos: 5, idos: 0 })
    expect(JSON.parse(espejo([extra('g1', 's1', 'm1', 'Doble de queso', 150, [6]), extra('g1', 's2', 'm2', 'Huevo frito', 120, [6]),
      extra('g1', 's3', 'm3', 'Sin cebolla', 0, [6]), extra('g1', 's4', 'm4', 'Salsa picante', 80, [6])]))).toEqual({ vistos: 4, idos: 1 })
    // Una foto vacía no da por idos a todos.
    expect(JSON.parse(espejo([]))).toEqual({ vistos: 0, idos: 0 })
  })

  it('los extras nuevos de sus platos, con lo que propone Folvy', () => {
    const e = cambiosED().extras_nuevos
    const por = Object.fromEntries(e.map((x) => [x.nombre, x]))
    expect(Object.keys(por).sort()).toEqual(['Doble de queso', 'Huevo frito', 'Salsa picante', 'Sin cebolla'])
    expect(por['Doble de queso']).toEqual(expect.objectContaining({ estado: 'propuesto', en_folvy: false,
      propuesta: expect.objectContaining({ ficha_nombre: 'Queso cheddar loncha', tipo: 'add_item', cantidad: 2 }) }))
    expect(por['Huevo frito'].propuesta).toEqual(expect.objectContaining({ ficha_nombre: 'Huevo', tipo: 'add_item', cantidad: 1 }))
    expect(por['Sin cebolla']).toEqual(expect.objectContaining({ estado: 'falta',
      propuesta: expect.objectContaining({ ficha_nombre: 'Cebolla morada', tipo: 'remove_item', cantidad: null }) }))
    expect(por['Salsa picante']).toEqual(expect.objectContaining({ estado: 'falta', propuesta: null }))
  })

  it('guardar los propuestos: crea la opción como la importación, sin duplicar, y dejan de salir', () => {
    const e = cambiosED().extras_nuevos.filter((x) => x.estado === 'propuesto')
    const lote = e.map((x) => ({ modifier_id: x.modifier_id, ficha: (x.propuesta as unknown as { ficha: string }).ficha, tipo: x.propuesta!.tipo,
      cantidad: x.propuesta!.cantidad, unidad: (x.propuesta as unknown as { unidad: string }).unidad }))
    const r = json<{ extras: number; opciones_nuevas: number; frase: string }>(
      `select public.f01_guardar_extras('${CUENTA}', '${ED}', '${JSON.stringify(lote)}'::jsonb)`)
    expect(r).toEqual(expect.objectContaining({ extras: 2, opciones_nuevas: 2, frase: 'Guardados 2 extras: ya dicen qué descuentan del almacén.' }))
    expect(sql(`select count(*) || '/' || count(distinct external_id) from modifier_option where pos_modifier_id in ('m1', 'm2')`)).toBe('2/2')
    expect(sql(`select string_agg(external_id, ',' order by external_id) from modifier_group`)).toBe('g1')
    expect(cambiosED().extras_nuevos.map((x) => x.nombre).sort()).toEqual(['Salsa picante', 'Sin cebolla'])
    // Otra vez: no duplica nada.
    json(`select public.f01_guardar_extras('${CUENTA}', '${ED}', '${JSON.stringify(lote)}'::jsonb)`)
    expect(sql(`select count(*) from modifier_option`) + '/' + sql(`select count(*) from modifier_recipe_impact where status = 'confirmed'`)).toBe('2/2')
    // Sin cuánto, no se guarda nada.
    expect(() => json(`select public.f01_guardar_extras('${CUENTA}', '${ED}', '[{"modifier_id":"m3","ficha":"${CUENTA}","tipo":"remove_item"}]'::jsonb)`)).toThrow(/falta qué descuenta o cuánto/)
  })

  it('un plato nuevo en Last, uno que ya no está y un precio distinto; añadir y poner los precios', () => {
    // Nuevo: «AREPA DEL DÍA» en Uber y Glovo. Se va: «TEQUEÑO ED». Cambia: el Choripapa sube a 7,50 en Glovo.
    sql(`insert into external_catalog_product (account_id, external_org_id, organization_product_id, external_brand_name, product_name, price_cents, external_channel, external_channels, external_location_id)
         select '${CUENTA}', '${ORG}', 'd0000000-0000-4000-8000-000000000077', 'El Delicioso Latin Food ', 'AREPA DEL DÍA', 850, ch, array[ch], 'e1000000-0000-4000-8000-000000000001'
           from unnest(array['uber','glovo']) ch;
         update external_catalog_product set missing_since = now() where organization_product_id = 'd0000000-0000-4000-8000-000000000018';
         update external_catalog_product set price_cents = 750 where organization_product_id = 'd0000000-0000-4000-8000-000000000005' and external_channel = 'glovo';`)
    const c = cambiosED()
    expect(c.platos_nuevos.map((p) => p.nombre)).toEqual(['AREPA DEL DÍA'])
    expect(c.retirados.map((p) => p.nombre)).toEqual(['TEQUEÑO ED'])
    expect(c.retirados[0].visto).not.toBeNull()
    expect(c.precios).toEqual([expect.objectContaining({ nombre: 'CHORIPAPA', canal: 'glovo', antes: 6.9, despues: 7.5 })])

    const p = json<{ puestos: number; frase: string }>(`select public.f01_poner_precios_de_last('${CUENTA}', '${ED}')`)
    expect(p.frase).toBe('Puesto 1 precio de Last en El Delicioso Latin Food, apuntado.')
    const a = json<{ creados: number; frase: string }>(`select public.f01_anadir_platos_nuevos('${CUENTA}', '${ED}')`)
    expect(a.frase).toBe('Añadido 1 plato a la carta de El Delicioso Latin Food. Faltan 8 recetas.')
    expect(sql(`select canal || ' ' || round(antes, 2) || ' → ' || round(despues, 2) from external_catalog_change`)).toBe('glovo 6.90 → 7.50')
    const d = cambiosED()
    expect([d.platos_nuevos, d.precios]).toEqual([[], []])
    // El que se fue sigue en la carta (histórico): nada se archiva solo.
    expect(sql(`select count(*) from menu_item where brand_id = '${ED}' and name = 'TEQUEÑO ED' and archived_at is null`)).toBe('1')
  })

  it('0650: el alta de quien no es empleado falla con la 1320 (23503) y funciona con la 0650; el de un empleado se guarda', () => {
    // Una marca de Last nueva en la carta de El Delicioso (la misma org), con un plato.
    const org = sql(`select external_org_id from external_catalog_product where account_id = '${CUENTA}' limit 1`)
    const loc = sql(`select external_location_id from external_catalog_product where account_id = '${CUENTA}' and external_location_id is not null limit 1`)
    sql(`insert into external_catalog_product (account_id, source, external_org_id, catalog_product_id, organization_product_id, external_brand_name,
           product_name, price_cents, product_type, external_channel, external_channels, external_location_id, seen_in_catalog_at, is_enabled)
         values ('${CUENTA}', 'lastapp', '${org}', gen_random_uuid(), gen_random_uuid(), 'Marca Admin', 'Plato admin', 800, 'PRODUCT', 'uber',
                 array['uber'], '${loc}', now(), true),
                ('${CUENTA}', 'lastapp', '${org}', gen_random_uuid(), gen_random_uuid(), 'Marca Empleado', 'Plato empleado', 800, 'PRODUCT', 'uber',
                 array['uber'], '${loc}', now(), true)`)
    const alta = (marca: string, quien: string) =>
      `select public._f01_alta_marca('${CUENTA}', '${org}', '${marca}', '${marca}', true, null, false, '${quien}', 'Julio')->>'brand_id'`
    const admin = '11111111-0000-4000-8000-0000000000a1'
    // Con la 1320 (antes de la 0650): falla con la clave ajena, como en producción.
    expect(() => sql(alta('Marca Admin', admin))).toThrow(/brand_created_by_fkey/)
    sql(leer('supabase/migrations/20261028T0650_f01b_alta_sin_empleado.sql'))
    const b = sql(alta('Marca Admin', admin))
    expect(sql(`select coalesce(created_by::text, 'null') || ' · ' || created_by_name from brand where id = '${b}'`)).toBe('null · Julio')
    expect(sql(`select count(*) from external_brand_alta where brand_id = '${b}' and created_by = '${admin}'`)).toBe('1')
    // Un empleado de la cuenta sí queda como quien la creó.
    const emp = sql(`insert into employees (account_id, name) values ('${CUENTA}', 'Encargada') returning id`)
    const b2 = sql(alta('Marca Empleado', emp))
    expect(sql(`select created_by from brand where id = '${b2}'`)).toBe(emp)
  })

  it('la vuelta atrás para con precios apuntados y, sin ellos, quita lo que añade', () => {
    expect(() => sql(leer('supabase/vuelta-atras/20261027T1910_f01b_cambios_carta.down.sql'))).toThrow(/precios puestos desde Last/)
    sql(`delete from external_catalog_change`)
    sql(leer('supabase/vuelta-atras/20261027T1910_f01b_cambios_carta.down.sql'))
    expect(sql(`select to_regclass('public.external_catalog_modifier') is null and to_regprocedure('public.f01_cambios_carta(uuid)') is null`)).toBe('t')
    // Lo que se guardó en tablas que existían se queda.
    expect(sql(`select count(*) from modifier_recipe_impact where status = 'confirmed'`)).toBe('2')
  })
})
