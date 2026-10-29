-- supabase/migrations/20261029T0730_l1a_cerrar_escritura_directa.sql
--
-- L1a · PR 2b («Cerrar»), primer fichero (29/10/2026). Es la 0700 que salió
-- del PR 2 (respuesta 5 de Julio, 28/10), sin cambios: su cerrojo esperaba 24 h
-- sin fichajes por la vía antigua, y ya se cumplen (medido en producción el
-- 29/10 a las 07:22 UTC: el último fichaje sin distance_m, o sea por el INSERT
-- directo, fue el 27/10 a las 23:11 UTC; el cerrojo cuenta 0 en 24 h).
--
--   1. clock_entries, sin escritura directa: ni INSERT, ni UPDATE, ni DELETE
--      para authenticated ni anon, y fuera sus tres políticas. Fichar es
--      fichar(); corregir, las funciones de corrección (con motivo y rastro).
--      Antes, el administrador podía cambiar una marca sin motivo («edición
--      directa») o borrarla: la original no se borra nunca (encargo L1a).
--      Las funciones security definer y la conservación siguen escribiendo.
--   2. export_gestoria_mensual leía el DNI con los permisos de quien llama:
--      pasa a security definer, con guarda de administrador. El cuerpo es el
--      de producción (29/10, huella 152170ea), de sql a plpgsql por la guarda.
--
-- CERROJO. Si en las últimas 24 h ha entrado algún fichaje por el INSERT
-- directo (un móvil o una tablet con el front de antes), PARA: quitar el INSERT
-- dejaría a esa persona sin fichar. Lo dice el rastro: fichar() deja su «create»
-- con «Fichaje propio desde el móvil» o «Fichaje en la tablet»; el INSERT
-- directo, con lo que pone el disparador de alta de la 1215.
--
-- Front: ni src ni las funciones de borde escriben en clock_entries con la
-- sesión (medido el 29/10: 0 insert/update/delete/upsert desde src; las de
-- borde usan la llave de servicio).
--
-- cambia: public.clock_entries · prueba: supabase/staging/sql/20261029_l1a_cerrar_prueba.sql
-- cambia: public.export_gestoria_mensual · prueba: supabase/staging/sql/20261029_l1a_cerrar_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261029T0730_l1a_cerrar_escritura_directa.down.sql

-- ── 0 · El cerrojo ─────────────────────────────────────────────────────────
do $$
declare n int; ultimo timestamptz;
begin
  select count(*), max(a.created_at) into n, ultimo
    from public.clock_entry_audit a
   where a.action = 'create'
     and a.created_at > now() - interval '24 hours'
     and a.actor_user_id is not null
     and coalesce(a.reason, '') not like 'Fichaje propio desde el móvil%'
     and coalesce(a.reason, '') not like 'Fichaje en la tablet%';
  if n > 0 then
    raise exception 'Hay % fichajes por el INSERT directo en las últimas 24 h (el último, %): aún hay móviles o tablets con el front de antes. Quitar el INSERT los dejaría sin fichar.', n, ultimo
      using errcode = 'P0001', hint = 'Espera a que pasen 24 h sin ninguno (que todo el mundo fiche por fichar()) y vuelve a lanzarlo.';
  end if;
end $$;

-- ── 1 · clock_entries, sin escritura directa ───────────────────────────────
drop policy if exists clock_entries_insert on public.clock_entries;
drop policy if exists clock_entries_modify on public.clock_entries;
drop policy if exists clock_entries_delete on public.clock_entries;
revoke insert, update, delete, truncate on public.clock_entries from authenticated, anon;

-- ── 2 · export_gestoria_mensual, de servidor y solo para el administrador ──
select public._respaldar_funcion('public.export_gestoria_mensual(uuid,date,date)', '20261029T0730_l1a_cerrar_escritura_directa');

create or replace function public.export_gestoria_mensual(p_account uuid, p_from date, p_to date)
 returns table(empleado text, dni text, local text, dias_trabajados integer, horas_trabajadas numeric, horas_nocturnas numeric, dias_vacaciones integer, dias_baja integer, dias_festivo_trabajado integer, horas_contratadas numeric, delta_horas numeric, incidencias text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  -- Lleva el DNI y lo manda a la gestoría: solo el administrador de la cuenta.
  if not public.current_user_is_admin_of(p_account) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', hint = 'El resumen para la gestoría solo lo saca el administrador.';
  end if;
  return query
  select e.name, e.dni, l.name,
    t.dias_trabajados, t.horas_trabajadas, t.horas_nocturnas,
    t.dias_vacaciones, t.dias_baja, t.dias_festivo_trabajado,
    t.horas_contratadas, t.delta_horas,
    nullif(concat_ws(' · ',
      case when e.dni is null or e.dni = '' then 'SIN DNI' end,
      case when t.horas_pausa = 0 and t.horas_trabajadas > 0 then 'sin descansos registrados' end,
      case when abs(t.delta_horas) > 20 then 'desvío de '||round(t.delta_horas,1)||' h sobre contrato' end,
      case when exists (
        select 1 from public.registro_jornada_mensual(e.id, p_from, p_to) r
        where r.salida is not null
          and extract(hour from (r.salida at time zone 'Europe/Madrid')) between 4 and 10
      ) then 'posible fichaje de salida olvidado' end
    ), '')
  from public.employees e
  join public.locations l on l.id = e.location_id
  cross join lateral public.registro_jornada_totales(e.id, p_from, p_to) t
  where e.account_id = p_account and e.active
  order by e.name;
end $function$;
