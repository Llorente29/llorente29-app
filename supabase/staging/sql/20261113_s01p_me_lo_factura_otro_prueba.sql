-- supabase/staging/sql/20261113_s01p_me_lo_factura_otro_prueba.sql
--
-- SOLO STAGING. Prueba de la 1910 y la 0033 (S01p·20·2: «Me lo factura otro»), con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. En la cuenta A: Hermanos Ruiz trae el género y lo
-- factura Mercados del Norte, que liquida cada mes (como MANUFACTURAS CATOR y Cloudtown).
--
--   1. Antes: la ficha de Hermanos Ruiz pregunta el tipo de gasto y cómo factura, y sale en
--      «Qué tienes que mirar».
--   2. «Me lo factura otro» con Mercados del Norte: lo dice, y vuelve a mirar su recepción abierta.
--   3. Después: su ficha no pregunta ni el tipo de gasto ni cómo factura, no sale en «Qué tienes
--      que mirar», y su recepción va a la liquidación de Mercados del Norte, sin pregunta y con la
--      frase «Lo factura Mercados del Norte en su factura de género.».
--   4. Si el que lo factura no liquida cada mes, la recepción espera SU factura (la del otro).
--   5. Lo que no se puede: facturarse a sí mismo, una cadena (el otro también tiene quien le
--      factura) y que se lo facture otro a quien ya factura lo de otros.
--   6. Elegir otra forma con compras_forma_facturar quita «me lo factura otro».
--   7. Sin cuenta, no.
--   8. La vuelta atrás: las cuatro funciones como estaban, fuera el botón y la columna (vacía).
--
-- Nombra lo que toca, para el analizador: _compras_camino_calcula, compras_ficha_le_falta,
-- compras_mirar, _compras_forma_facturar, compras_lo_factura_otro, supplier, goods_receipt_path.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p·20·2: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
set local lock_timeout = '30s';
-- sin usuario: la tanda la aplica el dueño de las funciones (como el workflow); el botón se pulsa con «role authenticated» y los «claims» del administrador de A.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('folvy.cuenta_activa', 'c01a0000-0000-4000-8000-00000000000a', true);

-- La 1910 solo añade: staging la aplica de verdad desde la rama. La 0033 cambia: se pasa aquí.
select to_regprocedure('public.compras_lo_factura_otro(uuid,uuid)') is not null as con_1910 \gset
\if :con_1910
\else
\i supabase/migrations/20261113T1910_s01p_me_lo_factura_otro.sql
\endif
select strpos(pg_get_functiondef('public._compras_camino_calcula(uuid)'::regprocedure), 'S01p·20·2') > 0 as ya_esta \gset
\if :ya_esta
\else
\i supabase/migrations/20261114T0033_s01p_me_lo_factura_otro_caminos.sql
\endif

-- Hermanos Ruiz (trae), Mercados del Norte (factura, cada mes); una recepción suya con la pregunta
-- de la ficha abierta, como las de CATOR antes de decirlo.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_x constant uuid := 'c01a0000-0000-4000-8000-0000000000a3';
  v_o constant uuid := 'c1b0a000-0000-4000-8000-0000000000a6';
  v_loc uuid; v_s uuid; v_emp text;
begin
  if not exists (select 1 from public.supplier where id = v_x and account_id = v_acc)
     or not exists (select 1 from public.supplier where id = v_o and account_id = v_acc) then
    raise exception 'PRUEBA S01p·20·2: no están Hermanos Ruiz y Mercados del Norte en la cuenta A.';
  end if;
  update public.supplier set invoicing_mode = 'monthly_settlement', invoicing_frequency = 'monthly', invoiced_by_supplier_id = null, archived_at = null where id = v_o;
  update public.supplier set invoicing_mode = null, invoicing_frequency = null, invoicing_per_location = null, expense_category_id = null,
         invoiced_by_supplier_id = null, archived_at = null where id = v_x;
  delete from public.company_account_link where account_id = v_acc and entity = 'supplier' and entity_id = v_x::text and role = 'gasto';
  select id into v_loc from public.locations where account_id = v_acc order by created_at, id limit 1;
  select coalesce(legal_name, trade_name) into v_emp from public.company where account_id = v_acc and is_active order by created_at, id limit 1;
  insert into public.goods_receipt_ai_session (account_id, kind, parsed_result, status)
  values (v_acc, 'photo', jsonb_build_object('document', jsonb_build_object('doc_type', 'factura', 'bill_to_name', v_emp), 'lines', '[]'::jsonb), 'pending_review')
  returning id into v_s;
  insert into public.goods_receipt (id, account_id, location_id, supplier_id, status, receipt_date, ai_session_id, supplier_doc_number, created_by_name)
  values ('c01a2002-0000-4000-8000-000000000001', v_acc, v_loc, v_x, 'borrador', date '2026-11-04', v_s, 'PRUEBA-2002', 'prueba');
  insert into public.goods_receipt_path (account_id, goods_receipt_id, path, supplier_id, doc_type, question, reason)
  values (v_acc, 'c01a2002-0000-4000-8000-000000000001', 'factura', v_x, 'factura', 'ficha_sin_forma',
          'Es una factura a nombre de tu empresa. La ficha no dice cómo factura: dímelo y la apunto.');
