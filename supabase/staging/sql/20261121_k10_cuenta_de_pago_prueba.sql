-- supabase/staging/sql/20261121_k10_cuenta_de_pago_prueba.sql
--
-- SOLO STAGING. Prueba del K10 (20261121T1650_k10_cuenta_de_pago), que el ensayo de
-- staging pone delante en la misma sesión. Todo en una transacción con ROLLBACK:
-- staging no cambia. Nombra el objeto que cambia: public.conta_recibida_motivos
-- (un trozo) y public.company_account_misma_cuenta (dos trozos); y los nuevos: public.conta_k10_pago_desde_plataforma (función y
-- tabla).
--
-- En la gestoría de la cuenta del núcleo (semilla K02), como su usuario. La
-- plataforma, su proveedor, sus cuentas y la recibida son inventados, dentro de
-- la transacción (T11).
--
--   0. La 1650 está delante.
--   1. La 430 de una plataforma pasa a la ficha de su proveedor: con una
--      plataforma inventada (su 430 y su proveedor), la función le pone la 430
--      como «Cuenta de pago» y lo apunta; la segunda vez no pone nada; a uno que
--      ya tenía su cuenta de pago no se la cambia.
--   2. Se guarda una cuenta de pago en una ficha, como la guarda la pantalla
--      (company_account_link_set, papel «pago»), con cualquier subcuenta (la 551);
--      la del propio proveedor (su 400) no la deja.
--   3. La contrapartida, con cualquier subcuenta: una recibida cuyo asiento va a
--      la 480 y su proveedor se valida (antes, «Falta la cuenta de gasto»).
--   4. Deshacer: la vuelta atrás quita los enlaces que puso la tanda (y no los de
--      a mano), y conta_recibida_motivos vuelve a ser la de antes (sin el trozo del K10).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K10: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

create temp table _k10 (clave text primary key, valor text) on commit drop;
grant select, insert on _k10 to authenticated;

-- 0 · Lo de antes.
do $$ begin
  if to_regprocedure('public.conta_k10_pago_desde_plataforma()') is null then
    raise exception 'PRUEBA K10 · 0: falta la 1650 delante (la pone el ensayo de staging).';
  end if;
  raise notice '0 · la 1650 delante.';
end $$;

-- Lo inventado: una plataforma con su 430 y su proveedor; un proveedor con su cuenta de pago ya puesta; la 480 y la 551.
do $$
declare
  a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  v_party uuid; v_sup uuid := 'c0ea0000-0000-4000-8000-0000000000a0'; v_otro uuid := 'c0ea0000-0000-4000-8000-0000000000a1';
  v_430 uuid; v_480 uuid; v_551 uuid; v_400 uuid; v_572 uuid;
begin
  insert into public.supplier (id, account_id, name) values (v_sup, a, 'Plataforma de Prueba K10, S.L.'), (v_otro, a, 'Proveedor de Prueba K10, S.L.');
  -- Al dar de alta el proveedor, la base le crea su contacto (party_role «supplier»): ese contacto es también la plataforma.
  select party_id into v_party from public.party_role where account_id = a and supplier_id = v_sup and role = 'supplier';
  if v_party is null then
    insert into public.party (account_id, name) values (a, 'Plataforma de Prueba K10') returning id into v_party;
    insert into public.party_role (account_id, party_id, role, supplier_id) values (a, v_party, 'supplier', v_sup);
  end if;
  insert into public.party_role (account_id, party_id, role) values (a, v_party, 'platform');
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values
    (a, emp, 'pymes', '43000099', '4300', 'Clientes · Plataforma de Prueba K10', 'own', 'manual'),
    (a, emp, 'pymes', '48000099', '480', 'Gastos anticipados de prueba K10', 'own', 'manual'),
    (a, emp, 'pymes', '55100099', '551', 'Cuenta corriente con socios · Socio de Prueba K10', 'own', 'manual'),
    (a, emp, 'pymes', '40000099', '4000', 'Proveedores · Plataforma de Prueba K10', 'own', 'manual'),
    (a, emp, 'pymes', '57200099', '572', 'Banco de prueba K10', 'own', 'manual');
  select id into v_430 from public.company_account where company_id = emp and code = '43000099';
  select id into v_480 from public.company_account where company_id = emp and code = '48000099';
  select id into v_551 from public.company_account where company_id = emp and code = '55100099';
  select id into v_400 from public.company_account where company_id = emp and code = '40000099';
  select id into v_572 from public.company_account where company_id = emp and code = '57200099';
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source) values
    (a, emp, v_430, 'customer', v_party::text, 'principal', 'manual'),
    (a, emp, v_400, 'supplier', v_sup::text, 'principal', 'manual'),
    (a, emp, v_572, 'supplier', v_otro::text, 'pago', 'manual');
  insert into _k10 values ('480', v_480::text), ('551', v_551::text), ('400', v_400::text);
end $$;

-- 1 · La 430 de la plataforma pasa a la ficha de su proveedor.
do $$
declare v_n int; v_code text;
begin
  v_n := public.conta_k10_pago_desde_plataforma();
  select a.code into v_code from public.company_account_link l join public.company_account a on a.id = l.company_account_id
   where l.company_id = 'c0e20000-0000-4000-8000-0000000000e3' and l.entity = 'supplier' and l.entity_id = 'c0ea0000-0000-4000-8000-0000000000a0' and l.role = 'pago';
  if v_code is distinct from '43000099' then raise exception 'PRUEBA K10 · 1: la 430 de la plataforma no ha pasado a la ficha de su proveedor (%)', v_code; end if;
  if not exists (select 1 from public.conta_k10_pago_desde_plataforma where supplier_id = 'c0ea0000-0000-4000-8000-0000000000a0') then
    raise exception 'PRUEBA K10 · 1: no se ha apuntado el enlace que puso';
  end if;
  if public.conta_k10_pago_desde_plataforma() <> 0 then raise exception 'PRUEBA K10 · 1: la segunda vez ha puesto algo'; end if;
  if (select a.code from public.company_account_link l join public.company_account a on a.id = l.company_account_id
       where l.entity = 'supplier' and l.entity_id = 'c0ea0000-0000-4000-8000-0000000000a1' and l.role = 'pago') <> '57200099' then
    raise exception 'PRUEBA K10 · 1: le ha cambiado la cuenta de pago a uno que ya la tenía';
  end if;
  raise notice '1 · la 43000099 de la plataforma, en la ficha de su proveedor (% esta vez; la segunda, 0); el que ya tenía la 57200099 la conserva.', v_n;
