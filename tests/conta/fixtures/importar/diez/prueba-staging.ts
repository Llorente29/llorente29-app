// tests/conta/fixtures/importar/diez/prueba-staging.ts
//
// C02c · GENERA la prueba de staging de «traer el plan» con la fixture
// inventada (tests/conta/fixtures/importar/diez/) y el MISMO núcleo que usa la
// pantalla (importarPlan.ts + propuestaImportacion.ts). Así la base recibe
// exactamente lo que le mandaría el asistente.
//
//   npx tsx tests/conta/fixtures/importar/diez/prueba-staging.ts
//
// Escribe supabase/staging/sql/20261008_c02c_prueba_traer.sql. Las fichas de
// Folvy de la fixture entran en la cuenta A con uuid fijos, dentro del ROLLBACK.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adivinarColumnas, juntar, leerTabla, partirCsv, resumir, type Lectura } from '../../../../../src/modules/conta/lib/importarPlan'
import { cifras, cuentasEnlazadas, decidir, planTraer, proponer, validar, type FichaBanco, type FichaProveedor } from '../../../../../src/modules/conta/lib/propuestaImportacion'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const dir = join(raiz, 'tests/conta/fixtures/importar/diez')
const serie = JSON.parse(readFileSync(join(raiz, 'supabase/conta/pgc/serie.json'), 'utf8')) as { cuentas: { plan: string; code: string; is_leaf: boolean; valid_to: string | null }[] }
const hojas = new Set(serie.cuentas.filter((c) => c.plan === 'pymes' && c.is_leaf && !c.valid_to).map((c) => c.code))
const folvy = JSON.parse(readFileSync(join(dir, 'folvy.json'), 'utf8')) as { proveedores: { name: string; nif: string | null }[]; bancos: { name: string; iban: string }[] }

const uuid = (n: number) => `c02c0000-0000-4000-8000-${String(n).padStart(12, '0')}`
const proveedores: FichaProveedor[] = folvy.proveedores.map((p, i) => ({ id: uuid(i + 1), name: p.name, nif: p.nif }))
const bancos: FichaBanco[] = folvy.bancos.map((b, i) => ({ id: uuid(100 + i), name: b.name, iban: b.iban }))

function leer(f: string, conDireccion: boolean): Lectura {
  const filas = partirCsv(readFileSync(join(dir, f), 'utf8'))
  const { columnas, cabecera } = adivinarColumnas(filas)
  if (!columnas) throw new Error(f)
  const l = leerTabla('diez', filas, columnas, cabecera)
  if (!conDireccion) return l
  const cab = filas[0]
  const fila = new Map(filas.slice(1).map((r) => [r[0], r]))
  const v = (code: string, k: string) => fila.get(code)?.[cab.indexOf(k)] ?? null
  return { ...l, terceros: l.terceros.map((t) => ({ ...t, direccion: v(t.code, 'direccion'), cp: v(t.code, 'cp'), poblacion: v(t.code, 'poblacion'), provincia: v(t.code, 'provincia') })) }
}
const lectura = juntar('diez', [leer('plan.csv', false), leer('proveedores.csv', true), leer('clientes.csv', true)])
const r = resumir(lectura, { plan: 'pymes', digitos: 8 }, hojas)
if (!r.ok) throw new Error(r.motivo ?? 'no')
let filas = proponer({ cuentas: r.cuentas, terceros: lectura.terceros, proveedores, bancos, programa: 'Cegid Diez' })
// Lo que decidiría la persona en «decide tú»: 47510015 → 111, 47510019 → ninguno, 43000006 → solo cliente, el resto → cuenta suya sin ficha.
for (const f of filas.filter((x) => x.decision.tipo === 'pendiente')) {
  const id = f.code === '47510015' ? '111' : f.code === '47510019' ? 'ninguno' : f.code === '43000006' ? 'cliente_c03' : 'sin_ficha'
  filas = decidir(filas, f.code, (f.opciones.find((o) => o.id === id) ?? f.opciones[0]).decision)
}
const problemas = validar(filas)
if (problemas.length) throw new Error(problemas.map((p) => p.texto).join('\n'))
const plan = planTraer(filas, r.cuentas, lectura.terceros)
const k = cifras(filas)
const enlazadas = cuentasEnlazadas(plan)
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`
const planJson = JSON.stringify(plan)

const sql = `-- supabase/staging/sql/20261008_c02c_prueba_traer.sql
--
-- GENERADO por tests/conta/fixtures/importar/diez/prueba-staging.ts (no se edita a mano).
-- C02c · Prueba de la 0100/0110/0120 en staging-conta con la fixture INVENTADA
-- (tests/conta/fixtures/importar/diez/), con el JWT de verdad de los
-- administradores de A y de B (pasa por la RLS). Termina en ROLLBACK.
--
-- Lo que manda el asistente (planTraer, el mismo núcleo de la pantalla):
--   ${plan.cuentas.length} cuentas tuyas · ${plan.crear.length} fichas nuevas · ${plan.enlaces.length} enlaces a proveedores y bancos (${enlazadas} cuentas) · ${plan.retenciones.length} retenciones con modelo
--   cifras de la revisión: ${k.tal} tal cual · ${k.revisar} para revisar · ${k.cambian} cambian · ${k.nuevas} nuevas
--
--   1. Traer: importar y activar en un paso. Código exacto, nombre de la ficha,
--      nombre de Diez en name_source; ficha nueva por completar; la 430 como
--      pago; IVA por tipo además del 472/477 común; 111 a la 47510015; el
--      banco de Folvy que no venía, a la siguiente libre (57200003).
--   2. La propuesta de la IA para un proveedor que no venía: 40000019.
--   3. No se trae dos veces; la activación normal tampoco pisa lo traído.
--   4. Deshacer entero: vuelve a «sin activar» y se van las fichas nuevas;
--      volver a traer el mismo fichero da lo mismo (nada duplicado).
--   5. Deshacer se bloquea si una ficha nueva ya se ha usado (un pedido).
--   6. Con una revisión a medias, «empiezo de cero» espera.
--   7. B no ve ni toca la importación de A.
--   8. Vuelta atrás de la 0120, 0110 y 0100.

