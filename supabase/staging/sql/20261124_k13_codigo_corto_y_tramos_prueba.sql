-- supabase/staging/sql/20261124_k13_codigo_corto_y_tramos_prueba.sql
--
-- SOLO STAGING. Prueba del K13 (20261123T2347 y 20261124T0001), por sus caminos (regla 10). Todo en
-- una transacción con ROLLBACK: staging no cambia. En la gestoría de la cuenta del núcleo (semilla K02), como su
-- usuario; lo que se crea es inventado (T11).
--
--   El código corto:
--     1. El relleno: ningún local, marca ni plataforma se queda sin código, y ninguno se repite dentro de su cuenta
--        (eso último lo garantiza la tabla: unique por cuenta y tabla).
--     2. Dar de alta un local, dos marcas y una plataforma, y leer los códigos (conta_codigos_cortos): cada uno sale
--        con su propuesto, el siguiente libre (local), las tres letras del nombre sin acentos (marca) y, si ya están,
--        dos letras y una cifra.
--     3. Cambiarlo a mano (conta_codigo_corto_poner): queda «a_mano»; uno repetido en la cuenta, uno raro y uno de otra
--        cuenta se rechazan con su porqué; vacío vuelve al propuesto.
--   El reparto en tramos (conta_recibida_reparto_linea):
--     4. Dos tramos en la línea 0 de una recibida: dos filas, su rastro y el asiento propuesto quitado.
--     5. Los mismos otra vez: «no había nada que guardar», sin rastro nuevo.
--     6. Un solo tramo: la línea queda sin reparto.
--     7. Un local de otra cuenta y un importe cero: se rechazan; una recibida anulada no se cambia.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K13: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public.conta_codigo_corto_poner(text,uuid,text)') is null
     or to_regprocedure('public.conta_recibida_reparto_linea(uuid,integer,jsonb,text)') is null then
    raise exception 'PRUEBA K13 · 0: falta la 2347 o la 0001 (conta_codigo_corto_poner, conta_recibida_reparto_linea).';
  end if;
end $$;
set local statement_timeout = '120s';

-- 1 · El relleno.
do $$
declare n int;
begin
  select count(*) into n from (
    select id from public.locations l where account_id is not null and not exists (select 1 from public.conta_codigo_corto k where k.tabla = 'locations' and k.entity_id = l.id)
    union all select id from public.brand b where not exists (select 1 from public.conta_codigo_corto k where k.tabla = 'brand' and k.entity_id = b.id)
    union all select id from public.sales_channel c where not exists (select 1 from public.conta_codigo_corto k where k.tabla = 'sales_channel' and k.entity_id = c.id)) x;
  if n > 0 then raise exception 'PRUEBA K13 · 1: % locales, marcas o plataformas sin código después del relleno', n; end if;
  raise notice 'PRUEBA K13 · 1: relleno: ninguno sin código (% códigos, todos «propuesto»: %).',
    (select count(*) from public.conta_codigo_corto), (select count(*) from public.conta_codigo_corto where origen = 'propuesto');
end $$;

-- 2 · El alta (sin código) y la lectura, que se lo pone.
do $$
declare a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0';
begin
  insert into public.locations (id, account_id, name) values ('c0f13000-0000-4000-8000-0000000000a1', a, 'Local de Prueba K13');
  insert into public.brand (id, account_id, name, slug) values
    ('c0f13000-0000-4000-8000-0000000000b1', a, 'Ñandú Cocina K13', 'prueba-k13-a'),
    ('c0f13000-0000-4000-8000-0000000000b2', a, 'Nanas K13', 'prueba-k13-b');
  insert into public.sales_channel (id, account_id, name, slug) values ('c0f13000-0000-4000-8000-0000000000d1', a, 'Reparto K13', 'prueba-k13-p');
