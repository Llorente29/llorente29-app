-- SOLO STAGING-CONTA. ENSAYO de las reglas de la base del C00, que NO deja
-- nada escrito (mismo mecanismo que el ensayo del C01: todo dentro de un
-- sub-bloque que acaba en una excepción; al capturarla se deshace entero).
--
-- Se hace con los usuarios de prueba de verdad (A y B), con su rol
-- `authenticated` y su token, para que la RLS sea la de la app. Cada caso
-- deja una línea en el resultado (NOTICE del workflow). Si una regla NO salta
-- cuando debe, el ensayo falla entero.
--
--   1  A da de alta una empresa; el NIF no se repite en A; en B sí puede.
--   2  Actividades: dos principales no; actividades sin principal tampoco.
--   3  Ejercicios: sin solapes, sin huecos, de doce meses como mucho.
--   4  Meses: se cierran en orden; reabrir pide motivo y deja rastro; nadie
--      escribe un cierre directamente.
--   5  Socios: no pasan del 100 %; un trabajador de A no los ve.
--   6  B no ve ni toca nada de A (RLS) ni puede colgar filas de una empresa de A.
--   7  Tablas generales: nadie escribe una fila de serie; una propia sí; su
--      porcentaje no se edita; dos vigentes a la vez para lo mismo, no.

do $$
declare
  a_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b_cuenta constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  a_user   constant uuid := 'c01a0000-0000-4000-8000-0000000000a1';
  b_user   constant uuid := 'c01b0000-0000-4000-8000-0000000000b1';
  a_worker constant uuid := 'c00a0000-0000-4000-8000-0000000000e1';
  c_marca  constant text := 'ENSAYO-C00-FIN';
  emp uuid; emp_b uuid; ej uuid; n int; r text := '';
