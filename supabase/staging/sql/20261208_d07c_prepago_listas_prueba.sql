-- supabase/staging/sql/20261208_d07c_prepago_listas_prueba.sql
--
-- SOLO STAGING. Prueba de 20261208T0830_d07c_prepago_en_todas_las_listas, con
-- \i dentro de la transacción y ROLLBACK: staging no cambia. Datos de la
-- empresa A de staging; la recibida es inventada dentro de la transacción.
--
--   (Empieza con su vuelta atrás, por si la 0830 ya estuviera.)
--   0. Lo de antes: conta_recibida_guardar y mark_supplier_invoice_paid son
--      las de producción (md5); guardar «prepaid» en la ficha da el error.
--   1. La 0830.
--   2. Como usuario de A: guardar en la ficha una recibida con «Saldo prepago
--      Catcher» (prepaid) se guarda, y su historial lo dice en palabras.
--   3. Una forma que no existe: el error en español, con el nombre de cada
--      forma, sin claves en inglés.
--   4. Las demás listas: mark_supplier_invoice_paid admite prepaid (y su error
--      sale en español); los CHECK de supplier_invoice.paid_method,
--      customer_fiscal y payment_method admiten prepaid; el catálogo tiene su
--      fila «Saldo prepago Catcher (40700001)».
--   5. B no guarda en la ficha de A.
--   6. La vuelta atrás: las dos funciones byte a byte, sin la fila del
--      catálogo. Y otra vez delante: los md5 nuevos.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D07c: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/vuelta-atras/20261208T0830_d07c_prepago_en_todas_las_listas.down.sql

-- 0 · Lo de antes.
do $$
begin
  if md5(pg_get_functiondef('public.conta_recibida_guardar(uuid,jsonb,text)'::regprocedure)) <> '08126d47a81d33fbb3826ce6b84179d8' then
    raise exception 'PRUEBA D07c · 0: conta_recibida_guardar no es la de producción.';
  end if;
  if md5(pg_get_functiondef('public.mark_supplier_invoice_paid(uuid,date,text)'::regprocedure)) <> '192d75fa8906f443db5800ee209b0e9a' then
    raise exception 'PRUEBA D07c · 0: mark_supplier_invoice_paid no es la de producción.';
  end if;
end $$;

-- La recibida de la prueba, en revisión, de un proveedor de A.
create temp table _c (clave text primary key, id uuid) on commit drop;
grant select on _c to authenticated;
insert into _c select 'prov', s.id from public.supplier s where s.account_id = 'c01a0000-0000-4000-8000-00000000000a' order by s.created_at, s.id limit 1;
insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, due_date, status, source,
                                     tax_base_total, tax_total, grand_total, needs_review, created_by_name)
select 'd07c0000-0000-4000-8000-000000000830', 'c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', p.id, 'invoice',
       'D07C-PREPAGO-1', date '2026-10-20', date '2026-10-20', 'en_revision', 'manual', 4.82, 1.01, 5.83, false, 'prueba D07c'
  from _c p where p.clave = 'prov';
do $$ begin
  if not exists (select 1 from public.supplier_invoice where id = 'd07c0000-0000-4000-8000-000000000830') then
    raise exception 'PRUEBA D07c · 0: la empresa A de staging no tiene ningún proveedor.';
  end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    perform public.conta_recibida_guardar('d07c0000-0000-4000-8000-000000000830', '{"forma_pago": "prepaid"}'::jsonb, 'Prueba D07c');
    raise exception 'PRUEBA D07c · 0: sin la 0830, «prepaid» ya se guarda en la ficha: ¿está aplicada?';
  exception when sqlstate '22023' then null;
  end;
  raise notice '0 · sin la 0830, «Saldo prepago» no se guarda en la ficha (el fallo)';
end $$;
reset role;

-- 1 · La 0830.
\i supabase/migrations/20261208T0830_d07c_prepago_en_todas_las_listas.sql

