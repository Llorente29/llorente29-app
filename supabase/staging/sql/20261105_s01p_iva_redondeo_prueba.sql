-- supabase/staging/sql/20261105_s01p_iva_redondeo_prueba.sql
--
-- SOLO STAGING. Prueba del IVA redondeado línea a línea (1510). Todo en una
-- transacción con ROLLBACK, en la empresa de la cuenta A, con facturas y cuentas
-- de mentira. Nombra lo que cambia, para el analizador:
-- conta_motivos_para_validar. El camino termina en VALIDAR (regla 10).
--   1. Una factura como la F1-2081547 de Uber: 3 líneas al 21 % (17,22; 103,02;
--      73,45), IVA de la factura 40,69 y base × 21 % = 40,67. Ya no tiene el
--      motivo de la cuota y SE VALIDA.
--   2. Una factura de 1 línea con 0,02 € de diferencia: sigue sin dejar.
--   3. Una de 3 líneas con 0,04 € de diferencia: sigue sin dejar.
--   4. Un asiento sin factura (no se sabe cuántas líneas): 0,02 € deja; 0,03 €, no.
--   5. La vuelta atrás deja conta_motivos_para_validar con su huella de
--      producción y quita lo nuevo; y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p IVA redondeo: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: la tanda la aplica el dueño de las funciones (como el workflow); para validar, los «claims» del administrador de A.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('folvy.cuenta_activa', 'c01a0000-0000-4000-8000-00000000000a', true);

\i supabase/migrations/20261105T1510_s01p_iva_redondeo.sql

create temp table _p (clave text primary key, v uuid) on commit drop;
grant all on _p to authenticated;
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid; x record; s uuid;
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  if c is null then raise exception 'PRUEBA S01p IVA redondeo: no está la empresa de la cuenta A.'; end if;
  select id into y from public.fiscal_year where company_id = c and date '2026-10-20' between starts_on and ends_on;
  if y is null then insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31') returning id into y; end if;
  for x in select * from (values ('62900099', '629'), ('47200099', '472'), ('41000099', '4100')) v(code, t) loop
    if not exists (select 1 from public.company_account where company_id = c and code = x.code) then
      insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
      values (v_acc, c, x.code, 'PRUEBA S01p IVA ' || x.t, 'own', 'pymes', 'manual', x.t);
    end if;
  end loop;
  insert into public.supplier (account_id, name) values (v_acc, 'PRUEBA S01p proveedor que redondea por línea') returning id into s;
  insert into _p values ('empresa', c), ('ejercicio', y), ('proveedor', s);
end $$;

-- Un asiento de factura (o sin ella) con su IVA, propuesto; devuelve el asiento.
create function pg_temp.asiento(p_lineas numeric[], p_cuota numeric, p_con_factura boolean) returns uuid language plpgsql as $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid := (select v from _p where clave = 'empresa');
  f uuid; e uuid; b numeric := (select sum(x) from unnest(p_lineas) x); k int := 0; x numeric;
  g uuid; i uuid; p uuid; t uuid := (select id from public.tax_rate where code = 'iva_general' and rate = 21);
begin
  select id into g from public.company_account where company_id = c and code = '62900099';
  select id into i from public.company_account where company_id = c and code = '47200099';
  select id into p from public.company_account where company_id = c and code = '41000099';
  if p_con_factura then
    insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_date, tax_base_total, tax_total, grand_total, status)
    values (v_acc, c, (select v from _p where clave = 'proveedor'), '2026-10-20', b, p_cuota, b + p_cuota, 'aprobada') returning id into f;
    foreach x in array p_lineas loop
      k := k + 1;
      insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position)
      values (f, 'PRUEBA línea ' || k, 1, x, x, 21, k);
    end loop;
  end if;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status, confidence, reason, document_ref, document_date)
  values (v_acc, c, (select v from _p where clave = 'ejercicio'), 2, '2026-10-20', 'PRUEBA S01p IVA redondeo',
          case when p_con_factura then 'supplier_invoice' else 'manual' end, f, 'propuesto', 'seguro', 'PRUEBA', 'PRUEBA-' || left(gen_random_uuid()::text, 8), '2026-10-20')
  returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, is_common, tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents)
  values (v_acc, c, e, 1, g, b, 0, true, null, null, null, null, 1),
         (v_acc, c, e, 2, i, p_cuota, 0, true, t, b, 'received', 'yes', 1),
         (v_acc, c, e, 3, p, 0, b + p_cuota, true, null, null, null, null, 1);
  if p_con_factura then update public.supplier_invoice set journal_entry_id = e where id = f; end if;
  return e;
