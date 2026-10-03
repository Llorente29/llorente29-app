-- SOLO STAGING-CONTA. ENSAYO de lo que escribe «Tu empresa» (tarea 5 del C00),
-- con los usuarios de prueba de verdad (A y B, rol `authenticated` y su token,
-- para que la RLS sea la de la app) sobre la empresa de prueba de A
-- (seed_c00_empresas_prueba.sql). NO deja nada escrito: todo va dentro de un
-- sub-bloque que acaba en una excepción y se deshace entero; al final se
-- comprueba con recuentos tomados antes y después (misma vara, regla 31).
--
--   1  Actividad principal: A cambia la principal en un paso (0150); no puede
--      hacer principal una que ya terminó; B no puede tocar las de A.
--   2  Ejercicio: A abre el de 2026, cierra enero, no puede saltarse febrero,
--      no reabre sin motivo y reabre con motivo dejando quién y por qué.
--   3  Quién eres y tus impuestos: A los cambia; B no cambia los de A.
--   4  Socios: A los ve y los escribe; B no ve los de A.

do $$
declare
  a_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  a_user   constant uuid := 'c01a0000-0000-4000-8000-0000000000a1';
  b_user   constant uuid := 'c01b0000-0000-4000-8000-0000000000b1';
  c_marca  constant text := 'ENSAYO-C00-T5-FIN';
  emp uuid; x uuid; y uuid; viejo uuid; ej uuid; n int; t text; r text := '';
  antes text; despues text;