begin
  begin
    -- ── Como A (administrador) ─────────────────────────────────────────────
    perform set_config('request.jwt.claims', json_build_object('sub', a_user, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);

    insert into company (account_id, legal_name, tax_id, tax_id_type, entity_kind)
    values (a_cuenta, 'Ensayo C00, S.L.', 'B91000018', 'nif_es', 'company') returning id into emp;
    r := r || E'\n 1a A da de alta una empresa: OK';

    begin
      insert into company (account_id, legal_name, tax_id) values (a_cuenta, 'Repetida', 'b-91000018');
      raise exception 'NO SALTÓ: NIF repetido en la misma cuenta';
    exception when unique_violation then r := r || E'\n 1b NIF repetido en A (con guion y minúscula): rechazado';
    end;

    -- ── 2 · actividades ─────────────────────────────────────────────────────
    insert into company_activity (account_id, company_id, kind, description, is_main) values (a_cuenta, emp, 'business', 'Restaurante', true);
    begin
      insert into company_activity (account_id, company_id, kind, description, is_main) values (a_cuenta, emp, 'business', 'Reparto', true);
      raise exception 'NO SALTÓ: dos principales';
    exception when unique_violation then r := r || E'\n 2a Dos actividades principales: rechazado';
    end;
    begin
      update company_activity set is_main = false where company_id = emp;
      set constraints company_activity_una_principal_chk immediate;
      raise exception 'NO SALTÓ: actividades sin principal';
    exception when check_violation then r := r || E'\n 2b Actividades sin ninguna principal: rechazado';
    end;
    set constraints company_activity_una_principal_chk deferred;

    -- ── 3 · ejercicios ──────────────────────────────────────────────────────
    insert into fiscal_year (account_id, company_id, code, starts_on, ends_on)
    values (a_cuenta, emp, '2026', '2026-01-01', '2026-12-31') returning id into ej;
    begin
      insert into fiscal_year (account_id, company_id, code, starts_on, ends_on) values (a_cuenta, emp, '2026b', '2026-06-01', '2027-05-31');
      raise exception 'NO SALTÓ: ejercicios solapados';
    exception when exclusion_violation then r := r || E'\n 3a Ejercicio que se solapa: rechazado';
    end;
    begin
      insert into fiscal_year (account_id, company_id, code, starts_on, ends_on, previous_year_id) values (a_cuenta, emp, '2027', '2027-01-02', '2027-12-31', ej);
      raise exception 'NO SALTÓ: hueco entre ejercicios';
    exception when check_violation then r := r || E'\n 3b Hueco de un día con el anterior: rechazado';
    end;
    begin
      insert into fiscal_year (account_id, company_id, code, starts_on, ends_on) values (a_cuenta, emp, '2028', '2028-01-01', '2029-01-01');
      raise exception 'NO SALTÓ: ejercicio de más de doce meses';
    exception when check_violation then r := r || E'\n 3c Ejercicio de más de doce meses: rechazado';
    end;
    insert into fiscal_year (account_id, company_id, code, starts_on, ends_on, previous_year_id) values (a_cuenta, emp, '2027', '2027-01-01', '2027-12-31', ej);
    r := r || E'\n 3d 2027 justo detrás de 2026: OK';

    -- ── 4 · meses ───────────────────────────────────────────────────────────
    begin
      perform conta_cerrar_mes(emp, '2026-02-01');
      raise exception 'NO SALTÓ: cerrar febrero con enero abierto';
    exception when check_violation then r := r || E'\n 4a Cerrar febrero con enero abierto: rechazado';
    end;
    perform conta_cerrar_mes(emp, '2026-01-15');
    perform conta_cerrar_mes(emp, '2026-02-01');
    if not conta_mes_cerrado(emp, '2026-02-10') then raise exception 'FALLO: febrero debería estar cerrado'; end if;
    r := r || E'\n 4b Enero y febrero cerrados en orden; conta_mes_cerrado lo dice: OK';
    begin
      perform conta_reabrir_mes(emp, '2026-02-01', '  ');
      raise exception 'NO SALTÓ: reabrir sin motivo';
    exception when check_violation then r := r || E'\n 4c Reabrir sin motivo: rechazado';
    end;
    begin
      perform conta_reabrir_mes(emp, '2026-01-01', 'Factura olvidada');
      raise exception 'NO SALTÓ: reabrir enero con febrero cerrado';
    exception when check_violation then r := r || E'\n 4d Reabrir enero con febrero cerrado: rechazado';
    end;
    perform conta_reabrir_mes(emp, '2026-02-01', 'Factura olvidada');
    select count(*) into n from fiscal_period_lock where company_id = emp and month = '2026-02-01' and reopened_at is not null and reopen_reason = 'Factura olvidada' and reopened_by = a_user;
    if n <> 1 then raise exception 'FALLO: reabrir no dejó rastro'; end if;
    r := r || E'\n 4e Reabrir febrero con motivo: OK, y queda quién, cuándo y por qué';
    begin
      insert into fiscal_period_lock (account_id, company_id, fiscal_year_id, month) values (a_cuenta, emp, ej, '2026-03-01');
      raise exception 'NO SALTÓ: cierre escrito directamente';
    exception when insufficient_privilege then r := r || E'\n 4f Escribir un cierre directamente (sin la función): rechazado';
    end;

    -- ── 5 · socios ──────────────────────────────────────────────────────────
    insert into company_person (account_id, company_id, full_name, roles, ownership_pct) values (a_cuenta, emp, 'Marta Ruiz Sanz', '{administrator,partner}', 60);
    begin
      insert into company_person (account_id, company_id, full_name, roles, ownership_pct) values (a_cuenta, emp, 'Otro', '{partner}', 50);
      set constraints company_person_hasta_cien immediate;
      raise exception 'NO SALTÓ: socios por encima del 100';
    exception when check_violation then r := r || E'\n 5a Socios que suman 110 %: rechazado';
    end;
    set constraints company_person_hasta_cien deferred;

    -- ── 7 · tablas generales (como A) ──────────────────────────────────────
    begin
      insert into tax_rate (is_system, code, name, tax_system, territory, rate, valid_from, legal_ref, verified_at)
      values (true, 'iva_falso', 'Falso', 'iva', 'peninsula_baleares', 3, '2026-01-01', 'Ninguna', current_date);
      raise exception 'NO SALTÓ: fila de serie escrita desde la app';
    exception when insufficient_privilege or check_violation or foreign_key_violation then r := r || E'\n 7a Escribir una fila de serie desde la app: rechazado';
    end;
    insert into tax_rate (account_id, company_id, code, name, tax_system, territory, rate, valid_from)
    values (a_cuenta, emp, 'propio_7', 'Impuesto propio', 'iva', 'peninsula_baleares', 7, '2026-01-01');
    r := r || E'\n 7b Una fila propia de la empresa: OK';
    begin
      update tax_rate set rate = 8 where company_id = emp and code = 'propio_7';
      raise exception 'NO SALTÓ: porcentaje editado';
    exception when check_violation then r := r || E'\n 7c Editar el porcentaje (tiene que ser fila nueva): rechazado';
    end;
    begin
      insert into tax_rate (account_id, company_id, code, name, tax_system, territory, rate, valid_from)
      values (a_cuenta, emp, 'propio_7', 'Impuesto propio', 'iva', 'peninsula_baleares', 8, '2026-06-01');
      raise exception 'NO SALTÓ: dos vigentes a la vez';
    exception when exclusion_violation then r := r || E'\n 7d Dos vigentes a la vez para el mismo concepto: rechazado';
    end;
    update tax_rate set valid_to = '2026-05-31' where company_id = emp and code = 'propio_7';
    insert into tax_rate (account_id, company_id, code, name, tax_system, territory, rate, valid_from)
    values (a_cuenta, emp, 'propio_7', 'Impuesto propio', 'iva', 'peninsula_baleares', 8, '2026-06-01');
    r := r || E'\n 7e Cerrar la fila y abrir otra desde el 01/06: OK';

    -- ── 5b · un trabajador de A no ve los socios ────────────────────────────
    reset role;
    insert into auth.users (instance_id, id, aud, role, email) values ('00000000-0000-0000-0000-000000000000', a_worker, 'authenticated', 'authenticated', 'a.trabajador@prueba.folvy.test');
    insert into user_profiles (user_id, account_id, role, active, display_name) values (a_worker, a_cuenta, 'worker', true, 'Trabajador Norte');
    perform set_config('request.jwt.claims', json_build_object('sub', a_worker, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select count(*) into n from company_person where company_id = emp;
    if n <> 0 then raise exception 'FALLO: un trabajador ve % socios', n; end if;
    select count(*) into n from company where id = emp;
    if n <> 1 then raise exception 'FALLO: un trabajador de A debería ver su empresa'; end if;
    r := r || E'\n 5b Un trabajador de A ve la empresa pero no los socios: OK';

    -- ── 6 · como B ──────────────────────────────────────────────────────────
    perform set_config('request.jwt.claims', json_build_object('sub', b_user, 'role', 'authenticated')::text, true);
    select count(*) into n from company where account_id = a_cuenta;
    if n <> 0 then raise exception 'FALLO: B ve % empresas de A', n; end if;
    select count(*) into n from fiscal_period_lock where account_id = a_cuenta;
    if n <> 0 then raise exception 'FALLO: B ve cierres de A'; end if;
    select count(*) into n from tax_rate where account_id = a_cuenta;
    if n <> 0 then raise exception 'FALLO: B ve impuestos propios de A'; end if;
    update company set legal_name = 'Escrito por B' where id = emp;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FALLO: B ha cambiado la empresa de A'; end if;
    r := r || E'\n 6a B no ve nada de A (empresa, cierres, impuestos propios) ni la cambia: OK';
    begin
      insert into company_activity (account_id, company_id, kind, description, is_main) values (b_cuenta, emp, 'business', 'Colada', true);
      raise exception 'NO SALTÓ: fila de B colgada de una empresa de A';
    exception when insufficient_privilege then r := r || E'\n 6b Colgar una actividad de B en una empresa de A: rechazado';
    end;
    begin
      perform conta_cerrar_mes(emp, '2026-02-01');
      raise exception 'NO SALTÓ: B cierra un mes de A';
    exception when insufficient_privilege then r := r || E'\n 6c B cierra un mes de A: rechazado';
    end;
    insert into company (account_id, legal_name, tax_id, tax_id_type, entity_kind)
    values (b_cuenta, 'Ensayo B, S.L.', 'B91000018', 'nif_es', 'company') returning id into emp_b;
    r := r || E'\n 1c El mismo NIF en OTRA cuenta (B): OK';

    raise exception '%', c_marca;
  exception when others then
    if sqlerrm <> c_marca then raise; end if;
  end;

  -- Guarda: no ha quedado nada.
  if exists (select 1 from company where legal_name like 'Ensayo%')
     or exists (select 1 from auth.users where id = a_worker)
     or current_user <> session_user then
    raise exception 'ENSAYO: ha quedado algo escrito o el rol no ha vuelto. Revertido.';
  end if;
  raise notice E'ENSAYO C00 · reglas de la base (nada escrito, comprobado):%', r;
end $$;