end $$;
create function pg_temp.motivo_cuota(e uuid) returns text language sql as $$
  select string_agg(m.motivo, ' | ') from public.conta_motivos_para_validar(e) m where m.motivo ~ 'no es la base'
$$;

-- 1 · Como la F1-2081547: deja, y se valida.
do $$
declare e uuid; m text; v_err text;
begin
  e := pg_temp.asiento(array[17.22, 103.02, 73.45], 40.69, true);
  m := pg_temp.motivo_cuota(e);
  if m is not null then raise exception 'PRUEBA S01p IVA redondeo · 1: la de Uber sigue con el motivo de la cuota: %', m; end if;
  perform public.journal_entry_validar(e, 'PRUEBA D');
  if (select status from public.journal_entry where id = e) <> 'validado' then raise exception 'PRUEBA S01p IVA redondeo · 1: no queda validada.'; end if;
  raise notice 'PRUEBA S01p IVA redondeo · 1 en verde: 3 líneas al 21 %%, 40,69 frente a 40,67: sin motivo y validada.';
end $$;

-- 2 · 1 línea, 0,02 € de diferencia: no deja.
do $$
declare e uuid; m text;
begin
  e := pg_temp.asiento(array[100.00], 21.02, true);
  m := pg_temp.motivo_cuota(e);
  if m is null or m !~ 'la cuota 21.02 no es la base 100.00' then raise exception 'PRUEBA S01p IVA redondeo · 2: una línea con 0,02 € deja validar (%).', m; end if;
  raise notice 'PRUEBA S01p IVA redondeo · 2 en verde: «%».', m;
end $$;

-- 3 · 3 líneas, 0,04 € de diferencia: no deja.
do $$
declare e uuid; m text;
begin
  e := pg_temp.asiento(array[17.22, 103.02, 73.45], 40.71, true);
  m := pg_temp.motivo_cuota(e);
  if m is null then raise exception 'PRUEBA S01p IVA redondeo · 3: 3 líneas con 0,04 € dejan validar.'; end if;
  raise notice 'PRUEBA S01p IVA redondeo · 3 en verde: «%».', m;
end $$;

-- 4 · Sin factura: 0,02 € deja; 0,03 €, no.
do $$
declare m2 text; m3 text;
begin
  m2 := pg_temp.motivo_cuota(pg_temp.asiento(array[100.00], 21.02, false));
  m3 := pg_temp.motivo_cuota(pg_temp.asiento(array[100.00], 21.03, false));
  if m2 is not null then raise exception 'PRUEBA S01p IVA redondeo · 4: sin factura, 0,02 € no deja (%).', m2; end if;
  if m3 is null then raise exception 'PRUEBA S01p IVA redondeo · 4: sin factura, 0,03 € deja.'; end if;
  raise notice 'PRUEBA S01p IVA redondeo · 4 en verde: sin factura, 0,02 € deja y 0,03 € no («%»).', m3;
end $$;

-- 5 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261105T1510_s01p_iva_redondeo.down.sql
do $$ begin
  -- La base local va por detrás de producción en esta función: allí no se compara la huella.
  if md5(pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure)) <> '9b352ea4ae6d1c73437d4eed3762d38a' and current_database() <> 'staging_local' then
    raise exception 'PRUEBA S01p IVA redondeo · 5: conta_motivos_para_validar no vuelve a su huella de producción.';
  end if;
  if to_regprocedure('public._conta_iva_tolerancia(uuid,numeric)') is not null then raise exception 'PRUEBA S01p IVA redondeo · 5: queda la función nueva.'; end if;
  raise notice 'PRUEBA S01p IVA redondeo · 5 en verde: la función vuelve a su huella de producción y lo nuevo se va.';
end $$;
\i supabase/migrations/20261105T1510_s01p_iva_redondeo.sql
do $$ begin
  if to_regprocedure('public._conta_iva_tolerancia(uuid,numeric)') is null then raise exception 'PRUEBA S01p IVA redondeo · 5: no vuelve delante.'; end if;
  raise notice 'PRUEBA S01p IVA redondeo · 5: y otra vez delante, bien.';
end $$;

rollback;
