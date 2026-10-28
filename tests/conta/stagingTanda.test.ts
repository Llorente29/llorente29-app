// tests/conta/stagingTanda.test.ts — W04 (Julio, 22/10): qué pasa por staging en cada run.
// Contra la población real (regla 31): las dos últimas fusiones de main, los
// 98 ficheros del manifiesto de hoy y las migraciones viejas que llevan COMMIT.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chmodSync, chownSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { lineas, nuevas, porQueNoSeEnsaya, llevaSuTransaccion, sesiones, MANIFIESTO, RUTA_STAGING, rutaNoAdmitida, ruta, textoDelManifiesto,
  porQueNoVaLaSemilla, tablasQueEscribe, funcionesQueCrea, sqlDosVeces, yaDeVerdad } from '../../scripts/conta/staging-tanda.mjs'

const enCommit = (ref: string) => execFileSync('git', ['show', `${ref}:${MANIFIESTO}`], { encoding: 'utf8' })

describe('lo que añade una rama o un push al manifiesto', () => {
  it('la fusión del #279 (Catcher) añadió su 0420 y su prueba, y nada más', () => {
    expect(nuevas(enCommit('a6133686'), enCommit('7818c125'))).toEqual([
      'supabase/migrations/20261130T0420_e05_catcher_ficha.sql',
      'supabase/staging/sql/20261130_e05_catcher_ficha_prueba.sql',
    ])
  })
  it('la fusión del #281 (I01d) añadió su 0420 y su prueba, y nada más', () => {
    expect(nuevas(enCommit('7818c125'), enCommit('03229c4b'))).toEqual([
      'supabase/migrations/20261130T0420_i01d_impuestos_2025.sql',
      'supabase/staging/sql/20261130_i01d_impuestos_2025_prueba.sql',
    ])
  })
  it('sin cambios, nada; un comentario o un blanco no cuentan; el orden es el del manifiesto nuevo', () => {
    const m = readFileSync(MANIFIESTO, 'utf8')
    expect(nuevas(m, m)).toEqual([])
    expect(nuevas(m, `${m}\n# un comentario\n\n`)).toEqual([])
    expect(nuevas('a.sql\n', 'b.sql\na.sql\nc.sql\n')).toEqual(['b.sql', 'c.sql'])
  })
})

