-- supabase/staging/sql/20261122_i01_obligaciones_prueba.sql
--
-- SOLO STAGING. Prueba de 20261122T0120_i01_obligaciones (con la 0100 y la
-- 0110 delante). Las tres se aplican DENTRO de la transacción (\i) y todo
-- acaba en ROLLBACK: staging no cambia. Contra las empresas de prueba de
-- verdad (regla 31): la de la cuenta A tiene 3 personas en nómina en los
-- últimos 12 meses (payroll_summary); su hermana, ninguna; la de la cuenta B
-- está en Canarias. Como usuario (el administrador de cada cuenta).
--
--   1. Las reglas, en la empresa A: cada modelo con su regla con nombre, sus
--      datos y su porqué en palabras de oficina («Tienes 3 personas en
--      nómina…»); lo que venía del alta pasa a su regla.
--   2. Calcular dos veces no escribe dos veces: la segunda, todo «igual».
--   3. Quitar un modelo pide motivo; con él queda «Lo quitaste tú: …» y
--      ninguna regla lo vuelve a poner. tax_forms lo sigue.
--   4. Un dato cambia la regla: «no pago nóminas ni profesionales con
--      retención» quita el 111 y, con él, su 190; los dos con su porqué.
--   5. Canarias: el 303 no sale, y se dice por qué (IGIC).
--   6. Un autónomo profesional (la hermana, cambiada dentro de la
--      transacción): con el 70 % de sus ingresos retenido no hay 130; con
--      «No lo sé», lo normal, sí; y ni 202 ni 200.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA obligaciones: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

\i supabase/migrations/20261122T0100_i01_plazos.sql
\i supabase/migrations/20261122T0110_i01_modelo_datos.sql
\i supabase/migrations/20261122T0120_i01_obligaciones.sql

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';   -- 3 en nómina
  v_h constant uuid := '567b0264-7895-47b3-b9f9-81fae8a4aa2c';   -- su hermana, nadie en nómina
  v jsonb; x jsonb; o record; v_n int; v_err text; v_lista text[];
