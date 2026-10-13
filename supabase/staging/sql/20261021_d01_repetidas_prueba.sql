-- supabase/staging/sql/20261021_d01_repetidas_prueba.sql
--
-- SOLO STAGING. Prueba de 20261021T0230 y 20261021T0260 (la regla única de
-- repetidas, con el total, la del C01b): public.supplier_invoice (su disparador), public.tg_supplier_invoice_no_repetida,
-- public.supplier_invoice_repetida y public.supplier_invoice_repetidas_que_hay.
-- Todo en una transacción con ROLLBACK, como administrador de A y de B.
--
--   1. La clave: «s/n», «sin número» (con y sin tilde), «000» no son número;
--      «01» sí; barras, guiones y espacios no cuentan.
--   2. El caso de la población real: un proveedor que pone «01» en dos
--      facturas de fecha e importe distintos — las dos entran.
--   3. El mismo número y el mismo total no entra (ni al crearla, ni al
--      cambiarle el total para que coincida); con «No es repetida», sí.
--   4. La función (0260, la regla del C01b): repetida; posible por fecha y
--      total; y nada con el mismo número y otro total, sin total o con total 0.
--   5. Las que ya había: se listan por número Y total.
--   6. B no pregunta por A.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01 repetidas: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_prov constant uuid := 'c01a0000-0000-4000-8000-0000000000a3'; -- Hermanos Ruiz, de A (semilla)
  v_e uuid := (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at limit 1);
  v_a uuid; v_b uuid; v_c uuid; v_res text; v_n int;
begin
  -- 1 · la clave
  if public.conta_clave_numero('s/n') is not null or public.conta_clave_numero('Sin número') is not null or public.conta_clave_numero('SIN NUMERO') is not null
     or public.conta_clave_numero('000') is not null or public.conta_clave_numero(' - ') is not null or public.conta_clave_numero(null) is not null then
    raise exception 'PRUEBA D01 repetidas · 1: algo que no es número da clave.';
  end if;
  if public.conta_clave_numero('01') <> '01' or public.conta_clave_numero(' f-2026/ 1022 ') <> 'F20261022' then
    raise exception 'PRUEBA D01 repetidas · 1: la clave no es la de la regla (% / %).', public.conta_clave_numero('01'), public.conta_clave_numero(' f-2026/ 1022 ');
  end if;
  raise notice 'PRUEBA D01 repetidas · 1: «s/n», «sin número», «000» y «-» no son número; «01» sí; « f-2026/ 1022 » es F20261022.';

  -- 2 · el «01» de la población real
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name)
  values (v_acc, v_prov, v_e, '01', '2026-09-04', 'en_revision', 'manual', 210.40, 'Prueba D01') returning id into v_a;
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name)
  values (v_acc, v_prov, v_e, '01', '2026-09-11', 'en_revision', 'manual', 87.15, 'Prueba D01') returning id into v_b;
  raise notice 'PRUEBA D01 repetidas · 2: dos «01» del mismo proveedor con otro importe y otra fecha entran los dos.';

  -- 3 · el mismo número y el mismo total, no
  begin
    insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name)
    values (v_acc, v_prov, v_e, '0-1', '2026-09-20', 'en_revision', 'manual', 210.40, 'Prueba D01');
    raise exception 'PRUEBA D01 repetidas · 3: ha entrado «0-1» por el mismo total que «01».';
  exception when unique_violation then null; end;
  begin
    update public.supplier_invoice set grand_total = 210.40 where id = v_b;
    raise exception 'PRUEBA D01 repetidas · 3: cambiarle el total para que coincida no lo ha parado.';
  exception when unique_violation then null; end;
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name, not_duplicate_confirmed_at, not_duplicate_confirmed_by_name)
  values (v_acc, v_prov, v_e, '0-1', '2026-09-20', 'en_revision', 'manual', 210.40, 'Prueba D01', now(), 'Prueba D01') returning id into v_c;
  -- Sin total todavía no se puede decir: entra, y la pregunta queda para cuando lo tenga.
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, created_by_name)
  values (v_acc, v_prov, v_e, '01', '2026-09-25', 'borrador', 'manual', 'Prueba D01');
  raise notice 'PRUEBA D01 repetidas · 3: el mismo número y total no entra, ni cambiando el total; con «No es repetida», sí; sin total, entra.';

  -- 4 · la función
  select nivel into v_res from public.supplier_invoice_repetida(v_acc, v_prov, null, '01', '2026-10-01', 87.15);
  if v_res is distinct from 'repetida' then raise exception 'PRUEBA D01 repetidas · 4: el mismo número y total no es repetida (%).', v_res; end if;
  -- Desde la 0260 (la del C01b): el mismo número con otro total, o sin total, no es nada.
  select count(*) into v_n from public.supplier_invoice_repetida(v_acc, v_prov, null, '01', '2026-10-01', 5);
  if v_n <> 0 then raise exception 'PRUEBA D01 repetidas · 4: el mismo número con otro total sale como algo.'; end if;
  select count(*) into v_n from public.supplier_invoice_repetida(v_acc, v_prov, null, '01', null, null);
  if v_n <> 0 then raise exception 'PRUEBA D01 repetidas · 4: el mismo número sin total sale como algo.'; end if;
  -- Un total 0 no casa nada.
  select count(*) into v_n from public.supplier_invoice_repetida(v_acc, v_prov, null, 'X-79', '2026-09-25', 0);
  if v_n <> 0 then raise exception 'PRUEBA D01 repetidas · 4: un total 0 casa algo.'; end if;
  select nivel into v_res from public.supplier_invoice_repetida(v_acc, v_prov, null, 'X-77', '2026-09-11', 87.15);
  if v_res is distinct from 'posible' then raise exception 'PRUEBA D01 repetidas · 4: misma fecha y total con otro número no es posible (%).', v_res; end if;
  select count(*) into v_n from public.supplier_invoice_repetida(v_acc, v_prov, null, 'X-78', '2026-12-11', 87.15);
  if v_n <> 0 then raise exception 'PRUEBA D01 repetidas · 4: otro número, otra fecha, sale algo.'; end if;
  raise notice 'PRUEBA D01 repetidas · 4: repetida; posible por fecha y total; y nada con el mismo número y otro total, sin total o con total 0 (la regla del C01b).';

  -- 5 · las que ya había
  select count(*) into v_n from public.supplier_invoice_repetidas_que_hay(v_acc) where v_a = any (ids) or v_b = any (ids);
  if v_n <> 0 then raise exception 'PRUEBA D01 repetidas · 5: los dos «01» con otro total salen como repetidas que hay.'; end if;
  select count(*) into v_n from public.supplier_invoice_repetidas_que_hay(v_acc);
  raise notice 'PRUEBA D01 repetidas · 5: los dos «01» no se listan; repetidas que ya había en A (número y total): %.', v_n;
end $$;
reset role;

-- 6 · B no pregunta por A
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform * from public.supplier_invoice_repetida('c01a0000-0000-4000-8000-00000000000a', null, null, '01', null, null);
    raise exception 'PRUEBA D01 repetidas · 6: B ha preguntado por repetidas de A.';
  exception when insufficient_privilege then null; end;
  if exists (select 1 from public.supplier_invoice_repetidas_que_hay('c01a0000-0000-4000-8000-00000000000a')) then
    raise exception 'PRUEBA D01 repetidas · 6: B ve las repetidas de A.';
  end if;
  raise notice 'PRUEBA D01 repetidas · 6: B no pregunta ni ve las repetidas de A.';
end $$;
reset role;

rollback;
