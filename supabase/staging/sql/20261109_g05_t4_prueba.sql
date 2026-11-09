-- supabase/staging/sql/20261109_g05_t4_prueba.sql
--
-- SOLO STAGING. La 1344 de la T4 del G05 (lo que necesita el modelo de
-- factura «Sumied»), en la cuenta A de pruebas, con ROLLBACK:
--   1. La 1344, dos veces: las columnas nuevas (conta_servicio.incluye y la
--      cuenta del mandato) y la función del «Qué incluye».
--   2. «Qué incluye» de un servicio: ensaya por defecto (no escribe), guarda de
--      verdad con p_ensayo = false, se vacía con '' y no pasa de 200 letras.
--      Otra cuenta no puede. conta_pantalla_clientes lo devuelve.
--   3. La vuelta atrás: conta_pantalla_clientes, la de antes (de su respaldo,
--      con su huella) y sin las columnas; y otra vez la 1344.
--   4. La 1403, dos veces: la ficha de la factura de un recibo, en una lectura.
--      Una factura sin recibo da null; con su recibo inventado, el recibo, lo
--      que le ha pasado y el asiento del cobro con sus apuntes. Otra cuenta no
--      ve nada. Y su vuelta atrás, y otra vez la 1403.
-- Datos inventados (T11).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G05 T4: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

create temp table _t (clave text primary key, v text) on commit drop;
grant select, insert on _t to authenticated;
-- La de antes de la 1344: si el manifiesto ya la pasó (staging aplica la tanda antes que esta prueba, en la
-- misma transacción), la de su respaldo; si no, la de ahora. La misma huella que mira _restaurar_funcion.
insert into _t select 'antes', coalesce(
  (select huella from public.funcion_respaldo where firma = 'public.conta_pantalla_clientes(uuid)' and migracion = '20261109T1344_g05_t4_incluye_y_cuenta'),
  md5(pg_get_functiondef('public.conta_pantalla_clientes(uuid)'::regprocedure)));

-- 1 · La 1344, dos veces.
\i supabase/migrations/20261109T1344_g05_t4_incluye_y_cuenta.sql
\i supabase/migrations/20261109T1344_g05_t4_incluye_y_cuenta.sql
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_servicio' and column_name = 'incluye')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_gc_mandato' and column_name = 'cuenta_final')
     or to_regprocedure('public.conta_tarifa_servicio_incluye(uuid,uuid,text,boolean)') is null then
    raise exception 'G05 T4 · 1: falta algo de la 1344.';
  end if;
  raise notice 'G05 T4 · 1: la 1344 carga, y dos veces. OK';
end $$;

-- 2 · Un servicio inventado de la empresa A y su «Qué incluye», como la persona administradora.
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid;
begin
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (v_acc, v_e, 'prueba_g05_t4', 'Servicio Prueba G05', 'fijo_mes');
  insert into _t values ('empresa', v_e::text), ('servicio', (select id::text from public.conta_servicio where company_id = v_e and clave = 'prueba_g05_t4'));
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$
declare v_e uuid := (select v::uuid from _t where clave = 'empresa'); v_s uuid := (select v::uuid from _t where clave = 'servicio'); r jsonb;
begin
  r := public.conta_tarifa_servicio_incluye(v_e, v_s, 'Nóminas y seguros sociales');
  if (r->>'ensayo')::boolean is not true then raise exception 'G05 T4 · 2: sin decirlo, tenía que ensayar.'; end if;
  r := public.conta_tarifa_servicio_incluye(v_e, v_s, '  Nóminas y seguros sociales  ', false);
  if r->>'frase' <> 'Servicio Prueba G05 incluye «Nóminas y seguros sociales»: así sale en las facturas.' then raise exception 'G05 T4 · 2: la frase es «%».', r->>'frase'; end if;
  begin
    perform public.conta_tarifa_servicio_incluye(v_e, v_s, repeat('x', 201), false);
    raise exception 'G05 T4 · 2: han entrado 201 letras.';
  exception when invalid_parameter_value then null; end;
  if not exists (select 1 from jsonb_array_elements(public.conta_pantalla_clientes('c01a0000-0000-4000-8000-00000000000a')->'servicios') x
                  where x->>'id' = v_s::text and x->>'incluye' = 'Nóminas y seguros sociales') then
    raise exception 'G05 T4 · 2: la pantalla de clientes no devuelve el «Qué incluye» del servicio.';
  end if;
