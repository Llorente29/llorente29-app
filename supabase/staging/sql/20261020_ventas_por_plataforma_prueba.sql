-- supabase/staging/sql/20261020_ventas_por_plataforma_prueba.sql
--
-- SOLO STAGING. Prueba de 20261020T0100 (la regla de ventas por plataforma):
-- public.conta_dias_por_asentar, public._journal_entry_proponer,
-- public.conta_proponer_dias y public.journal_entry_descartar, con
-- conta_ventas_canal, conta_ventas_marca, conta_propuesta_ventas_unidad y
-- conta_propuestas_ventas_dia. Va después de la 0110 (el índice por unidad).
-- Todo en una transacción con ROLLBACK: no cambia staging.
--
-- En la empresa A, local Norte Centro, con números hechos a mano:
--   1. Sin regla (sin filas en conta_ventas_canal) todo es como antes: el 20/09
--      se propone entero («Ventas del día · Norte Centro»).
--   2. Se le pone la regla: Glovo por marca; Casa Lola a 70000001 (subcuenta
--      creada aquí), sin subcuenta de reembolsos: sin reembolsos ese día, no
--      hay nada que avisar (el aviso es de lo que se usa).
--      21/09 · Glovo: 22,00 con base 20,00 y 11,00 sin base, de Casa Lola;
--              una cedida de 18,00. Uber (sin 430 en staging): 15,00.
--      → Glovo · Casa Lola: cobra Glovo 33,00 · 70000001 30,00 · IVA 3,00;
--        Uber: sin propuesta, «No sé a qué cuenta va lo que cobra…».
--      El 20/09, asentado entero antes de la regla, NO se rehace por unidades.
--   3. Otra pasada: nada dos veces.
--   4. El front de antes (sin unidad) recibe el porqué, no un asiento.
--   5. Descartar la unidad descarta la unidad (clave día:local:unidad), no el día.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA ventas por plataforma: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

select set_config('prueba.empresa', (select id::text from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at limit 1), true);

-- ── 1 · Sin regla, como antes ──────────────────────────────────────────────
do $$
declare
  v_e      uuid := current_setting('prueba.empresa')::uuid;
  v_acc    constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc    constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_marca  constant uuid := '7e000000-0000-4000-8000-000000000b01';   -- Casa Lola, propia
  v_cedida constant uuid := 'e0200000-0000-4000-8000-00000000a0b5';   -- Brasa Prestada, cedida
  v_glovo  constant uuid := 'e0200000-0000-4000-8000-00000000a0c1';   -- con su 430
  v_uber   constant uuid := 'e0200000-0000-4000-8000-00000000a0c2';   -- sin 430 en staging
  h        constant interval := interval '13 hours';
  v        jsonb;
begin
  if v_e is null then raise exception 'PRUEBA ventas por plataforma · 1: no encuentro la empresa de la cuenta A.'; end if;
  if exists (select 1 from public.sale where account_id = v_acc and sold_at >= '2026-09-19' and sold_at < '2026-09-23') then
    raise exception 'PRUEBA ventas por plataforma · 1: A ya tiene ventas del 19 al 22 de septiembre; la prueba no mediría lo que dice.';
  end if;
  if exists (select 1 from public.conta_ventas_canal where company_id = v_e) then
    raise exception 'PRUEBA ventas por plataforma · 1: A ya tiene regla de ventas; la prueba la pone ella.';
  end if;
  insert into public.sale (account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, taxable_base, tax, source, platform_order_code, is_active) values
    (v_acc, v_loc, v_marca,  v_glovo, ('2026-09-20'::timestamp + h) at time zone 'Europe/Madrid', 'closed', 'completed', 12.00, null, null, 'hubrise', 'P2001', true),
    (v_acc, v_loc, v_marca,  v_glovo, ('2026-09-21'::timestamp + h) at time zone 'Europe/Madrid', 'closed', 'completed', 22.00, 20.00, 2.00, 'hubrise', 'P2101', true),
    (v_acc, v_loc, v_marca,  v_glovo, ('2026-09-21'::timestamp + h + interval '1 hour') at time zone 'Europe/Madrid', 'closed', 'completed', 11.00, null, null, 'hubrise', 'P2102', true),
    (v_acc, v_loc, v_cedida, v_glovo, ('2026-09-21'::timestamp + h + interval '2 hours') at time zone 'Europe/Madrid', 'closed', 'completed', 18.00, null, null, 'hubrise', 'P2103', true),
    (v_acc, v_loc, v_marca,  v_uber,  ('2026-09-21'::timestamp + h + interval '3 hours') at time zone 'Europe/Madrid', 'closed', 'completed', 15.00, null, null, 'hubrise', 'P2104', true);
  -- El 20, con la regla de antes, a mano (como el botón de antes): el día entero.
  v := public.conta_propuesta_ventas_dia(v_e, v_loc, '2026-09-20');
  if v ? 'sin_propuesta' then raise exception 'PRUEBA ventas por plataforma · 1: el 20 sin regla no propone: %', v; end if;
  v := public._journal_entry_proponer(v_e, v->'entrada', v->'lineas', v->'resumen', 'Prueba', null);
  if (select e.concept from public.journal_entry e where e.id = (v->>'id')::uuid) <> 'Ventas del día · Norte Centro' then
    raise exception 'PRUEBA ventas por plataforma · 1: el 20 sin regla no es el día entero.';
  end if;
  raise notice 'PRUEBA ventas por plataforma · 1: sin regla, el 20 se propone entero, como antes.';
