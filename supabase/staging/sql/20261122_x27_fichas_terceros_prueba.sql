-- supabase/staging/sql/20261122_x27_fichas_terceros_prueba.sql
--
-- SOLO STAGING. Prueba del X27 (20261122T1315_x27_fichas_terceros y 20261122T1316_x27_la_factura_usa_su_ficha), que el
-- ensayo de staging pone delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia. Nombra lo que cambia: public.supplier_invoice (el
-- disparador x27_recibida_nace) y public.supplier_invoice_expense (el disparador x27_linea_plataforma); y lo nuevo:
-- public.supplier, public.customer_fiscal, public.tg_x27_recibida_nace() y public.tg_x27_linea_plataforma().
--
-- En la gestoría de la cuenta del núcleo (semillas K02, K04, K06 y K10b), como su usuario. Las recibidas son inventadas,
-- dentro de la transacción (T11). Por sus CAMINOS:
--   1. Regla 31: con la ficha del proveedor sin nada nuevo (como quedan TODAS al aplicar), una recibida nace igual que
--      antes: % deducible, 347, marca y plataforma de la línea, vacíos.
--   2. La ficha del proveedor, escrita como la escribe la pantalla (update de supplier, como su usuario): 50 %, no 347,
--      la marca K10b Uno y la plataforma K06.
--   3. Una recibida nueva de ese proveedor nace con todo eso; su línea de gasto, con la plataforma.
--   4. Lo que la recibida ya trae no se toca: con 100 % y otra marca, se quedan; una línea a la que se quitó la
--      plataforma no la recupera al volver a poner las líneas.
--   5. Cambiarle el proveedor a una recibida vacía: toma lo del nuevo, también la plataforma de sus líneas. Con su
--      asiento validado, nada.
--   6. La ficha del cliente: teléfono, correo, observaciones, nombre comercial y tipos de IVA (update de
--      customer_fiscal, como su usuario).
--   7. La vuelta atrás: quita los disparadores y las columnas; lo que una recibida copió se queda en ella.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X27: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public.tg_x27_recibida_nace()') is null then raise exception 'PRUEBA X27 · 0: faltan la 1315 y la 1316 delante.'; end if;
  if not exists (select 1 from public.supplier where id = 'c0e40000-0000-4000-8000-0000000000a1') then
    raise exception 'PRUEBA X27 · 0: falta el proveedor de la semilla K04.';
  end if;
  if not exists (select 1 from public.brand where id = 'c0eb0000-0000-4000-8000-0000000000c1')
     or not exists (select 1 from public.sales_channel where id = 'c0e60000-0000-4000-8000-0000000000c0') then
    raise exception 'PRUEBA X27 · 0: faltan la marca de la K10b o la plataforma de la K06.';
  end if;
end $$;
set local statement_timeout = '120s';

-- Una recibida inventada, sin asiento, del proveedor que se diga; y su línea de gasto.
create or replace function pg_temp.x27_recibida(p_id uuid, p_num text, p_prov uuid, p_pct numeric default null, p_marca uuid default null)
returns void language sql as $$
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source,
                                       tax_base_total, tax_total, grand_total, needs_review, created_by_name, vat_deductible_pct, brand_id)
  values (p_id, 'c0e20000-0000-4000-8000-0000000000e0', 'c0e20000-0000-4000-8000-0000000000e3', p_prov, 'invoice', p_num, date '2026-11-10',
          'en_revision', 'manual', 100, 21, 121, true, 'prueba X27', p_pct, p_marca);
  insert into public.supplier_invoice_expense (account_id, supplier_invoice_id, position, account_code, is_common, amount)
  values ('c0e20000-0000-4000-8000-0000000000e0', p_id, 0, '62800000', true, 100);
$$;
create or replace function pg_temp.x27_ver(p_id uuid) returns jsonb language sql as $$
  select jsonb_build_object('pct', i.vat_deductible_pct, 'no_347', i.exclude_from_347, 'marca', i.brand_id,
    'plataforma', (select d.channel_id from public.supplier_invoice_expense_dato d where d.supplier_invoice_id = i.id and d.position = 0),
    'dato', exists (select 1 from public.supplier_invoice_expense_dato d where d.supplier_invoice_id = i.id))
  from public.supplier_invoice i where i.id = p_id
$$;

