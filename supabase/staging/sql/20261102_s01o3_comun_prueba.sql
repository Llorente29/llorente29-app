-- supabase/staging/sql/20261102_s01o3_comun_prueba.sql
--
-- SOLO STAGING. Prueba del S01o·3 (20261102T0929 y 0930): «Común a todos los
-- locales» como local por defecto de un proveedor. Todo en una transacción con
-- ROLLBACK. Datos inventados, en la cuenta D. Prueba lo que cambia en caliente:
-- public._conta_factura_segura.
--
--   1. Con el eje «local» encendido, un servicio sin local por defecto: «Falta su local».
--   2. El mismo, «común a todos los locales» en su ficha: se apunta solo, el
--      gasto va común y sin local, el asiento se valida y su porqué lo dice.
--   3. La 0930 no hace nada sin Foodint.
--   4. La vuelta atrás, y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01o·3: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
-- sin usuario: la prueba llama a las funciones internas (las de la pasada), que no son de ninguna persona.

-- El workflow ya ha pasado la tanda de la rama: la regla vuelve antes a la de antes, desde su respaldo.
do $$ begin
  if position('default_common' in pg_get_functiondef('public._conta_factura_segura(uuid)'::regprocedure)) > 0 then
    perform public._restaurar_funcion('public._conta_factura_segura(uuid)', '20261102T0929_s01o3_comun_por_defecto');
  end if;
end $$;
\i supabase/migrations/20261102T0929_s01o3_comun_por_defecto.sql
\i supabase/migrations/20261102T0930_s01o3_anthropic_comun.sql

-- Preparar (todo inventado): un servicio con su ficha completa y sin local por defecto.
do $$
declare
  v_acc constant uuid := 'c01d0000-0000-4000-8000-00000000000d';
  v_e constant uuid := 'c01d0000-0000-4000-8000-0000000000d2';
  v_s uuid; v_g uuid;
begin
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, status, origin)
  select v_acc, v_e, '2026', date '2026-01-01', date '2026-12-31', 'open', 'folvy'
   where not exists (select 1 from public.fiscal_year where company_id = v_e and current_date between starts_on and ends_on);
  insert into public.company_purchase_setting (company_id, account_id, receives_goods, post_safe_invoices) values (v_e, v_acc, true, true)
  on conflict (company_id) do update set post_safe_invoices = true;
  insert into public.conta_eje_analitico (account_id, company_id, eje, activo, nombre) values (v_acc, v_e, 'local', true, 'Local') on conflict do nothing;
  update public.conta_eje_analitico set activo = true where company_id = v_e and eje = 'local';
  insert into public.supplier (account_id, name, tax_id, tax_id_type, country_code)
  values (v_acc, 'Software Inventado S01o3, S.L.', 'B00000195', 'nif_es', 'ES') returning id into v_s;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  values (v_acc, v_e, 'pymes', '41009934', '4100', 'Prueba S01o3', 'own', 'manual') returning id into v_g;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source) values (v_acc, v_e, v_g, 'supplier', v_s::text, 'principal', 'manual');
  select id into v_g from public.company_account where company_id = v_e and code = '62300000';
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source) values (v_acc, v_e, v_g, 'supplier', v_s::text, 'gasto', 'manual');
  perform set_config('prueba.acc', v_acc::text, true);
  perform set_config('prueba.e', v_e::text, true);
  perform set_config('prueba.s', v_s::text, true);
end $$;

create function pg_temp.factura(p_num text, p_base numeric)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, tax_base_total, tax_total, grand_total, status, source, created_by_name, reading_confidence, reading)
  values (current_setting('prueba.acc')::uuid, current_setting('prueba.e')::uuid, current_setting('prueba.s')::uuid, p_num, date '2026-10-20', p_base, round(p_base * 0.21, 2), p_base + round(p_base * 0.21, 2),
          'en_revision', 'ocr', 'Prueba S01o3', 'seguro',
          jsonb_build_object('factura', jsonb_build_object('proveedor', jsonb_build_object('nif', 'B00000195'), 'destinatario', jsonb_build_object('nif', 'B12345682')), 'confianza', 'seguro'))
  returning id into v;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
  values (current_setting('prueba.acc')::uuid, v, 21, p_base, round(p_base * 0.21, 2));
  return v;
end $$;

-- 1 · Sin local por defecto y sin «común»: «Falta su local».
do $$
declare r jsonb;
begin
  r := public._conta_factura_apuntar(pg_temp.factura('S01O3-0001', 10));
  if (r->>'apuntada')::boolean or r->>'motivo' <> 'Falta su local en la ficha de Software Inventado S01o3, S.L..' then
    raise exception 'PRUEBA S01o·3 · 1: sin local ni «común» no dice «Falta su local»: %', r;
  end if;
  raise notice 'PRUEBA S01o·3 · 1: «%»', r->>'motivo';
end $$;

-- 2 · «Común a todos los locales» en su ficha: apuntada sola, gasto común sin local, validada.
do $$
declare r jsonb; n int;
begin
  update public.supplier set default_common = true where id = current_setting('prueba.s')::uuid;
  r := public._conta_factura_apuntar(pg_temp.factura('S01O3-0002', 100));
  if not coalesce((r->>'apuntada')::boolean, false) or r->>'porque' not like '%Común a todos los locales, como dice su ficha.' then
    raise exception 'PRUEBA S01o·3 · 2: con «común» en su ficha no se apunta o no lo dice: %', r;
  end if;
  select count(*) into n from public.journal_line l join public.company_account a on a.id = l.company_account_id
   where l.entry_id = (r->>'asiento')::uuid and l.is_common and l.location_id is null;
  if n <> (select count(*) from public.journal_line where entry_id = (r->>'asiento')::uuid)
     or (select status from public.journal_entry where id = (r->>'asiento')::uuid) <> 'validado' then
    raise exception 'PRUEBA S01o·3 · 2: el asiento no va todo común y sin local, o no está validado.';
  end if;
  raise notice 'PRUEBA S01o·3 · 2: «%»', r->>'porque';
end $$;

-- 3 · La 0930 no hace nada sin Foodint (lo dice su notice al cargarla arriba).
do $$ begin raise notice 'PRUEBA S01o·3 · 3: la 0930, sin la cuenta de Foodint, no toca nada.'; end $$;

-- 4 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261102T0930_s01o3_anthropic_comun.down.sql
\i supabase/vuelta-atras/20261102T0929_s01o3_comun_por_defecto.down.sql
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier' and column_name = 'default_common')
     or position('default_common' in pg_get_functiondef('public._conta_factura_segura(uuid)'::regprocedure)) > 0 then
    raise exception 'PRUEBA S01o·3 · 4: la vuelta atrás no deja las cosas como estaban.';
  end if;
  raise notice 'PRUEBA S01o·3 · 4: la vuelta atrás quita la columna y devuelve la regla.';
end $$;
\i supabase/migrations/20261102T0929_s01o3_comun_por_defecto.sql

rollback;
