-- supabase/staging/sql/20261006_c01b_prueba_iban.sql
--
-- C01b, respuesta 2 · Prueba de la 0135 en staging-conta, como el
-- administrador de la cuenta A (JWT de verdad: pasa por la RLS) y como el de
-- la B. Termina en ROLLBACK: no deja nada.
--
--   1. El freno: pagar una factura con IBAN distinto y sin decidir falla, por
--      la RPC de la ficha y por un update directo (Compras).
--   2. «No es suyo»: la ficha no cambia y ya se puede pagar.
--   3. «Es el nuevo IBAN»: pasa a la ficha con el de antes, quién y cuándo.
--   4. Con IBAN igual, o sin IBAN leído, se paga como siempre.
--   5. RLS: B no puede decidir sobre una factura de A.
--   6. Vuelta atrás: el .down.sql quita todo lo suyo.

begin;

\echo '>>> 1-4. Como el administrador de A'
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  ruiz   constant uuid := 'c01a0000-0000-4000-8000-0000000000a3';
  loc    constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  ficha  constant text := 'ES9121000418450200051332';
  otro   constant text := 'ES7921000813610123456789';
  f1 uuid; f2 uuid; f3 uuid; f4 uuid;
  s public.supplier;
  fallo text;
begin
  if (select iban from public.supplier where id = ruiz) is distinct from ficha then
    raise exception 'PRUEBA 0135: Hermanos Ruiz no tiene el IBAN de la semilla';
  end if;
  insert into public.supplier_invoice (account_id, supplier_id, location_id, invoice_number, invoice_date, status, grand_total, read_iban)
  values (cuenta, ruiz, loc, 'P0135-1', date '2026-10-01', 'aprobada', 100, otro) returning id into f1;
  insert into public.supplier_invoice (account_id, supplier_id, location_id, invoice_number, invoice_date, status, grand_total, read_iban)
  values (cuenta, ruiz, loc, 'P0135-2', date '2026-10-01', 'aprobada', 200, otro) returning id into f2;
  insert into public.supplier_invoice (account_id, supplier_id, location_id, invoice_number, invoice_date, status, grand_total, read_iban)
  values (cuenta, ruiz, loc, 'P0135-3', date '2026-10-01', 'aprobada', 300, ficha) returning id into f3;
  -- Lo leído se guarda normalizado: con espacios o en minúsculas no entra.
  begin
    insert into public.supplier_invoice (account_id, supplier_id, location_id, invoice_number, invoice_date, status, grand_total, read_iban)
    values (cuenta, ruiz, loc, 'P0135-X', date '2026-10-01', 'aprobada', 1, 'es91 2100 0418 4502 0005 1332');
    raise exception 'PRUEBA 0135: ha entrado un IBAN leído sin normalizar';
  exception when check_violation then null;
  end;
  insert into public.supplier_invoice (account_id, supplier_id, location_id, invoice_number, invoice_date, status, grand_total)
  values (cuenta, ruiz, loc, 'P0135-4', date '2026-10-01', 'aprobada', 400) returning id into f4;

  -- 1. El freno, por los dos caminos.
  begin
    perform public.mark_supplier_invoice_paid(f1, date '2026-10-04', 'transfer');
    raise exception 'PRUEBA 0135: la RPC ha pagado una factura con IBAN distinto';
  exception when others then
    fallo := sqlerrm;
    if fallo not like 'IBAN distinto al de la ficha%' then raise exception 'PRUEBA 0135: falló por otra cosa: %', fallo; end if;
  end;
  begin
    update public.supplier_invoice set status = 'pagada', paid_at = date '2026-10-04' where id = f1;
    raise exception 'PRUEBA 0135: un update directo ha pagado una factura con IBAN distinto';
  exception when others then
    fallo := sqlerrm;
    if fallo not like 'IBAN distinto al de la ficha%' then raise exception 'PRUEBA 0135: el update falló por otra cosa: %', fallo; end if;
  end;
  if (select status from public.supplier_invoice where id = f1) <> 'aprobada' then
    raise exception 'PRUEBA 0135: la factura frenada ha cambiado de estado';
  end if;

  -- 2. «No es suyo»: la ficha se queda y ya se paga.
  perform public.supplier_invoice_iban_decide(f1, 'no_es_suyo', 'Admin Norte');
  if (select iban from public.supplier where id = ruiz) <> ficha then raise exception 'PRUEBA 0135: «no es suyo» ha tocado la ficha'; end if;
  perform public.mark_supplier_invoice_paid(f1, date '2026-10-04', 'transfer');
  if (select status from public.supplier_invoice where id = f1) <> 'pagada' then raise exception 'PRUEBA 0135: tras «no es suyo» no se ha podido pagar'; end if;

  -- 3. «Es el nuevo IBAN».
  perform public.supplier_invoice_iban_decide(f2, 'es_el_nuevo', 'Admin Norte');
  select * into s from public.supplier where id = ruiz;
  if s.iban <> otro or s.iban_previous <> ficha or s.iban_changed_at is null or s.iban_changed_by_name <> 'Admin Norte'
     or s.iban_changed_by <> 'c01a0000-0000-4000-8000-0000000000a1' then
    raise exception 'PRUEBA 0135: «es el nuevo» no ha quedado bien en la ficha: % % % %', s.iban, s.iban_previous, s.iban_changed_at, s.iban_changed_by_name;
  end if;
  if not exists (select 1 from public.supplier_invoice where id = f2 and iban_decision = 'es_el_nuevo' and iban_decision_by_name = 'Admin Norte') then
    raise exception 'PRUEBA 0135: la decisión no ha quedado en la factura';
  end if;
  perform public.mark_supplier_invoice_paid(f2, date '2026-10-04', 'transfer');

  -- 4. Con el IBAN de la ficha... que ahora es el nuevo: la f3 trae el VIEJO,
  --    así que ahora frena (es lo que tiene que pasar). Y sin IBAN leído, no.
  begin
    perform public.mark_supplier_invoice_paid(f3, date '2026-10-04', 'transfer');
    raise exception 'PRUEBA 0135: la factura con el IBAN viejo no ha frenado tras el cambio';
  exception when others then
    if sqlerrm not like 'IBAN distinto al de la ficha%' then raise; end if;
  end;
  perform public.mark_supplier_invoice_paid(f4, date '2026-10-04', 'cash');
  -- Una decisión que no existe.
  begin
    perform public.supplier_invoice_iban_decide(f3, 'quiza', 'Admin Norte');
    raise exception 'PRUEBA 0135: ha aceptado una decisión que no existe';
  exception when others then
    if sqlerrm <> 'Esa decisión no existe.' then raise; end if;
  end;
  begin
    perform public.supplier_invoice_iban_decide(f4, 'no_es_suyo', 'Admin Norte');
    raise exception 'PRUEBA 0135: ha decidido sobre una factura sin IBAN';
  exception when others then
    if sqlerrm <> 'Esa factura no trae IBAN.' then raise; end if;
  end;
  raise notice 'Freno por RPC y por update, «no es suyo», «es el nuevo» (con el de antes, quién y cuándo), IBAN viejo frena, sin IBAN paga: OK.';