-- 1 · Regla 31: la ficha sin nada nuevo, la recibida nace como antes ----------------------------------------------
do $$
declare v jsonb;
begin
  if exists (select 1 from public.supplier where vat_deductible_pct is not null or default_brand_id is not null
              or default_channel_id is not null or exclude_from_347 is not null or pay_on_post is not null) then
    raise exception 'PRUEBA X27 · 1: hay fichas con lo nuevo escrito antes de empezar.';
  end if;
  perform pg_temp.x27_recibida('c0e70000-0000-4000-8000-0000000002b1', 'X27-PRUEBA-1', 'c0e40000-0000-4000-8000-0000000000a1');
  v := pg_temp.x27_ver('c0e70000-0000-4000-8000-0000000002b1');
  if v <> '{"pct": null, "no_347": null, "marca": null, "plataforma": null, "dato": false}'::jsonb then
    raise exception 'PRUEBA X27 · 1: sin nada en la ficha, la recibida nace distinta: %', v;
  end if;
  raise notice 'PRUEBA X27 · 1 (regla 31): sin nada en la ficha, la recibida nace como antes: %', v;
end $$;

-- 2 · La ficha del proveedor, como la escribe la pantalla ---------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
update public.supplier set vat_deductible_pct = 50, exclude_from_347 = true, pay_on_post = true,
       default_brand_id = 'c0eb0000-0000-4000-8000-0000000000c1', default_channel_id = 'c0e60000-0000-4000-8000-0000000000c0'
 where id = 'c0e40000-0000-4000-8000-0000000000a1';
do $$ begin
  if not found and not exists (select 1 from public.supplier where id = 'c0e40000-0000-4000-8000-0000000000a1' and vat_deductible_pct = 50) then
    raise exception 'PRUEBA X27 · 2: su usuario no puede escribir la ficha del proveedor.';
  end if;
end $$;
reset role;

-- 3 · Una recibida nueva nace con lo de su ficha ------------------------------------------------------------------
do $$
declare v jsonb;
begin
  perform pg_temp.x27_recibida('c0e70000-0000-4000-8000-0000000002b2', 'X27-PRUEBA-2', 'c0e40000-0000-4000-8000-0000000000a1');
  v := pg_temp.x27_ver('c0e70000-0000-4000-8000-0000000002b2');
  if v <> jsonb_build_object('pct', 50.00, 'no_347', true, 'marca', 'c0eb0000-0000-4000-8000-0000000000c1',
                             'plataforma', 'c0e60000-0000-4000-8000-0000000000c0', 'dato', true) then
    raise exception 'PRUEBA X27 · 3: la recibida nueva no nace con lo de su ficha: %', v;
  end if;
  raise notice 'PRUEBA X27 · 3: la recibida nueva nace con lo de su ficha: %', v;
end $$;

-- 4 · Lo que ya trae no se toca -----------------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  perform pg_temp.x27_recibida('c0e70000-0000-4000-8000-0000000002b3', 'X27-PRUEBA-3', 'c0e40000-0000-4000-8000-0000000000a1',
                               100, 'c0eb0000-0000-4000-8000-0000000000c2');
  v := pg_temp.x27_ver('c0e70000-0000-4000-8000-0000000002b3');
  if v ->> 'pct' <> '100.00' or v ->> 'marca' <> 'c0eb0000-0000-4000-8000-0000000000c2' then
    raise exception 'PRUEBA X27 · 4: lo que traía la recibida se ha cambiado: %', v;
  end if;
  -- Quitarle la plataforma a la línea (como «Otros datos» de la K11a) y volver a poner las líneas (como el reparto).
  update public.supplier_invoice_expense_dato set channel_id = null where supplier_invoice_id = 'c0e70000-0000-4000-8000-0000000002b3';
  delete from public.supplier_invoice_expense where supplier_invoice_id = 'c0e70000-0000-4000-8000-0000000002b3';
  insert into public.supplier_invoice_expense (account_id, supplier_invoice_id, position, account_code, is_common, amount)
  values ('c0e20000-0000-4000-8000-0000000000e0', 'c0e70000-0000-4000-8000-0000000002b3', 0, '62800000', true, 100);
  v := pg_temp.x27_ver('c0e70000-0000-4000-8000-0000000002b3');
  if v -> 'plataforma' <> 'null'::jsonb then raise exception 'PRUEBA X27 · 4: la plataforma quitada ha vuelto: %', v; end if;
  raise notice 'PRUEBA X27 · 4: lo que trae la recibida se queda: %', v;
end $$;

