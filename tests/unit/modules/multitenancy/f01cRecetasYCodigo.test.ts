// tests/unit/modules/multitenancy/f01cRecetasYCodigo.test.ts
//
// F01 · PR 3 · Las recetas que faltan (tablero 3) y una marca que ya tienes con
// otro código (tablero 4), contra un Postgres DE VERDAD, sobre la población
// real de El Delicioso (f01/poblacion.sql) con el PR 1, el PR 2 y la 0850 y la
// 0851 aplicadas:
//   · la carta de la marca: cuántas faltan, los del almacén aparte, lo vendido
//     esperando a cada receta y lo que se queda debajo del último recuento;
//   · «Hacer receta» (el artículo vacío del plato) y la cola: el plato entra al
//     recibir su PRIMERA línea, no con las siguientes; lo vendido desde el
//     recuento se coloca solo, por tandas, sin pasar nunca por debajo (regla 6);
//   · un código nuevo con la carta idéntica se une solo en la pasada y se avisa;
//     uno que solo se parece se pregunta, con las dos cartas; «Sí, es…» coloca
//     sus ventas; «No, es otra marca» deja de preguntar;
//   · ninguna venta sin marca en silencio (salvo un código ignorado a propósito);
//   · la vuelta atrás.

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
const ALCALA = 'e1000000-0000-4000-8000-000000000001'
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

type Plato = { id: string; nombre: string; estado: string; recipe_item_id: string | null; precios: Record<string, number>; ventas_esperando: number; ventas_antes_del_recuento: number }
type Carta = {
  marca: { nombre: string; propia: boolean; socio: string | null; locales: { nombre: string }[]; canales: { slug: string }[] }
  platos: Plato[]; resumen: { platos: number; con_receta: number; sin_receta: number; almacen: number }
  ventas_esperando: number; ventas_antes_del_recuento: number; por_colocar: number
  colocadas: { plato: string; colocadas: number; fallidas: number; antes_del_recuento: number }[]
}
type Comparacion = { brand_id: string; marca: string; platos_last: number; platos_folvy: number; con_receta: number; coinciden: number; identica: boolean; parecida: boolean
  cartas: { last: { nombre: string; coincide: boolean }[]; folvy: { nombre: string; coincide: boolean }[] } }
type Revisar = {
  preguntas: { org: string; nombre: string; estado: string; comparacion: Comparacion; ventas: { despues: number; antes: number } }[]
  reconocidas: { id: string; como: string; nombre_last: string; marca: string; ventas: { colocadas: number; antes_del_recuento: number } }[]
  sin_marca: { codigo: string; ventas: number; marca_last: string | null }[]
}
const carta = (b = ED) => json<Carta>(`select public.f01_carta_marca('${CUENTA}', '${b}')`)
const revisar = () => json<Revisar>(`select public.f01_marcas_por_revisar('${CUENTA}')`)
const plato = (c: Carta, nombre: string) => c.platos.find((p) => p.nombre === nombre)!
/** Una venta de Last con un plato (por su matrícula), a esa hora y con ese código de marca. */
const venta = (matricula: string, cuando: string, marca: string | null, codigo: string | null = null) =>
  sql(`with s as (insert into sale (account_id, location_id, brand_id, source, sold_at, raw_products, external_brand_text, external_location_text)
         values ('${CUENTA}', '10000000-0000-4000-8000-000000000001', ${marca ? `'${marca}'` : 'null'}, 'lastapp', ${cuando}, '[]', ${codigo ? `'${codigo}'` : 'null'}, '${ALCALA}') returning id)
       insert into sale_line (account_id, sale_id, menu_item_id, external_product_id)
       select '${CUENTA}', s.id, (select id from menu_item where account_id = '${CUENTA}' and external_id = '${matricula}' and archived_at is null
                                   and (${marca ? `brand_id = '${marca}'` : 'true'}) limit 1), '${matricula}' from s returning sale_id`)
