-- supabase/vuelta-atras/20261106T1335_g02_limpieza_foodint.down.sql
--
-- G02 · La vuelta atrás: las dos empresas de prueba de QBO vuelven a Foodint
-- con todo lo que colgaba de ellas, con los mismos ids, desde
-- public.conta_g02_copia, y Foodint vuelve a estar marcada como asesoría con
-- la fecha y la persona de antes. Después se quita la copia (ya no hay nada
-- que devolver).
--
--   · Orden: primero las empresas, luego lo que cuelga, al revés de como se
--     borró (el plan de cuentas antes que sus enlaces).
--   · Los disparadores que, al volver a meter filas, crearían otras:
--       - company_tax_profile → crearía obligaciones nuevas desde tax_forms;
--       - tax_obligation → reescribiría tax_forms del perfil;
--     se apagan con sus propios interruptores (conta.i01_espejo y
--     conta.i01_desde_columna), solo dentro de esta transacción.
--       - conta_programa_anterior → apunta un «alta» en su registro: se quita, y
--         el registro vuelve tal cual estaba desde la copia, con su id.
--   · Lo que NO queda byte a byte: conta_programa_anterior.updated_at, que su
--     guarda pone siempre a la hora (2 filas), y accounts.updated_at de Foodint.
--   · Para si una tabla no queda con las filas de la copia.
-- Sin la copia (staging, o una tanda que no llegó a aplicarse), no hace nada.
-- sin prueba con datos: solo actúa sobre Foodint (cuenta 51ad1792…), que no está en staging; la prueba con datos es el ensayo de producción, que aplica la tanda y la deshace con esto dentro de su transacción y compara las cuentas «como antes».

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_emp constant uuid[] := array['ec98621c-583e-461d-a976-94f67c1c9ac6', 'ba37c7c4-875a-4a3f-bea2-8b83ab6990e1']::uuid[];
  -- Al revés de como se borró; el registro del programa anterior, después de su tabla.
  v_orden constant text[] := array[
    'company', 'fiscal_year', 'supplier_expected_invoice', 'sales_day_proposal_log', 'company_tax_profile',
    'tax_obligation', 'conta_programa_anterior', 'conta_programa_anterior_registro', 'company_tax_facts',
    'company_doubt', 'bank_agent_run', 'bank_activity_log', 'ai_action_log', 'ai_data_origin',
    'company_account', 'company_account_log', 'company_account_link'];
  t text; n int; c int; v_reg_max bigint; v_a jsonb;
begin
  if to_regclass('public.conta_g02_copia') is null then
    raise notice 'G02 · vuelta atrás: no hay copia (public.conta_g02_copia): no hay nada que devolver.';
    return;
  end if;
  if exists (select 1 from public.company where id = any(v_emp)) then
    raise exception 'G02 · vuelta atrás: las empresas de prueba ya están en la base: no se devuelve nada encima.';
  end if;

  perform set_config('conta.i01_espejo', 'si', true);
  perform set_config('conta.i01_desde_columna', 'si', true);
  select coalesce(max(id), 0) into v_reg_max from public.conta_programa_anterior_registro;

  foreach t in array v_orden loop
    select count(*) into c from public.conta_g02_copia where tabla = t;
    if t = 'conta_programa_anterior_registro' then
      -- El «alta» que acaba de apuntar el disparador no estaba: fuera.
      delete from public.conta_programa_anterior_registro x
       where x.company_id = any(v_emp) and x.account_id = v_acc and x.id > v_reg_max and x.accion = 'alta';
      execute format(
        'insert into public.%I overriding system value select (jsonb_populate_record(null::public.%I, k.fila)).* from public.conta_g02_copia k where k.tabla = %L order by (k.fila->>''id'')::bigint', t, t, t);
    else
      execute format(
        'insert into public.%I select (jsonb_populate_record(null::public.%I, k.fila)).* from public.conta_g02_copia k where k.tabla = %L order by k.copiada_en', t, t, t);
    end if;
    get diagnostics n = row_count;
    if n <> c then raise exception 'G02 · vuelta atrás: en % la copia tiene % filas y han vuelto %.', t, c, n; end if;
    if t = 'company' then
      execute format('select count(*) from public.%I where id = any($1)', t) into n using v_emp;
    else
      execute format('select count(*) from public.%I where company_id = any($1)', t) into n using v_emp;
    end if;
    if n <> c then raise exception 'G02 · vuelta atrás: % tiene % filas de las empresas de prueba y la copia %.', t, n, c; end if;
    raise notice 'G02 · vuelta atrás: % · % filas devueltas.', t, n;
  end loop;

  perform set_config('conta.i01_espejo', '', true);
  perform set_config('conta.i01_desde_columna', '', true);

  -- Foodint, otra vez asesoría, con la fecha y la persona de antes.
  select fila into v_a from public.conta_g02_copia where tabla = 'accounts';
  update public.accounts
     set tax_advisor_since = (v_a->>'tax_advisor_since')::timestamptz, tax_advisor_by = (v_a->>'tax_advisor_by')::uuid
   where id = v_acc and (v_a->>'id')::uuid = v_acc and tax_advisor_since is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'G02 · vuelta atrás: no se ha podido devolver la marca de asesoría de Foodint (% filas).', n; end if;

  drop table public.conta_g02_copia;
  raise notice 'G02 · vuelta atrás: las dos empresas de prueba, otra vez en Foodint con todo lo suyo; Foodint, otra vez asesoría. Copia quitada.';
end $$;
