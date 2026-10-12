-- supabase/staging/sql/20261019_cierre_a_las_dos_ensayo.sql
--
-- SOLO STAGING. El ENSAYO de 20261019T0170 y 0175 antes del real: los dos
-- ficheros enteros y la prueba (20261019_cierre_a_las_dos_prueba.sql) dentro
-- de UNA transacción que acaba en ROLLBACK. Va primero en el manifiesto: si
-- falla, el real no se aplica. Generado copiando los ficheros tal cual.

begin;
-- C04b · Respuesta 4 · El día se cierra a las 2:00 (Julio, 12/10).
--
-- cambia: public.conta_ultimo_dia_cerrado · prueba: supabase/staging/sql/20261019_cierre_a_las_dos_prueba.sql
-- cambia: public.conta_cerrar_dias · prueba: supabase/staging/sql/20261019_cierre_a_las_dos_prueba.sql
-- cambia: public.conta_propuestos_antes_del_cierre · prueba: supabase/staging/sql/20261019_cierre_a_las_dos_prueba.sql
-- cambia: public.company_tax_profile · prueba: supabase/staging/sql/20261019_cierre_a_las_dos_prueba.sql
--
-- POR QUÉ: «Los cierres diarios pasan a las 02:00 (hora de Madrid), para que
-- entren todas las ventas del día.» El día D se cierra a las 2:00 del día
-- D + 1, también con el cambio de hora.
--
-- LO QUE CAMBIA (solo la hora DE SERIE; la de cada empresa es su ajuste, y
-- la de Foodint, que hoy guarda 06:00, la pasa a 02:00 la 0175):
--   1. company_tax_profile.sales_day_close_time: el valor de serie pasa de
--      06:00 a 02:00 (solo el DEFAULT: ninguna fila cambia aquí).
--   2. conta_ultimo_dia_cerrado y conta_cerrar_dias: cuando la empresa no
--      tiene hora, 02:00 en vez de 06:00. Lo demás, copiado de lo vigente
--      (md5 7d029e66… y b9ced117…, iguales en staging y producción el 12/10).
--   3. conta_propuestos_antes_del_cierre: «propuesto antes del cierre de su
--      día» deja de calcular el instante de cierre a mano y pregunta lo mismo
--      que el cierre: ¿estaba ya cerrado ese día cuando se propuso?
--      (conta_ultimo_dia_cerrado en el instante de la propuesta). Con las 6:00
--      daba igual; con las 2:00, NO: la noche del 25/10 las 2:00 pasan dos
--      veces, y «D + 1 a las 2:00 en Madrid» lo lee Postgres como la SEGUNDA
--      (hora de invierno), una hora DESPUÉS de que el cierre ya hubiera
--      cerrado el día con la primera. Un asiento propuesto en esa hora se
--      habría dado por «propuesto antes del cierre» sin serlo. Así, las dos
--      preguntas son la misma y no pueden discrepar.
--
-- No cambia: el cron (cada hora, a los 7 minutos: el día de ayer se cierra a
-- las 2:07 de Madrid), el proponedor (pregunta a conta_ultimo_dia_cerrado),
-- el agente «día cerrado sin resumen o sin asiento a las 24 h» (lee la hora
-- de la empresa) ni el día de cada pedido (el natural de sold_at en Madrid).
-- Vuelta atrás: supabase/vuelta-atras/20261019T0170_cierre_a_las_dos.down.sql

-- 1 · La hora de serie ----------------------------------------------------------------
alter table public.company_tax_profile alter column sales_day_close_time set default '02:00';
comment on column public.company_tax_profile.sales_day_close_time is
  'Cierre del día: a esta hora (de Madrid) se dan por terminadas las ventas del día anterior. Un pedido de marca propia que siga abierto se cierra como no confirmado. Vacío = 2:00.';

-- 2 · El último día cerrado --------------------------------------------------------------
create or replace function public.conta_ultimo_dia_cerrado(p_company uuid, p_ahora timestamp with time zone default now())
 returns date
 language sql
 stable
 set search_path to 'public'
as $function$
  select case when (p_ahora at time zone 'Europe/Madrid')::time >= coalesce(t.sales_day_close_time, time '02:00')
              then (p_ahora at time zone 'Europe/Madrid')::date - 1
              else (p_ahora at time zone 'Europe/Madrid')::date - 2 end
    from public.company c
    left join public.company_tax_profile t on t.company_id = c.id
   where c.id = p_company
$function$;
comment on function public.conta_ultimo_dia_cerrado(uuid, timestamptz) is
  'Cierre del día: el último día ya cerrado de la empresa a esta hora (Madrid). A las 17:16 del 09/10 con cierre a las 2:00 → 08/10; a las 1:30 del 09/10 → 07/10.';

-- 3 · El cierre de una empresa ---------------------------------------------------------
create or replace function public.conta_cerrar_dias(p_company uuid, p_ahora timestamp with time zone default now())
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_account uuid;
  v_hora    time;
  v_hasta   date;
  v_n       int;
  v_importe numeric;