begin;

\\echo '>>> 0. Desde cero: sin plan en la empresa de A (dentro del ROLLBACK) y la fixture de Folvy en A'
delete from public.company_account_link where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
delete from public.company_account_log where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
delete from public.company_account where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
delete from public.ai_suggestion where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and kind = 'plan';
insert into public.supplier (id, account_id, name, tax_id) values
${proveedores.map((p) => `  (${lit(p.id)}, 'c01a0000-0000-4000-8000-00000000000a', ${lit(p.name)}, ${p.nif ? lit(p.nif) : 'null'})`).join(',\n')};
insert into public.treasury_account (id, account_id, company_id, kind, name, iban) values
${bancos.map((b) => `  (${lit(b.id)}, 'c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'bank', ${lit(b.name)}, ${lit(b.iban!)})`).join(',\n')};

\\echo '>>> 1-6. Como el administrador de A'
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  plan constant jsonb := ${lit(planJson)}::jsonb;
  huella constant text := '${'a'.repeat(64)}';
  imp uuid; r jsonb; r2 jsonb; v text; n int; n2 int; fallo text; glovo uuid; usada uuid;
begin
  -- 6 · Con una revisión a medias, «empiezo de cero» espera.
  imp := public.company_chart_import_save(emp, 'diez', array['plan.csv', 'proveedores.csv', 'clientes.csv'], huella, '{"filas": []}'::jsonb, 'Prueba C02c');
  begin
    perform public.company_chart_activate(emp, false, 'Prueba C02c');
    raise exception 'PRUEBA C02c: se activa con numeración automática con una importación a medias';
  exception when check_violation then fallo := sqlerrm; end;
  if fallo not like 'Tienes a medias traer tu plan%' then raise exception 'PRUEBA C02c: mensaje de espera = %', fallo; end if;
  -- Guardar otra vez la misma empresa no abre otra: es la misma importación.
  if public.company_chart_import_save(emp, 'diez', array['plan.csv'], huella, '{"filas": [1]}'::jsonb) <> imp then raise exception 'PRUEBA C02c: guardar dos veces abre dos importaciones'; end if;

  -- 1 · Traer.
  r := public.company_chart_import_apply(imp, plan, 'Prueba C02c');
  raise notice 'PRUEBA C02c · traer: %', r;
  if (r->>'cuentas')::int <> ${plan.cuentas.length} then raise exception 'PRUEBA C02c: cuentas traídas = %', r->>'cuentas'; end if;
  if (r->>'fichas')::int <> ${plan.crear.length} then raise exception 'PRUEBA C02c: fichas nuevas = %', r->>'fichas'; end if;
  if (select count(*) from public.company_account where company_id = emp and source = 'migrated') <> ${plan.cuentas.length} then raise exception 'PRUEBA C02c: migrated ≠ ${plan.cuentas.length}'; end if;
  if (select count(*) from public.company_account where company_id = emp and kind = 'template') <> ${hojas.size} then raise exception 'PRUEBA C02c: hojas de serie ≠ ${hojas.size}'; end if;
  -- Código exacto, nombre de la ficha, nombre de Diez aparte.
  select name || ' | ' || name_source into v from public.company_account where company_id = emp and code = '40000001';
  if v is distinct from 'Proveedores · Distribuciones Alba Oriente | DISTRIBUCIONES ALBA ORIENTE' then raise exception 'PRUEBA C02c: 40000001 = %', v; end if;
  if (select entity_id from public.company_account_link l join public.company_account a on a.id = l.company_account_id where a.company_id = emp and a.code = '40000001' and l.role = 'principal') <> '${uuid(1)}' then
    raise exception 'PRUEBA C02c: 40000001 no va a su ficha';
  end if;
  -- De serie: nombre oficial, el de Diez en name_source.
  select name || ' | ' || coalesce(name_source, '-') into v from public.company_account where company_id = emp and code = '47200000';
  if v is distinct from 'Hacienda Pública, IVA soportado | HACIENDA PÚBLICA, IVA SOPORTADO' then raise exception 'PRUEBA C02c: 47200000 = %', v; end if;
  -- Un tercero en dos cuentas: 40000003 principal y 43000005 pago, la misma ficha.
  select string_agg(a.code || ':' || l.role, ' ' order by a.code) into v from public.company_account_link l join public.company_account a on a.id = l.company_account_id
   where a.company_id = emp and l.entity = 'supplier' and l.entity_id = '${uuid(3)}';
  if v is distinct from '40000003:principal 43000005:pago' then raise exception 'PRUEBA C02c: Norte Socios = %', v; end if;
  -- Ficha nueva por completar (41000001, con su NIF y su población) y la 430 de Glovo como pago de ella.
  select s.id into glovo from public.supplier s where s.account_id = 'c01a0000-0000-4000-8000-00000000000a' and s.import_id = imp and s.name = 'GLOVOAPP SPAIN PLATFORM' and s.tax_id is not null and s.fiscal_city = 'MADRID';
  if glovo is null then raise exception 'PRUEBA C02c: no se crea la ficha de 41000001 por completar'; end if;
  select string_agg(a.code || ':' || l.role, ' ' order by a.code) into v from public.company_account_link l join public.company_account a on a.id = l.company_account_id
   where a.company_id = emp and l.entity = 'supplier' and l.entity_id = glovo::text;
  if v is distinct from '41000001:principal 43000001:pago' then raise exception 'PRUEBA C02c: Glovo = %', v; end if;
  -- IVA: el común de Diez sigue; además, por tipo.
  select string_agg(code, ' ' order by code) into v from public.company_account where company_id = emp and template_code = '472';
  if v is distinct from '47200000 47200004 47200010 47200021' then raise exception 'PRUEBA C02c: 472 = %', v; end if;
  -- Retenciones: las del 111 a la 47510015; la del alquiler (115) a la 47510001; 47510019 sin enlace.
  select string_agg(distinct a.code || ':' || w.filed_in, ' ') into v from public.company_account_link l join public.company_account a on a.id = l.company_account_id
    join public.withholding_rate w on w.id::text = l.entity_id where a.company_id = emp and l.entity = 'withholding_rate' and w.filed_in in ('111', '115');
  if v is distinct from '47510001:115 47510015:111' then raise exception 'PRUEBA C02c: retenciones = %', v; end if;
  if exists (select 1 from public.company_account_link l join public.company_account a on a.id = l.company_account_id where a.company_id = emp and a.code = '47510019') then raise exception 'PRUEBA C02c: 47510019 enlazada'; end if;
  -- Bancos: el de la fixture por IBAN a 57200001; el que ya tenía A, a la siguiente libre.
  if (select a.code from public.company_account_link l join public.company_account a on a.id = l.company_account_id where a.company_id = emp and l.entity_id = '${uuid(100)}') <> '57200001' then raise exception 'PRUEBA C02c: el banco por IBAN no va a 57200001'; end if;
  select string_agg(a.code, ' ' order by a.code) into v from public.company_account_link l join public.company_account a on a.id = l.company_account_id where a.company_id = emp and l.entity = 'bank_account';
  if v is distinct from '57200001 57200003' then raise exception 'PRUEBA C02c: bancos = %', v; end if;
  -- Sin ficha: 43000004 (cliente hasta el C03) y 41000100 (Riders) entran con su número y sin enlace.
  if exists (select 1 from public.company_account_link l join public.company_account a on a.id = l.company_account_id where a.company_id = emp and a.code in ('43000004', '41000100')) then raise exception 'PRUEBA C02c: una cuenta sin ficha tiene enlace'; end if;
  -- Una entrada en «Lo que ha hecho Folvy».
  select detalle into v from public.company_account_log where company_id = emp and que = 'importado';
  if v is distinct from 'Plan traído de Cegid Diez · ${plan.cuentas.length} cuentas · ${enlazadas} enlaces · ${plan.crear.length} fichas nuevas' then raise exception 'PRUEBA C02c: registro = %', v; end if;
  raise notice 'PRUEBA C02c · 1 en verde';

  -- 2 · La IA propondría a «Hielo Polar del Barrio» (no venía en Diez) la siguiente libre dentro de lo traído.
  -- (company_account_siguiente es interna; la misma regla aquí: el primer número libre desde 1.)
  select '4000' || lpad(min(i)::text, 4, '0') into v from generate_series(1, 9999) i
   where not exists (select 1 from public.company_account where company_id = emp and code = '4000' || lpad(i::text, 4, '0'));
  if v <> '40000019' then raise exception 'PRUEBA C02c: siguiente libre = %', v; end if;
  raise notice 'PRUEBA C02c · 2 en verde';

  -- 3 · No se trae dos veces ni se activa encima.
  begin perform public.company_chart_import_apply(imp, plan); raise exception 'PRUEBA C02c: se trae dos veces';
  exception when check_violation then null; end;
  begin perform public.company_chart_import_save(emp, 'diez', array['plan.csv'], huella, '{}'::jsonb); raise exception 'PRUEBA C02c: se guarda otra encima de lo traído';
  exception when unique_violation then null; end;
  begin perform public.company_chart_activate(emp, false); raise exception 'PRUEBA C02c: se activa encima de lo traído';
  exception when unique_violation then null; end;
  raise notice 'PRUEBA C02c · 3 en verde';

  -- 4 · Deshacer entero y volver a traer: lo mismo, nada duplicado.
  select count(*) into n from public.company_account where company_id = emp;
  select count(*) into n2 from public.company_account_link where company_id = emp;
  r2 := public.company_chart_import_undo(imp, 'Prueba C02c');
  if exists (select 1 from public.company_account where company_id = emp) then raise exception 'PRUEBA C02c: deshacer deja cuentas'; end if;
  if exists (select 1 from public.supplier where import_id = imp) then raise exception 'PRUEBA C02c: deshacer deja fichas nuevas'; end if;
  if (select count(*) from public.supplier where id::text like 'c02c0000-%') <> ${proveedores.length} then raise exception 'PRUEBA C02c: deshacer toca fichas que ya existían'; end if;
  if (select status from public.company_chart_import where id = imp) <> 'deshecha' then raise exception 'PRUEBA C02c: la importación no queda deshecha'; end if;
  if not exists (select 1 from public.company_account_log where company_id = emp and que = 'importacion_deshecha') then raise exception 'PRUEBA C02c: deshacer sin registro'; end if;
  imp := public.company_chart_import_save(emp, 'diez', array['plan.csv', 'proveedores.csv', 'clientes.csv'], huella, '{}'::jsonb);
  r := public.company_chart_import_apply(imp, plan);
  if (select count(*) from public.company_account where company_id = emp) <> n or (select count(*) from public.company_account_link where company_id = emp) <> n2 then
    raise exception 'PRUEBA C02c: volver a traer no da lo mismo (% cuentas, antes %)', (select count(*) from public.company_account where company_id = emp), n;
  end if;
  if (select count(*) from public.supplier where account_id = 'c01a0000-0000-4000-8000-00000000000a' and import_id is not null) <> ${plan.crear.length} then raise exception 'PRUEBA C02c: volver a traer duplica fichas'; end if;
  raise notice 'PRUEBA C02c · 4 en verde';

  -- 5 · Una ficha nueva ya usada (un pedido) bloquea deshacer, con el porqué.
  select id into usada from public.supplier where import_id = imp limit 1;
  insert into public.purchase_order (account_id, supplier_id) values ('c01a0000-0000-4000-8000-00000000000a', usada);
  begin perform public.company_chart_import_undo(imp); raise exception 'PRUEBA C02c: deshace con una ficha usada';
  exception when check_violation then fallo := sqlerrm; end;
  if fallo not like '%ya se ha usado (1 en purchase_order)%' then raise exception 'PRUEBA C02c: porqué = %', fallo; end if;
  raise notice 'PRUEBA C02c · 5 y 6 en verde';