end $$;

-- 2 · La pantalla guarda una cuenta de pago en una ficha, con cualquier subcuenta (la 551 de un socio).
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_code text;
begin
  perform public.company_account_link_set('c0e20000-0000-4000-8000-0000000000e3', 'supplier', 'c0ea0000-0000-4000-8000-0000000000a1', 'pago',
    (select valor::uuid from _k10 where clave = '551'), 'Prueba K10', 'manual');
  select a.code into v_code from public.company_account_link l join public.company_account a on a.id = l.company_account_id
   where l.entity = 'supplier' and l.entity_id = 'c0ea0000-0000-4000-8000-0000000000a1' and l.role = 'pago';
  if v_code is distinct from '55100099' then raise exception 'PRUEBA K10 · 2: la cuenta de pago guardada es %', v_code; end if;
  begin
    perform public.company_account_link_set('c0e20000-0000-4000-8000-0000000000e3', 'supplier', 'c0ea0000-0000-4000-8000-0000000000a0', 'pago',
      (select valor::uuid from _k10 where clave = '400'), 'Prueba K10', 'manual');
    raise exception 'PRUEBA K10 · 2: ha dejado poner la 400 del proveedor como su cuenta de pago';
  exception when sqlstate '23514' then null;
  end;
  raise notice '2 · guardada la 55100099 como cuenta de pago en su ficha (company_account_link_set); la 400 del propio proveedor, no.';
end $$;
reset role;

-- 3 · La contrapartida, con cualquier subcuenta: una recibida a la 480 se valida.
do $$
declare
  a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  v_y uuid; v_e uuid;
begin
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source,
                                       tax_base_total, tax_total, grand_total, needs_review, created_by_name)
  values ('c0ea0000-0000-4000-8000-0000000000f1', a, emp, 'c0ea0000-0000-4000-8000-0000000000a0', 'invoice', 'K10-PRUEBA-480', '2026-10-20', 'aprobada', 'manual', 100, 0, 100, false, 'prueba K10');
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount) values (a, 'c0ea0000-0000-4000-8000-0000000000f1', 0, 100, 0);
  select id into v_y from public.fiscal_year where company_id = emp and date '2026-10-20' between starts_on and ends_on;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, document_ref)
  values (a, emp, v_y, 2, '2026-10-20', 'Prueba K10 · a la 480', 'supplier_invoice', 'c0ea0000-0000-4000-8000-0000000000f1', 'K10-PRUEBA-480') returning id into v_e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit) values
    (a, emp, v_e, 1, (select valor::uuid from _k10 where clave = '480'), 100, 0),
    (a, emp, v_e, 2, (select valor::uuid from _k10 where clave = '400'), 0, 100);
  insert into _k10 values ('asiento480', v_e::text);
  if exists (select 1 from public.conta_recibida_motivos('c0ea0000-0000-4000-8000-0000000000f1', v_e) m where m.codigo = 'falta_gasto') then
    raise exception 'PRUEBA K10 · 3: con la 480 de contrapartida dice que falta la cuenta de gasto';
  end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_e uuid := (select valor::uuid from _k10 where clave = 'asiento480');
begin
  perform public.journal_entry_validar(v_e, 'Prueba K10');
  if (select status from public.journal_entry where id = v_e) <> 'validado' then raise exception 'PRUEBA K10 · 3: la de la 480 no ha quedado validada'; end if;
  raise notice '3 · la recibida a la 480 se valida (la contrapartida, con cualquier subcuenta).';
end $$;
reset role;

-- 4 · Deshacer.
\i supabase/vuelta-atras/20261121T1650_k10_cuenta_de_pago.down.sql
do $$ begin
  if exists (select 1 from public.company_account_link where entity = 'supplier' and entity_id = 'c0ea0000-0000-4000-8000-0000000000a0' and role = 'pago') then
    raise exception 'PRUEBA K10 · 4: la vuelta atrás no quita la cuenta de pago que puso la tanda';
  end if;
  if not exists (select 1 from public.company_account_link where entity = 'supplier' and entity_id = 'c0ea0000-0000-4000-8000-0000000000a1' and role = 'pago') then
    raise exception 'PRUEBA K10 · 4: la vuelta atrás ha quitado una cuenta de pago puesta a mano';
  end if;
  if strpos(pg_get_functiondef('public.conta_recibida_motivos(uuid,uuid)'::regprocedure), 'K10: la 480') > 0 then
    raise exception 'PRUEBA K10 · 4: conta_recibida_motivos no ha vuelto a ser la de antes';
  end if;
  if strpos(pg_get_functiondef('public.company_account_misma_cuenta()'::regprocedure), 'K10:') > 0 then
    raise exception 'PRUEBA K10 · 4: company_account_misma_cuenta no ha vuelto a ser la de antes';
  end if;
  raise notice '4 · la vuelta atrás quita la que puso la tanda, deja la de a mano y devuelve conta_recibida_motivos y company_account_misma_cuenta como eran.';
end $$;

rollback;