-- 2 y 3 · Como usuario de A.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r jsonb; v_msg text;
begin
  r := public.conta_recibida_guardar('d07c0000-0000-4000-8000-000000000830', '{"forma_pago": "prepaid"}'::jsonb, 'Prueba D07c');
  if (select payment_method from public.supplier_invoice where id = 'd07c0000-0000-4000-8000-000000000830') is distinct from 'prepaid' then
    raise exception 'PRUEBA D07c · 2: la ficha no ha guardado «Saldo prepago» (%).', r;
  end if;
  if not exists (select 1 from public.supplier_invoice_change where supplier_invoice_id = 'd07c0000-0000-4000-8000-000000000830' and cambios @> '[{"campo": "forma_pago", "ahora": "prepaid"}]') then
    raise exception 'PRUEBA D07c · 2: el historial no apunta el cambio de forma de pago.';
  end if;
  if r::text not like '%Saldo prepago Catcher (40700001)%' then
    raise exception 'PRUEBA D07c · 2: lo que dice al guardar no nombra «Saldo prepago Catcher»: %', r;
  end if;
  raise notice '2 · %', r->>'texto';
  begin
    perform public.conta_recibida_guardar('d07c0000-0000-4000-8000-000000000830', '{"forma_pago": "bizum"}'::jsonb, 'Prueba D07c');
    raise exception 'PRUEBA D07c · 3: «bizum» se ha guardado.';
  exception when sqlstate '22023' then
    get stacked diagnostics v_msg = message_text;
    if v_msg ~ '(transfer|direct_debit|\mcard\M|\mcash\M|prepaid)' or v_msg not like '%Saldo prepago Catcher (40700001)%' or v_msg not like '%Transferencia%' then
      raise exception 'PRUEBA D07c · 3: el error no lo dice en español con sus nombres: %', v_msg;
    end if;
    raise notice '3 · %', v_msg;
  end;
end $$;
reset role;

-- 4 · Las demás listas.
do $$
declare v_msg text;
begin
  update public.supplier_invoice set paid_method = 'prepaid' where id = 'd07c0000-0000-4000-8000-000000000830';
  update public.supplier_invoice set paid_method = null where id = 'd07c0000-0000-4000-8000-000000000830';
  if not exists (select 1 from public.payment_method where is_system and account_id is null and kind = 'prepaid' and name = 'Saldo prepago Catcher (40700001)') then
    raise exception 'PRUEBA D07c · 4: el catálogo no tiene «Saldo prepago Catcher».';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'customer_fiscal_payment_method_check')) not like '%prepaid%' then
    raise exception 'PRUEBA D07c · 4: la ficha fiscal del cliente no admite prepaid.';
  end if;
  if pg_get_functiondef('public.mark_supplier_invoice_paid(uuid,date,text)'::regprocedure) not like '%''cash'',''prepaid''%' then
    raise exception 'PRUEBA D07c · 4: mark_supplier_invoice_paid no admite prepaid.';
  end if;
  raise notice '4 · paid_method, customer_fiscal, el catálogo y mark_supplier_invoice_paid admiten «Saldo prepago»';
end $$;

-- 5 · B no guarda en la ficha de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_recibida_guardar('d07c0000-0000-4000-8000-000000000830', '{"forma_pago": "cash"}'::jsonb, 'B');
    raise exception 'PRUEBA D07c · 5: B ha guardado en una recibida de A.';
  exception when insufficient_privilege then null;
  end;
  raise notice '5 · B no guarda en la ficha de A';
end $$;
reset role;

-- 6 · La vuelta atrás, y otra vez delante.
update public.supplier_invoice set payment_method = null where id = 'd07c0000-0000-4000-8000-000000000830';
\i supabase/vuelta-atras/20261208T0830_d07c_prepago_en_todas_las_listas.down.sql
do $$ begin
  if md5(pg_get_functiondef('public.conta_recibida_guardar(uuid,jsonb,text)'::regprocedure)) <> '08126d47a81d33fbb3826ce6b84179d8'
     or md5(pg_get_functiondef('public.mark_supplier_invoice_paid(uuid,date,text)'::regprocedure)) <> '192d75fa8906f443db5800ee209b0e9a'
     or exists (select 1 from public.payment_method where kind = 'prepaid') then
    raise exception 'PRUEBA D07c · 6: la vuelta atrás no deja las funciones byte a byte o deja la fila del catálogo.';
  end if;
end $$;
\i supabase/migrations/20261208T0830_d07c_prepago_en_todas_las_listas.sql
do $$ begin
  if md5(pg_get_functiondef('public.conta_recibida_guardar(uuid,jsonb,text)'::regprocedure)) <> '5eecff4e2fea2a335fe7323cc1cc638e'
     or md5(pg_get_functiondef('public.mark_supplier_invoice_paid(uuid,date,text)'::regprocedure)) <> '7ec159755cec7bf80a8b548f9f213d9a' then
    raise exception 'PRUEBA D07c · 6: otra vez delante, las funciones no son las de la 0830.';
  end if;
  raise notice '6 · la vuelta atrás, byte a byte; y otra vez delante';
end $$;

rollback;
