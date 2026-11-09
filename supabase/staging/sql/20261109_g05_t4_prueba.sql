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
--   5. La 1426 (nº 43, el ingreso de GoCardless en el banco), dos veces: un pago
--      de GoCardless inventado espera su ingreso; un movimiento de otro importe
--      no se casa; el bueno se casa (la 572 del banco contra la 57200002 por el
--      neto), deja de esperar, el recibo lo apunta y la ficha enseña su llegada
--      y el asiento del ingreso; no se casa dos veces. Con la empresa y el banco
--      de pruebas de staging (los de la prueba de Stripe, S01); en una base sin
--      ellos, se dice y se salta.
--   6. La 1500 (nº 46, parar un recibo desde el portal), dos veces: el portal
--      (service_role) lo para con su motivo; sale del cobro (no se puede
--      aprobar), su incidencia en «Pendiente de revisar» y su historial;
--      pararlo otra vez cambia el motivo sin duplicar; sin motivo no; otra
--      cuenta no lo deshace; la gestoría lo deshace y la incidencia deja de
--      estar vigente; un recibo ya enviado no se para. Y su vuelta atrás.
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
grant select, insert on _t to authenticated, service_role;
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

-- 4 · La 1403, dos veces (después de la 1426, que lee), y la ficha de la factura de un recibo inventado.
\i supabase/migrations/20261109T1426_g05_t4_ingreso_gocardless.sql
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

-- 5 · La 1426, dos veces, y el ingreso de GoCardless casado en Bancos.
\i supabase/migrations/20261109T1426_g05_t4_ingreso_gocardless.sql
\i supabase/migrations/20261109T1426_g05_t4_ingreso_gocardless.sql
\i supabase/migrations/20261109T1403_g05_t4_ficha_factura.sql
insert into _t values ('e5', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'), ('banco5', 'b0100000-0000-4000-8000-0000000000b3');
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid := (select v::uuid from _t where clave = 'e5'); v_p uuid; v_f uuid; v_r uuid;
begin
  if not exists (select 1 from public.treasury_account where id = (select v::uuid from _t where clave = 'banco5') and company_id = v_e) then
    insert into _t values ('salta5', 'si');
    raise notice 'G05 T4 · 5: esta base no tiene la empresa y el banco de pruebas de staging: el casado se prueba en staging.';
    return;
  end if;
  insert into public.party (account_id, name, source) values (v_acc, 'Cliente Prueba G05 Ingreso', 'manual') returning id into v_p;
  insert into public.customer_invoice (account_id, company_id, party_id) values (v_acc, v_e, v_p) returning id into v_f;
  insert into public.conta_gc_payout (company_id, gc_id, account_id, estado, llegada, importe, comision, moneda, referencia)
  values (v_e, 'PRUEBA-PO1', v_acc, 'paid', public.conta_hoy(), 157.30, 1.00, 'EUR', 'PRUEBA-PO1');
  insert into public.conta_gc_cobro (company_id, gc_id, account_id, estado, fecha, importe, moneda, payout_gc_id)
  values (v_e, 'PRUEBA-PM1', v_acc, 'paid_out', public.conta_hoy() - 2, 158.30, 'EUR', 'PRUEBA-PO1');
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent, cobrar_cent, estado, gc_cobro_id, gc_estado, confirmado_el, invoice_id)
  values (v_acc, v_e, v_p, '2026-12', 'recibo:' || v_e || ':' || v_p || ':2026-12', 15830, 15830, 'facturado', 'PRUEBA-PM1', 'paid_out', public.conta_hoy() - 2, v_f)
  returning id into v_r;
  insert into _t values ('f5', v_f::text), ('r5', v_r::text);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$
