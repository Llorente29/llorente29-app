-- supabase/staging/sql/20261115_d01_referencia_vuelta_atras_prueba.sql
--
-- SOLO STAGING. La tanda de las liquidaciones de referencia (20261115T0110) y
-- SU VUELTA ATRÁS, ejecutadas de verdad, sobre datos: los mismos ficheros que
-- van a producción (\i), con la cuenta A en vez de Foodint (d01_prueba.*).
-- Todo en una transacción con ROLLBACK: no cambia staging. Datos inventados.
-- (16/10: el ensayo #103 en producción paró en la vuelta atrás con 42702, una
-- columna ambigua que la prueba de antes no podía ver: en staging no hay
-- Foodint y la vuelta atrás no hacía nada.)
-- sin usuario: la tanda y su vuelta atrás las aplica el workflow como postgres, y así se prueban aquí.
--
--   0. Sin corte de Bancos (el de A es el del último importado, 01/01/2026):
--      dos resúmenes de agosto de la misma tienda que se solapan (27/07–02/08 y
--      27/07–09/08) y uno de octubre, cada uno con su factura de comisión.
--   1. Con el corte de Bancos al 01/10/2026, la tanda: las dos de agosto pasan
--      a de referencia y sus facturas se van a la copia; la de octubre sigue
--      con la suya; el solape se sigue diciendo en las dos.
--   2. La vuelta atrás: las dos facturas vuelven con sus mismos ids, totales,
--      líneas e IVA; las liquidaciones vuelven a apuntarlas y dejan de ser de
--      referencia; la copia desaparece.
--   3. La vuelta atrás del corte (0100), detrás, como en producción: fuera
--      _conta_corte y is_reference, las dos funciones siguen, nada se descasa.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01 referencia: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- 0 · Preparar: el proveedor de la plataforma y tres resúmenes con su factura.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_canal uuid; v_party uuid; v_sup uuid; p jsonb; e jsonb;
begin
  -- La tanda cuenta TODAS las del correo de la cuenta: la prueba empieza sin ninguna. Las que haya
  -- (la de la semilla de Libros, seed_d01_liquidacion_referencia_staging.sql) se quitan aquí dentro,
  -- y el rollback del final las devuelve.
  delete from public.channel_settlement where account_id = v_acc and source like 'correo\_%';
  delete from public.bank_settings where company_id = v_e;
  if public._conta_corte(v_e) >= date '2026-07-27' then raise exception 'PRUEBA D01 referencia · 0: sin Bancos, el corte de A (%) no deja crear facturas de agosto.', public._conta_corte(v_e); end if;
  select id into v_canal from public.sales_channel where account_id = v_acc and slug = 'uber';
  insert into public.party (account_id, name, created_by_name) values (v_acc, 'Plataforma inventada (prueba referencia)', 'Prueba D01 referencia') returning id into v_party;
  insert into public.party_role (account_id, party_id, role, channel_id, commission_account_code) values (v_acc, v_party, 'platform', v_canal, '62300001');
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Plataforma inventada referencia', 'Plataforma Inventada Referencia SL', 'B00000099', true, 'Prueba D01 referencia') returning id into v_sup;
  update public.party_role set party_id = v_party where account_id = v_acc and supplier_id = v_sup and role = 'supplier';
  if not found then insert into public.party_role (account_id, party_id, role, supplier_id) values (v_acc, v_party, 'supplier', v_sup); end if;

  p := jsonb_build_object('proveedor', 'uber', 'tienda', 'Marca Referencia Inventada (Calle Inventada 7, Madrid, ES, 28001)', 'marca', 'Marca Referencia Inventada',
    'referencia', null, 'deposito_iniciado', null, 'pedidos', 4,
    'ventas', jsonb_build_object('base', 80, 'iva', 8, 'total', 88, 'pedidos', 4),
    'ganancias', jsonb_build_object('ventas', 88, 'pedidosVentas', 4, 'otras', 0, 'total', 88),
    'uber', jsonb_build_object('tasas', -8, 'otros', 0, 'total', -8),
    'marketing', jsonb_build_object('promociones', -15, 'otrosPromo', -2, 'anuncios', -10, 'total', -27),
    'modificaciones', jsonb_build_object('contracargo', 0, 'pedidosContracargo', 0, 'ajustes', 0, 'total', 0),
    'neto', 53, 'diario', '[]'::jsonb, 'contracargos', '[]'::jsonb, 'mensual', null, 'avisos', '[]'::jsonb,
    'factura', jsonb_build_object('comision', jsonb_build_object('total', 10, 'base', 8.27), 'publicidad', jsonb_build_object('total', 10, 'base', 8.26),
                                  'base', 16.53, 'iva', 3.47, 'total', 20, 'tipo_iva', 21, 'avisos', '[]'::jsonb));
  perform set_config('request.jwt.claims', '', true);
  for e in select v.x from (values
      (jsonb_build_object('email_id', 'prueba-ref-1', 'desde', '2026-07-27', 'hasta', '2026-08-02')),
      (jsonb_build_object('email_id', 'prueba-ref-2', 'desde', '2026-07-27', 'hasta', '2026-08-09')),
      (jsonb_build_object('email_id', 'prueba-ref-3', 'desde', '2026-10-05', 'hasta', '2026-10-11'))) v(x) loop
    if public.conta_liquidacion_registrar(v_e, p || e, null)->'factura'->>'estado' <> 'creada' then
      raise exception 'PRUEBA D01 referencia · 0: un resumen de % no ha creado su factura.', e->>'desde';
    end if;
  end loop;
  if (select count(*) from public.channel_settlement where account_id = v_acc and source like 'correo\_%' and review_note like '%Se solapa con%') <> 2 then
    raise exception 'PRUEBA D01 referencia · 0: las dos de agosto no dicen que se solapan.';
  end if;
  -- Lo que hay antes, para compararlo después de la vuelta atrás.
  create temp table prueba_antes on commit drop as
    select s.id liq, i.id fac, i.grand_total, i.tax_total, i.invoice_date,
           (select count(*) from public.supplier_invoice_line l where l.supplier_invoice_id = i.id) lineas,
           (select string_agg(l.expense_account_code || '=' || l.line_amount, ',' order by l.position) from public.supplier_invoice_line l where l.supplier_invoice_id = i.id) detalle,
           (select count(*) from public.supplier_invoice_tax t where t.supplier_invoice_id = i.id) impuestos
      from public.channel_settlement s join public.supplier_invoice i on i.id = s.commission_invoice_id
     where s.account_id = v_acc and s.source like 'correo\_%';
  insert into public.bank_settings (company_id, account_id, cutover_date) values (v_e, v_acc, date '2026-10-01');
  raise notice 'PRUEBA D01 referencia · 0: dos de agosto (se solapan) y una de octubre, las tres con factura; corte de Bancos al 01/10/2026.';
