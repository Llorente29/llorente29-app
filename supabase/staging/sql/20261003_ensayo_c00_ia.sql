-- SOLO STAGING-CONTA. ENSAYO de la base de la IA (tarea 6 del C00, migración
-- 0160), con los usuarios de prueba de verdad (A y B, rol `authenticated` y su
-- token) sobre la empresa de prueba de A. NO deja nada escrito: todo va en un
-- sub-bloque que acaba en una excepción; al final, antes = después (regla 31).
--
--   1  Origen: la IA pone un dato y queda su motivo y el valor que puso; si la
--      persona lo cambia, deja de coincidir (la marca se va sola) y deshacer
--      no lo pisa. Sin cambio, deshacer devuelve el valor de antes.
--   2  Actividad: la IA no puede poner un epígrafe que no está en el IAE; sí
--      uno que está, y se deshace.
--   3  Registro: nadie lo escribe a mano; B no lo ve ni deshace nada de A.
--   4  Sugerencias con datos de la cuenta: rechazada, no vuelve; aceptada,
--      aplica el cambio, queda en el registro y se deshace.

do $$
declare
  a_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  a_user   constant uuid := 'c01a0000-0000-4000-8000-0000000000a1';
  b_user   constant uuid := 'c01b0000-0000-4000-8000-0000000000b1';
  c_marca  constant text := 'ENSAYO-C00-IA-FIN';
  emp uuid; reg uuid; reg2 uuid; sug uuid; n int; t text; r text := ''; antes text; despues text;
  medir constant text := $m$
    select format('origen %s · registro %s · sugerencias %s · act %s · proveedores %s · nombre %s · modelos %s',
      (select count(*) from ai_data_origin where company_id = $1), (select count(*) from ai_action_log where company_id = $1),
      (select count(*) from ai_suggestion where company_id = $1), (select count(*) from company_activity where company_id = $1),
      (select count(*) from supplier where account_id = $2), (select trade_name from company where id = $1),
      (select tax_forms::text from company_tax_profile where company_id = $1))
  $m$;