end $$;

-- 1. Antes.
do $$
declare v_f jsonb := public.compras_ficha_le_falta('c01a0000-0000-4000-8000-0000000000a3'); v_m jsonb;
begin
  if not v_f @> '[{"falta":"tipo_gasto"}]' or not v_f @> '[{"falta":"forma_facturar"}]' then
    raise exception 'PRUEBA S01p·20·2 · 1: la ficha debería preguntar el tipo de gasto y cómo factura: %', v_f;
  end if;
  v_m := public.compras_mirar('c01a0000-0000-4000-8000-00000000000a');
  if not (v_m->'fichas') @> '[{"proveedor":"c01a0000-0000-4000-8000-0000000000a3"}]' then
    raise exception 'PRUEBA S01p·20·2 · 1: Hermanos Ruiz debería salir en «Qué tienes que mirar»: %', v_m->'fichas';
  end if;
  raise notice '1 · antes: la ficha pregunta el tipo de gasto y cómo factura, y sale en «Qué tienes que mirar»';
end $$;

-- 2. «Me lo factura otro», como lo pulsa la administradora de A.
create temp table _r (v jsonb) on commit drop;
grant all on _r to authenticated;
set local role authenticated;
insert into _r select public.compras_lo_factura_otro('c01a0000-0000-4000-8000-0000000000a3', 'c1b0a000-0000-4000-8000-0000000000a6');
reset role;
do $$
declare v jsonb := (select v from _r);
begin
  if v->>'mensaje' <> 'Guardado: lo de Hermanos Ruiz lo factura Mercados del Norte en su factura de género. No espero ninguna factura de Hermanos Ruiz. He vuelto a mirar su recepción abierta.'
     or (v->>'recepciones')::int <> 1 then
    raise exception 'PRUEBA S01p·20·2 · 2: no dice lo que ha hecho: %', v;
  end if;
  raise notice '2 · «Me lo factura otro»: %', v->>'mensaje';
end $$;

-- 3. Después.
do $$
declare
  v_f jsonb := public.compras_ficha_le_falta('c01a0000-0000-4000-8000-0000000000a3');
  v_m jsonb := public.compras_mirar('c01a0000-0000-4000-8000-00000000000a');
  p record; s record;
begin
  select * into s from public.supplier where id = 'c01a0000-0000-4000-8000-0000000000a3';
  if s.invoiced_by_supplier_id is distinct from 'c1b0a000-0000-4000-8000-0000000000a6' or s.invoicing_mode is not null then
    raise exception 'PRUEBA S01p·20·2 · 3: la ficha no quedó con quién lo factura: % / %', s.invoiced_by_supplier_id, s.invoicing_mode;
  end if;
  if v_f @> '[{"falta":"tipo_gasto"}]' or v_f @> '[{"falta":"forma_facturar"}]' then
    raise exception 'PRUEBA S01p·20·2 · 3: la ficha sigue preguntando: %', v_f;
  end if;
  if (v_m->'fichas') @> '[{"proveedor":"c01a0000-0000-4000-8000-0000000000a3"}]' then
    raise exception 'PRUEBA S01p·20·2 · 3: Hermanos Ruiz sigue en «Qué tienes que mirar».';
  end if;
  select * into p from public.goods_receipt_path where goods_receipt_id = 'c01a2002-0000-4000-8000-000000000001';
  if p.path <> 'liquidacion' or p.supplier_id <> 'c1b0a000-0000-4000-8000-0000000000a6' or p.question is not null
     or p.reason <> 'Lo factura Mercados del Norte en su factura de género.' then
    raise exception 'PRUEBA S01p·20·2 · 3: la recepción no va con Mercados del Norte: % % % «%»', p.path, p.supplier_id, p.question, p.reason;
  end if;
  raise notice '3 · después: sin preguntas, fuera de «Qué tienes que mirar», y la recepción en la liquidación de Mercados del Norte («%»)', p.reason;