declare v_e uuid := (select v::uuid from _t where clave = 'e5'); x jsonb; r jsonb; mv jsonb := '[]'::jsonb; m record; v_err text; v_bueno uuid; v_otro uuid; lin text; ent uuid; v_puente text;
begin
  if exists (select 1 from _t where clave = 'salta5') then return; end if;
  x := public.conta_abonos_gocardless_pendientes(v_e);
  if not exists (select 1 from jsonb_array_elements(x) a where a->>'id' = 'PRUEBA-PO1' and (a->>'neto')::numeric = 157.30 and (a->>'cobros')::int = 1 and a->>'cuenta' is not null) then
    raise exception 'G05 T4 · 5: el pago de GoCardless no espera su ingreso: %', x;
  end if;
  -- La cuenta puente, la que dice lo que espera (los ajustes son internos: el usuario no los lee).
  select a->>'cuenta' into v_puente from jsonb_array_elements(x) a where a->>'id' = 'PRUEBA-PO1';
  for m in select * from (values (1, 157.31, 'GOCARDLESS OTRO G05'), (2, 157.30, 'GOCARDLESS PRUEBA-PO1 G05')) y(i, imp, con) loop
    mv := mv || jsonb_build_array(jsonb_build_object('fecha', to_char(public.conta_hoy(), 'YYYY-MM-DD'), 'importe', m.imp,
      'concepto_banco', m.con, 'concepto_limpio', initcap(m.con), 'contraparte', 'GOCARDLESS', 'tipo', 'ABONO', 'huella', 'g05-' || m.i, 'huella_suave', 'g05-s' || m.i));
  end loop;
  r := public.bank_importar((select v::uuid from _t where clave = 'banco5'), 'fichero', 'csv:bbva', 'prueba-g05.xlsx', repeat('f', 64),
    public.conta_hoy(), public.conta_hoy(), null, null, 'prueba', null, mv);
  select id into v_bueno from public.bank_movement where statement_id = (r->>'extracto')::uuid and bank_concept = 'GOCARDLESS PRUEBA-PO1 G05' limit 1;
  select id into v_otro from public.bank_movement where statement_id = (r->>'extracto')::uuid and bank_concept = 'GOCARDLESS OTRO G05' limit 1;
  begin perform public.conta_abono_gocardless_casar(v_otro, 'PRUEBA-PO1', 'probable', 'prueba', 'persona'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'GoCardless pagó 157,30 € y este movimiento es de 157,31 €: no es este.' then raise exception 'G05 T4 · 5: otro importe dijo «%».', v_err; end if;
  x := public.conta_abono_gocardless_casar(v_bueno, 'PRUEBA-PO1', 'seguro', 'Pago de GoCardless: 157,30 € netos, exactos.', 'folvy');
  if x->>'frase' not like 'Casado el ingreso de GoCardless del __/__: 157,30 € de 1 cobro. Asiento: 157,30 € al banco contra la %.' then raise exception 'G05 T4 · 5: casar dijo «%».', x->>'frase'; end if;
  ent := (x->>'asiento')::uuid;
  select string_agg(coalesce(jl.debit, 0)::numeric(14,2) || '/' || coalesce(jl.credit, 0)::numeric(14,2), ' · ' order by jl.position) into lin from public.journal_line jl where jl.entry_id = ent;
  if lin <> '157.30/0.00 · 0.00/157.30'
     or (select ca.code from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id where jl.entry_id = ent and jl.credit > 0)
        <> v_puente then
    raise exception 'G05 T4 · 5: el asiento del ingreso es «%».', lin;
  end if;
  if exists (select 1 from jsonb_array_elements(public.conta_abonos_gocardless_pendientes(v_e)) a where a->>'id' = 'PRUEBA-PO1') then raise exception 'G05 T4 · 5: casado, sigue esperando.'; end if;
  if not exists (select 1 from public.conta_recibo_evento where recibo_id = (select v::uuid from _t where clave = 'r5') and tipo = 'ingreso') then raise exception 'G05 T4 · 5: el recibo no apunta el ingreso.'; end if;
  r := public.conta_pantalla_factura_recibo('c01a0000-0000-4000-8000-00000000000a', (select v::uuid from _t where clave = 'f5'));
  if (r->'ingreso'->>'casado')::boolean is not true or r->'ingreso'->>'llegada' <> to_char(public.conta_hoy(), 'YYYY-MM-DD')
     or not exists (select 1 from jsonb_array_elements(r->'asientos') a where a->>'tipo' = 'ingreso' and (a->>'id')::uuid = ent and jsonb_array_length(a->'apuntes') = 2) then
    raise exception 'G05 T4 · 5: la ficha no enseña el ingreso: % · %', r->'ingreso', r->'asientos';
  end if;
  v_err := null;
  begin perform public.conta_abono_gocardless_casar(v_otro, 'PRUEBA-PO1', 'probable', 'prueba', 'persona'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'Ese pago de GoCardless ya está casado con otro movimiento.' then raise exception 'G05 T4 · 5: casarlo dos veces dijo «%».', v_err; end if;
  raise notice 'G05 T4 · 5: el pago de GoCardless espera su ingreso, otro importe no se casa, el bueno sí (banco contra la puente por el neto), deja de esperar, el recibo lo apunta, la ficha enseña llegada y asiento, y no se casa dos veces. OK';
end $$;
reset role;
\i supabase/vuelta-atras/20261109T1403_g05_t4_ficha_factura.down.sql
\i supabase/vuelta-atras/20261109T1426_g05_t4_ingreso_gocardless.down.sql
do $$ begin
  if to_regclass('public.conta_gc_payout') is not null or to_regprocedure('public.conta_abono_gocardless_casar(uuid,text,text,text,text)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_gc_cobro' and column_name = 'payout_gc_id') then
    raise exception 'G05 T4 · 5: la vuelta atrás de la 1426 no la quita.';
  end if;
end $$;
\i supabase/migrations/20261109T1426_g05_t4_ingreso_gocardless.sql
\i supabase/migrations/20261109T1403_g05_t4_ficha_factura.sql
\echo 'G05 T4 · 5: la vuelta atrás de la 1403 y la 1426, y otra vez las dos. OK'

-- 6 · La 1500, dos veces, y parar un recibo desde el portal.
\i supabase/migrations/20261109T1500_g05_t4_parar_recibo.sql
\i supabase/migrations/20261109T1500_g05_t4_parar_recibo.sql
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid; v_p uuid; v_r uuid; v_r2 uuid;
begin
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;
  if not exists (select 1 from public.conta_gestoria_lectura where account_id = v_acc) then
    insert into public.conta_gestoria_lectura (account_id, company_id, origen, entorno, por) values (v_acc, v_e, 'gocardless', 'pruebas', 'persona');
  end if;
  insert into public.party (account_id, name, source) values (v_acc, 'Cliente Prueba G05 Portal', 'manual') returning id into v_p;
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent, cobrar_cent, decision)
  values (v_acc, v_e, v_p, '2026-12', 'recibo:' || v_e || ':' || v_p || ':2026-12', 15730, 15730, 'aprobado') returning id into v_r;
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent, cobrar_cent, estado)
  values (v_acc, v_e, v_p, '2027-01', 'recibo:' || v_e || ':' || v_p || ':2027-01', 15730, 15730, 'enviado') returning id into v_r2;
  insert into _t values ('r6', v_r::text), ('r6b', v_r2::text);
