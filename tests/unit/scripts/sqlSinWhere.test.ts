// tests/unit/scripts/sqlSinWhere.test.ts
//
// PC01 · arreglo urgente (26/10). La comprobación de scripts/conta/sql-sin-where.mjs,
// contra la población REAL (regla 31): las migraciones que hay en el
// repositorio. Lo que tiene que encontrar son las cinco sentencias que en
// producción paraba safeupdate (medido en pg_proc el 26/10: tres funciones,
// cinco «delete» sin «where»). Y no puede saltar con lo que no es un UPDATE: los
// 106 «on conflict … do update set» de 86 migraciones.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error módulo .mjs sin tipos
import { sentenciasSinWhere } from '../../../scripts/conta/sql-sin-where.mjs'

type Hallazgo = { linea: number; sentencia: string }
const leer = (f: string) => readFileSync(`supabase/migrations/${f}`, 'utf8')
const de = (texto: string): Hallazgo[] => sentenciasSinWhere(texto)

describe('las cinco que paraba safeupdate en producción', () => {
  it('_conta_liquidacion_cobros (0916 del PC01): las tres temporales, en su línea', () => {
    expect(de(leer('20261025T0916_pc01_motor_cobros_pagos.sql'))).toEqual([
      { linea: 275, sentencia: 'delete from _pc01_pedidos' },
      { linea: 275, sentencia: 'delete from _pc01_antes' },
      { linea: 275, sentencia: 'delete from _pc01_ahora' },
    ])
  })
  it('_compras_fin_de_mes y recost_sales_for_product', () => {
    expect(de(leer('20261017T0150_compras_pendiente_y_fin_de_mes.sql'))).toEqual([{ linea: 184, sentencia: 'delete from _fin_de_mes' }])
    expect(de(leer('20260726T1400_fiabilidad_almacen_cola_y_automapeo.sql'))).toEqual([{ linea: 607, sentencia: 'delete from _recost_sales' }])
  })
  it('la 0642 que las arregla no trae ninguna', () => {
    expect(de(leer('20261026T0642_pc01_sin_delete_sin_where.sql'))).toEqual([])
  })
})

describe('lo que no es un UPDATE sin WHERE no salta', () => {
  it('ninguno de los «on conflict … do update set» de las migraciones', () => {
    const conConflict = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql') && /do update set/i.test(leer(f)))
    expect(conConflict.length).toBeGreaterThanOrEqual(86)
    const saltan = conConflict.flatMap((f) => de(leer(f)).filter((h) => /\bdo\s+update\b/i.test(leer(f).split('\n')[h.linea - 1])).map((h) => `${f}:${h.linea}`))
    expect(saltan).toEqual([])
  })
  it('for update, los disparadores y los permisos', () => {
    expect(de(`select * from t where id = 1 for update skip locked;
create trigger x before delete or update on t for each row execute function f();
create trigger y after update of a on t for each row execute function f();
grant select, update, delete on t to authenticated;
alter table t add constraint c foreign key (a) references u(id) on delete cascade on update cascade;`)).toEqual([])
  })
  it('lo que va en un comentario no cuenta', () => {
    expect(de(`-- delete from t;\n/* update t set a = 1; */\nselect 1;`)).toEqual([])
  })
})

describe('lo que sí salta, y por qué', () => {
  it('el WHERE de una subconsulta no es el de la sentencia', () => {
    expect(de(`update t set a = (select max(b) from u where u.id = 1);`)).toEqual([{ linea: 1, sentencia: 'update t set a = (select max(b) from u where u.id = 1)' }])
    expect(de(`update t set a = 1 where id in (select id from u);`)).toEqual([])
  })
  it('un DELETE dentro de una CTE acaba en su paréntesis', () => {
    expect(de(`with d as (delete from t returning id) select count(*) from d where true;`)).toEqual([{ linea: 1, sentencia: 'delete from t returning id' }])
  })
  it('el SQL dinámico de una cadena', () => {
    expect(de(`do $$ begin execute format('delete from %I', 'x'); end $$;`).map((h) => h.sentencia)).toEqual(['delete from %I'])
    expect(de(`do $$ begin execute 'update t set a = 1 where id = 2'; end $$;`)).toEqual([])
  })
  it('con alias y con only', () => {
    expect(de(`update only public.t as x set a = 1;\nupdate public.t x set a = 1;`).map((h) => h.linea)).toEqual([1, 2])
  })
  it('«where true» vale; «-- sin where:» con su porqué, en la línea o en la de encima, también', () => {
    expect(de(`delete from _tmp where true;`)).toEqual([])
    expect(de(`-- sin where: corre una vez, como postgres; nadie la llama desde la app\nupdate t set a = 1;`)).toEqual([])
    expect(de(`update t set a = 1; -- sin where: una vez, como postgres`)).toEqual([])
    expect(de(`-- sin where:\nupdate t set a = 1;`)).toHaveLength(1)
  })
})
