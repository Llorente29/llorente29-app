// tests/conta/stagingTanda.test.ts — W04 (Julio, 22/10): qué pasa por staging en cada run.
// Contra la población real (regla 31): las dos últimas fusiones de main, los
// 98 ficheros del manifiesto de hoy y las migraciones viejas que llevan COMMIT.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { lineas, nuevas, porQueNoSeEnsaya, llevaSuTransaccion, sesiones, MANIFIESTO } from '../../scripts/conta/staging-tanda.mjs'

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
  it('los 106 ficheros del manifiesto de hoy (sin W03, con la 0450, la 0460 del S02, la 0470 del D02, la 0480 del E05 y la 0490 del S02 · PR 3, cada una con su prueba) se ensayan, y 49 llevan su propia transacción', () => {
    expect(hoy).toHaveLength(106)
    expect(hoy.filter((f) => porQueNoSeEnsaya(readFileSync(f, 'utf8')))).toEqual([])
    expect(hoy.filter((f) => llevaSuTransaccion(readFileSync(f, 'utf8')))).toHaveLength(49)
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
import { porQueNoSoloAnade } from '../../scripts/conta/staging-tanda.mjs'

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
  it('la 0490 del S02 · PR 3 cambia el calendario (que existe): solo en ROLLBACK; sin él, las tres nuevas solo añadirían', () => {
    const ruta = 'supabase/migrations/20261205T0490_s02_cifras.sql'
    const medida = JSON.parse(readFileSync('tests/conta/produccion/contexto-produccion-tanda-viva.json', 'utf8')).contexto
    expect(porQueNoSoloAnade(ruta, readFileSync(ruta, 'utf8'), medida)).toMatch(/reemplaza funcion public\.conta_impuesto_calendario/)
    expect(porQueNoSoloAnade(ruta, readFileSync(ruta, 'utf8'), { tablas: [], funciones: [] })).toBeNull()
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