end $$;
-- El portal, desde su servidor.
set local role service_role;
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
do $$
declare v_r uuid := (select v::uuid from _t where clave = 'r6'); x jsonb; v_err text;
begin
  begin perform public.conta_recibo_parar(v_r, '   '); exception when invalid_parameter_value then v_err := 'sin motivo'; end;
  if v_err is null then raise exception 'G05 T4 · 6: se ha parado sin motivo.'; end if;
  x := public.conta_recibo_parar(v_r, 'No contraté la gestión laboral');
  if x->>'frase' <> 'Parado el recibo de 157,30 € de 2026-12: no se cobra hasta que la gestoría lo revise.' then raise exception 'G05 T4 · 6: parar dijo «%».', x->>'frase'; end if;
  perform public.conta_recibo_parar(v_r, 'No contraté la gestión laboral desde diciembre', 'Persona Prueba (portal)');
  v_err := null;
  begin perform public.conta_recibo_parar((select v::uuid from _t where clave = 'r6b'), 'No'); exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'Este recibo ya se ha enviado al banco: ya no se puede parar desde aquí. Habla con tu gestoría.' then raise exception 'G05 T4 · 6: parar uno enviado dijo «%».', v_err; end if;
end $$;
reset role;
do $$
declare v_r uuid := (select v::uuid from _t where clave = 'r6'); v public.conta_recibo;
begin
  select * into v from public.conta_recibo where id = v_r;
  if v.parado <> array['El cliente no está de acuerdo: «No contraté la gestión laboral desde diciembre»'] or v.decision <> 'pendiente' then
    raise exception 'G05 T4 · 6: el recibo parado quedó % / %.', v.parado, v.decision;
  end if;
  if (select count(*) from public.conta_gestoria_diferencia where tipo = 'cliente_no_de_acuerdo' and vigente and datos->>'recibo' = v_r::text) <> 1
     or (select datos->>'quien' from public.conta_gestoria_diferencia where tipo = 'cliente_no_de_acuerdo' and vigente and datos->>'recibo' = v_r::text) <> 'Persona Prueba (portal)' then
    raise exception 'G05 T4 · 6: la incidencia no es una sola y vigente, con quién la puso.';
  end if;
  if (select count(*) from public.conta_recibo_evento where recibo_id = v_r and tipo = 'parado_cliente') <> 2 then raise exception 'G05 T4 · 6: el historial no apunta las dos veces.'; end if;