begin
  select id into emp from public.company where account_id = a_cuenta and tax_id = 'B28000016';
  if emp is null then raise exception 'ENSAYO IA: falta la empresa de prueba de A.'; end if;
  execute medir into antes using emp, a_cuenta;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);

    -- ── 1 · origen y deshacer ───────────────────────────────────────────────
    reg := conta_ia_poner(emp, 'company', 'trade_name', to_jsonb('Taberna Norte (IA)'::text), 'Es el nombre con el que te conocen (ensayo)');
    select format('%s · «%s» · %s', source, value_set #>> '{}', reason) into t from ai_data_origin where table_key = 'company' and row_id = emp and field = 'trade_name';
    r := r || E'\n 1a La IA pone el nombre comercial; origen: ' || t;
    update company set trade_name = 'Taberna Norte (persona)' where id = emp;
    select count(*) into n from ai_data_origin o join company c on c.id = o.row_id
     where o.table_key = 'company' and o.field = 'trade_name' and o.row_id = emp and o.value_set = to_jsonb(c.trade_name);
    if n <> 0 then raise exception 'NO CUADRA: la marca sigue tras cambiarlo la persona'; end if;
    r := r || E'\n 1b La persona lo cambia: el origen ya no coincide (sin marca)';
    begin
      perform conta_ia_deshacer(reg);
      raise exception 'NO SALTÓ: deshacer pisando un cambio posterior';
    exception when check_violation then r := r || E'\n 1c Deshacer después del cambio de la persona: rechazado («' || sqlerrm || '»)';
    end;
    reg2 := conta_ia_poner(emp, 'company_tax_profile', 'vat_period', to_jsonb('monthly'::text), 'Prueba (ensayo)');
    perform conta_ia_deshacer(reg2);
    select vat_period into t from company_tax_profile where company_id = emp;
    if t <> 'quarterly' then raise exception 'NO CUADRA: deshacer no devolvió el periodo (%)', t; end if;
    select count(*) into n from ai_data_origin where table_key = 'company_tax_profile' and row_id = emp and field = 'vat_period';
    r := r || format(E'\n 1d Deshacer sin cambios en medio: vuelve a «%s» y el origen se va (%s)', t, n);
    begin
      perform conta_ia_poner(emp, 'company', 'tax_id', to_jsonb('B00000000'::text), 'no');
      raise exception 'NO SALTÓ: la IA cambia el NIF';
    exception when insufficient_privilege then r := r || E'\n 1e La IA cambia el NIF: rechazado';
    end;
    begin
      perform conta_ia_poner(emp, 'company', 'legal_name', to_jsonb('X'::text), '  ');
      raise exception 'NO SALTÓ: sin porqué';
    exception when check_violation then r := r || E'\n 1f La IA sin porqué: rechazado';
    end;

    -- ── 2 · actividad del catálogo ──────────────────────────────────────────
    begin
      perform conta_ia_anadir_actividad(emp, 'Inventada', 'business', '1_9999', null, false, 'ensayo');
      raise exception 'NO SALTÓ: epígrafe inventado';
    exception when foreign_key_violation then r := r || E'\n 2a Un epígrafe que no está en el IAE: rechazado («' || sqlerrm || '»)';
    end;
    reg := conta_ia_anadir_actividad(emp, 'Comida a domicilio (ensayo)', 'business', '1_6779', '5611', false, 'Lo dijiste: «también repartimos a domicilio»');
    select count(*) into n from company_activity where company_id = emp and description = 'Comida a domicilio (ensayo)';
    perform conta_ia_deshacer(reg);
    select n || ' → ' || count(*) into t from company_activity where company_id = emp and description = 'Comida a domicilio (ensayo)';
    r := r || E'\n 2b La IA añade 677.9 y se deshace: ' || t;

    -- ── 3 · el registro ─────────────────────────────────────────────────────
    begin
      insert into ai_action_log (account_id, company_id, action, table_key, reason) values (a_cuenta, emp, 'poner', 'company', 'a mano');
      raise exception 'NO SALTÓ: registro escrito a mano';
    exception when insufficient_privilege then r := r || E'\n 3a A escribe el registro a mano: rechazado';
    end;

    -- ── 4 · sugerencias ─────────────────────────────────────────────────────
    update company_tax_profile set tax_forms = array['303', '390', '202'] where company_id = emp;
    insert into supplier (account_id, name, expense_category_id, irpf_withholding_pct)
    values (a_cuenta, 'Local de Ensayo, S.L.', (select id from expense_category where is_system and pgc_account_hint = '621' limit 1), 19),
           (a_cuenta, 'Gestoría de Ensayo', (select id from expense_category where is_system and pgc_account_hint = '623' limit 1), 15);
    n := conta_sugerencias_calcular(emp);
    select string_agg(reason_key, ', ' order by reason_key) into t from ai_suggestion where company_id = emp and status = 'open';
    r := r || format(E'\n 4a Con un alquiler al 19 %% y una gestoría al 15 %%: %s sugerencias (%s)', n, t);
    select id into sug from ai_suggestion where company_id = emp and reason_key = 'modelo_115';
    perform conta_sugerencia_responder(sug, false);
    n := conta_sugerencias_calcular(emp);
    select status into t from ai_suggestion where id = sug;
    r := r || format(E'\n 4b Rechazada la del 115 y recalculado: sigue «%s», %s nuevas', t, n);
    select id into sug from ai_suggestion where company_id = emp and reason_key = 'modelo_111';
    perform conta_sugerencia_responder(sug, true);
    select tax_forms::text into t from company_tax_profile where company_id = emp;
    select id into reg from ai_action_log where suggestion_id = sug;
    r := r || format(E'\n 4c Aceptada la del 111: modelos %s, en el registro %s', t, case when reg is null then 'NO' else 'sí' end);
    if reg is null then raise exception 'NO CUADRA: la sugerencia aceptada no está en el registro'; end if;
    perform conta_ia_deshacer(reg);
    select tax_forms::text into t from company_tax_profile where company_id = emp;
    r := r || E'\n 4d Deshecha: modelos ' || t;

    -- ── Como B ──────────────────────────────────────────────────────────────
    reg := conta_ia_poner(emp, 'company', 'trade_name', to_jsonb('Para B'::text), 'ensayo');
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', b_user, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    begin
      perform conta_ia_poner(emp, 'company', 'trade_name', to_jsonb('B'::text), 'ensayo');
      raise exception 'NO SALTÓ: B pone datos en A';
    exception when insufficient_privilege then r := r || E'\n 3b B pone un dato en la empresa de A: rechazado';
    end;
    begin
      perform conta_ia_deshacer(reg);
      raise exception 'NO SALTÓ: B deshace en A';
    exception when insufficient_privilege then r := r || E'\n 3c B deshace una acción de A: rechazado';
    end;
    select count(*) into n from ai_action_log where company_id = emp;
    if n <> 0 then raise exception 'NO SALTÓ: B ve el registro de A (%)', n; end if;
    select count(*) into n from ai_suggestion where company_id = emp;
    if n <> 0 then raise exception 'NO SALTÓ: B ve las sugerencias de A (%)', n; end if;
    r := r || E'\n 3d B ve el registro y las sugerencias de A: 0 y 0';

    raise exception '%', c_marca;
  exception when others then
    if sqlerrm <> c_marca then raise; end if;
  end;

  execute medir into despues using emp, a_cuenta;
  if antes is distinct from despues or current_user <> session_user then
    raise exception 'ENSAYO IA: ha quedado algo escrito o el rol no ha vuelto. Antes: % · después: %', antes, despues;
  end if;
  raise notice E'ENSAYO C00 · IA (nada escrito; antes = después: %):%', despues, r;
end $$;