begin
  -- 1 · Las reglas.
  v := public.conta_impuesto_obligaciones_calcular(v_a);
  select x0 into x from jsonb_array_elements(v) x0 where x0->>'modelo' = '111';
  if x->>'regla' <> 'ret_111' or x->>'por_que' <> 'Tienes 3 personas en nómina: declaras cada trimestre lo que les retienes.'
     or (x->'datos'->>'personas_en_nomina')::int <> 3 or x->>'hecho' not in ('cambiado', 'igual') then
    raise exception 'PRUEBA obligaciones 1: el 111 sale %.', x;
  end if;
  select * into o from public.tax_obligation where company_id = v_a and form_code = '111' and valid_to is null;
  if o.origin <> 'rule' or o.rule_key <> 'ret_111' or o.why not like 'Tienes 3 personas en nómina%' or not o.active then
    raise exception 'PRUEBA obligaciones 1: el 111 se guarda %, %, «%».', o.origin, o.rule_key, o.why;
  end if;
  for x in select * from jsonb_array_elements(v) loop
    if coalesce(x->>'por_que', '') = '' or coalesce(x->>'regla', '') = '' then raise exception 'PRUEBA obligaciones 1: % sin regla o sin porqué.', x; end if;
  end loop;
  if not exists (select 1 from jsonb_array_elements(v) x0 where x0->>'modelo' = '303' and x0->>'regla' = 'iva_303' and (x0->>'presenta')::boolean)
     or not exists (select 1 from jsonb_array_elements(v) x0 where x0->>'modelo' = '190' and x0->>'regla' = 'anual_de_111')
     or not exists (select 1 from jsonb_array_elements(v) x0 where x0->>'modelo' = '347' and x0->>'regla' = 'defecto_347')
     or not exists (select 1 from jsonb_array_elements(v) x0 where x0->>'modelo' = '202' and x0->>'regla' = 'is_202') then
    raise exception 'PRUEBA obligaciones 1: faltan reglas en %.', v;
  end if;
  -- Las reglas no se llaman desde el front: leen datos de cualquier empresa.
  begin
    perform * from public.conta_impuesto_reglas(v_h);
    raise exception 'PRUEBA obligaciones 1: un usuario llama a conta_impuesto_reglas.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PRUEBA obligaciones 1: % modelos, cada uno con su regla y su porqué; el 111: «%»; las reglas, solo por dentro.', jsonb_array_length(v), o.why;

  -- 2 · Otra vez: nada nuevo.
  select count(*) into v_n from public.tax_obligation where company_id = v_a;
  v := public.conta_impuesto_obligaciones_calcular(v_a);
  if exists (select 1 from jsonb_array_elements(v) x0 where x0->>'hecho' <> 'igual') then raise exception 'PRUEBA obligaciones 2: la segunda vez cambia %.', v; end if;
  if (select count(*) from public.tax_obligation where company_id = v_a) <> v_n then raise exception 'PRUEBA obligaciones 2: la segunda vez escribe filas.'; end if;
  raise notice 'PRUEBA obligaciones 2: calcular otra vez no escribe nada.';

  -- 3 · Quitar pide motivo, y queda.
  begin
    perform public.conta_impuesto_obligacion_decidir(v_a, '347', false, '  ');
    raise exception 'PRUEBA obligaciones 3: se ha quitado el 347 sin motivo.';
  exception when sqlstate '22023' then get stacked diagnostics v_err = message_text;
    if v_err <> 'Para quitar el 347 hace falta el motivo.' then raise exception 'PRUEBA obligaciones 3: mensaje «%».', v_err; end if;
  end;
  perform public.conta_impuesto_obligacion_decidir(v_a, '347', false, 'Ningún cliente ni proveedor pasa de 3.005,06 € este año (lo revisó la asesoría).');
  select * into o from public.tax_obligation where company_id = v_a and form_code = '347' and valid_to is null;
  if o.origin <> 'removed' or o.active or o.why <> 'Lo quitaste tú: Ningún cliente ni proveedor pasa de 3.005,06 € este año (lo revisó la asesoría).'
     or o.decided_by <> 'c01a0000-0000-4000-8000-0000000000a1' then
    raise exception 'PRUEBA obligaciones 3: el 347 quitado queda %, «%».', o.origin, o.why;
  end if;
  v := public.conta_impuesto_obligaciones_calcular(v_a);
  select x0 into x from jsonb_array_elements(v) x0 where x0->>'modelo' = '347';
  if x->>'hecho' <> 'lo_decidio_una_persona' or x->>'motivo_de_la_persona' is null then raise exception 'PRUEBA obligaciones 3: la regla del 347 dice %.', x; end if;
  select tax_forms into v_lista from public.company_tax_forms where company_id = v_a;
  if '347' = any (v_lista) then raise exception 'PRUEBA obligaciones 3: el 347 quitado sigue en la lista: %.', v_lista; end if;
  raise notice 'PRUEBA obligaciones 3: quitar pide motivo; quitado, ninguna regla lo vuelve a poner; la lista lo sigue.';

  -- 4 · Un dato cambia la regla (la hermana, sin nadie en nómina).
  perform public.conta_impuesto_dato_poner(v_h, 'pays_with_withholding', 'false', 'ajustes');
  v := public.conta_impuesto_obligaciones_calcular(v_h);
  select * into o from public.tax_obligation where company_id = v_h and form_code = '111' and valid_to is null;
  if o.active or o.why <> 'No tienes a nadie en nómina ni facturas de profesionales con retención.' then
    raise exception 'PRUEBA obligaciones 4: el 111 sin nóminas queda %, «%».', o.active, o.why;
  end if;
  select * into o from public.tax_obligation where company_id = v_h and form_code = '190' and valid_to is null;
  if o.active or o.rule_key <> 'anual_de_111' or o.why <> 'No presentas el 111, así que tampoco su resumen anual.' then
    raise exception 'PRUEBA obligaciones 4: el 190 queda %, %, «%».', o.active, o.rule_key, o.why;
  end if;
  raise notice 'PRUEBA obligaciones 4: sin nóminas ni retenciones, fuera el 111 y su 190, cada uno con su porqué.';