begin
  select id into emp from public.company where account_id = a_cuenta and tax_id = 'B28000016';
  if emp is null then raise exception 'ENSAYO T5: falta la empresa de prueba de A (seed_c00_empresas_prueba.sql).'; end if;

  -- La vara: lo que hay de esta empresa en cada tabla que toca el ensayo.
  select format('act %s · ej %s · cierres %s · socios %s · perfil %s · nombre %s',
    (select count(*) from company_activity where company_id = emp), (select count(*) from fiscal_year where company_id = emp),
    (select count(*) from fiscal_period_lock where company_id = emp), (select count(*) from company_person where company_id = emp),
    (select md5(p::text) from company_tax_profile p where company_id = emp), (select legal_name from company where id = emp))
    into antes;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);

    -- ── 1 · actividad principal ─────────────────────────────────────────────
    insert into company_activity (account_id, company_id, kind, description, iae_code, cnae_version, cnae_code, is_main)
    values (a_cuenta, emp, 'business', 'Restaurante (ensayo)', '1_6711', '2025', '5611', true) returning id into x;
    insert into company_activity (account_id, company_id, kind, description, iae_code, cnae_version, cnae_code, is_main)
    values (a_cuenta, emp, 'business', 'Comida a domicilio (ensayo)', '1_6779', '2025', '5621', false) returning id into y;
    perform conta_hacer_principal(y);
    set constraints company_activity_una_principal_chk immediate;
    select string_agg(description || '=' || is_main, ', ' order by description) into t from company_activity where company_id = emp and ended_on is null;
    if t <> 'Comida a domicilio (ensayo)=true, Restaurante (ensayo)=false' then raise exception 'NO CUADRA la principal: %', t; end if;
    set constraints company_activity_una_principal_chk deferred;
    r := r || E'\n 1a A cambia la principal en un paso: ' || t;

    insert into company_activity (account_id, company_id, kind, description, ended_on, is_main)
    values (a_cuenta, emp, 'business', 'Antigua (ensayo)', '2025-12-31', false) returning id into viejo;
    begin
      perform conta_hacer_principal(viejo);
      raise exception 'NO SALTÓ: principal una actividad terminada';
    exception when check_violation then r := r || E'\n 1b Hacer principal una que ya terminó: rechazado («' || sqlerrm || '»)';
    end;

    -- ── 2 · ejercicio y meses ───────────────────────────────────────────────
    select id into ej from fiscal_year where company_id = emp and code = '2026';
    if ej is null then
      insert into fiscal_year (account_id, company_id, code, starts_on, ends_on) values (a_cuenta, emp, '2026', '2026-01-01', '2026-12-31') returning id into ej;
      r := r || E'\n 2a A abre el ejercicio 2026: OK';
    end if;
    perform conta_cerrar_mes(emp, '2026-01-01');
    r := r || E'\n 2b A cierra enero: OK';
    begin
      perform conta_cerrar_mes(emp, '2026-03-01');
      raise exception 'NO SALTÓ: cerrar marzo con febrero abierto';
    exception when check_violation then r := r || E'\n 2c Cerrar marzo con febrero abierto: rechazado («' || sqlerrm || '»)';
    end;
    begin
      perform conta_reabrir_mes(emp, '2026-01-01', '  ');
      raise exception 'NO SALTÓ: reabrir sin motivo';
    exception when check_violation then r := r || E'\n 2d Reabrir enero sin motivo: rechazado';
    end;
    perform conta_reabrir_mes(emp, '2026-01-01', 'Falta una factura de enero (ensayo)');
    select format('reabierto por %s: «%s»', reopened_by_name, reopen_reason) into t
      from fiscal_period_lock where company_id = emp and month = '2026-01-01' order by locked_at desc limit 1;
    r := r || E'\n 2e Reabrir enero con motivo: ' || t;

    -- ── 3 · quién eres y tus impuestos ──────────────────────────────────────
    update company set registry_name = 'Madrid', registry_sheet = 'M-000000' where id = emp;
    get diagnostics n = row_count;
    update company_tax_profile set vat_cash_basis = true where company_id = emp;
    r := r || format(E'\n 3a A cambia su registro mercantil y el criterio de caja: %s fila', n);

    -- ── 4 · socios ──────────────────────────────────────────────────────────
    insert into company_person (account_id, company_id, full_name, roles, ownership_pct) values (a_cuenta, emp, 'Marta Ensayo', array['administrator', 'partner'], 60);
    select count(*) into n from company_person where company_id = emp;
    r := r || format(E'\n 4a A añade una socia y la ve: %s', n);

    -- ── Como B ──────────────────────────────────────────────────────────────
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', b_user, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    begin
      perform conta_hacer_principal(x);
      raise exception 'NO SALTÓ: B cambia la principal de A';
    exception when insufficient_privilege then r := r || E'\n 1c B hace principal una actividad de A: rechazado («' || sqlerrm || '»)';
    end;
    update company set legal_name = 'Tocada por B' where id = emp;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'NO SALTÓ: B cambia el nombre de A'; end if;
    update company_tax_profile set vat_period = 'monthly' where company_id = emp;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'NO SALTÓ: B cambia los impuestos de A'; end if;
    r := r || E'\n 3b B cambia el nombre o los impuestos de A: 0 filas';
    select count(*) into n from company_person where company_id = emp;
    if n <> 0 then raise exception 'NO SALTÓ: B ve los socios de A (%)', n; end if;
    r := r || E'\n 4b B ve los socios de A: 0';
    begin
      perform conta_cerrar_mes(emp, '2026-01-01');
      raise exception 'NO SALTÓ: B cierra un mes de A';
    exception when insufficient_privilege then r := r || E'\n 2f B cierra un mes de A: rechazado';
    end;

    raise exception '%', c_marca;
  exception when others then
    if sqlerrm <> c_marca then raise; end if;
  end;

  -- Guarda: lo mismo antes y después, tomado igual.
  select format('act %s · ej %s · cierres %s · socios %s · perfil %s · nombre %s',
    (select count(*) from company_activity where company_id = emp), (select count(*) from fiscal_year where company_id = emp),
    (select count(*) from fiscal_period_lock where company_id = emp), (select count(*) from company_person where company_id = emp),
    (select md5(p::text) from company_tax_profile p where company_id = emp), (select legal_name from company where id = emp))
    into despues;
  if antes is distinct from despues or current_user <> session_user then
    raise exception 'ENSAYO T5: ha quedado algo escrito o el rol no ha vuelto. Antes: % · después: %', antes, despues;
  end if;
  raise notice E'ENSAYO C00 · tarea 5 (nada escrito; antes = después: %):%', despues, r;
end $$;
