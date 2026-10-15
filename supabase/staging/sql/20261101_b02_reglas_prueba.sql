-- ============================================================================
-- PRUEBA (staging) · B02 · T3 (0210): las reglas de Foodint, corregidas.
-- Todo en una transacción con ROLLBACK. Ejecuta los ficheros DE VERDAD (\ir):
-- la tanda y su vuelta atrás. Reglas INVENTADAS en la empresa A de la semilla,
-- con los cuatro ids que la tanda busca (los ids no dicen nada de nadie).
--
--   1. Sin la 40700001 en la empresa, la tanda PARA y no toca nada.
--      (Es la misma siembra que en el paso 3, que sí pasa: lo único distinto
--      es la cuenta, así que lo que la para es la cuenta.)
--   2. Si una regla no está como se midió, PARA.
--   3. Con la 40700001, tres reglas quedan corregidas y encendidas (la de las
--      recargas, con su condición «CATCHER DISCO» → «CATCHER»), sin
--      confirmaciones (proponen, no casan solas), con sus palabras rehechas y
--      lo de antes en su registro; la cuarta, apagada y sin tocar.
--   4. La vuelta atrás deja cada regla como estaba, y lo apunta.
--
-- sin usuario: la 0210 y su vuelta atrás no las ejecuta nadie desde la app;
-- las aplica el workflow de producción como dueño. Lo de usuario (corregir,
-- apagar, borrar) lo prueba la de la 0200, sección 7.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;

-- ── 0 · Siembra (como el dueño): las cuentas y las cuatro reglas ────────────
do $$
declare a constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
        v_plan text; c text;
begin
  select plan into v_plan from public.company_account where company_id = emp limit 1;
  if v_plan is null then raise exception 'PRUEBA B02 · 0210: la empresa A no tiene plan de cuentas en staging.'; end if;
  foreach c in array array['60000000', '62400000', '62800000', '62900000', '40700000', '43000000'] loop
    if not exists (select 1 from public.company_account where company_id = emp and code = c) then
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
      values (a, emp, v_plan, c, rtrim(c, '0'), 'Cuenta de prueba ' || c, 'template', 'manual');
    end if;
  end loop;
  foreach c in array array['60000001', '43000002'] loop
    if not exists (select 1 from public.company_account where company_id = emp and code = c) then
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
      values (a, emp, v_plan, c, left(c, 3), 'Subcuenta de prueba ' || c, 'own', 'manual');
    end if;
  end loop;
  insert into public.bank_rule (id, account_id, company_id, words, condition, target, origin, status, confirmations, corrections) values
    ('f2afd853-b93a-43b8-bc1c-fdd5136a0c13', a, emp, 'antes 1', '{"contiene": "SUSCRIPCION INVENTADA"}', '{"cuenta": "60000001"}', 'persona', 'apagada', 2, 1),
    ('a094fd3a-c8e5-4209-a989-52ecb3c862a3', a, emp, 'antes 2', '{"contiene": "GASOLINERA INVENTADA"}', '{"cuenta": "62400000"}', 'persona', 'apagada', 0, null),
    ('11f54405-a466-455d-be9c-6583d9ae58be', a, emp, 'antes 3', '{"contiene": "CATCHER DISCO"}',       '{"cuenta": "40700000"}', 'persona', 'apagada', 1, 0),
    ('103ccdd6-ce74-4464-ab6a-645e43dff288', a, emp, 'antes 4', '{"contiene": "LIQ INVENTADA"}',       '{"cuenta": "43000002"}', 'persona', 'apagada', 0, 0);
  raise notice '0 · siembra: cuatro reglas apagadas y sus cuentas';
end $$;

-- ── 1 · Sin la 40700001, PARA (y no toca nada) ─────────────────────────────
savepoint sin_cuenta;
-- En staging la 40700001 puede existir ya (y con asientos): le cambio el
-- código dentro del savepoint, que se deshace (el id no cambia).
update public.company_account set code = '40700099' where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and code = '40700001';
\set ON_ERROR_STOP 0
\ir ../../migrations/20261101T0210_b02_reglas_foodint.sql
\set ON_ERROR_STOP 1
\if :ERROR
rollback to savepoint sin_cuenta;
do $$ begin raise notice '1 · sin la 40700001: la tanda PARA'; end $$;
\else
do $$ begin raise exception 'PRUEBA B02 · 1: sin la 40700001 la tanda tenía que parar y ha seguido.'; end $$;
\endif
do $$
begin
  if exists (select 1 from public.bank_rule where id in ('f2afd853-b93a-43b8-bc1c-fdd5136a0c13', 'a094fd3a-c8e5-4209-a989-52ecb3c862a3', '11f54405-a466-455d-be9c-6583d9ae58be') and status <> 'apagada')
     or exists (select 1 from public.bank_rule_log where created_by_name = 'Tanda B02 · 0210') then
    raise exception 'PRUEBA B02 · 1: la tanda paró pero dejó algo tocado.';
  end if;
end $$;

-- ── 2 · Una regla cambiada desde la medida (su condición ya no es la medida): PARA ────────────────────────────
savepoint cambiada;
do $$
begin
  if not exists (select 1 from public.company_account where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and code = '40700001') then
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
    select 'c01a0000-0000-4000-8000-00000000000a', company_id, plan, '40700001', '407', 'Saldo prepago (prueba)', 'own', 'manual'
      from public.company_account where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' limit 1;
  end if;
  update public.bank_rule set condition = '{"contiene": "CATCHER"}' where id = '11f54405-a466-455d-be9c-6583d9ae58be';