begin
  select c.account_id, coalesce(t.sales_day_close_time, time '02:00')
    into v_account, v_hora
    from public.company c left join public.company_tax_profile t on t.company_id = c.id
   where c.id = p_company;
  if v_account is null then
    raise exception 'Cierre del día: la empresa % no existe.', p_company;
  end if;
  v_hasta := public.conta_ultimo_dia_cerrado(p_company, p_ahora);

  with cand as (
    -- skip locked: un pedido que en este mismo instante está moviendo la
    -- plataforma no se pisa; lo coge la pasada de la hora siguiente.
    select s.id from public.sale s
     where s.id in (select x.sale_id from public.conta_por_cerrar(p_company, p_ahora) x)
       and s.status = 'open'
     for update of s skip locked
  ),
  cerrados as (
    update public.sale s
       set status = 'cancelled',
           unconfirmed_at = now(),
           cancelled_at = now(),
           cancel_reason = format('No confirmado por la plataforma al cierre del día (%s)', to_char(v_hora, 'FMHH24:MI')),
           updated_at = now()
      from cand
     where s.id = cand.id
    returning s.id, s.account_id, s.location_id, (s.sold_at at time zone 'Europe/Madrid')::date as dia,
              coalesce(s.platform_order_code, s.pos_short_code, s.external_ref) as codigo, s.total, s.order_status, s.delivery_state
  ),
  rastro as (
    insert into public.sales_day_close_log
      (account_id, company_id, sale_id, location_id, sales_day, closed_through, close_time, order_code, total, order_status, delivery_state)
    select account_id, p_company, id, location_id, dia, v_hasta, v_hora, codigo, total, order_status, delivery_state
      from cerrados
    on conflict (sale_id) do nothing
    returning total
  )
  select count(*), coalesce(sum(total), 0) into v_n, v_importe from rastro;

  return jsonb_build_object('company_id', p_company, 'cerrado_hasta', v_hasta, 'hora', to_char(v_hora, 'HH24:MI'),
                            'cerrados', v_n, 'importe', v_importe);
end
$function$;

-- 4 · Lo propuesto antes de su cierre ----------------------------------------------------
create or replace function public.conta_propuestos_antes_del_cierre(p_company uuid default null::uuid)
 returns table(entry_id uuid, company_id uuid, location_id uuid, sales_day date, created_at timestamp with time zone, status text, number integer)
 language sql
 stable
 set search_path to 'public'
as $function$
  select e.id, e.company_id, d.location_id, d.sales_day, e.created_at, e.status, e.number
    from public.journal_entry e
    join public.sales_day_summary d on d.entry_id = e.id
   where e.source_type = 'sales_day'
     and e.status = 'propuesto'
     and (p_company is null or e.company_id = p_company)
     -- Propuesto cuando su día aún no estaba cerrado: la MISMA pregunta que
     -- hace el cierre (también la noche en que las 2:00 pasan dos veces).
     and public.conta_ultimo_dia_cerrado(e.company_id, e.created_at) < d.sales_day
$function$;

-- ============================================================================
-- C04b · Respuesta 4 · DATOS: Foodint cierra el día a las 2:00
-- ----------------------------------------------------------------------------
-- Decidido por Julio (12/10): «Los cierres diarios pasan a las 02:00 (hora de
-- Madrid), para que entren todas las ventas del día.»
--
-- La 0170 cambia la hora DE SERIE. La de Foodint está GUARDADA en su ficha
-- fiscal (company_tax_profile.sales_day_close_time = 06:00, medido en
-- producción el 12/10, solo lectura: es la única empresa de producción), así
-- que la de serie no la mueve: hay que cambiar esa fila.
--
-- Anclado por id y cuenta (regla 9). PARA, sin cambiar nada, si la empresa no
-- es de la cuenta o si su hora no es 06:00 (la de serie de antes): otra hora
-- sería una decisión de alguien y no se pisa a escondidas. Si ya es 02:00, no
-- hace nada y lo dice. En una base sin Foodint (staging) no hace nada y lo
-- dice.
--
-- Es lo mismo que hace «Hora de cierre del día» en Ajustes › Ejercicio; se
-- escribe aquí para que quede en el historial con su huella.
--
-- Actualiza una fila que existe: va en «autorizo».
-- Vuelta atrás: supabase/vuelta-atras/20261019T0175_cierre_a_las_dos_foodint.down.sql
-- ============================================================================

do $$
declare
  v_cuenta  constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_empresa constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_hora time;
begin
  if not exists (select 1 from public.company where id = v_empresa) then
    raise notice 'cierre a las 2:00: esta base no tiene Foodint. No se cambia nada.';
    return;
  end if;
  if not exists (select 1 from public.company where id = v_empresa and account_id = v_cuenta) then
    raise exception 'cierre a las 2:00: la empresa % no es de la cuenta %.', v_empresa, v_cuenta;
  end if;
  select sales_day_close_time into v_hora from public.company_tax_profile where company_id = v_empresa;
  if not found then
    raise exception 'cierre a las 2:00: Foodint no tiene ficha fiscal. No se cambia nada.';
  end if;
  if v_hora = time '02:00' then
    raise notice 'cierre a las 2:00: Foodint ya cierra a las 2:00. No se cambia nada.';
    return;
  end if;
  if v_hora is distinct from time '06:00' then
    raise exception 'cierre a las 2:00: Foodint tiene guardada otra hora (%), no la de serie de antes. No se pisa.', v_hora;
  end if;
  update public.company_tax_profile set sales_day_close_time = time '02:00' where company_id = v_empresa;
  raise notice 'cierre a las 2:00: Foodint pasa de las 6:00 a las 2:00.';
end $$;

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
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, created_at)
    values (v_acc, v_e, v_y, 1, v_d, 'Ventas inventadas', 'sales_day', 'propuesto', c.creado::timestamptz) returning id into v_ent;
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