end $$;
-- La recibida de los tramos y su asiento propuesto (como deja la propuesta: borrador, sin validar).
do $$
declare a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3'; v_y uuid;
begin
  insert into public.supplier (id, account_id, name, tax_id, country_code, vat_regime) values
    ('c0f13000-0000-4000-8000-0000000000c1', a, 'Proveedor de Prueba K13, S.L.', 'B00013000', 'ES', 'general');
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source,
                                       tax_base_total, tax_total, grand_total, needs_review, created_by_name, created_at)
  values ('c0f13000-0000-4000-8000-0000000000f1', a, emp, 'c0f13000-0000-4000-8000-0000000000c1', 'invoice', 'K13-TRAMOS', date '2026-11-05',
          'en_revision', 'manual', 100, 21, 121, true, 'prueba K13', timestamptz '2026-11-05 10:00+01');
  select id into v_y from public.fiscal_year where company_id = emp and date '2026-11-05' between starts_on and ends_on;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status, confidence, reason)
  values (a, emp, v_y, 2, '2026-11-05', 'K13-TRAMOS', 'supplier_invoice', 'c0f13000-0000-4000-8000-0000000000f1', 'propuesto', 'probable', 'Prueba K13');
end $$;

select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;

-- 2 · (sigue) La lectura le pone el propuesto a lo nuevo.
do $$
declare
  a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; v_sig text; v text;
begin
  select lpad((max(codigo::int) filter (where id <> 'c0f13000-0000-4000-8000-0000000000a1') + 1)::text, 3, '0') into v_sig
    from public.conta_codigos_cortos(a) where tabla = 'locations';
  select codigo into v from public.conta_codigos_cortos(a) where id = 'c0f13000-0000-4000-8000-0000000000a1';
  if v is distinct from v_sig then raise exception 'PRUEBA K13 · 2: el local nuevo sale con «%» y era «%»', v, v_sig; end if;
  select codigo into v from public.conta_codigos_cortos(a) where id = 'c0f13000-0000-4000-8000-0000000000b1';
  if v is distinct from 'NAN' then raise exception 'PRUEBA K13 · 2: la marca «Ñandú Cocina K13» sale con «%» y era NAN', v; end if;
  select codigo into v from public.conta_codigos_cortos(a) where id = 'c0f13000-0000-4000-8000-0000000000b2';
  if v is distinct from 'NA2' then raise exception 'PRUEBA K13 · 2: la marca «Nanas K13» (NAN ya está) sale con «%» y era NA2', v; end if;
  select codigo into v from public.conta_codigos_cortos(a) where id = 'c0f13000-0000-4000-8000-0000000000d1';
  if v is distinct from 'REP' then raise exception 'PRUEBA K13 · 2: la plataforma «Reparto K13» sale con «%» y era REP', v; end if;
  begin
    perform public.conta_codigos_cortos('c01a0000-0000-4000-8000-00000000000a');
    raise exception 'PRUEBA K13 · 2: se han leído los códigos de otra cuenta';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PRUEBA K13 · 2: alta y lectura: local %, marcas NAN y NA2, plataforma REP; los de otra cuenta, no.', v_sig;
end $$;

-- 3 · A mano.
do $$
declare r jsonb;
begin
  r := public.conta_codigo_corto_poner('brand', 'c0f13000-0000-4000-8000-0000000000b2', ' zz9 ');
  if r ->> 'codigo' is distinct from 'ZZ9' or r ->> 'origen' is distinct from 'a_mano' then raise exception 'PRUEBA K13 · 3: a mano devuelve %', r; end if;
  if (select origen from public.conta_codigo_corto where entity_id = 'c0f13000-0000-4000-8000-0000000000b2') is distinct from 'a_mano' then
    raise exception 'PRUEBA K13 · 3: el código puesto a mano no queda «a_mano»';
  end if;
  begin
    perform public.conta_codigo_corto_poner('brand', 'c0f13000-0000-4000-8000-0000000000b2', 'NAN');
    raise exception 'PRUEBA K13 · 3: un código repetido en la cuenta se ha guardado';
  exception when unique_violation then raise notice 'PRUEBA K13 · 3: repetido → %', sqlerrm;
  end;
  if (select code from public.conta_codigo_corto where entity_id = 'c0f13000-0000-4000-8000-0000000000b2') is distinct from 'ZZ9' then
    raise exception 'PRUEBA K13 · 3: el repetido rechazado se ha llevado el ZZ9';
  end if;
  begin
    perform public.conta_codigo_corto_poner('brand', 'c0f13000-0000-4000-8000-0000000000b2', 'CON ESPACIO');
    raise exception 'PRUEBA K13 · 3: un código con espacio se ha guardado';
  exception when invalid_parameter_value then raise notice 'PRUEBA K13 · 3: raro → %', sqlerrm;
  end;
  begin
    perform public.conta_codigo_corto_poner('locations', 'c01a0000-0000-4000-8000-0000000000a2', '999');
    raise exception 'PRUEBA K13 · 3: un local de otra cuenta se ha cambiado';
  exception when insufficient_privilege then raise notice 'PRUEBA K13 · 3: de otra cuenta → %', sqlerrm;
  end;
  r := public.conta_codigo_corto_poner('sales_channel', 'c0f13000-0000-4000-8000-0000000000d1', 'R1');
  r := public.conta_codigo_corto_poner('sales_channel', 'c0f13000-0000-4000-8000-0000000000d1', '');
  if r ->> 'codigo' is distinct from 'REP' or r ->> 'origen' is distinct from 'propuesto' then raise exception 'PRUEBA K13 · 3: vacío no vuelve al propuesto (%)', r; end if;
  raise notice 'PRUEBA K13 · 3: a mano ZZ9 («a_mano»); vacío vuelve al propuesto: %', r ->> 'texto';