end $$;
\set ON_ERROR_STOP 0
\ir ../../migrations/20261101T0210_b02_reglas_foodint.sql
\set ON_ERROR_STOP 1
\if :ERROR
rollback to savepoint cambiada;
do $$ begin raise notice '2 · una regla que no está como se midió: la tanda PARA'; end $$;
\else
do $$ begin raise exception 'PRUEBA B02 · 2: con una regla cambiada la tanda tenía que parar y ha seguido.'; end $$;
\endif

-- ── 3 · Con la 40700001, la tanda entera ────────────────────────────────────
do $$
begin
  if not exists (select 1 from public.company_account where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and code = '40700001') then
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
    select 'c01a0000-0000-4000-8000-00000000000a', company_id, plan, '40700001', '407', 'Saldo prepago (prueba)', 'own', 'manual'
      from public.company_account where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' limit 1;
  end if;
end $$;
\ir ../../migrations/20261101T0210_b02_reglas_foodint.sql
do $$
declare r record; n int;
begin
  for r in select * from (values
      ('f2afd853-b93a-43b8-bc1c-fdd5136a0c13'::uuid, '62900000', 'activa',  'SUSCRIPCION INVENTADA'),
      ('a094fd3a-c8e5-4209-a989-52ecb3c862a3'::uuid, '62800000', 'activa',  'GASOLINERA INVENTADA'),
      ('11f54405-a466-455d-be9c-6583d9ae58be'::uuid, '40700001', 'activa',  'CATCHER')) v(id, cuenta, estado, contiene) loop
    if not exists (select 1 from public.bank_rule b where b.id = r.id and b.target->>'cuenta' = r.cuenta and b.status = r.estado
                     and b.confirmations = 0 and b.corrections = 0 and b.condition->>'contiene' = r.contiene
                     and b.words like 'Cuando el concepto tenga «' || r.contiene || '» → % · ' || r.cuenta) then
      raise exception 'PRUEBA B02 · 3: la regla % no ha quedado → % encendida, sin confirmaciones y con sus palabras: %',
        left(r.id::text, 8), r.cuenta, (select row_to_json(b) from public.bank_rule b where b.id = r.id);
    end if;
  end loop;
  if not exists (select 1 from public.bank_rule where id = '103ccdd6-ce74-4464-ab6a-645e43dff288' and status = 'apagada' and target->>'cuenta' = '43000002' and words = 'antes 4') then
    raise exception 'PRUEBA B02 · 3: la cuarta tenía que seguir apagada y sin tocar.';
  end if;
  select count(*) into n from public.bank_rule_log where created_by_name = 'Tanda B02 · 0210' and action = 'encendida';
  if n <> 3 or exists (select 1 from public.bank_rule_log where created_by_name = 'Tanda B02 · 0210' and rule_id = '103ccdd6-ce74-4464-ab6a-645e43dff288') then
    raise exception 'PRUEBA B02 · 3: el registro tenía que llevar tres «encendida» (y ninguna de la cuarta), y lleva %.', n;
  end if;
  if not exists (select 1 from public.bank_rule_log where created_by_name = 'Tanda B02 · 0210' and rule_id = 'f2afd853-b93a-43b8-bc1c-fdd5136a0c13'
                   and before->>'palabras' = 'antes 1' and before->'destino'->>'cuenta' = '60000001' and (before->>'confirmaciones')::int = 2 and (before->>'correcciones')::int = 1) then
    raise exception 'PRUEBA B02 · 3: lo de antes no ha quedado en el registro.';
  end if;
  raise notice '3 · con la 40700001: tres corregidas y encendidas, sin confirmaciones; la cuarta, apagada';
end $$;

-- ── 4 · La vuelta atrás ─────────────────────────────────────────────────────
\ir ../../vuelta-atras/20261101T0210_b02_reglas_foodint.down.sql
do $$
begin
  if not exists (select 1 from public.bank_rule where id = 'f2afd853-b93a-43b8-bc1c-fdd5136a0c13' and status = 'apagada' and target->>'cuenta' = '60000001' and words = 'antes 1' and confirmations = 2 and corrections = 1)
     or not exists (select 1 from public.bank_rule where id = 'a094fd3a-c8e5-4209-a989-52ecb3c862a3' and status = 'apagada' and target->>'cuenta' = '62400000' and words = 'antes 2' and confirmations = 0 and corrections is null)
     or not exists (select 1 from public.bank_rule where id = '11f54405-a466-455d-be9c-6583d9ae58be' and status = 'apagada' and target->>'cuenta' = '40700000' and words = 'antes 3' and confirmations = 1
                      and condition = '{"contiene": "CATCHER DISCO"}'::jsonb) then
    raise exception 'PRUEBA B02 · 4: la vuelta atrás no ha dejado las reglas como estaban.';
  end if;
  if (select count(*) from public.bank_rule_log where created_by_name = 'Vuelta atrás B02 · 0210') <> 3 then
    raise exception 'PRUEBA B02 · 4: la vuelta atrás no lo ha apuntado en las tres.';
  end if;
  raise notice '4 · vuelta atrás: las tres, como estaban, y apuntado';
end $$;

rollback;
