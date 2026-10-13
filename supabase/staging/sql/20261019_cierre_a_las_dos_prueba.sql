-- supabase/staging/sql/20261019_cierre_a_las_dos_prueba.sql
--
-- SOLO STAGING. Prueba de 20261019T0170 (public.conta_ultimo_dia_cerrado,
-- public.conta_cerrar_dias, public.conta_propuestos_antes_del_cierre y el
-- valor de serie de company_tax_profile.sales_day_close_time), en la empresa
-- de la cuenta A de pruebas. Todo en una transacción con ROLLBACK: no cambia
-- staging.
--
--   1. El valor de serie es 2:00, y una empresa SIN hora cierra a las 2:00.
--   2. El cambio de hora: los mismos instantes que cierreDelDia.test.ts, con
--      las 2:00 (las dos noches: el 25/10 las 2:00 pasan dos veces; el 29/03
--      no existen).
--   3. El cierre de verdad: un pedido abierto de las 23:00 del día D sigue
--      abierto a la 1:59 de D + 1 y se cierra a las 2:00, con «(2:00)» en el
--      motivo y en el rastro.
--   4. «Propuesto antes del cierre» y el cierre dicen lo mismo, también en la
--      hora que se repite el 25/10: propuesto a las 2:30 de la PRIMERA vuelta
--      (00:30 UTC) ya no es «antes del cierre»; a la 1:30, sí.
--   5. La hora de cada empresa sigue mandando: con 6:00 guardado, a las 2:00
--      no se cierra nada.

begin;