end $$;

-- 4 a 7 · Los tramos.
do $$
declare
  f constant uuid := 'c0f13000-0000-4000-8000-0000000000f1';
  l1 constant text := 'c0f13000-0000-4000-8000-0000000000a1';
  m1 constant text := 'c0f13000-0000-4000-8000-0000000000b1';
  r jsonb; n int; n_rastro int;
begin
  r := public.conta_recibida_reparto_linea(f, 0, jsonb_build_array(
         jsonb_build_object('local', l1, 'marca', m1, 'importe', 60),
         jsonb_build_object('local', null, 'plataforma', 'c0f13000-0000-4000-8000-0000000000d1', 'importe', 40)), 'Prueba K13');
  select count(*) into n from public.supplier_invoice_expense_tramo where supplier_invoice_id = f and position = 0;
  if n <> 2 then raise exception 'PRUEBA K13 · 4: % tramos guardados, y eran 2', n; end if;
  if (r ->> 'asiento_quitado')::boolean is not true
     or exists (select 1 from public.journal_entry e where e.source_id = f and e.status = 'propuesto') then
    raise exception 'PRUEBA K13 · 4: el asiento propuesto no se ha quitado (%)', r;
  end if;
  select count(*) into n_rastro from public.supplier_invoice_change c, jsonb_array_elements(c.cambios) x where c.supplier_invoice_id = f and x ->> 'campo' = 'reparto';
  if n_rastro <> 1 then raise exception 'PRUEBA K13 · 4: % filas de rastro del reparto, y era 1', n_rastro; end if;
  raise notice 'PRUEBA K13 · 4: dos tramos → %', r ->> 'texto';

  r := public.conta_recibida_reparto_linea(f, 0, jsonb_build_array(
         jsonb_build_object('local', l1, 'marca', m1, 'importe', 60),
         jsonb_build_object('local', null, 'plataforma', 'c0f13000-0000-4000-8000-0000000000d1', 'importe', 40)), 'Prueba K13');
  select count(*) into n_rastro from public.supplier_invoice_change c, jsonb_array_elements(c.cambios) x where c.supplier_invoice_id = f and x ->> 'campo' = 'reparto';
  if (r ->> 'guardado')::boolean or n_rastro <> 1 then raise exception 'PRUEBA K13 · 5: los mismos tramos han guardado algo (%; rastro %)', r, n_rastro; end if;
  raise notice 'PRUEBA K13 · 5: los mismos → %', r ->> 'texto';

  r := public.conta_recibida_reparto_linea(f, 0, jsonb_build_array(jsonb_build_object('local', l1, 'importe', 100)), 'Prueba K13');
  select count(*) into n from public.supplier_invoice_expense_tramo where supplier_invoice_id = f;
  if n <> 0 then raise exception 'PRUEBA K13 · 6: con un tramo quedan % filas', n; end if;
  raise notice 'PRUEBA K13 · 6: un tramo → %', r ->> 'texto';

  begin
    perform public.conta_recibida_reparto_linea(f, 0, jsonb_build_array(
      jsonb_build_object('local', 'c01a0000-0000-4000-8000-0000000000a2'  /* «Norte Centro», de la cuenta A de la semilla C01 */, 'importe', 50),
      jsonb_build_object('importe', 50)), 'Prueba K13');
    raise exception 'PRUEBA K13 · 7: un local de otra cuenta se ha guardado';
  exception when insufficient_privilege then raise notice 'PRUEBA K13 · 7: local de otra cuenta → %', sqlerrm;
  end;
  begin
    perform public.conta_recibida_reparto_linea(f, 0, jsonb_build_array(jsonb_build_object('importe', 0), jsonb_build_object('importe', 100)), 'Prueba K13');
    raise exception 'PRUEBA K13 · 7: un tramo de cero se ha guardado';
  exception when invalid_parameter_value then raise notice 'PRUEBA K13 · 7: importe cero → %', sqlerrm;
  end;
