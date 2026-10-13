-- supabase/staging/sql/20261019_diez_numeracion_prueba.sql
--
-- SOLO STAGING. Prueba de 20261019T0160 (public.journal_entry_validar,
-- public.conta_diez_importar, conta_diez_historico_traido,
-- fiscal_year.history_imported_at), en la empresa de la cuenta A de pruebas y
-- con un ejercicio 2027 MIXTO inventado. Todo en una transacción con
-- ROLLBACK: no cambia staging.
--
--   1. En un ejercicio mixto sin el histórico traído, validar un asiento de
--      Folvy se para con «Primero hay que traer el histórico de Diez de 2027».
--   2. Lo traído entra igual (es migrated) y guarda su tipo de Diez.
--   3. Marcar el histórico: solo con algo traído, y una vez.
--   4. Ya marcado, el asiento de Folvy se valida con el número DETRÁS del
--      último traído de su serie (aquí, el 3 de la serie 4), no con el 1.
--   5. En un ejercicio de Folvy no cambia nada: se valida como antes.
--   6. Marcar un ejercicio de Folvy no se puede.

begin;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

do $$
declare
  c constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_y uuid; v_run uuid; e1 uuid; e2 uuid; r jsonb; v_ok boolean; v_msg text; v_y26 uuid;
  caja uuid; socio uuid;
  diez jsonb := jsonb_build_array(
    jsonb_build_object('ejercicio', '2027', 'serie', 4, 'numero', 1, 'fecha', '2027-01-01', 'concepto', 'Apertura inventada', 'tipoAsiento', 3, 'huella', 'h1',
      'lineas', jsonb_build_array(jsonb_build_object('posicion', 1, 'cuenta', '57000000', 'debe', 500, 'haber', 0),
                                  jsonb_build_object('posicion', 2, 'cuenta', '55100000', 'debe', 0, 'haber', 500))),
    jsonb_build_object('ejercicio', '2027', 'serie', 4, 'numero', 2, 'fecha', '2027-02-01', 'concepto', 'General inventado', 'tipoAsiento', 0, 'huella', 'h2',
      'lineas', jsonb_build_array(jsonb_build_object('posicion', 1, 'cuenta', '57000000', 'debe', 100, 'haber', 0),
                                  jsonb_build_object('posicion', 2, 'cuenta', '55100000', 'debe', 0, 'haber', 100))));
begin
  select id into caja from public.company_account where company_id = c and code = '57000000';
  select id into socio from public.company_account where company_id = c and code = '55100000';
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, status, origin, origin_program, imported_until)
  values (a, c, '2027', '2027-01-01', '2027-12-31', 'open', 'mixed', 'diez', '2027-03-31') returning id into v_y;

  -- Un asiento de Folvy de mayo, en borrador.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, c, v_y, 4, '2027-05-04', 'Folvy inventado', 'manual') returning id into e1;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, is_common)
  values (a, c, e1, 1, caja, 7, 0, true), (a, c, e1, 2, socio, 0, 7, true);

  -- 1 · Bloqueado mientras no esté el histórico
  v_ok := false;
  begin perform public.journal_entry_validar(e1);
  exception when check_violation then v_ok := true; v_msg := sqlerrm; end;
  if not v_ok or v_msg <> 'Primero hay que traer el histórico de Diez de 2027.' then
    raise exception 'PRUEBA numeración · 1: no se paró, o el mensaje no es el que se ve: %.', v_msg;
  end if;
  if (select status from public.journal_entry where id = e1) <> 'borrador' then
    raise exception 'PRUEBA numeración · 1: el asiento cambió aunque no se validó.';
  end if;

  -- 2 · Traer el histórico (sigue entrando: es migrated) con su tipo
  insert into public.import_run (account_id, company_id, program, kind) values (a, c, 'diez', 'historico') returning id into v_run;
  r := public.conta_diez_importar(c, v_run, diez);
  if (r ->> 'traidos')::int <> 2 then raise exception 'PRUEBA numeración · 2: %.', r; end if;
  if not exists (select 1 from public.journal_entry where fiscal_year_id = v_y and external_number = '1'
                 and reasons @> '[{"decision": "traido-de-diez", "tipo_diez": 3}]'::jsonb) then
    raise exception 'PRUEBA numeración · 2: lo traído no guarda su tipo de Diez.';
  end if;

  -- 3 · Marcar el histórico
  r := public.conta_diez_historico_traido(c, '2027');
  if (r ->> 'traidos')::int <> 2 or (r -> 'ultimoPorSerie' ->> '4')::int <> 2
     or (select history_imported_at from public.fiscal_year where id = v_y) is null then
    raise exception 'PRUEBA numeración · 3: %.', r;
  end if;

  -- 4 · Ahora sí, y detrás del último traído
  r := public.journal_entry_validar(e1);
  if (r ->> 'numero')::int <> 3 then
    raise exception 'PRUEBA numeración · 4: el primero de Folvy sacó el % y tenía que ser el 3 (detrás del 2 de Diez).', r ->> 'numero';
  end if;

  -- 5 · Un ejercicio de Folvy, igual que antes (2026 de la empresa A es de Folvy)
  select id into v_y26 from public.fiscal_year where company_id = c and code = '2026' and origin = 'folvy';
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, c, v_y26, 4, '2026-12-30', 'Folvy inventado 2026', 'manual') returning id into e2;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, is_common)
  values (a, c, e2, 1, caja, 3, 0, true), (a, c, e2, 2, socio, 0, 3, true);
  r := public.journal_entry_validar(e2);
  if r ->> 'numero' is null then raise exception 'PRUEBA numeración · 5: un ejercicio de Folvy dejó de validar.'; end if;

  -- 6 · Marcar un ejercicio de Folvy, no
  v_ok := false;
  begin perform public.conta_diez_historico_traido(c, '2026'); exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA numeración · 6: marcó traído un ejercicio de Folvy.'; end if;

  raise notice 'PRUEBA numeración: 6 de 6 bien.';
end $$;

rollback;