end $$;

-- 1 · La tanda, la misma que va a producción, sobre la cuenta A.
select set_config('d01_prueba.cuenta', 'c01a0000-0000-4000-8000-00000000000a', true),
       set_config('d01_prueba.empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', true),
       set_config('d01_prueba.esperadas', '2', true),
       set_config('d01_prueba.solapes', '2', true);
\i supabase/migrations/20261115T0110_d01_liquidaciones_referencia_foodint.sql
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
begin
  if (select count(*) from public.channel_settlement where account_id = v_acc and source like 'correo\_%' and is_reference and commission_invoice_id is null and period_to < date '2026-10-01') <> 2
     or exists (select 1 from public.supplier_invoice i join prueba_antes a on a.fac = i.id where a.invoice_date < date '2026-10-01')
     or (select count(*) from public.conta_respaldo_liquidacion_factura where tanda = '20261115T0110_d01_liquidaciones_referencia_foodint') <> 2
     or not exists (select 1 from public.channel_settlement s join prueba_antes a on a.liq = s.id where s.period_to >= date '2026-10-01' and s.commission_invoice_id = a.fac)
     or (select count(*) from public.channel_settlement where account_id = v_acc and source like 'correo\_%' and is_reference and review_note like '%Se solapa con%') <> 2 then
    raise exception 'PRUEBA D01 referencia · 1: la tanda no deja lo que dice.';
  end if;
  raise notice 'PRUEBA D01 referencia · 1: las dos de agosto, de referencia y sin factura (en la copia, 2); la de octubre, con la suya; el solape, dicho en las dos.';
end $$;

-- 2 · Su vuelta atrás, la misma que va a producción.
\i supabase/vuelta-atras/20261115T0110_d01_liquidaciones_referencia_foodint.down.sql
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; n int;
begin
  select count(*) into n from prueba_antes a
    join public.supplier_invoice i on i.id = a.fac and i.grand_total = a.grand_total and i.tax_total = a.tax_total and i.invoice_date = a.invoice_date
    join public.channel_settlement s on s.id = a.liq and s.commission_invoice_id = a.fac and s.is_reference is not true
   where (select count(*) from public.supplier_invoice_line l where l.supplier_invoice_id = i.id) = a.lineas
     and (select string_agg(l.expense_account_code || '=' || l.line_amount, ',' order by l.position) from public.supplier_invoice_line l where l.supplier_invoice_id = i.id) = a.detalle
     and (select count(*) from public.supplier_invoice_tax t where t.supplier_invoice_id = i.id) = a.impuestos;
  if n <> 3 or to_regclass('public.conta_respaldo_liquidacion_factura') is not null then
    raise exception 'PRUEBA D01 referencia · 2: la vuelta atrás no deja lo de antes (% de 3 iguales; copia %).', n, coalesce(to_regclass('public.conta_respaldo_liquidacion_factura')::text, 'quitada');
  end if;
  raise notice 'PRUEBA D01 referencia · 2: la vuelta atrás devuelve las dos facturas con sus ids, totales, líneas e IVA, y quita la copia.';
end $$;

-- 3 · Y la vuelta atrás del corte (0100), en el mismo orden que en producción.
\i supabase/vuelta-atras/20261115T0100_d01_liquidaciones_corte.down.sql
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
begin
  if to_regprocedure('public._conta_corte(uuid)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'channel_settlement' and column_name = 'is_reference')
     or to_regprocedure('public.conta_liquidacion_factura_proponer(uuid,text)') is null
     or to_regprocedure('public._conta_liquidacion_marcar(uuid)') is null
     or (select count(*) from public.channel_settlement s join prueba_antes a on a.liq = s.id and s.commission_invoice_id = a.fac) <> 3 then
    raise exception 'PRUEBA D01 referencia · 3: la vuelta atrás del corte no deja lo de antes.';
  end if;
  raise notice 'PRUEBA D01 referencia · 3: la vuelta atrás del corte quita _conta_corte y is_reference, deja las dos funciones y las tres liquidaciones con su factura.';
end $$;

rollback;
