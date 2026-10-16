-- supabase/staging/sql/20261113_c06b_centimo_iva_prueba.sql
--
-- SOLO STAGING. Prueba de 20261113T0100_c06b_centimo_iva
-- (public.journal_entry_validar y public.conta_propuesta_ventas_unidad), en la
-- empresa de la cuenta A de pruebas. La migración se aplica DENTRO de la
-- transacción (\i) y todo acaba en ROLLBACK: staging es compartido y no
-- cambia. Cada caso se mide con la regla de antes y con la nueva, y se valida
-- como lo valida la pantalla: como usuario (el administrador de la cuenta A).
--
--   1. El caso real (Ventas Glovo · Foodint Carabanchel, 13/10), con datos
--      inventados iguales: un ticket de 20,40 €, base 18,55 y cuota 1,85 al
--      10 %. Antes paraba («apunte 3 (47700010)»); ahora se valida, cuadrado.
--   2. Con 0,02 € de diferencia (cuota 1,84) sigue parando, con el mismo texto.
--   3. Sin diferencia (base 18,60, cuota 1,86), igual que antes: se valida.
--   4. Un resumen de 9 facturas: 4 céntimos pasan y 5 paran, como antes.
--   5. El texto del cierre del día: «1 ticket … cuadra»; con 2, «2 tickets …
--      cuadran», como antes. Sin usuario: conta_propuesta_ventas_unidad no es
--      de authenticated (la llama el cierre del día, conta_proponer_dias).
--
-- Lo de antes y lo de después se guarda en ajustes de la sesión
-- (prueba_centimo.*), que valen para cualquier rol.

begin;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

-- Los asientos de los casos 1–4, en borrador, en la empresa A (como postgres:
-- es la preparación, no lo que se prueba).
do $$
declare
  a   constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_y uuid; v_iva10 uuid; c572 uuid; c700 uuid; c477 uuid; e uuid;
  r record;
begin
  select id into v_y from public.fiscal_year where company_id = emp and code = '2026';
  select id into v_iva10 from public.tax_rate where is_system and code = 'iva_reducido' and valid_to is null;
  select id into c572 from public.company_account where company_id = emp and code = '57200001';
  select id into c700 from public.company_account where company_id = emp and code = '70000000';
  select id into c477 from public.company_account where company_id = emp and code = '47700010';
  if v_y is null or v_iva10 is null or c572 is null or c700 is null or c477 is null then
    raise exception 'PRUEBA céntimo · 0: faltan el ejercicio 2026, el IVA al 10 %% o cuentas de la empresa A en staging.';
  end if;
  for r in select * from (values
      ('c1', 20.40, 18.55, 1.85, 1),
      ('c2', 20.39, 18.55, 1.84, 1),
      ('c3', 20.46, 18.60, 1.86, 1),
      ('c4a', 110.04, 100.00, 10.04, 9),
      ('c4b', 110.05, 100.00, 10.05, 9)) v(k, total, base, cuota, n)
  loop
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
    values (a, emp, v_y, 1, '2026-10-13', 'Prueba del céntimo · ' || r.k, 'manual') returning id into e;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, tax_rate_id, tax_base, vat_book, tax_documents)
    values (a, emp, e, 1, c572, r.total, 0, loc, null, null, null, 1),
           (a, emp, e, 2, c700, 0, r.base, loc, null, null, null, 1),
           (a, emp, e, 3, c477, 0, r.cuota, loc, v_iva10, r.base, 'issued', r.n);
    perform set_config('prueba_centimo.' || r.k, e::text, true);
  end loop;

  -- 5 · El texto del cierre del día con la función de antes.
  perform set_config('prueba_centimo.t1_antes', public.conta_propuesta_ventas_unidad(emp, loc, '2026-09-25', 'e0200000-0000-4000-8000-00000000a0c1', null) -> 'entrada' ->> 'porque', true);
  perform set_config('prueba_centimo.t2_antes', public.conta_propuesta_ventas_unidad(emp, loc, '2026-09-24', 'e0200000-0000-4000-8000-00000000a0c1', null) -> 'entrada' ->> 'porque', true);
end $$;

-- Lo que dice cada caso con la regla de ANTES, como usuario. Cada validación
-- va en un subbloque que se deshace: aquí no queda nada validado.
set local role authenticated;
do $$
declare k text; v_msg text;
begin
  foreach k in array array['c1', 'c2', 'c3', 'c4a', 'c4b'] loop
    begin
      perform public.journal_entry_validar(current_setting('prueba_centimo.' || k)::uuid);
      raise exception using errcode = 'P0001', message = 'VALIDA';
    exception
      when check_violation then v_msg := sqlerrm;
      when raise_exception then if sqlerrm <> 'VALIDA' then raise; end if; v_msg := 'se valida';
    end;
    perform set_config('prueba_centimo.' || k || '_antes', v_msg, true);
  end loop;
end $$;
reset role;

-- La migración, la misma que irá a producción.
\i supabase/migrations/20261113T0100_c06b_centimo_iva.sql