describe('qué se puede ensayar en ROLLBACK', () => {
  const hoy = lineas(readFileSync(MANIFIESTO, 'utf8'))
  it('los 118 ficheros del manifiesto de hoy (sin W03, con la 0450, la 0460 del S02, la 0470 del D02, la 0480 del E05, la 0490 del S02 · PR 3, la 0770, la 0780 y la 0790 del D03 y la 0800 y la 0810 del D06 la 0820 del D07a y la 0830 del D07c, cada una con su prueba) se ensayan, y 54 llevan su propia transacción', () => {
    expect(hoy).toHaveLength(118)
    expect(hoy.filter((f) => porQueNoSeEnsaya(readFileSync(f, 'utf8')))).toEqual([])
    expect(hoy.filter((f) => llevaSuTransaccion(readFileSync(f, 'utf8')))).toHaveLength(54)
  })
  it('una migración vieja con COMMIT no se ensaya: dejaría cosas de verdad', () => {
    const f = 'supabase/migrations/20260923T0015_casar_el_combo_por_su_id.sql'
    expect(porQueNoSeEnsaya(readFileSync(f, 'utf8'))).toMatch(/COMMIT/)
  })
  it('un ROLLBACK que no es la última sentencia, tampoco; el «end;» de un cuerpo $$ no es un COMMIT', () => {
    expect(porQueNoSeEnsaya('begin;\nselect 1;\nrollback;\ninsert into t values (1);\n')).toMatch(/ROLLBACK/)
    expect(porQueNoSeEnsaya('do $$ begin perform 1; end $$;\ncreate function f() returns int language plpgsql as $f$ begin return 1; end; $f$;\n')).toBeNull()
    expect(porQueNoSeEnsaya("select 'commit;';\n-- commit;\n")).toBeNull()
  })
  it('volver a un savepoint no cierra la transacción: se ensaya; un ROLLBACK a secas en medio sigue parando (S01, 28/10)', () => {
    expect(porQueNoSeEnsaya('begin;\nsavepoint x;\nselect 1;\nrollback to savepoint x;\nselect 2;\nrollback;\n')).toBeNull()
    expect(porQueNoSeEnsaya('begin;\nsavepoint x;\nselect 1;\nrollback to x;\nselect 2;\nrollback;\n')).toBeNull()
    expect(porQueNoSeEnsaya('begin;\nsavepoint x;\nROLLBACK WORK TO SAVEPOINT x;\nselect 2;\nrollback;\n')).toBeNull()
    expect(porQueNoSeEnsaya('begin;\nselect 1;\nrollback;\nselect 2;\nrollback;\n')).toMatch(/ROLLBACK que no es su última sentencia/)
    expect(porQueNoSeEnsaya('begin;\nselect 1;\nrollback work;\nselect 2;\n')).toMatch(/ROLLBACK/)
    expect(porQueNoSeEnsaya('begin;\nselect 1;\nrollback transaction;\nselect 2;\n')).toMatch(/ROLLBACK/)
    expect(porQueNoSeEnsaya(readFileSync('supabase/staging/sql/20261027_s01_redsys_y_abono_prueba.sql', 'utf8'))).toBeNull()
  })
  it('lo que se llama al aplicar: la función de un DO o de un select, no el cuerpo de las que define, ni una tabla ni una política (S01, 28/10)', () => {
    expect(llamadasAlAplicar("do $$ declare x jsonb; begin x := public._s01_asiento_cobro(r.id, 'stripe'); end $$;")).toEqual(['public._s01_asiento_cobro()'])
    expect(llamadasAlAplicar("select public._respaldar_funcion('public.f(uuid)', 'm');")).toEqual(['public._respaldar_funcion()'])
    expect(llamadasAlAplicar([
      'create table public.t (id uuid references public.company(id));',
      'insert into public.t (id) values (null);',
      'create policy p on public.t using (public.belongs_to_account(id));',
      'create or replace function public.g() returns int language sql as $f$ select public.h() $f$;',
      'select public.g();',
    ].join('\n'))).toEqual([])
  })
})

describe('las sesiones del ensayo', () => {
  it('cada fichero en su sesión, con BEGIN y ROLLBACK; la prueba encuentra antes las migraciones de la rama', () => {
    const leer = (f: string) => (f.includes('prueba') ? 'begin;\nselect 1;\nrollback;\n' : 'create table t (x int);\n')
    const s = sesiones(['m1.sql', 'p1_prueba.sql', 'm2.sql', 'p2_prueba.sql'], leer)
    expect(s.map((x) => x.sql)).toEqual([
      'begin;\n\\i m1.sql\nrollback;',
      'begin;\n\\i m1.sql\n\\i p1_prueba.sql\nrollback;',
      'begin;\n\\i m1.sql\n\\i m2.sql\nrollback;',
      'begin;\n\\i m1.sql\n\\i m2.sql\n\\i p2_prueba.sql\nrollback;',
    ])
  })
})

// W05 (Julio, 22/10): lo que solo añade va de verdad desde la rama; lo demás, solo en ROLLBACK.
import { porQueNoSoloAnade, llamadasAlAplicar } from '../../scripts/conta/staging-tanda.mjs'