do $$
begin
  if exists (select 1 from public.company where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') then
    raise exception 'PRUEBA cierre a las 2:00: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;

do $$
declare
  v_acc   constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc   constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_marca constant uuid := '7e000000-0000-4000-8000-000000000b01';
  v_canal constant uuid := 'e0200000-0000-4000-8000-00000000a0c1';
  v_e uuid;
  v_s constant uuid := 'cd000000-0000-4000-8000-000000000701';
  c record; v_mal text := ''; r jsonb; v_d date := date '2026-10-24';
  v_y uuid; v_ent uuid;
begin
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;

  -- 1 · El valor de serie, y una empresa sin hora --------------------------------------
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'company_tax_profile' and column_name = 'sales_day_close_time') is distinct from '''02:00:00''::time without time zone' then
    raise exception 'PRUEBA 2:00 · 1: el valor de serie no es 2:00.';
  end if;
  update public.company_tax_profile set sales_day_close_time = null where company_id = v_e;
  if not found then raise exception 'PRUEBA 2:00 · 1: la empresa A no tiene ficha fiscal.'; end if;

  -- 2 · Los instantes (sin hora guardada: manda la de serie) ----------------------------
  for c in select * from (values
      ('2026-10-09 15:15:56+00', '2026-10-08'),   -- 17:15 de Madrid
      ('2026-10-08 23:59:00+00', '2026-10-07'),   -- 1:59 del 09/10 (verano, UTC+2)
      ('2026-10-09 00:00:00+00', '2026-10-08'),   -- 2:00 en punto
      ('2026-10-24 23:59:00+00', '2026-10-23'),   -- noche del cambio: 1:59 de verano
      ('2026-10-25 00:00:00+00', '2026-10-24'),   -- 2:00, primera vuelta
      ('2026-10-25 00:59:00+00', '2026-10-24'),   -- 2:59, primera vuelta
      ('2026-10-25 01:00:00+00', '2026-10-24'),   -- 2:00, segunda vuelta (invierno)
      ('2026-10-26 00:59:00+00', '2026-10-24'),   -- 1:59 de invierno (UTC+1)
      ('2026-10-26 01:00:00+00', '2026-10-25'),   -- 2:00 de invierno
      ('2026-03-28 00:59:00+00', '2026-03-26'),   -- 1:59 de invierno
      ('2026-03-28 01:00:00+00', '2026-03-27'),
      ('2026-03-29 00:59:00+00', '2026-03-27'),   -- 1:59; a las 2:00 se salta a las 3:00
      ('2026-03-29 01:00:00+00', '2026-03-28')    -- 3:00 de verano: ya cerrado
    ) as t(ahora, esperado) loop
    if public.conta_ultimo_dia_cerrado(v_e, c.ahora::timestamptz)::text <> c.esperado then
      v_mal := v_mal || format('%s → %s (esperado %s); ', c.ahora, public.conta_ultimo_dia_cerrado(v_e, c.ahora::timestamptz), c.esperado);
    end if;
  end loop;
  if v_mal <> '' then raise exception 'PRUEBA 2:00 · 2: %', v_mal; end if;

  -- 3 · El cierre de verdad: abierto a las 23:00 del 24/10 -------------------------------
  insert into public.sale (id, account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, source, platform_order_code, is_active)
  values (v_s, v_acc, v_loc, v_marca, v_canal, (v_d::timestamp + time '23:00') at time zone 'Europe/Madrid', 'open', 'awaiting_collection', 9.9, 'hubrise', 'P2701', true);
  r := public.conta_cerrar_dias(v_e, '2026-10-24 23:59:00+00');   -- 1:59 del 25/10
  if (select status from public.sale where id = v_s) <> 'open' then
    raise exception 'PRUEBA 2:00 · 3: a la 1:59 ya se había cerrado el pedido de las 23:00 (%).', r;
  end if;
  r := public.conta_cerrar_dias(v_e, '2026-10-25 00:07:00+00');   -- 2:07, la pasada del cron
  if (select status from public.sale where id = v_s) <> 'cancelled'
     or (select cancel_reason from public.sale where id = v_s) <> 'No confirmado por la plataforma al cierre del día (2:00)'
     or (select close_time from public.sales_day_close_log where sale_id = v_s) <> time '02:00'
     or r ->> 'hora' <> '02:00' then
    raise exception 'PRUEBA 2:00 · 3: a las 2:07 no se cerró como tocaba: % · %.', r, (select cancel_reason from public.sale where id = v_s);
  end if;

  -- 4 · «Propuesto antes del cierre» = la pregunta del cierre ----------------------------
  select id into v_y from public.fiscal_year where company_id = v_e and code = '2026';
  if v_y is null then raise exception 'PRUEBA 2:00 · 4: la empresa A no tiene 2026.'; end if;
  for c in select * from (values
      ('2026-10-24 23:30:00+00', true),    -- 1:30 de verano: antes del cierre
      ('2026-10-25 00:30:00+00', false),   -- 2:30 de la PRIMERA vuelta: ya cerrado
      ('2026-10-25 01:30:00+00', false)    -- 2:30 de la segunda
    ) as t(creado, antes) loop
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, confidence, reason, created_at)
    values (v_acc, v_e, v_y, 1, v_d, 'Ventas inventadas', 'sales_day', 'propuesto', 'seguro', 'Prueba del cierre a las 2:00', c.creado::timestamptz) returning id into v_ent;
    insert into public.sales_day_summary (account_id, company_id, location_id, sales_day, entry_id, tickets_count, total, detail_hash)
    values (v_acc, v_e, v_loc, v_d, v_ent, 0, 0, 'prueba');
    if exists (select 1 from public.conta_propuestos_antes_del_cierre(v_e) x where x.entry_id = v_ent) <> c.antes then
      raise exception 'PRUEBA 2:00 · 4: propuesto a las % (UTC) se ve «antes del cierre» = %, y tenía que ser %.',
        c.creado, not c.antes, c.antes;
    end if;
    delete from public.sales_day_summary where entry_id = v_ent;
    delete from public.journal_entry where id = v_ent;
  end loop;

  -- 5 · La hora de la empresa sigue mandando ------------------------------------------
  update public.company_tax_profile set sales_day_close_time = time '06:00' where company_id = v_e;
  if public.conta_ultimo_dia_cerrado(v_e, '2026-10-09 00:00:00+00') <> date '2026-10-07' then
    raise exception 'PRUEBA 2:00 · 5: con 6:00 guardado, a las 2:00 ya daba por cerrado el día anterior.';
  end if;

  raise notice 'PRUEBA cierre a las 2:00 en verde: serie 2:00; 13 instantes (octubre y marzo); el pedido de las 23:00 sigue abierto a la 1:59 y se cierra a las 2:07 con «(2:00)»; «propuesto antes del cierre» coincide con el cierre en la hora repetida; la hora de la empresa manda.';
end $$;

rollback;