-- 5 · Cambiar el proveedor: la vacía toma lo del nuevo; con su asiento validado, nada --------------------------------
do $$
declare v jsonb; v_otro uuid;
begin
  select s.id into v_otro from public.supplier s
   where s.account_id = 'c0e20000-0000-4000-8000-0000000000e0' and s.id <> 'c0e40000-0000-4000-8000-0000000000a1' order by s.id limit 1;
  if v_otro is null then raise exception 'PRUEBA X27 · 5: no hay otro proveedor en la gestoría.'; end if;
  perform pg_temp.x27_recibida('c0e70000-0000-4000-8000-0000000002b4', 'X27-PRUEBA-4', v_otro);
  update public.supplier_invoice set supplier_id = 'c0e40000-0000-4000-8000-0000000000a1' where id = 'c0e70000-0000-4000-8000-0000000002b4';
  v := pg_temp.x27_ver('c0e70000-0000-4000-8000-0000000002b4');
  if v ->> 'pct' <> '50.00' or v ->> 'no_347' <> 'true' or v ->> 'marca' <> 'c0eb0000-0000-4000-8000-0000000000c1'
     or v ->> 'plataforma' is distinct from 'c0e60000-0000-4000-8000-0000000000c0' then
    raise exception 'PRUEBA X27 · 5: al cambiarle el proveedor no toma lo del nuevo: %', v;
  end if;
  -- La regla de «con su asiento validado, nada», en la función misma (sin validar un asiento entero aquí: lo hace el
  -- camino de la X26). La mira el disparador antes de copiar nada.
  if position('validado' in pg_get_functiondef('public.tg_x27_recibida_nace()'::regprocedure)) = 0
     or position('validado' in pg_get_functiondef('public.tg_x27_linea_plataforma()'::regprocedure)) = 0 then
    raise exception 'PRUEBA X27 · 5: los disparadores no miran el asiento validado.';
  end if;
  raise notice 'PRUEBA X27 · 5: al cambiarle el proveedor toma lo del nuevo: %', v;
end $$;

-- 6 · La ficha del cliente -----------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
update public.customer_fiscal set phone = '900000000', email = 'cliente@prueba.folvy.test', notes = 'Prueba X27',
       trade_name = 'Cliente de Prueba X27', usual_tax_rate_ids = array(select id from public.tax_rate where company_id is null and rate = 21 order by id limit 1)
 where party_id = 'c0e50000-0000-4000-8000-0000000000c1';
reset role;
do $$
declare v record;
begin
  select phone, email, notes, trade_name, cardinality(usual_tax_rate_ids) n into v from public.customer_fiscal where party_id = 'c0e50000-0000-4000-8000-0000000000c1';
  if v.trade_name is distinct from 'Cliente de Prueba X27' or v.phone is distinct from '900000000' or v.n is distinct from 1 then
    raise exception 'PRUEBA X27 · 6: la ficha del cliente no guarda lo nuevo como su usuario: %', row_to_json(v);
  end if;
  raise notice 'PRUEBA X27 · 6: la ficha del cliente guarda teléfono, correo, observaciones, nombre comercial y tipos de IVA.';
end $$;

-- 7 · La vuelta atrás -----------------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261122T1316_x27_la_factura_usa_su_ficha.down.sql
\i supabase/vuelta-atras/20261122T1315_x27_fichas_terceros.down.sql
do $$
declare v jsonb;
begin
  if to_regprocedure('public.tg_x27_recibida_nace()') is not null or to_regprocedure('public.tg_x27_linea_plataforma()') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public'
                 and ((table_name = 'supplier' and column_name in ('vat_deductible_pct', 'default_brand_id', 'default_channel_id', 'exclude_from_347', 'pay_on_post'))
                   or (table_name = 'customer_fiscal' and column_name in ('phone', 'email', 'notes', 'trade_name', 'usual_tax_rate_ids')))) then
    raise exception 'PRUEBA X27 · 7: la vuelta atrás no quita lo nuevo';
  end if;
  -- Lo que una recibida copió de la ficha se queda en ella; y una nueva, sin disparador, nace vacía.
  v := pg_temp.x27_ver('c0e70000-0000-4000-8000-0000000002b2');
  if v ->> 'pct' <> '50.00' then raise exception 'PRUEBA X27 · 7: la recibida ha perdido lo que copió: %', v; end if;
  perform pg_temp.x27_recibida('c0e70000-0000-4000-8000-0000000002b5', 'X27-PRUEBA-5', 'c0e40000-0000-4000-8000-0000000000a1');
  v := pg_temp.x27_ver('c0e70000-0000-4000-8000-0000000002b5');
  if v <> '{"pct": null, "no_347": null, "marca": null, "plataforma": null, "dato": false}'::jsonb then
    raise exception 'PRUEBA X27 · 7: después de la vuelta atrás, una recibida nueva no nace como antes: %', v;
  end if;
  raise notice 'PRUEBA X27 · 7: la vuelta atrás quita los disparadores y las columnas; una recibida nueva nace como antes.';
end $$;

rollback;