describe('lo que solo añade, de verdad desde la rama', () => {
  // La 0460 de D (rama claude/cool-noether-i932tx, 22/10), sus tres sentencias tal cual.
  const S02 = `alter table public.company add column if not exists color text;
comment on column public.company.color is 'el color de la empresa';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_color_formato' and conrelid = 'public.company'::regclass) then
    alter table public.company add constraint company_color_formato check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;`
  const conCompany = { tablas: ['public.company'], funciones: [] as string[] }
  it('la 0460 de D (columna que admite nulos, su comentario y un CHECK que solo mira esa columna) solo añade', () => {
    expect(porQueNoSoloAnade('supabase/migrations/20261202T0460_s02_color_empresa.sql', S02, conCompany)).toBeNull()
  })
  it('un CHECK que mira una columna que ya existía no es «solo añadir»', () => {
    const sql = S02.replace('check (color is null', 'check (legal_name is null')
    expect(porQueNoSoloAnade('supabase/migrations/x.sql', sql, conCompany)).toMatch(/restriccion public\.company/)
  })
  it('las tres tandas de hoy reemplazan funciones que existen: solo en ROLLBACK (la 0450 es la de esta mañana)', () => {
    const ctx = { tablas: ['public.external_send', 'public.conta_diez_autorizo'], funciones: ['public.conta_resumen_ventas(uuid)', 'public.conta_recibida_envio(uuid)', 'public.conta_impuesto_trimestre(uuid,int,int)', 'public.compras_ficha_le_falta(uuid)', 'public.conta_vat_book_desde_asiento(uuid)'] }
    for (const [f, fn] of [['20261201T0450_c07_diez_todo', 'conta_resumen_ventas'], ['20261130T0420_i01d_impuestos_2025', 'conta_impuesto_trimestre'], ['20261130T0410_e05_riders_ficha_y_libro', 'compras_ficha_le_falta']]) {
      const ruta = `supabase/migrations/${f}.sql`
      expect(porQueNoSoloAnade(ruta, readFileSync(ruta, 'utf8'), ctx), f).toMatch(new RegExp(`reemplaza funcion public\\.${fn}`))
    }
  })
  it('la 0470 del D02 cambia conta_documento_factura_guardar (que existe): solo en ROLLBACK; sin ella, solo añadiría', () => {
    const ruta = 'supabase/migrations/20261203T0470_d02_recibida_pdf.sql'
    const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-d02-recibida-pdf-20261022.json', 'utf8')).contexto
    expect(porQueNoSoloAnade(ruta, readFileSync(ruta, 'utf8'), medida)).toMatch(/reemplaza funcion public\.conta_documento_factura_guardar/)
    expect(porQueNoSoloAnade(ruta, readFileSync(ruta, 'utf8'), { tablas: [], funciones: [] })).toBeNull()
  })
  it('la 0480 del E05 cambia las dos funciones de cruzar (que existen): solo en ROLLBACK', () => {
    const ruta = 'supabase/migrations/20261204T0480_e05_releer_riders.sql'
    const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-e05-releer-riders-20261022.json', 'utf8')).contexto
    expect(porQueNoSoloAnade(ruta, readFileSync(ruta, 'utf8'), medida)).toMatch(/reemplaza funcion public\.conta_lote_(pedidos_app|cruce_guardar)/)
  })
  it('la 0770 del D03 cambia _compras_factura_desde_papel (que existe) y la 0780 cambia datos: las dos, solo en ROLLBACK', () => {
    const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-d03-recibida-pdf-20261023.json', 'utf8')).contexto
    const f0770 = 'supabase/migrations/20261206T0770_d03_recibida_pdf_sin_recepcion.sql', f0780 = 'supabase/migrations/20261206T0780_d03_recibida_pdf_datos.sql'
    expect(porQueNoSoloAnade(f0770, readFileSync(f0770, 'utf8'), medida)).toMatch(/reemplaza funcion public\._compras_factura_desde_papel/)
    expect(porQueNoSoloAnade(f0780, readFileSync(f0780, 'utf8'), medida)).toMatch(/cambia_datos tabla public\.supplier_invoice/)
  })
  it('la 0790 del D03 solo añade (columnas que admiten nulos, dos tablas y tres funciones nuevas): desde la rama va de verdad', () => {
    const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-d03-recibida-pdf-20261023.json', 'utf8')).contexto
    const f0790 = 'supabase/migrations/20261206T0790_d03_recibida_guardar.sql'
    expect(porQueNoSoloAnade(f0790, readFileSync(f0790, 'utf8'), medida)).toBeNull()
  })
  it('la 0490 del S02 · PR 3 cambia el calendario (que existe): solo en ROLLBACK; sin él, las tres nuevas solo añadirían', () => {
    const ruta = 'supabase/migrations/20261205T0490_s02_cifras.sql'
    const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-s02-cifras-20261023.json', 'utf8')).contexto
    expect(porQueNoSoloAnade(ruta, readFileSync(ruta, 'utf8'), medida)).toMatch(/reemplaza funcion public\.conta_impuesto_calendario/)
    expect(porQueNoSoloAnade(ruta, readFileSync(ruta, 'utf8'), { tablas: [], funciones: [] })).toBeNull()
  })
  it('la 0800 del D06 cambia los dos CHECK de payment_method y conta_factura_desde_lectura (que existen), y la 0810 cambia datos: las dos, solo en ROLLBACK', () => {
    const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-d06-prepago-y-pdf-20261023.json', 'utf8')).contexto
    const f0800 = 'supabase/migrations/20261207T0800_d06_prepago_y_pdf_bueno.sql', f0810 = 'supabase/migrations/20261207T0810_d06_riders_prepago.sql'
    expect(porQueNoSoloAnade(f0800, readFileSync(f0800, 'utf8'), medida)).not.toBeNull()
    expect(porQueNoSoloAnade(f0810, readFileSync(f0810, 'utf8'), medida)).toMatch(/cambia_datos tabla public\.supplier/)
  })
  it('una función nueva solo añade; la misma, si ya existe, la cambia; una prueba de staging nunca va de verdad', () => {
    const sql = 'create or replace function public.nueva_w05(p uuid) returns int language sql as $$ select 1 $$;'
    expect(porQueNoSoloAnade('supabase/migrations/x.sql', sql, { tablas: [], funciones: [] })).toBeNull()
    expect(porQueNoSoloAnade('supabase/migrations/x.sql', sql, { tablas: [], funciones: ['public.nueva_w05(uuid)'] })).toMatch(/reemplaza/)
    expect(porQueNoSoloAnade('supabase/staging/sql/x_prueba.sql', sql, { tablas: [], funciones: [] })).toMatch(/no es una migración/)
  })
  it('borrar, cambiar datos o hacer obligatoria una columna no es añadir', () => {
    for (const sql of ['drop table public.company;', 'update public.company set color = null;', 'alter table public.company alter column legal_name set not null;']) {
      expect(porQueNoSoloAnade('supabase/migrations/x.sql', sql, conCompany), sql).not.toBeNull()
    }
  })
})