-- Lo mismo con la regla NUEVA, como usuario.
set local role authenticated;
do $$
declare k text; v_msg text;
begin
  foreach k in array array['c1', 'c2', 'c3', 'c4a', 'c4b'] loop
    begin
      perform public.journal_entry_validar(current_setting('prueba_centimo.' || k)::uuid);
      raise exception using errcode = 'P0001', message = 'VALIDA';
    exception
      when check_violation then v_msg := sqlerrm;
      when raise_exception then if sqlerrm <> 'VALIDA' then raise; end if; v_msg := 'se valida';
    end;
    perform set_config('prueba_centimo.' || k || '_despues', v_msg, true);
  end loop;
end $$;
reset role;

do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  k text; antes text; despues text; t1 text; t2 text; v_n int;
  g constant text := 'prueba_centimo.';
begin
  foreach k in array array['c1', 'c2', 'c3', 'c4a', 'c4b'] loop
    raise notice '%: antes «%», ahora «%»', k, current_setting(g || k || '_antes'), current_setting(g || k || '_despues');
  end loop;

  antes := current_setting(g || 'c1_antes'); despues := current_setting(g || 'c1_despues');
  if antes not like 'No se valida: apunte 3 (47700010): la cuota 1.85 no es la base 18.55 × %' then
    raise exception 'PRUEBA céntimo · 1: con la regla de antes tenía que parar en el apunte 3, y dice «%».', antes;
  end if;
  if despues <> 'se valida' then raise exception 'PRUEBA céntimo · 1: el caso real sigue parando: «%».', despues; end if;

  antes := current_setting(g || 'c2_antes'); despues := current_setting(g || 'c2_despues');
  if antes is distinct from despues or despues not like 'No se valida: apunte 3 (47700010): la cuota 1.84 %' then
    raise exception 'PRUEBA céntimo · 2: con 0,02 € tenía que parar igual que antes: antes «%», ahora «%».', antes, despues;
  end if;

  if current_setting(g || 'c3_antes') <> 'se valida' or current_setting(g || 'c3_despues') <> 'se valida' then
    raise exception 'PRUEBA céntimo · 3: sin diferencia tenía que validarse antes y ahora: «%» / «%».', current_setting(g || 'c3_antes'), current_setting(g || 'c3_despues');
  end if;

  if current_setting(g || 'c4a_antes') <> 'se valida' or current_setting(g || 'c4a_despues') <> 'se valida' then
    raise exception 'PRUEBA céntimo · 4a: un resumen de 9 con 4 céntimos: «%» / «%».', current_setting(g || 'c4a_antes'), current_setting(g || 'c4a_despues');
  end if;
  antes := current_setting(g || 'c4b_antes'); despues := current_setting(g || 'c4b_despues');
  if antes is distinct from despues or despues not like 'No se valida: apunte 3 (47700010)%' then
    raise exception 'PRUEBA céntimo · 4b: un resumen de 9 con 5 céntimos tenía que parar igual que antes: «%» / «%».', antes, despues;
  end if;

  -- El asiento sigue cuadrando: la regla 1 no ha cambiado.
  select count(*) into v_n from (
    select l.entry_id from public.journal_line l join public.journal_entry e on e.id = l.entry_id
     where e.company_id = emp and e.concept like 'Prueba del céntimo · %' group by l.entry_id having sum(l.debit) <> sum(l.credit)) x;
  if v_n <> 0 then raise exception 'PRUEBA céntimo · 1: % asientos de la prueba no cuadran.', v_n; end if;

  -- 5 · El texto del cierre del día, con la función nueva.
  t1 := public.conta_propuesta_ventas_unidad(emp, loc, '2026-09-25', 'e0200000-0000-4000-8000-00000000a0c1', null) -> 'entrada' ->> 'porque';
  t2 := public.conta_propuesta_ventas_unidad(emp, loc, '2026-09-24', 'e0200000-0000-4000-8000-00000000a0c1', null) -> 'entrada' ->> 'porque';
  raise notice '5 · 1 ticket: antes «%», ahora «%»', current_setting(g || 't1_antes'), t1;
  raise notice '5 · 2 tickets: antes «%», ahora «%»', current_setting(g || 't2_antes'), t2;
  if current_setting(g || 't1_antes') not like '1 tickets de tus marcas en Glovo cuadran con lo que cobra, al céntimo%' then
    raise exception 'PRUEBA céntimo · 5: el día de 1 ticket no es el de la semilla: «%».', current_setting(g || 't1_antes');
  end if;
  if t1 <> replace(replace(current_setting(g || 't1_antes'), '1 tickets', '1 ticket'), 'cuadran', 'cuadra') then
    raise exception 'PRUEBA céntimo · 5: con 1 ticket dice «%».', t1;
  end if;
  if current_setting(g || 't2_antes') not like '2 tickets de tus marcas en Glovo cuadran %' or t2 is distinct from current_setting(g || 't2_antes') then
    raise exception 'PRUEBA céntimo · 5: con 2 tickets cambió: «%» / «%».', current_setting(g || 't2_antes'), t2;
  end if;

  raise notice 'PRUEBA céntimo: el caso real se valida, 0,02 € sigue parando, sin diferencia igual que antes, el resumen igual, y «1 ticket … cuadra».';
end $$;

\echo '>>> Prueba del céntimo de redondeo en el IVA en verde. ROLLBACK: no queda nada.'
rollback;
