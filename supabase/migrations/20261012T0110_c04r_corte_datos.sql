-- ============================================================================
-- C04 R4 · DATOS: la fecha de corte de Foodint con Diez, y lo de antes fuera
-- ----------------------------------------------------------------------------
-- Decidido por Julio (respuesta 4 del C04): hasta el 30/09/2026 inclusive
-- manda Diez (lo traerá el C04b); desde el 01/10 asienta Folvy. El ejercicio
-- 2026 queda mixto, traído de Diez hasta el 30/09.
--
-- Tres cosas, en una transacción, ancladas por id y cuenta (regla 9), nunca
-- por nombre:
--   1. fiscal_year 2026 de la empresa → origin 'mixed' (el CHECK
--      fiscal_year_origin_check admite folvy / migrated / mixed),
--      origin_program 'diez', imported_until 2026-09-30.
--   2. Los meses enteros traídos se cierran como traídos (fiscal_period_lock
--      kind 'migrated'): enero a septiembre, 9 filas. Es lo mismo que hace
--      conta_fijar_corte, escrito a mano porque el workflow no tiene usuario
--      (auth.uid() es nulo y esa función pide un administrador).
--   3. Las propuestas fechadas hasta el corte se descartan con motivo
--      «anteriores al corte», igual que journal_entry_descartar: queda la fila
--      en journal_dismissal (clave local:día para las de ventas del día) y se
--      borra la propuesta (sus apuntes se van en cascada; sales_day_summary
--      .entry_id queda a null por su clave ajena).
--
-- Medido en producción el 08/10 (solo lectura): la empresa tiene UN ejercicio,
-- 2026 (01/01–31/12), origin folvy, sin corte; 120 asientos en toda la
-- empresa, los 120 «propuesto» de ventas del día, del 21/06 al 13/08; 0
-- validados; 0 cierres de mes; 0 descartes.
--
-- PARA (y no cambia nada) si: la empresa no es de la cuenta; hay otro
-- ejercicio que empiece antes del corte; el 2026 ya tiene un corte distinto;
-- hay algún asiento traído; o hasta el corte hay CUALQUIER asiento que no sea
-- una propuesta (validado, anulado o un borrador que alguien ha tocado: eso
-- es trabajo de alguien y no se borra a escondidas).
--
-- Actualiza y borra filas que existen: va en «autorizo».
-- Vuelta atrás: supabase/vuelta-atras/20261012T0110_c04r_corte_datos.down.sql
-- ============================================================================

do $$
declare
  v_cuenta  constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_empresa constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_corte   constant date := '2026-09-30';
  v_motivo  constant text := 'anteriores al corte';
  v_quien   constant text := 'Folvy · corte con Diez (C04 R4)';
  v_fy public.fiscal_year;
  v_otros int; v_no_propuestas int; v_propuestas int; v_descartadas int := 0; v_meses int := 0;
  r record; v_clave text; m date;
begin
  if not exists (select 1 from public.company where id = v_empresa and account_id = v_cuenta) then
    raise exception 'corte: la empresa % no es de la cuenta %.', v_empresa, v_cuenta;
  end if;

  select * into v_fy from public.fiscal_year
   where company_id = v_empresa and account_id = v_cuenta and starts_on <= v_corte and ends_on > v_corte;
  if v_fy.id is null or v_fy.code <> '2026' then
    raise exception 'corte: no hay un ejercicio 2026 que contenga el %.', v_corte;
  end if;
  select count(*) into v_otros from public.fiscal_year
   where company_id = v_empresa and id <> v_fy.id and starts_on <= v_corte;
  if v_otros > 0 then
    raise exception 'corte: hay % ejercicio(s) anteriores; este fichero solo sabe del 2026. Se fija desde Ajustes.', v_otros;
  end if;
  if v_fy.imported_until is not null and v_fy.imported_until <> v_corte then
    raise exception 'corte: el 2026 ya tiene otro corte (%): no se pisa.', v_fy.imported_until;
  end if;
  if exists (select 1 from public.journal_entry where company_id = v_empresa and source_type = 'migrated') then
    raise exception 'corte: ya hay asientos traídos; el corte no se cambia.';
  end if;

  select count(*) filter (where status <> 'propuesto'), count(*) filter (where status = 'propuesto')
    into v_no_propuestas, v_propuestas
    from public.journal_entry
   where company_id = v_empresa and account_id = v_cuenta and entry_date <= v_corte;
  if v_no_propuestas > 0 then
    raise exception 'corte: hasta el % hay % asiento(s) que no son propuestas (validados, anulados o borradores): PARA, no se borra trabajo de nadie.', v_corte, v_no_propuestas;
  end if;

  -- 1 · El ejercicio, mixto hasta el corte.
  update public.fiscal_year
     set origin = 'mixed', origin_program = 'diez', imported_until = v_corte
   where id = v_fy.id;

  -- 2 · Los meses enteros traídos, cerrados como traídos (como conta_fijar_corte).
  delete from public.fiscal_period_lock where company_id = v_empresa and kind = 'migrated';
  for m in select generate_series(date_trunc('month', v_fy.starts_on), date_trunc('month', v_corte), interval '1 month')::date loop
    if (m + interval '1 month' - interval '1 day')::date <= v_corte
       and not exists (select 1 from public.fiscal_period_lock l where l.company_id = v_empresa and l.month = m and l.reopened_at is null) then
      insert into public.fiscal_period_lock (account_id, company_id, fiscal_year_id, month, kind, locked_by, locked_by_name)
      values (v_cuenta, v_empresa, v_fy.id, m, 'migrated', null, v_quien);
      v_meses := v_meses + 1;
    end if;
  end loop;

  -- 3 · Las propuestas de antes del corte, descartadas con su porqué (como journal_entry_descartar).
  for r in select e.* from public.journal_entry e
            where e.company_id = v_empresa and e.account_id = v_cuenta and e.entry_date <= v_corte and e.status = 'propuesto'
            order by e.entry_date, e.id for update loop
    if r.source_type = 'sales_day' then
      select s.location_id || ':' || s.sales_day into v_clave from public.sales_day_summary s where s.id = r.source_id;
    else
      v_clave := r.source_id::text;
    end if;
    if v_clave is not null then
      insert into public.journal_dismissal (account_id, company_id, source_type, source_key, reason, created_by, created_by_name)
      values (r.account_id, r.company_id, r.source_type, v_clave, v_motivo, null, v_quien)
      on conflict (company_id, source_type, source_key) do update set reason = excluded.reason;
    end if;
    delete from public.journal_entry where id = r.id;
    v_descartadas := v_descartadas + 1;
  end loop;

  if v_descartadas <> v_propuestas then
    raise exception 'corte: se contaron % propuestas y se descartaron %: PARA.', v_propuestas, v_descartadas;
  end if;
  if exists (select 1 from public.journal_entry where company_id = v_empresa and entry_date <= v_corte) then
    raise exception 'corte: después de descartar sigue habiendo asientos hasta el %: PARA.', v_corte;
  end if;
  raise notice 'corte: 2026 mixto hasta el %; % meses cerrados como traídos; % propuestas descartadas («%»).',
    v_corte, v_meses, v_descartadas, v_motivo;
end $$;