end $$;
reset role;

\echo '>>> 5. Como el administrador de B'
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v uuid;
begin
  select id into v from public.supplier_invoice where id = 'c1b0a000-0000-4000-8000-000000000513';
  if v is not null then raise exception 'PRUEBA 0135: B ve una factura de A'; end if;
  begin
    perform public.supplier_invoice_iban_decide('c1b0a000-0000-4000-8000-000000000513', 'es_el_nuevo', 'Intruso');
    raise exception 'PRUEBA 0135: B ha decidido sobre una factura de A';
  exception when others then
    if sqlerrm <> 'Esa factura no existe o no es de tu cuenta.' then raise; end if;
  end;
  raise notice 'RLS: B no ve ni decide sobre las facturas de A: OK.';
end $$;
reset role;

\echo '>>> 6. Vuelta atrás'
\ir ../../vuelta-atras/20261006T0135_c01b_iban_factura.down.sql
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and ((table_name = 'supplier_invoice' and column_name in ('read_iban', 'iban_decision', 'iban_decision_at', 'iban_decision_by', 'iban_decision_by_name'))
                or (table_name = 'supplier' and column_name in ('iban_previous', 'iban_changed_at', 'iban_changed_by', 'iban_changed_by_name'))))
     or to_regprocedure('public.supplier_invoice_iban_decide(uuid,text,text)') is not null
     or to_regprocedure('public.supplier_invoice_iban_guard()') is not null
     or exists (select 1 from pg_trigger where tgname = 'supplier_invoice_iban_guard') then
    raise exception 'PRUEBA 0135: la vuelta atrás ha dejado algo';
  end if;
  raise notice 'Vuelta atrás: no queda nada de la 0135: OK.';
end $$;

rollback;