const m = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const colocar = (max = 150) => json<{ colocadas: number; fallidas: number; antes_del_recuento: number; quedan: number; platos: { plato: string }[] }>(
  `select public._f01c_colocar_recetas('${CUENTA}', ${max})`)

describe.skipIf(!listo)('F01 · PR 3 · recetas que faltan y código cambiado, con la población real de El Delicioso', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'f01c-'))
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
    sql(leer('supabase/migrations/20261028T0650_f01b_alta_sin_empleado.sql'))
    // Cada venta que se reprocesa queda apuntada, para saber cuáles se tocan.
    sql(`create table reprocesada (sale_id uuid, cuando timestamptz default clock_timestamp());
         alter function public.reprocess_sale(uuid) rename to reprocess_sale_de_mentira;
         create function public.reprocess_sale(p uuid) returns void language plpgsql as $$
         begin insert into reprocesada (sale_id) values (p); perform public.reprocess_sale_de_mentira(p); end $$;`)
    // Dos veces cada una: se pueden pasar dos veces (W05).
    for (let i = 0; i < 2; i++) {
      sql(leer('supabase/migrations/20261028T0850_f01c_recetas_y_codigo.sql'))
      sql(leer('supabase/migrations/20261028T0851_f01c_cola_y_pasada.sql'))
    }
  }, 90_000)

  afterAll(() => {
    if (!dir) return
    run(join(bin!, 'pg_ctl'), ['-D', join(dir, 'datos'), '-m', 'immediate', 'stop'])
    rmSync(dir, { recursive: true, force: true })
  })

  it('la carta de El Delicioso: cuántas faltan y los del almacén aparte', () => {
    const c = carta()
    expect(c.marca).toEqual(expect.objectContaining({ nombre: 'El Delicioso Latin Food', propia: false, socio: 'CLOUDTOWN BRANDS SL' }))
    expect(c.marca.locales.map((l) => l.nombre)).toEqual(['Foodint Alcalá', 'Foodint Carabanchel'])
    expect(c.marca.canales.map((x) => x.slug)).toEqual(['glovo', 'uber'])
    expect(c.resumen).toEqual({ platos: 8, con_receta: 0, sin_receta: 8, almacen: 10 })
    // Primero las que faltan; los del almacén al final.
    expect(c.platos.slice(0, 8).every((p) => p.estado === 'sin_receta')).toBe(true)
    expect(c.platos.slice(8).every((p) => p.estado === 'almacen')).toBe(true)
    expect(plato(c, 'Coca Cola').precios).toEqual({ glovo: 2.5, uber: 2.5 })
    expect(c.ventas_esperando).toBe(0)
  })

  it('lo vendido de un plato sin receta: lo de después del recuento espera, lo de antes se dice', () => {
    // El recuento cerrado de la población es de hace 2 días.
    venta(m(9), `now() - interval '1 hour'`, ED)
    venta(m(9), `now() - interval '3 days'`, ED)
    const c = carta()
    expect(plato(c, 'DIVINO CHICHARRÓN')).toEqual(expect.objectContaining({ estado: 'sin_receta', ventas_esperando: 1, ventas_antes_del_recuento: 1 }))
    expect([c.ventas_esperando, c.ventas_antes_del_recuento]).toEqual([1, 1])
  })

  it('«Hacer receta»: el plato sin artículo recibe uno vacío; el que ya tiene, el suyo; el del almacén no lleva', () => {
    const p = plato(carta(), 'DIVINO CHICHARRÓN')
    const r1 = json<{ recipe_item_id: string; creado: boolean }>(`select public.f01_preparar_receta('${CUENTA}', '${p.id}')`)
    expect(r1.recipe_item_id).toBe(p.recipe_item_id ?? r1.recipe_item_id)
    const sinArticulo = sql(`insert into menu_item (account_id, brand_id, name, external_id, external_source) values
                               ('${CUENTA}', '${ED}', 'AREPA REINA', '${m(78)}', 'lastapp') returning id`)
    const r2 = json<{ recipe_item_id: string; creado: boolean }>(`select public.f01_preparar_receta('${CUENTA}', '${sinArticulo}')`)
    expect(r2.creado).toBe(true)
    expect(sql(`select recipe_item_id from menu_item where id = '${sinArticulo}'`)).toBe(r2.recipe_item_id)
    expect(sql(`select type || ' · ' || name from recipe_item where id = '${r2.recipe_item_id}'`)).toBe('dish · AREPA REINA')
    // Otra vez: no crea otro.
    expect(json<{ creado: boolean }>(`select public.f01_preparar_receta('${CUENTA}', '${sinArticulo}')`).creado).toBe(false)
    expect(() => json(`select public.f01_preparar_receta('${CUENTA}', '${plato(carta(), 'Coca Cola').id}')`)).toThrow(/sale del almacén tal cual/)
    // Sin ser administrador, no.
    expect(() => sql(`select public.f01_preparar_receta('${CUENTA}', '${sinArticulo}')`)).toThrow(/quien administra/)
  })

  it('la cola: el plato entra con su PRIMERA línea de receta, no con las siguientes, y solo si es de Last', () => {
    const p = plato(carta(), 'DIVINO CHICHARRÓN')
    const dish = json<{ recipe_item_id: string }>(`select public.f01_preparar_receta('${CUENTA}', '${p.id}')`).recipe_item_id
    const cerdo = sql(`insert into recipe_item (account_id, type, name) values ('${CUENTA}', 'raw', 'Panceta') returning id`)
    sql(`insert into recipe_line (account_id, parent_item_id, child_item_id) values ('${CUENTA}', '${dish}', '${cerdo}')`)
    expect(sql(`select count(*) from f01_receta_puesta where recipe_item_id = '${dish}' and colocada_at is null`)).toBe('1')
    sql(`insert into recipe_line (account_id, parent_item_id, child_item_id) values ('${CUENTA}', '${dish}', '${cerdo}')`)
    expect(sql(`select count(*) from f01_receta_puesta where recipe_item_id = '${dish}'`)).toBe('1')
    // Una elaboración que no es de ningún plato de Last no entra.
    const salsa = sql(`insert into recipe_item (account_id, type, name) values ('${CUENTA}', 'recipe', 'Salsa de la casa') returning id`)
    sql(`insert into recipe_line (account_id, parent_item_id, child_item_id) values ('${CUENTA}', '${salsa}', '${cerdo}')`)
    expect(sql(`select count(*) from f01_receta_puesta where recipe_item_id = '${salsa}'`)).toBe('0')
    expect(carta().por_colocar).toBe(1)
  })

  it('colocar: lo de después del recuento se reprocesa; lo de antes, nunca (regla 6), y se dice', () => {
    sql(`truncate reprocesada`)
    const r = colocar()
    expect(r).toEqual(expect.objectContaining({ colocadas: 1, fallidas: 0, antes_del_recuento: 1, quedan: 0 }))
    const corte = sql(`select max(closed_at) from inventory_count where account_id = '${CUENTA}'`)
    expect(sql(`select count(*) from reprocesada r join sale s on s.id = r.sale_id where s.sold_at <= '${corte}'`)).toBe('0')
    expect(sql(`select count(*) from reprocesada`)).toBe('1')
    const c = carta()
    expect(plato(c, 'DIVINO CHICHARRÓN').estado).toBe('receta')
    expect(c.resumen).toEqual({ platos: 9, con_receta: 1, sin_receta: 8, almacen: 10 })
    expect(c.colocadas).toEqual([expect.objectContaining({ plato: 'DIVINO CHICHARRÓN', colocadas: 1, fallidas: 0, antes_del_recuento: 1 })])
    expect(c.por_colocar).toBe(0)
    // Otra vez: nada que hacer.
    expect(colocar()).toEqual(expect.objectContaining({ colocadas: 0, quedan: 0 }))
  })

  it('por tandas: la pantalla pide pocas y repite hasta que no quedan; ninguna se queda sin colocar', () => {
    const p = plato(carta(), 'CHORIPOLLO')
    for (let i = 1; i <= 5; i++) venta(m(6), `now() - interval '${i} minutes'`, ED)
    const dish = json<{ recipe_item_id: string }>(`select public.f01_preparar_receta('${CUENTA}', '${p.id}')`).recipe_item_id
    const pollo = sql(`insert into recipe_item (account_id, type, name) values ('${CUENTA}', 'raw', 'Pollo') returning id`)
    sql(`truncate reprocesada; insert into recipe_line (account_id, parent_item_id, child_item_id) values ('${CUENTA}', '${dish}', '${pollo}')`)
    const vueltas: number[] = []
    for (let i = 0; i < 6; i++) { const r = colocar(2); vueltas.push(r.quedan); if (r.quedan === 0) break }
    expect(vueltas[vueltas.length - 1]).toBe(0)
    expect(vueltas.length).toBeGreaterThan(1)
    expect(sql(`select count(distinct r.sale_id) from reprocesada r join sale_line sl on sl.sale_id = r.sale_id where sl.menu_item_id = '${p.id}'`)).toBe('5')
  })

  it('«Subir mis recetas»: la lectura va al plato elegido y, al guardarla, lo vendido se coloca (sin esperar al disparador)', () => {
    const p = plato(carta(), 'TEQUEÑO ED')
    venta(m(18), `now() - interval '15 minutes'`, ED)
    const sesion = sql(`insert into recipe_item_ai_session (account_id, status) values ('${CUENTA}', 'pending_review') returning id`)
    const r = json<{ recipe_item_id: string; plato: string }>(`select public.f01_destino_lectura('${CUENTA}', '${sesion}', '${p.id}')`)
    expect(r.plato).toBe('TEQUEÑO ED')
    expect(sql(`select recipe_item_id from recipe_item_ai_session where id = '${sesion}'`)).toBe(r.recipe_item_id)
    // Lo que escribe materialize_recipe_session, con el disparador apagado: la cola la llena el guardar.
    const queso = sql(`insert into recipe_item (account_id, type, name) values ('${CUENTA}', 'raw', 'Queso blanco') returning id`)
    sql(`alter table recipe_line disable trigger trg_recipe_line_f01c_receta_puesta;
         insert into recipe_line (account_id, parent_item_id, child_item_id) values ('${CUENTA}', '${r.recipe_item_id}', '${queso}');
         alter table recipe_line enable trigger trg_recipe_line_f01c_receta_puesta;`)
    expect(sql(`select count(*) from f01_receta_puesta where recipe_item_id = '${r.recipe_item_id}'`)).toBe('0')
    const c = json<{ colocadas: number; quedan: number }>(`select public.f01_colocar_recetas('${CUENTA}', '${r.recipe_item_id}')`)
    expect(c).toEqual(expect.objectContaining({ colocadas: 1, quedan: 0 }))
    // Una lectura ya guardada no se vuelve a apuntar; la de otra cuenta, tampoco.
    sql(`update recipe_item_ai_session set status = 'accepted' where id = '${sesion}'`)
    expect(() => json(`select public.f01_destino_lectura('${CUENTA}', '${sesion}', '${p.id}')`)).toThrow(/ya está guardada/)
    const ajena = sql(`insert into recipe_item_ai_session (account_id, status) values ('a0000000-0000-4000-8000-000000000099', 'pending_review') returning id`)
    expect(() => json(`select public.f01_destino_lectura('${CUENTA}', '${ajena}', '${p.id}')`)).toThrow(/no es de esta cuenta/)
  })

  it('la pasada de cada hora también coloca (y una venta que falla se cuenta, no se calla)', () => {
    const p = plato(carta(), 'MECHADA CRIOLLA')
    const s = venta(m(14), `now() - interval '10 minutes'`, ED)
    const dish = json<{ recipe_item_id: string }>(`select public.f01_preparar_receta('${CUENTA}', '${p.id}')`).recipe_item_id
    const carne = sql(`insert into recipe_item (account_id, type, name) values ('${CUENTA}', 'raw', 'Carne mechada') returning id`)
    sql(`insert into recipe_line (account_id, parent_item_id, child_item_id) values ('${CUENTA}', '${dish}', '${carne}')`)
    // Esa venta falla al reprocesarse.
    sql(`create or replace function public.reprocess_sale(p uuid) returns void language plpgsql as $$
         begin if p = '${s}' then raise exception 'falla a propósito'; end if; insert into reprocesada (sale_id) values (p); perform public.reprocess_sale_de_mentira(p); end $$;`)
    const r = json<{ recetas: { colocadas: number; fallidas: number } }>(`select public.f01_pasada_last('${CUENTA}')`)
    expect(r.recetas).toEqual(expect.objectContaining({ colocadas: 0, fallidas: 1 }))
    expect(carta().colocadas.find((x) => x.plato === 'MECHADA CRIOLLA')).toEqual(expect.objectContaining({ fallidas: 1 }))
    sql(`create or replace function public.reprocess_sale(p uuid) returns void language plpgsql as $$
         begin insert into reprocesada (sale_id) values (p); perform public.reprocess_sale_de_mentira(p); end $$;`)
  })

  it('un código nuevo con la carta IDÉNTICA: la pasada la une sola, coloca sus ventas y lo avisa', () => {
    // «Delicioso Latin» llega a Alcalá con otro código y los mismos platos que El Delicioso.
    sql(`insert into external_catalog_product (account_id, external_org_id, organization_product_id, external_brand_name, external_brand_id, product_name, price_cents, external_channel, external_channels, external_location_id)
         select account_id, external_org_id, organization_product_id, 'Delicioso Latin', 'dl-nuevo', product_name, price_cents, external_channel, external_channels, external_location_id
           from external_catalog_product where external_brand_name = 'El Delicioso Latin Food ' and external_location_id = '${ALCALA}' and missing_since is null`)
    // Con la AREPA REINA de «Hacer receta», que no está en Last, la carta solo se parece.
    const conArepa = json<Comparacion>(`select public._f01c_comparar('${CUENTA}', '${ORG}', 'Delicioso Latin')`)
    expect([conArepa.identica, conArepa.parecida, conArepa.platos_folvy - conArepa.coinciden]).toEqual([false, true, 1])
    // Sin ella (archivada, como un plato que ya no se vende), idéntica.
    sql(`update menu_item set archived_at = now() where account_id = '${CUENTA}' and name = 'AREPA REINA'`)
    const sinMarca = venta(m(5), `now() - interval '20 minutes'`, null, 'dl-nuevo')
    const comp = json<Comparacion>(`select public._f01c_comparar('${CUENTA}', '${ORG}', 'Delicioso Latin')`)
    expect(comp).toEqual(expect.objectContaining({ marca: 'El Delicioso Latin Food', identica: true }))
    expect(comp.coinciden).toBe(comp.platos_folvy)
    // Antes de la pasada, se pregunta (con su venta esperando).
    const antes = revisar().preguntas.find((q) => q.nombre === 'Delicioso Latin')!
    expect(antes.ventas).toEqual(expect.objectContaining({ despues: 1, antes: 0 }))
    const r = json<{ reconocidas_solas: { nombre_last: string; marca: string; ventas: { colocadas: number } }[] }>(`select public.f01_pasada_last('${CUENTA}')`)
    expect(r.reconocidas_solas).toEqual([expect.objectContaining({ nombre_last: 'Delicioso Latin', marca: 'El Delicioso Latin Food', ventas: expect.objectContaining({ colocadas: 1 }) })])
    expect(sql(`select brand_id from sale where id = '${sinMarca}'`)).toBe(ED)
    expect(sql(`select brand_id from external_brand_map where external_brand_id = 'dl-nuevo'`)).toBe(ED)
    // Las mismas matrículas: la carta de El Delicioso no crece ni se repite.
    expect(carta().resumen).toEqual(expect.objectContaining({ platos: 8, almacen: 10 }))
    const v = revisar()
    expect(v.preguntas.find((q) => q.nombre === 'Delicioso Latin')).toBeUndefined()
    const aviso = v.reconocidas.find((x) => x.nombre_last === 'Delicioso Latin')!
    expect(aviso).toEqual(expect.objectContaining({ como: 'sola', marca: 'El Delicioso Latin Food' }))
    // «Entendido»: deja de avisar.
    expect(json<{ vistos: number }>(`select public.f01_aviso_visto('${CUENTA}', '${aviso.id}')`).vistos).toBe(1)
    expect(revisar().reconocidas.find((x) => x.id === aviso.id)).toBeUndefined()
    // La pasada siguiente no la vuelve a unir ni avisa otra vez.
    const r2 = json<{ reconocidas_solas: unknown[]; marcas_con_vinculos_nuevos: unknown[] }>(`select public.f01_pasada_last('${CUENTA}')`)
    expect([r2.reconocidas_solas, r2.marcas_con_vinculos_nuevos]).toEqual([[], []])
  })

  it('un local con un código nuevo de una marca ya dada de alta: se vincula como antes y AHORA se avisa', () => {
    sql(`update external_catalog_product set external_brand_id = 'ed-carabanchel-2'
          where external_brand_name = 'El Delicioso Latin Food ' and external_location_id = 'e1000000-0000-4000-8000-000000000002'`)
    const r = json<{ marcas_con_vinculos_nuevos: { marca: string }[] }>(`select public.f01_pasada_last('${CUENTA}')`)
    expect(r.marcas_con_vinculos_nuevos.map((x) => x.marca)).toEqual(['El Delicioso Latin Food'])
    expect(revisar().reconocidas).toEqual([expect.objectContaining({ como: 'codigo_nuevo', marca: 'El Delicioso Latin Food' })])
  })

  it('un código nuevo que solo SE PARECE: se pregunta con las dos cartas; «Sí, es…» coloca sus ventas', () => {
    // Dirty Burger en Folvy (5 platos con receta) y «Dirty Burgers» en Last con 4 de ellos y uno distinto.
    const db = sql(`insert into brand (account_id, name, slug, ownership_type) values ('${CUENTA}', 'Dirty Burger', 'dirty-burger', 'own') returning id`)
    const pan = sql(`insert into recipe_item (account_id, type, name) values ('${CUENTA}', 'raw', 'Pan brioche') returning id`)
    const nombres = ['Dirty Classic', 'Dirty Bacon', 'Dirty Cheese', 'Dirty Chicken', 'Dirty Veggie']
    nombres.forEach((n, i) => {
      const d = sql(`insert into recipe_item (account_id, type, name) values ('${CUENTA}', 'dish', '${n}') returning id`)
      sql(`insert into recipe_line (account_id, parent_item_id, child_item_id) values ('${CUENTA}', '${d}', '${pan}');
           insert into menu_item (account_id, brand_id, recipe_item_id, name, external_id, external_source) values ('${CUENTA}', '${db}', '${d}', '${n}', '${m(200 + i)}', 'lastapp')`)
    })
    sql(`insert into external_catalog_product (account_id, external_org_id, organization_product_id, external_brand_name, external_brand_id, product_name, price_cents, external_channel, external_channels, external_location_id)
         select '${CUENTA}', '${ORG}', x.mat::uuid, 'Dirty Burgers', 'db-nuevo', x.n, 1090, 'uber', array['uber'], '${ALCALA}'
           from (values ('${m(300)}', 'DIRTY CLASSIC'), ('${m(301)}', 'Dirty Bacon'), ('${m(302)}', 'Dirty Cheese'), ('${m(303)}', 'Dirty Chicken'), ('${m(304)}', 'Dirty Smash')) x(mat, n)`)
    for (let i = 0; i < 6; i++) venta(m(300 + (i % 4)), `now() - interval '${30 + i} minutes'`, null, 'db-nuevo')

    const q = revisar().preguntas.find((x) => x.nombre === 'Dirty Burgers')!
    expect(q.comparacion).toEqual(expect.objectContaining({ marca: 'Dirty Burger', platos_last: 5, platos_folvy: 5, con_receta: 5, coinciden: 4, identica: false, parecida: true }))
    expect(q.comparacion.cartas.last.filter((p) => !p.coincide).map((p) => p.nombre)).toEqual(['Dirty Smash'])
    expect(q.comparacion.cartas.folvy.filter((p) => !p.coincide).map((p) => p.nombre)).toEqual(['Dirty Veggie'])
    expect(q.ventas).toEqual(expect.objectContaining({ despues: 6, antes: 0 }))
    // La pasada no la une sola: solo se parece.
    expect(json<{ reconocidas_solas: unknown[] }>(`select public.f01_pasada_last('${CUENTA}')`).reconocidas_solas).toEqual([])

    // Sin ser administrador, no se decide.
    expect(() => sql(`select public.f01_decidir_marca('${CUENTA}', '${ORG}', 'Dirty Burgers', '${db}', true)`)).toThrow(/quien administra/)
    const r = json<{ como: string; marca: string; ventas: { colocadas: number; antes_del_recuento: number }; sin_receta: string[] }>(
      `select public.f01_decidir_marca('${CUENTA}', '${ORG}', 'Dirty Burgers', '${db}', true)`)
    expect(r).toEqual(expect.objectContaining({ como: 'confirmada', marca: 'Dirty Burger', ventas: expect.objectContaining({ colocadas: 6, antes_del_recuento: 0 }) }))
    // Lo que se queda sin receta al unirla, dicho: el plato que no estaba.
    expect(r.sin_receta).toEqual(['Dirty Smash'])
    expect(sql(`select count(*) from sale where external_brand_text = 'db-nuevo' and brand_id = '${db}'`)).toBe('6')
    // Sus platos se juntan por nombre con los de Dirty Burger (mismo artículo, misma receta): las 6 ventas casan y descuentan.
    expect(sql(`select count(*) from sale_line sl join sale s on s.id = sl.sale_id where s.external_brand_text = 'db-nuevo' and sl.menu_item_id is not null`)).toBe('6')
    const cdb = carta(db)
    expect(cdb.platos.map((x) => `${x.nombre} · ${x.estado}`).sort()).toEqual(
      ['Dirty Bacon · receta', 'Dirty Cheese · receta', 'Dirty Chicken · receta', 'Dirty Classic · receta', 'Dirty Smash · sin_receta', 'Dirty Veggie · receta'])
    expect(revisar().preguntas.find((x) => x.nombre === 'Dirty Burgers')).toBeUndefined()
    // Lo decidido por una persona no se avisa: ya lo ha visto.
    expect(revisar().reconocidas.find((x) => x.nombre_last === 'Dirty Burgers')).toBeUndefined()
  })

  it('«No, es otra marca»: deja de preguntar y queda como marca nueva para darla de alta', () => {
    sql(`insert into external_catalog_product (account_id, external_org_id, organization_product_id, external_brand_name, external_brand_id, product_name, price_cents, external_channel, external_channels, external_location_id)
         select '${CUENTA}', '${ORG}', x.mat::uuid, 'Dirty Kitchen', 'dk-1', x.n, 990, 'glovo', array['glovo'], '${ALCALA}'
           from (values ('${m(400)}', 'Dirty Classic'), ('${m(401)}', 'Dirty Bacon'), ('${m(402)}', 'Dirty Cheese'), ('${m(403)}', 'Pollo frito')) x(mat, n)`)
    expect(revisar().preguntas.map((x) => x.nombre)).toContain('Dirty Kitchen')
    const db = sql(`select id from brand where name = 'Dirty Burger'`)
    expect(json<{ como: string }>(`select public.f01_decidir_marca('${CUENTA}', '${ORG}', 'Dirty Kitchen', '${db}', false)`).como).toBe('otra')
    expect(revisar().preguntas.map((x) => x.nombre)).not.toContain('Dirty Kitchen')
    const marcas = json<{ nombre: string; estado: string }[]>(`select public.f01_marcas_last('${CUENTA}')`)
    expect(marcas.find((x) => x.nombre === 'Dirty Kitchen')?.estado).toBe('nueva')
    // Ya decidida: otra vez, no.
    expect(() => json(`select public.f01_decidir_marca('${CUENTA}', '${ORG}', 'Dirty Kitchen', '${db}', true)`)).toThrow(/ya no está pendiente/)
  })

  it('Van Van no se parece a nada: ni se une ni se pregunta (sigue siendo una marca nueva)', () => {
    const comp = json<Comparacion>(`select public._f01c_comparar('${CUENTA}', '${ORG}', 'Van Van')`)
    expect([comp.identica, comp.parecida]).toEqual([false, false])
    expect(revisar().preguntas.map((x) => x.nombre)).not.toContain('Van Van')
  })

  it('ninguna venta sin marca en silencio: un código que nadie conoce sale; uno ignorado a propósito, no', () => {
    venta(m(9), `now() - interval '5 minutes'`, null, 'zz-desconocido')
    venta(m(9), `now() - interval '6 minutes'`, null, 'zz-ignorado')
    sql(`insert into external_brand_map (account_id, source, external_location_id, external_brand_id, brand_id, is_ignored)
         values ('${CUENTA}', 'lastapp', '${ALCALA}', 'zz-ignorado', null, true)`)
    const s = revisar().sin_marca
    expect(s.map((x) => x.codigo)).toContain('zz-desconocido')
    expect(s.map((x) => x.codigo)).not.toContain('zz-ignorado')
    expect(s.find((x) => x.codigo === 'zz-desconocido')).toEqual(expect.objectContaining({ ventas: 1, marca_last: null }))
    // Sin ser administrador no se ve nada (ni se rompe).
    expect(JSON.parse(sql(`select public.f01_marcas_por_revisar('${CUENTA}')`))).toEqual({ preguntas: [], reconocidas: [], sin_marca: [] })
  })

  it('la vuelta atrás: la 0851 restaura la pasada y quita el disparador; la 0850 para con decisiones y, sin ellas, quita lo que añade', () => {
    sql(leer('supabase/vuelta-atras/20261028T0851_f01c_cola_y_pasada.down.sql').replace(
      "select public._restaurar_funcion('public.f01_pasada_last(uuid)', '20261028T0851_f01c_cola_y_pasada');",
      `do $r$ begin execute (select definicion from funcion_respaldo where firma = 'public.f01_pasada_last(uuid)' and migracion = '20261028T0851_f01c_cola_y_pasada'); end $r$;`))
    expect(sql(`select count(*) from pg_trigger where tgname = 'trg_recipe_line_f01c_receta_puesta'`)).toBe('0')
    expect(sql(`select pg_get_functiondef('public.f01_pasada_last(uuid)'::regprocedure) like '%reconocer_solas%'`)).toBe('f')
    expect(() => sql(leer('supabase/vuelta-atras/20261028T0850_f01c_recetas_y_codigo.down.sql'))).toThrow(/decisiones de «Revisar marca»/)
    sql(`delete from f01_marca_reconocida where como in ('confirmada', 'otra')`)
    sql(leer('supabase/vuelta-atras/20261028T0850_f01c_recetas_y_codigo.down.sql'))
    expect(sql(`select to_regclass('public.f01_receta_puesta') is null and to_regclass('public.f01_marca_reconocida') is null
                   and to_regprocedure('public.f01_carta_marca(uuid,uuid)') is null`)).toBe('t')
    // Lo hecho en tablas que existían se queda: la marca unida sigue unida.
    expect(sql(`select count(*) from external_brand_alta where external_brand_name = 'Dirty Burgers'`)).toBe('1')
  })
})