end $$;
reset role;
do $$ begin
  if (select incluye from public.conta_servicio where id = (select v::uuid from _t where clave = 'servicio')) is distinct from 'Nóminas y seguros sociales' then
    raise exception 'G05 T4 · 2: no se ha guardado (o el ensayo escribió).';
  end if;
end $$;
-- Vaciarlo: vuelve el de siempre (null).
set local role authenticated;
select public.conta_tarifa_servicio_incluye((select v::uuid from _t where clave = 'empresa'), (select v::uuid from _t where clave = 'servicio'), '', false);
reset role;
-- Otra cuenta (B) no puede.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01b0000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_tarifa_servicio_incluye((select v::uuid from _t where clave = 'empresa'), (select v::uuid from _t where clave = 'servicio'), 'Intruso', false);
    raise exception 'G05 T4 · 2: otra cuenta ha cambiado el «Qué incluye».';
  exception when no_data_found then null; end;
end $$;
reset role;
do $$ begin
  if (select incluye from public.conta_servicio where id = (select v::uuid from _t where clave = 'servicio')) is not null then
    raise exception 'G05 T4 · 2: vaciarlo no lo ha vaciado.';
  end if;
  raise notice 'G05 T4 · 2: el «Qué incluye» ensaya, se guarda, se vacía, no pasa de 200 letras, otra cuenta no puede y la pantalla lo devuelve. OK';
end $$;

-- 3 · La vuelta atrás, y otra vez la 1344.
\i supabase/vuelta-atras/20261109T1344_g05_t4_incluye_y_cuenta.down.sql
do $$ begin
  if md5(pg_get_functiondef('public.conta_pantalla_clientes(uuid)'::regprocedure)) <> (select v from _t where clave = 'antes')
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('conta_servicio', 'conta_gc_mandato') and column_name in ('incluye', 'cuenta_final', 'cuenta_pais', 'banco'))
     or to_regprocedure('public.conta_tarifa_servicio_incluye(uuid,uuid,text,boolean)') is not null then
    raise exception 'G05 T4 · 3: la vuelta atrás no lo deja como estaba.';
  end if;
  raise notice 'G05 T4 · 3: la vuelta atrás lo deja como estaba. OK';
end $$;
\i supabase/migrations/20261109T1344_g05_t4_incluye_y_cuenta.sql
\echo 'G05 T4 · 3: y otra vez la 1344. OK'