end $$;

-- 4. Si el que lo factura no liquida cada mes: espera SU factura.
do $$
declare v jsonb;
begin
  update public.supplier set invoicing_mode = 'delivery_note_then_invoice' where id = 'c1b0a000-0000-4000-8000-0000000000a6';
  v := public._compras_camino_calcula('c01a2002-0000-4000-8000-000000000001');
  if v->>'path' <> 'pendiente_factura' or v->>'supplier_id' <> 'c1b0a000-0000-4000-8000-0000000000a6' or v->>'question' is not null then
    raise exception 'PRUEBA S01p·20·2 · 4: debería esperar la factura de Mercados del Norte: %', v;
  end if;
  update public.supplier set invoicing_mode = 'monthly_settlement' where id = 'c1b0a000-0000-4000-8000-0000000000a6';
  raise notice '4 · si el otro no liquida cada mes, la recepción espera su factura';
end $$;

-- 5. Lo que no se puede (como la administradora).
set local role authenticated;
do $$
declare v_x constant uuid := 'c01a0000-0000-4000-8000-0000000000a3'; v_o constant uuid := 'c1b0a000-0000-4000-8000-0000000000a6';
  v_otro constant uuid := 'c01a0000-0000-4000-8000-0000000000a4'; v_que text;
begin
  begin perform public.compras_lo_factura_otro(v_x, v_x); raise exception 'PRUEBA S01p·20·2 · 5: se dejó facturar a sí mismo.';
  exception when sqlstate '22023' then v_que := sqlerrm; end;
  begin perform public.compras_lo_factura_otro(v_otro, v_x); raise exception 'PRUEBA S01p·20·2 · 5: se dejó hacer una cadena.';
  exception when sqlstate '22023' then v_que := v_que || ' · ' || sqlerrm; end;
  begin perform public.compras_lo_factura_otro(v_o, v_otro); raise exception 'PRUEBA S01p·20·2 · 5: a quien factura lo de otros se lo factura otro.';
  exception when sqlstate '22023' then v_que := v_que || ' · ' || sqlerrm; end;
  raise notice '5 · lo que no se puede: %', v_que;
end $$;

-- 6. Elegir otra forma la quita.
select public.compras_forma_facturar('c01a0000-0000-4000-8000-0000000000a3', 'per_delivery', null, null) is not null as forma \gset
reset role;
do $$ begin
  if (select invoiced_by_supplier_id from public.supplier where id = 'c01a0000-0000-4000-8000-0000000000a3') is not null then
    raise exception 'PRUEBA S01p·20·2 · 6: elegir otra forma no quitó «me lo factura otro».';
  end if;
  raise notice '6 · elegir «Con cada entrega» quita «me lo factura otro»';
end $$;

-- 7. Sin cuenta, no.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000f00f","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.compras_lo_factura_otro('c01a0000-0000-4000-8000-0000000000a3', 'c1b0a000-0000-4000-8000-0000000000a6');
    raise exception 'PRUEBA S01p·20·2 · 7: alguien sin la cuenta lo cambió.';
  exception when sqlstate '42501' then raise notice '7 · sin cuenta: %', sqlerrm;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

\if :ya_esta
\else
-- 8. La vuelta atrás, de las dos y en orden inverso (nadie tiene ya quién se lo factura: la columna se va).
\i supabase/vuelta-atras/20261114T0033_s01p_me_lo_factura_otro_caminos.down.sql
\i supabase/vuelta-atras/20261113T1910_s01p_me_lo_factura_otro.down.sql
do $$
declare f text;
begin
  foreach f in array array['public._compras_camino_calcula(uuid)', 'public.compras_ficha_le_falta(uuid)', 'public.compras_mirar(uuid)', 'public._compras_forma_facturar(uuid,text,boolean,text)'] loop
    if strpos(pg_get_functiondef(f::regprocedure), 'invoiced_by_supplier_id') > 0 then raise exception 'PRUEBA S01p·20·2 · 8: % sigue cambiada.', f; end if;
  end loop;
  if to_regprocedure('public.compras_lo_factura_otro(uuid,uuid)') is not null then raise exception 'PRUEBA S01p·20·2 · 8: queda el botón.'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier' and column_name = 'invoiced_by_supplier_id') then
    raise exception 'PRUEBA S01p·20·2 · 8: queda la columna.';
  end if;
  raise notice '8 · la vuelta atrás: las cuatro como estaban, fuera el botón y la columna';
end $$;
\endif

rollback;