end $$;
reset role;

-- 5 · Canarias (el administrador de la cuenta B).
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v jsonb; x jsonb;
begin
  v := public.conta_impuesto_obligaciones_calcular('7e35fa0e-65aa-4a96-86e6-de9a2317c0f6');
  select x0 into x from jsonb_array_elements(v) x0 where x0->>'modelo' = '303';
  if (x->>'presenta')::boolean or x->>'por_que' <> 'En Canarias no hay IVA sino IGIC: sus modelos los confirma tu asesor.' then
    raise exception 'PRUEBA obligaciones 5: en Canarias el 303 sale %.', x;
  end if;
  if exists (select 1 from public.tax_obligation where company_id = '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6' and form_code in ('303', '390') and valid_to is null and active) then
    raise exception 'PRUEBA obligaciones 5: en Canarias queda el 303 o el 390 activo.';
  end if;
  raise notice 'PRUEBA obligaciones 5: Canarias, sin 303 y con su porqué: «%».', x->>'por_que';
end $$;
reset role;

-- 6 · El 130 (preparación como el servidor: la hermana pasa a autónomo profesional).
update public.company set entity_kind = 'self_employed' where id = '567b0264-7895-47b3-b9f9-81fae8a4aa2c';
update public.company_activity set kind = 'professional' where company_id = '567b0264-7895-47b3-b9f9-81fae8a4aa2c' and ended_on is null;
insert into public.company_activity (account_id, company_id, description, kind)
select c.account_id, c.id, 'Asesoría de prueba (I01a)', 'professional' from public.company c
 where c.id = '567b0264-7895-47b3-b9f9-81fae8a4aa2c'
   and not exists (select 1 from public.company_activity a where a.company_id = c.id and a.ended_on is null);
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v_h constant uuid := '567b0264-7895-47b3-b9f9-81fae8a4aa2c';
  v jsonb; x jsonb; o record;
begin
  perform public.conta_impuesto_dato_poner(v_h, 'withheld_income_70', 'true', 'ajustes');
  v := public.conta_impuesto_obligaciones_calcular(v_h);
  select x0 into x from jsonb_array_elements(v) x0 where x0->>'modelo' = '130';
  if x is null or (x->>'presenta')::boolean or x->>'regla' <> 'irpf_130'
     or x->>'por_que' <> 'El año pasado al menos el 70 % de tus ingresos llevó retención: no adelantas el IRPF.' then
    raise exception 'PRUEBA obligaciones 6: con el 70 %% retenido, el 130 sale %.', x;
  end if;
  if exists (select 1 from jsonb_array_elements(v) x0 where x0->>'modelo' in ('202', '200')) then
    raise exception 'PRUEBA obligaciones 6: un autónomo con 202 o 200: %.', v;
  end if;
  perform public.conta_impuesto_dato_poner(v_h, 'withheld_income_70', 'null', 'ajustes');
  v := public.conta_impuesto_obligaciones_calcular(v_h);
  select * into o from public.tax_obligation where company_id = v_h and form_code = '130' and valid_to is null;
  if not o.active or o.rule_key <> 'irpf_130' or o.why not like 'Dijiste «No lo sé»%' then
    raise exception 'PRUEBA obligaciones 6: con «No lo sé», el 130 queda %, «%».', o.active, o.why;
  end if;
  raise notice 'PRUEBA obligaciones 6: autónomo profesional: con el 70 %% retenido no hay 130; con «No lo sé», sí: «%».', o.why;
end $$;
reset role;

rollback;