end $$;
-- La gestoría: no lo puede aprobar mientras está parado; otra cuenta no lo deshace; la suya sí.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01b0000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ declare v_err text; begin
  begin perform public.conta_recibo_reanudar((select v::uuid from _t where clave = 'r6')); exception when no_data_found then v_err := 'no'; end;
  if v_err is null then raise exception 'G05 T4 · 6: otra cuenta ha deshecho el recibo parado.'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$
declare v_r uuid := (select v::uuid from _t where clave = 'r6'); v_err text; x jsonb;
begin
  begin perform public.conta_cobro_decidir(v_r, 'aprobado'); exception when check_violation then v_err := sqlerrm; end;
  if v_err not like 'No se puede aprobar: El cliente no está de acuerdo%' then raise exception 'G05 T4 · 6: aprobar el parado dijo «%».', v_err; end if;
  x := public.conta_recibo_reanudar(v_r);
  if x->>'frase' <> 'Cliente Prueba G05 Portal vuelve al cobro de 2026-12, por revisar: apruébalo cuando lo tengas claro.' then raise exception 'G05 T4 · 6: deshacer dijo «%».', x->>'frase'; end if;
  v_err := null;
  begin perform public.conta_recibo_reanudar(v_r); exception when check_violation then v_err := sqlerrm; end;
  if v_err is distinct from 'Este recibo no lo ha parado su cliente.' then raise exception 'G05 T4 · 6: deshacer dos veces dijo «%».', v_err; end if;
end $$;
reset role;
do $$
declare v_r uuid := (select v::uuid from _t where clave = 'r6');
begin
  if (select cardinality(parado) from public.conta_recibo where id = v_r) <> 0
     or exists (select 1 from public.conta_gestoria_diferencia where tipo = 'cliente_no_de_acuerdo' and vigente and datos->>'recibo' = v_r::text) then
    raise exception 'G05 T4 · 6: deshecho, sigue parado o con la incidencia vigente.';
  end if;
  raise notice 'G05 T4 · 6: el portal para el recibo con su motivo (sale del cobro, incidencia y historial), otra vez sin duplicar, sin motivo no, uno enviado no; otra cuenta no lo deshace; la gestoría sí. OK';
end $$;
\i supabase/vuelta-atras/20261109T1500_g05_t4_parar_recibo.down.sql
do $$ begin
  if to_regprocedure('public.conta_recibo_parar(uuid,text,text)') is not null
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'conta_gestoria_diferencia_tipo_check')) like '%cliente_no_de_acuerdo%' then
    raise exception 'G05 T4 · 6: la vuelta atrás de la 1500 no la quita.';
  end if;
end $$;
\i supabase/migrations/20261109T1500_g05_t4_parar_recibo.sql
\echo 'G05 T4 · 6: la vuelta atrás de la 1500, y otra vez la 1500. OK'

rollback;