end $$;

-- ── 2 · Con la regla ───────────────────────────────────────────────────────
do $$
declare
  v_e      uuid := current_setting('prueba.empresa')::uuid;
  v_acc    constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_marca  constant uuid := '7e000000-0000-4000-8000-000000000b01';
  v_glovo  constant uuid := 'e0200000-0000-4000-8000-00000000a0c1';
  v_uber   constant uuid := 'e0200000-0000-4000-8000-00000000a0c2';
  v_cta    uuid;
begin
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, status, created_by_name)
  values (v_acc, v_e, 'pymes', '70000001', '700', 'VENTAS CASA LOLA', 'own', 'manual', 'activa', 'Prueba')
  on conflict (company_id, code) do nothing;
  select id into v_cta from public.company_account where company_id = v_e and code = '70000001';
  insert into public.conta_ventas_canal (company_id, account_id, channel_id, por_marca, created_by_name) values
    (v_e, v_acc, v_glovo, true, 'Prueba'), (v_e, v_acc, v_uber, false, 'Prueba');
  insert into public.conta_ventas_marca (company_id, account_id, brand_id, papel, company_account_id, created_by_name)
  values (v_e, v_acc, v_marca, 'ventas', v_cta, 'Prueba');
end $$;

select set_config('prueba.pasada', public.conta_proponer_dias(current_setting('prueba.empresa')::uuid, timestamptz '2026-09-23 10:00+02')::text, true);

do $$
declare
  v_e    uuid := current_setting('prueba.empresa')::uuid;
  v_loc  constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_marca constant uuid := '7e000000-0000-4000-8000-000000000b01';
  v_glovo constant uuid := 'e0200000-0000-4000-8000-00000000a0c1';
  v      jsonb := current_setting('prueba.pasada')::jsonb;
  v_ent  record; v_l jsonb; v_d numeric; v_h numeric; v_log record;
begin
  if (v->>'fallos')::int <> 0 or (v->>'asientos_por_unidad')::int <> 1 then
    raise exception 'PRUEBA ventas por plataforma · 2: esperaba 0 fallos y 1 asiento por unidad: %', v;
  end if;
  select e.* into v_ent from public.journal_entry e join public.sales_day_summary s on s.entry_id = e.id
   where s.company_id = v_e and s.location_id = v_loc and s.sales_day = '2026-09-21' and s.unit_key = v_glovo || ':' || v_marca;
  if v_ent.id is null or v_ent.status <> 'propuesto' or v_ent.concept not like 'Ventas Glovo · Casa Lola · %' or v_ent.confidence <> 'probable' then
    raise exception 'PRUEBA ventas por plataforma · 2: el asiento de Glovo · Casa Lola del 21 no es el esperado: % % %', v_ent.status, v_ent.concept, v_ent.confidence;
  end if;
  select jsonb_agg(jsonb_build_object('c', a.code, 'd', l.debit, 'h', l.credit, 'con', l.concept, 'm', l.brand_id) order by l.position)
    into v_l from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v_ent.id;
  if v_l <> jsonb_build_array(
       jsonb_build_object('c', '43000001', 'd', 33.00, 'h', 0, 'con', 'Cobra Glovo', 'm', null),
       jsonb_build_object('c', '70000001', 'd', 0, 'h', 30.00, 'con', 'Ventas Casa Lola', 'm', v_marca),
       jsonb_build_object('c', '47700010', 'd', 0, 'h', 3.00, 'con', 'IVA repercutido 10 %', 'm', null)) then
    raise exception 'PRUEBA ventas por plataforma · 2: las líneas de Glovo · Casa Lola no son las esperadas: %', v_l;
  end if;
  select sum(debit), sum(credit) into v_d, v_h from public.journal_line where entry_id = v_ent.id;
  if v_d <> v_h then raise exception 'PRUEBA ventas por plataforma · 2: no cuadra (% / %).', v_d, v_h; end if;
  -- Sin reembolsos ese día, la subcuenta de reembolsos que falta no se usa: no hay aviso.
  if exists (select 1 from jsonb_array_elements(v_ent.reasons) x where x->>'decision' = 'Mira esto') then
    raise exception 'PRUEBA ventas por plataforma · 2: avisa de algo que no usa: %', v_ent.reasons;
  end if;
  -- Uber, sin 430: no se propone, y el registro del día dice de qué unidad es el porqué.
  select * into v_log from public.sales_day_proposal_log where company_id = v_e and location_id = v_loc and sales_day = '2026-09-21';
  if v_log.result <> 'sin_propuesta' or v_log.reason not like '%: No sé a qué cuenta va lo que cobra %' then
    raise exception 'PRUEBA ventas por plataforma · 2: el registro del 21 no es el esperado: % %', v_log.result, v_log.reason;
  end if;
  -- La cedida no está en ningún asiento.
  if exists (select 1 from public.journal_line l join public.journal_entry e on e.id = l.entry_id
              where e.company_id = v_e and e.entry_date = '2026-09-21' and l.brand_id = 'e0200000-0000-4000-8000-00000000a0b5') then
    raise exception 'PRUEBA ventas por plataforma · 2: una cedida ha entrado en un asiento.';
  end if;
  -- El 20, asentado entero antes de la regla: sigue siendo uno, el entero.
  if (select count(*) from public.sales_day_summary where company_id = v_e and location_id = v_loc and sales_day = '2026-09-20') <> 1
     or exists (select 1 from public.sales_day_summary where company_id = v_e and location_id = v_loc and sales_day = '2026-09-20' and unit_key is not null) then
    raise exception 'PRUEBA ventas por plataforma · 2: el 20 se ha rehecho por unidades estando asentado entero.';
  end if;
  raise notice 'PRUEBA ventas por plataforma · 2: Glovo · Casa Lola propuesto por marca, Uber sin 430 dicho, el 20 sin tocar.';