end $$;
reset role;

-- 7 · Anulada: no se cambia (la puerta de la contabilizada es la misma consulta que en conta_recibida_otros_datos; un
--     asiento validado de verdad pide sus apuntes completos y su número, y no cabe en esta prueba).
update public.supplier_invoice set status = 'anulada' where id = 'c0f13000-0000-4000-8000-0000000000f1';
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  perform public.conta_recibida_reparto_linea('c0f13000-0000-4000-8000-0000000000f1', 0,
    jsonb_build_array(jsonb_build_object('importe', 50), jsonb_build_object('importe', 50)), 'Prueba K13');
  raise exception 'PRUEBA K13 · 7: una recibida anulada se ha repartido';
exception when invalid_parameter_value then raise notice 'PRUEBA K13 · 7: anulada → %', sqlerrm;
end $$;
reset role;

-- 8 · La vuelta atrás, sobre los mismos datos (con tramos y códigos a mano): quita las tablas y funciones nuevas y no
--     toca nada de lo que ya había (los locales, marcas y plataformas, ni la recibida).
update public.supplier_invoice set status = 'en_revision' where id = 'c0f13000-0000-4000-8000-0000000000f1';
insert into public.supplier_invoice_expense_tramo (account_id, supplier_invoice_id, position, tramo, amount)
values ('c0e20000-0000-4000-8000-0000000000e0', 'c0f13000-0000-4000-8000-0000000000f1', 0, 0, 60),
       ('c0e20000-0000-4000-8000-0000000000e0', 'c0f13000-0000-4000-8000-0000000000f1', 0, 1, 40);
create temp table _k13_antes on commit drop as
  select 'l' t, id, name from public.locations union all select 'b', id, name from public.brand union all select 'c', id, name from public.sales_channel;
\i supabase/vuelta-atras/20261124T0001_k13_reparto_en_tramos.down.sql
\i supabase/vuelta-atras/20261123T2347_k13_codigo_corto.down.sql
do $$
declare n int;
begin
  if to_regclass('public.supplier_invoice_expense_tramo') is not null or to_regclass('public.conta_codigo_corto') is not null
     or to_regprocedure('public.conta_codigos_cortos(uuid)') is not null or to_regprocedure('public.conta_recibida_reparto_linea(uuid,integer,jsonb,text)') is not null then
    raise exception 'PRUEBA K13 · 8: después de la vuelta atrás queda alguna tabla o función nueva';
  end if;
  select count(*) into n from (
    (select * from _k13_antes except select 'l', id, name from public.locations except select 'b', id, name from public.brand except select 'c', id, name from public.sales_channel)) x;
  if n <> 0 then raise exception 'PRUEBA K13 · 8: la vuelta atrás ha movido % locales, marcas o plataformas', n; end if;
  if not exists (select 1 from public.supplier_invoice where id = 'c0f13000-0000-4000-8000-0000000000f1' and status = 'en_revision') then
    raise exception 'PRUEBA K13 · 8: la vuelta atrás ha tocado la recibida';
  end if;
  raise notice 'PRUEBA K13 · 8: vuelta atrás: sin las tablas ni las funciones nuevas; locales, marcas, plataformas y la recibida, como estaban.';
end $$;

rollback;