// F01, respuesta 4 (27/10): el #358 se fusionó con una semilla de Folvy que el
// workflow de staging no admitía, y el run de main de después (#677) cayó entero.
describe('qué rutas admite el manifiesto de staging (una sola regla)', () => {
  it('las semillas de Folvy, de contabilidad y de reparto, las migraciones y las pruebas, sí; lo demás y «..», no', () => {
    for (const f of [
      'supabase/seeds/folvy/seed_f01_marcas_last_staging.sql',
      'supabase/seeds/conta/seed_autoconteo_e2e_staging.sql',
      'supabase/seeds/reparto/x.sql',
      'supabase/migrations/20261027T1320_f01_marcas_last.sql',
      'supabase/staging/sql/20261027_f01_marcas_last_prueba.sql',
    ]) expect(rutaNoAdmitida(f)).toBeNull()
    for (const f of ['supabase/seeds/x.sql', 'supabase/functions/a/index.ts', 'supabase/seeds/folvy/../../x.sql', 'supabase/seeds/folvy/x.txt']) {
      expect(rutaNoAdmitida(f)).not.toBeNull()
    }
  })
  it('el #677: el manifiesto de main tras fusionar el #358 nombraba la semilla de Folvy, y ahora pasa', () => {
    const lineasDe358 = lineas(execFileSync('git', ['show', '45024cad:supabase/staging/tandas/folvy/claude-f01-marcas-last.txt'], { encoding: 'utf8' }))
    expect(lineasDe358).toContain('supabase/seeds/folvy/seed_f01_marcas_last_staging.sql')
    expect(lineasDe358.filter((f) => rutaNoAdmitida(f))).toEqual([])
  })
  it('todo el manifiesto de hoy (el cerrado y las tandas de cada rama) lo admite el workflow', () => {
    expect(lineas(textoDelManifiesto()).map(ruta).filter((f) => rutaNoAdmitida(f))).toEqual([])
  })
  it('el workflow que aplica y el que revisa el PR usan esta regla, y no una suya', () => {
    const aplicar = readFileSync('.github/workflows/aplicar-staging-conta.yml', 'utf8')
    expect(aplicar).toContain('node scripts/conta/staging-tanda.mjs rutas $(cat /tmp/tanda.txt)')
    expect(aplicar).toContain("- 'supabase/seeds/folvy/**'")
    expect(aplicar).not.toMatch(/grep -qE '\^supabase\/\(migrations/)
    const pr = readFileSync('.github/workflows/pr-a-main.yml', 'utf8')
    expect(pr).toContain('node scripts/conta/staging-tanda.mjs nuevas "$BASE"')
    expect(pr).toContain('node scripts/conta/staging-tanda.mjs rutas')
    expect(RUTA_STAGING.source).toContain('seeds\\/folvy')
  })
})

describe('«otra vez:»: lo que entró en el manifiesto y su run no aplicó', () => {
  it('una línea que ya estaba no es nueva; con «otra vez:» sí, y pasa su ruta una sola vez', () => {
    expect(nuevas('a.sql\n', 'a.sql\n')).toEqual([])
    expect(nuevas('a.sql\n', 'a.sql\notra vez: a.sql\n')).toEqual(['a.sql'])
    expect(nuevas('', 'otra vez: a.sql\na.sql\n')).toEqual(['a.sql'])
    expect(nuevas('a.sql\notra vez: a.sql\n', 'a.sql\notra vez: a.sql\n')).toEqual([])
    expect(ruta('otra vez:   supabase/x.sql')).toBe('supabase/x.sql')
  })
  it('la tanda de esta rama pasa lo del #358 que no llegó, en el orden de su manifiesto y sin su prueba', () => {
    const t = readFileSync('supabase/staging/tandas/folvy/claude-f01-a-staging.txt', 'utf8')
    expect(nuevas(textoDelManifiesto('45024cad'), `${textoDelManifiesto('45024cad')}\n${t}`)).toEqual([
      'supabase/migrations/20261027T1320_f01_marcas_last.sql',
      'supabase/seeds/folvy/seed_f01_marcas_last_staging.sql',
      'supabase/migrations/20261027T1322_f01_sembrado_y_socio.sql',
      'supabase/migrations/20261027T1321_f01_socios_y_el_delicioso.sql',
    ])
  })
})

describe('la tanda del S01 (Respuesta 3): qué va de verdad desde la rama', () => {
  const ctx = { tablas: ['conta_enlace_pago', 'journal_entry', 'treasury_account', 'company', 'accounts', 'company_account', 'bank_match'], funciones: [] as string[] }
  const f = (n: string) => `supabase/migrations/${n}`
  it('la 2238 llama a _s01_asiento_cobro: solo en ROLLBACK, aunque solo cree su copia', () => {
    const n = f('20261027T2238_s01_cobros_sin_asiento.sql')
    expect(porQueNoSoloAnade(n, readFileSync(n, 'utf8'), ctx)).toMatch(/llama a public\._s01_asiento_cobro\(\)/)
  })
  it('la 2030 sigue siendo «solo añade»', () => {
    const n = f('20261027T2030_s01_redsys_y_abono.sql')
    expect(porQueNoSoloAnade(n, readFileSync(n, 'utf8'), ctx)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// W07 (Julio, 28/10): las semillas de una rama llegan a staging si se pueden
// aplicar dos veces, y eso lo demuestra el ensayo (dos veces en ROLLBACK, la
// misma medida), no su cabecera.
describe('W07 · qué semilla se puede intentar que vaya de verdad', () => {
  const sem = 'supabase/seeds/folvy/x.sql'
  it('una con «on conflict do nothing» sí', () => {
    expect(porQueNoVaLaSemilla(sem, `insert into public.t (id, nombre) values (1, 'a') on conflict (id) do nothing;`)).toBeNull()
    expect(porQueNoVaLaSemilla(sem, `do $$ begin insert into public.t (id) values (1) on conflict do nothing; end $$;`)).toBeNull()
  })
  it('una con un insert a secas se queda en ROLLBACK, con su motivo', () => {
    expect(porQueNoVaLaSemilla(sem, `insert into public.t (id) values (1);`))
      .toBe('inserta en public.t sin «on conflict» ni «not exists»: la segunda vez duplica')
  })
  it('una que llama a una función que escribe se queda en ROLLBACK (la regla del S01, #363)', () => {
    expect(porQueNoVaLaSemilla(sem, `select public.journal_entry_validar('x');`))
      .toBe('al aplicarse llama a public.journal_entry_validar(), que puede escribir donde la medida no mira')
    expect(porQueNoVaLaSemilla(sem, `do $$ begin perform public.conta_cerrar_mes('x'); end $$;`)).toMatch(/^al aplicarse llama a public\.conta_cerrar_mes\(\)/)
  })
  it('la que llama a una función que crea ella misma, sí; su cuerpo no cuenta como «al aplicarse»', () => {
    const sql = `create or replace function public.e2e_x() returns void language plpgsql as $$ begin update public.t set n = 1; perform public.otra(); end $$;
                 insert into public.t (id) values (1) on conflict do nothing;`
    expect(porQueNoVaLaSemilla(sem, sql)).toBeNull()
    expect(tablasQueEscribe(sql)).toEqual(['public.t'])
    expect(funcionesQueCrea(sql)).toEqual(['e2e_x'])
  })
  it('update, delete o truncate al aplicarse: cambian lo que leen las demás ramas', () => {
    expect(porQueNoVaLaSemilla(sem, `update public.supplier set nif = 'x' where id = '1';`)).toMatch(/^update public\.supplier al aplicarse/)
    expect(porQueNoVaLaSemilla(sem, `do $$ begin if true then delete from public.t where id = 1; end if; end $$;`)).toMatch(/^delete from public\.t al aplicarse/)
  })
  it('un insert guardado con «if not exists» o «where not exists» sí (lo prueba la medida doble)', () => {
    expect(porQueNoVaLaSemilla(sem, `do $$ begin if not exists (select 1 from public.t where id = 1) then insert into public.t (id) values (1); end if; end $$;`)).toBeNull()
    expect(porQueNoVaLaSemilla(sem, `insert into public.t (id) select 1 where not exists (select 1 from public.t where id = 1);`)).toBeNull()
  })
  it('una migración o una prueba no son semillas', () => {
    expect(porQueNoVaLaSemilla('supabase/migrations/x.sql', 'select 1;')).toBe('no es una semilla')
  })
  it('las semillas de hoy (regla 31): la del F01 (#358) pasa; la del R02 (update) y la del autoconteo (llama a una función) no', () => {
    const leer = (f: string) => readFileSync(f, 'utf8')
    expect(porQueNoVaLaSemilla('supabase/seeds/folvy/seed_f01_marcas_last_staging.sql', leer('supabase/seeds/folvy/seed_f01_marcas_last_staging.sql'))).toBeNull()
    expect(porQueNoVaLaSemilla('supabase/seeds/reparto/seed_r02_e2e.sql', leer('supabase/seeds/reparto/seed_r02_e2e.sql'))).toMatch(/^update public\.locations/)
    expect(porQueNoVaLaSemilla('supabase/seeds/conta/seed_autoconteo_e2e_staging.sql', leer('supabase/seeds/conta/seed_autoconteo_e2e_staging.sql')))
      .toMatch(/^al aplicarse llama a public\.recompute_location_stock_core\(\)/)
  })
  it('el workflow mide dos veces antes de pasar una semilla de verdad, y la pasa sin registro de definiciones', () => {
    const w = readFileSync('.github/workflows/aplicar-staging-conta.yml', 'utf8')
    expect(w).toContain('node "$S" semilla $(cat /tmp/semillas.txt)')
    expect(w).toContain('node "$S" semilla-dos-veces "$f" $(cat /tmp/previas.txt)')
    expect(w).toContain(`if [ "$r" = 'W07|igual' ]; then`)
    expect(w).toContain('SIN_DEFINICIONES=1 bash scripts/conta/staging/de-verdad.sh')
  })
})

// La medida doble y el «de verdad» de una semilla, contra un Postgres DE VERDAD
// (regla 31), con el psql que genera staging-tanda.mjs y el de-verdad.sh de verdad.
const binPg = (() => {
  const base = '/usr/lib/postgresql'
  if (!existsSync(base)) return null
  const v = readdirSync(base).filter((d) => existsSync(join(base, d, 'bin', 'pg_ctl'))).sort().pop()
  return v ? join(base, v, 'bin') : null
})()
const pgListo = !!binPg && spawnSync('psql', ['--version']).status === 0
describe.skipIf(!pgListo)('W07 · dos veces en ROLLBACK, la misma medida (en un Postgres de verdad)', () => {
  const PUERTO = String(58000 + Math.floor(Math.random() * 900))
  let dir = ''
  const comoPostgres = userInfo().uid === 0
  const run = (exe: string, args: string[]) =>
    comoPostgres ? spawnSync('runuser', ['-u', 'postgres', '--', exe, ...args], { encoding: 'utf8' }) : spawnSync(exe, args, { encoding: 'utf8' })
  const url = () => `postgresql://postgres@/postgres?host=${dir}&port=${PUERTO}`
  const psql = (args: string[]) => spawnSync('psql', [url(), '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8' })
  const sql = (q: string) => { const r = psql(['-c', q]); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim() }
  /** Escribe la semilla en un fichero y pasa su psql de dos veces: la línea W07. */
  function dosVeces(texto: string): string {
    const f = join(dir, `semilla-${Math.random().toString(36).slice(2)}.sql`)
    writeFileSync(f, texto)
    const g = join(dir, 'dos.sql')
    writeFileSync(g, sqlDosVeces(f))
    const r = psql(['-f', g])
    return r.status === 0 ? r.stdout.trim().split('\n').filter((l) => l.startsWith('W07|')).pop()! : `ERROR ${r.stderr}`
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'w07-'))
    if (comoPostgres) { chmodSync(dir, 0o777); chownSync(dir, 102, 104) }
    const ini = run(join(binPg!, 'initdb'), ['-D', join(dir, 'datos'), '-A', 'trust', '-U', 'postgres', '--no-sync'])
    if (ini.status !== 0) throw new Error(ini.stderr)
    const arr = run(join(binPg!, 'pg_ctl'), ['-D', join(dir, 'datos'), '-o', `-k ${dir} -p ${PUERTO} -c listen_addresses='' -c fsync=off`, '-w', 'start', '-l', join(dir, 'log')])
    if (arr.status !== 0) throw new Error(arr.stderr || readFileSync(join(dir, 'log'), 'utf8'))
    sql(`create table public.t (id int primary key, nombre text, creado timestamptz default now()); insert into public.t values (9, 'de antes')`)
  }, 60_000)
  afterAll(() => {
    if (dir) run(join(binPg!, 'pg_ctl'), ['-D', join(dir, 'datos'), '-m', 'immediate', 'stop'])
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('con «on conflict do nothing» y una función: igual las dos veces, y no deja nada (ROLLBACK)', () => {
    expect(dosVeces(`insert into public.t (id, nombre) values (1, 'a'), (2, 'b') on conflict (id) do nothing;
      create or replace function public.e2e_w07() returns int language sql as $$ select 7 $$;`)).toBe('W07|igual')
    expect(sql('select count(*) from public.t')).toBe('1')
    expect(sql(`select count(*) from pg_proc where proname = 'e2e_w07'`)).toBe('0')
  })
  it('con un insert a secas (si se colara): la segunda vez falla por la clave y no va', () => {
    expect(dosVeces(`insert into public.t (id, nombre) values (3, 'c');`)).toMatch(/^ERROR .*duplicate key/s)
  })
  it('la cabecera no basta: «on conflict do nothing» con una clave nueva cada vez da otra medida', () => {
    expect(dosVeces(`insert into public.t (id, nombre) select (select coalesce(max(id), 0) + 1 from public.t), 'otra' on conflict do nothing;`))
      .toBe('W07|distinto|tabla public.t: 2 filas → 3 filas (otra huella)')
  })
  it('de-verdad.sh con SIN_DEFINICIONES=1: la aplica y la apunta, sin registro de definiciones', () => {
    const f = join(dir, 'de-verdad.sql')
    writeFileSync(f, `insert into public.t (id, nombre) values (4, 'd') on conflict (id) do nothing;`)
    const r = spawnSync('bash', ['scripts/conta/staging/de-verdad.sh', 'rama-w07', f], {
      encoding: 'utf8', env: { ...process.env, PSQL: 'psql', DB_URL: url(), SIN_DEFINICIONES: '1' },
    })
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toContain('Sin registro de definiciones (W07: semillas).')
    expect(sql(`select nombre from public.t where id = 4`)).toBe('d')
    expect(sql(`select count(*) from w06_staging.de_verdad where rama = 'rama-w07'`)).toBe('1')
    expect(sql(`select count(*) from w06_staging.antes_de_verdad where rama = 'rama-w07'`)).toBe('0')
  })
})

// W07b (28/10): en el segundo push de una rama, su migración ya está puesta en
// staging (W05) y ya no «solo añade»; su semilla no puede quedarse en ROLLBACK
// por ir «detrás de algo que no va de verdad» (el #361, ensayo 40642383617).
describe('W07b · lo que la rama ya pasó de verdad cuenta como que va', () => {
  const md5 = (f: string) => ({ 'supabase/migrations/1910.sql': 'aaa', 'supabase/seeds/folvy/s.sql': 'bbb' } as Record<string, string>)[f] ?? null
  it('el mismo contenido, sí; si el fichero cambió o ya no está, no', () => {
    expect(yaDeVerdad('supabase/migrations/1910.sql aaa\nsupabase/seeds/folvy/s.sql zzz\nsupabase/migrations/borrada.sql ccc\n', md5))
      .toEqual(['supabase/migrations/1910.sql'])
    expect(yaDeVerdad('', md5)).toEqual([])
  })
  it('el workflow lo lee de w06_staging.de_verdad de la rama y lo suma a lo que va', () => {
    const w = readFileSync('.github/workflows/aplicar-staging-conta.yml', 'utf8')
    expect(w).toContain(`select fichero || ' ' || md5 from w06_staging.de_verdad where rama = :'rama';`)
    expect(w).toContain('node "$S" ya-de-verdad /tmp/registro-de-verdad.txt > /tmp/ya-de-verdad.txt')
    expect(w).toContain('cat /tmp/anaden.txt /tmp/semillas-van.txt /tmp/ya-de-verdad.txt > /tmp/van.txt')
  })
})