end $$;

-- ── 3 · Otra pasada: nada dos veces ────────────────────────────────────────
do $$
declare
  v_e uuid := current_setting('prueba.empresa')::uuid;
  v_antes int; v jsonb;
begin
  select count(*) into v_antes from public.journal_entry where company_id = v_e;
  v := public.conta_proponer_dias(v_e, timestamptz '2026-09-23 10:00+02');
  if (select count(*) from public.journal_entry where company_id = v_e) <> v_antes or (v->>'asientos_por_unidad')::int <> 0 then
    raise exception 'PRUEBA ventas por plataforma · 3: la segunda pasada ha propuesto algo: %', v;
  end if;
  raise notice 'PRUEBA ventas por plataforma · 3: la segunda pasada no duplica.';
end $$;

-- ── 4 · El front de antes recibe el porqué ─────────────────────────────────
do $$
declare
  v_e   uuid := current_setting('prueba.empresa')::uuid;
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_ok  boolean := false;
begin
  begin
    perform public._journal_entry_proponer(v_e, jsonb_build_object('series', 1, 'fecha', '2026-09-22', 'concepto', 'Ventas del día', 'source_type', 'sales_day', 'confianza', 'seguro', 'porque', 'x'),
                                           '[]'::jsonb, jsonb_build_object('location_id', v_loc, 'sales_day', '2026-09-22'), 'Prueba', null);
  exception when others then
    v_ok := sqlerrm like 'Las ventas se asientan ahora por plataforma%';
  end;
  if not v_ok then raise exception 'PRUEBA ventas por plataforma · 4: el día entero sin unidad no se ha negado con su porqué.'; end if;
  raise notice 'PRUEBA ventas por plataforma · 4: el día entero, negado con su porqué.';
end $$;

-- ── 5 · Descartar una unidad no descarta el día ────────────────────────────
do $$
declare
  v_e   uuid := current_setting('prueba.empresa')::uuid;
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_marca constant uuid := '7e000000-0000-4000-8000-000000000b01';
  v_glovo constant uuid := 'e0200000-0000-4000-8000-00000000a0c1';
  v_id  uuid; v jsonb; v_dias int;
begin
  select e.id into v_id from public.journal_entry e join public.sales_day_summary s on s.entry_id = e.id
   where s.company_id = v_e and s.sales_day = '2026-09-21' and s.unit_key = v_glovo || ':' || v_marca;
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  v := public.journal_entry_descartar(v_id, 'prueba: lo lleva otro', 'Prueba');
  if v->>'clave' <> v_loc || ':2026-09-21:' || v_glovo || ':' || v_marca then
    raise exception 'PRUEBA ventas por plataforma · 5: la clave del descarte no es la de la unidad: %', v;
  end if;
  v := public.conta_proponer_dias(v_e, timestamptz '2026-09-23 10:00+02');
  if (v->>'asientos_por_unidad')::int <> 0 then raise exception 'PRUEBA ventas por plataforma · 5: la unidad descartada ha vuelto: %', v; end if;
  raise notice 'PRUEBA ventas por plataforma · 5: el descarte es de la unidad.';
end $$;

rollback;