-- 4 · La 1403, dos veces, y la ficha de la factura de un recibo inventado.
\i supabase/migrations/20261109T1403_g05_t4_ficha_factura.sql
\i supabase/migrations/20261109T1403_g05_t4_ficha_factura.sql
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid; v_fy uuid; v_p uuid; v_f uuid; v_g uuid; v_as uuid; v_a572 uuid; v_a430 uuid; v_r uuid;
begin
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;
  select id into v_fy from public.fiscal_year where company_id = v_e and date '2026-12-04' between starts_on and ends_on;
  if v_fy is null then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, v_e, '2026', '2026-01-01', '2026-12-31') returning id into v_fy;
  end if;
  insert into public.party (account_id, name, source) values (v_acc, 'Cliente Prueba G05 Ficha', 'manual') returning id into v_p;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  values (v_acc, v_e, 'pymes', '57299999', '572', 'Plataforma Prueba', 'own', 'manual') returning id into v_a572;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  values (v_acc, v_e, 'pymes', '43009999', '4300', 'Cliente Prueba G05 Ficha', 'own', 'manual') returning id into v_a430;
  insert into public.customer_invoice (account_id, company_id, party_id) values (v_acc, v_e, v_p) returning id into v_f;
  insert into public.customer_invoice (account_id, company_id, party_id) values (v_acc, v_e, v_p) returning id into v_g;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status)
  values (v_acc, v_e, v_fy, 1, '2026-12-04', 'Cobro de prueba G05', 'manual', 'borrador') returning id into v_as;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit)
  values (v_acc, v_e, v_as, 1, v_a572, 157.30, 0), (v_acc, v_e, v_as, 2, v_a430, 0, 157.30);
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent, cobrar_cent, estado, cargo_el, confirmado_el, invoice_id, asiento_cobro, enviado_por_name)
  values (v_acc, v_e, v_p, '2026-12', 'recibo:' || v_e || ':' || v_p || ':2026-12', 15730, 15730, 'facturado', '2026-12-04', '2026-12-04', v_f, v_as, 'Persona Prueba')
  returning id into v_r;
  insert into public.conta_recibo_evento (recibo_id, account_id, company_id, tipo, texto) values (v_r, v_acc, v_e, 'facturado', 'Cobrado el 04/12/2026 y facturado.');
  insert into _t values ('factura', v_f::text), ('sin_recibo', v_g::text);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; r jsonb;
begin
  if public.conta_pantalla_factura_recibo(v_acc, (select v::uuid from _t where clave = 'sin_recibo')) is not null then
    raise exception 'G05 T4 · 4: una factura sin recibo tenía que dar null.';
  end if;
  r := public.conta_pantalla_factura_recibo(v_acc, (select v::uuid from _t where clave = 'factura'));
  if r->'recibo'->>'estado' <> 'facturado' or (r->'recibo'->>'cobrar_cent')::int <> 15730 or r->'recibo'->>'confirmado_el' <> '2026-12-04' then
    raise exception 'G05 T4 · 4: el recibo no sale bien: %', r->'recibo';
  end if;
  if jsonb_array_length(r->'eventos') <> 1 or r->'eventos'->0->>'tipo' <> 'facturado' then raise exception 'G05 T4 · 4: lo que le ha pasado no sale: %', r->'eventos'; end if;
  if jsonb_array_length(r->'asientos') <> 1 or r->'asientos'->0->>'tipo' <> 'cobro' or jsonb_array_length(r->'asientos'->0->'apuntes') <> 2
     or r->'asientos'->0->'apuntes'->0->>'codigo' <> '57299999' or (r->'asientos'->0->'apuntes'->1->>'haber')::numeric <> 157.30 then
    raise exception 'G05 T4 · 4: el asiento del cobro no sale bien: %', r->'asientos';
  end if;
  if r->'verifactu' <> 'null'::jsonb and r->'verifactu' is not null then raise exception 'G05 T4 · 4: sin registro, Verifactu tenía que ser null.'; end if;
end $$;
reset role;
-- Otra cuenta (B) no ve nada.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01b0000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ begin
  if public.conta_pantalla_factura_recibo('c01a0000-0000-4000-8000-00000000000a', (select v::uuid from _t where clave = 'factura')) is not null then
    raise exception 'G05 T4 · 4: otra cuenta ve la ficha de la factura.';
  end if;
  raise notice 'G05 T4 · 4: la ficha de la factura de un recibo sale en una lectura (recibo, lo que le ha pasado, asiento con sus apuntes), sin recibo da null y otra cuenta no ve nada. OK';
end $$;
reset role;
\i supabase/vuelta-atras/20261109T1403_g05_t4_ficha_factura.down.sql
do $$ begin
  if to_regprocedure('public.conta_pantalla_factura_recibo(uuid,uuid)') is not null then raise exception 'G05 T4 · 4: la vuelta atrás de la 1403 no la quita.'; end if;
end $$;
\i supabase/migrations/20261109T1403_g05_t4_ficha_factura.sql
\echo 'G05 T4 · 4: la vuelta atrás de la 1403, y otra vez la 1403. OK'

rollback;
