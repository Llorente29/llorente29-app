-- supabase/staging/sql/20261127_x14l_tramos_por_casilla_prueba.sql
--
-- SOLO STAGING. Prueba del X14l (20261127T2205_x14l_tramos_por_casilla), que el ensayo de staging pone delante en la misma
-- sesión. Todo en una transacción con ROLLBACK: staging no cambia. Lo nuevo: supplier_invoice_tax.import_position (la casilla de
-- ERP10), su disparador tg_supplier_invoice_tax_casilla y el índice supplier_invoice_tax_tipo_y_casilla, en lugar de la
-- restricción supplier_invoice_tax_supplier_invoice_id_vat_pct_key. Datos INVENTADOS, en la cuenta A. Los caminos:
--   1. Una recibida traída de ERP10 con tres casillas, dos al 21 % (+100,00 y −20,00) y una al 0 %: entran las tres, tal cual,
--      con su casilla 1, 2 y 3, y suman la base y el IVA de la factura (sin sumar ni tirar ninguna).
--   2. Varias casillas en una sola sentencia (como las inserta la carga): 1, 2, 3, en su orden.
--   3. Una recibida de Sumied sigue con un tramo por tipo: dos al 21 % paran (23505), y su tramo no lleva casilla.
--   4. La vuelta atrás, con dos tramos al mismo tipo: para y no deja nada a medias.
--   5. La vuelta atrás, sin ellos: lo deja como antes.
-- sin usuario: los tramos los escribe solo la base (la carga de ERP10 y las funciones de la ficha); authenticated no puede
-- insertar en supplier_invoice_tax (revoke de la D01), así que se prueba como postgres, que es como escribe la carga.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X14l: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regclass('public.supplier_invoice_tax_tipo_y_casilla') is null then raise exception 'PRUEBA X14l · 0: falta la 20261127T2205 delante.'; end if;
end $$;
set local statement_timeout = '120s';

-- Preparar (como postgres): dos recibidas inventadas de la cuenta A, una traída y otra de Sumied.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e uuid; v_sup uuid; v_t uuid; v_t2 uuid; v_m uuid;
begin
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;
  select id into v_sup from public.supplier where account_id = v_acc order by created_at limit 1;
  if v_e is null or v_sup is null then raise exception 'PRUEBA X14l · 0: la cuenta A no tiene empresa o proveedor.'; end if;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, tax_base_total, tax_total, grand_total, status, source, created_by_name)
  values (v_acc, v_e, v_sup, 'X14L-1', '2025-03-15', 130, 16.8, 146.8, 'aprobada', 'traida', 'Prueba X14l') returning id into v_t;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, tax_base_total, tax_total, grand_total, status, source, created_by_name)
  values (v_acc, v_e, v_sup, 'X14L-2', '2025-03-16', 30, 2.1, 32.1, 'aprobada', 'traida', 'Prueba X14l') returning id into v_t2;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status, source, created_by_name)
  values (v_acc, v_e, v_sup, 'X14L-3', '2026-11-27', 121, 'aprobada', 'manual', 'Prueba X14l') returning id into v_m;
  perform set_config('prueba.t', v_t::text, true);
  perform set_config('prueba.t2', v_t2::text, true);
  perform set_config('prueba.m', v_m::text, true);
end $$;

-- 1 · Tres casillas de ERP10, dos al 21 % ---------------------------------------------------------------------------------------
do $$
declare v_t uuid := current_setting('prueba.t')::uuid; v_acc uuid; r record; s text := '';
begin
  select account_id into v_acc from public.supplier_invoice where id = v_t;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount) values (v_acc, v_t, 21, 100, 21);
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount) values (v_acc, v_t, 21, -20, -4.2);
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount) values (v_acc, v_t, 0, 50, 0);
  for r in select import_position p, vat_pct, base, vat_amount from public.supplier_invoice_tax where supplier_invoice_id = v_t order by import_position loop
    s := s || r.p || ':' || r.vat_pct::numeric(5,0) || ':' || r.base || ':' || r.vat_amount || ' ';
  end loop;
  if s <> '1:21:100.00:21.00 2:21:-20.00:-4.20 3:0:50.00:0.00 ' then raise exception 'PRUEBA X14l · 1: las casillas no entran tal cual (%).', s; end if;
  if (select sum(base) from public.supplier_invoice_tax where supplier_invoice_id = v_t) <> 130
     or (select sum(vat_amount) from public.supplier_invoice_tax where supplier_invoice_id = v_t) <> 16.8 then
    raise exception 'PRUEBA X14l · 1: los tramos no suman la base y el IVA de la factura.';
  end if;
  raise notice 'PRUEBA X14l · 1: una traída con dos casillas al 21 %% (+100,00 y −20,00) y una al 0 %%: entran las tres, con su casilla 1, 2 y 3, y suman la factura.';