end $$;
reset role;

\\echo '>>> 7. Como el administrador de B: no ve ni toca la importación de A'
select set_config('prueba.imp', (select id::text from public.company_chart_import where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and status = 'traida'), true);
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare imp uuid := current_setting('prueba.imp')::uuid; fallo text;
begin
  if exists (select 1 from public.company_chart_import) then raise exception 'PRUEBA C02c: B ve importaciones de A'; end if;
  begin perform public.company_chart_import_undo(imp); raise exception 'PRUEBA C02c: B deshace lo de A';
  exception when others then fallo := sqlerrm; end;
  if fallo like 'PRUEBA C02c%' then raise exception '%', fallo; end if;
  begin perform public.company_chart_import_save('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'diez', '{}', '${'b'.repeat(64)}', '{}'::jsonb); raise exception 'PRUEBA C02c: B guarda en la empresa de A';
  exception when others then fallo := sqlerrm; end;
  if fallo like 'PRUEBA C02c%' then raise exception '%', fallo; end if;
  raise notice 'PRUEBA C02c · 7 en verde';
end $$;
reset role;

\\echo '>>> 8. Vuelta atrás (0120, 0110 y 0100)'
\\ir ../../vuelta-atras/20261008T0120_c02c_lectura.down.sql
\\ir ../../vuelta-atras/20261008T0110_c02c_activar_espera.down.sql
-- La guarda de la vuelta atrás para si queda algo traído: lo de A se quita antes, a mano (dentro del ROLLBACK).
delete from public.purchase_order where supplier_id in (select id from public.supplier where import_id is not null);
delete from public.company_account_link where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
delete from public.company_account where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
delete from public.supplier where import_id is not null;
update public.company_chart_import set status = 'deshecha' where status = 'traida';
\\ir ../../vuelta-atras/20261008T0100_c02c_traer_plan.down.sql
do $$ begin
  if to_regclass('public.company_chart_import') is not null then raise exception 'PRUEBA C02c: la vuelta atrás no quita company_chart_import'; end if;
  if exists (select 1 from information_schema.columns where table_name in ('company_account', 'supplier') and column_name in ('name_source', 'import_id')) then raise exception 'PRUEBA C02c: quedan columnas'; end if;
  if pg_get_functiondef('public.company_chart_activate(uuid, boolean, text)'::regprocedure) like '%company_chart_import%' then raise exception 'PRUEBA C02c: la activación sigue esperando'; end if;
  raise notice 'PRUEBA C02c · 8 en verde';
end $$;

rollback;
`
writeFileSync(join(raiz, 'supabase/staging/sql/20261008_c02c_prueba_traer.sql'), sql)
console.log(`prueba escrita: ${plan.cuentas.length} cuentas, ${plan.crear.length} fichas, ${plan.enlaces.length} enlaces (${enlazadas} cuentas), cifras ${JSON.stringify(k)}`)