end $$;

-- 2 · En una sola sentencia, como la carga -------------------------------------------------------------------------------------
do $$
declare v_t uuid := current_setting('prueba.t2')::uuid; v_acc uuid; s text;
begin
  select account_id into v_acc from public.supplier_invoice where id = v_t;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
  select v_acc, v_t, (z->>'tipo')::numeric, (z->>'base')::numeric / 100, (z->>'cuota')::numeric / 100
    from jsonb_array_elements('[{"tipo":10,"base":2500,"cuota":250},{"tipo":10,"base":-500,"cuota":-50},{"tipo":0,"base":1000,"cuota":0}]'::jsonb) z;
  select string_agg(import_position || ':' || base, ' ' order by import_position) into s from public.supplier_invoice_tax where supplier_invoice_id = v_t;
  if s is distinct from '1:25.00 2:-5.00 3:10.00' then raise exception 'PRUEBA X14l · 2: en una sentencia, las casillas no salen en su orden (%).', s; end if;
  raise notice 'PRUEBA X14l · 2: tres casillas en una sola sentencia, como la carga: 1, 2 y 3, en su orden.';
end $$;

-- 3 · Una recibida de Sumied: un tramo por tipo, sin casilla ------------------------------------------------------------------
do $$
declare v_m uuid := current_setting('prueba.m')::uuid; v_acc uuid; ok boolean := false;
begin
  select account_id into v_acc from public.supplier_invoice where id = v_m;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount) values (v_acc, v_m, 21, 100, 21);
  if (select import_position from public.supplier_invoice_tax where supplier_invoice_id = v_m) is not null then
    raise exception 'PRUEBA X14l · 3: el tramo de una factura de Sumied lleva casilla.';
  end if;
  begin
    insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount) values (v_acc, v_m, 21, -10, -2.1);
  exception when unique_violation then ok := true;
  end;
  if not ok then raise exception 'PRUEBA X14l · 3: una factura de Sumied admite dos tramos al mismo tipo.'; end if;
  raise notice 'PRUEBA X14l · 3: una recibida de Sumied sigue con un tramo por tipo: el segundo al 21 %% para (23505), y no lleva casilla.';
end $$;

-- 4 · La vuelta atrás, con dos tramos al mismo tipo ------------------------------------------------------------------------------
do $$
declare ok boolean := false;
begin
  begin
    if exists (select 1 from public.supplier_invoice_tax group by supplier_invoice_id, vat_pct having count(*) > 1) then
      raise exception 'X14l: hay recibidas con dos tramos de IVA al mismo tipo (casillas de ERP10): con ellas no cabe la regla de antes. No se deshace.';
    end if;
  exception when raise_exception then ok := true;
  end;
  if not ok or to_regclass('public.supplier_invoice_tax_tipo_y_casilla') is null then raise exception 'PRUEBA X14l · 4: la vuelta atrás no para con dos tramos al mismo tipo.'; end if;
  raise notice 'PRUEBA X14l · 4: con dos tramos al mismo tipo, la vuelta atrás para (su primer paso) y no deja nada a medias.';
end $$;

-- 5 · La vuelta atrás, sin ellos: lo deja como antes --------------------------------------------------------------------------------
delete from public.supplier_invoice_tax where supplier_invoice_id in (current_setting('prueba.t')::uuid, current_setting('prueba.t2')::uuid);
\i supabase/vuelta-atras/20261127T2205_x14l_tramos_por_casilla.down.sql
do $$ begin
  if to_regclass('public.supplier_invoice_tax_tipo_y_casilla') is not null
     or not exists (select 1 from pg_constraint where conname = 'supplier_invoice_tax_supplier_invoice_id_vat_pct_key')
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_invoice_tax' and column_name = 'import_position')
     or exists (select 1 from pg_trigger where tgname = 'tg_supplier_invoice_tax_casilla') then
    raise exception 'PRUEBA X14l · 5: la vuelta atrás no lo deja como antes.';
  end if;
  raise notice 'PRUEBA X14l · 5: la vuelta atrás quita la casilla, su disparador y el índice, y devuelve la regla de un tramo por tipo.';
end $$;

rollback;
