-- supabase/migrations/20261027T1112_l00_origen_del_fichaje.sql
--
-- L00 · Laboral, fase L0 · punto 4: la etiqueta del origen del fichaje.
--
-- Hasta hoy buildClockEntry (src/services/fichajeKiosko.ts) escribía siempre
-- source = 'kiosko', también cuando se fichaba desde el móvil del trabajador.
-- Desde este cambio el front guarda el origen real:
--   'movil'  — el portal del trabajador, en su propio móvil;
--   'tablet' — la pantalla de kiosko, en la tablet del local.
-- 'kiosko' deja de escribirse y se queda con lo que significaba en las filas
-- antiguas: «tablet o móvil, sin distinguir». Las filas antiguas NO se tocan.
--
-- Dos cosas en la base, y ninguna toca datos:
--
--   1. clock_entries_source_check admite 'tablet' (solo amplía: lo que pasaba
--      antes sigue pasando). Se quita y se vuelve a poner con el mismo nombre.
--      clock_entries tiene ~2.200 filas: revisarlas es inmediato.
--
--   2. tg_clock_entry_debounce (el freno del doble toque: dos fichajes del
--      mismo empleado a menos de 60 s) solo frenaba source = 'kiosko'. Con el
--      móvil escribiendo 'movil', el móvil se quedaría sin freno. Pasa a frenar
--      'kiosko', 'movil' y 'tablet' (todo menos 'manual', como hasta hoy).
--      Misma firma, el resto del texto igual que en producción.
--
-- Orden: esta migración se aplica ANTES de que el front llegue a producción
-- (se ensaya y se aplica desde la rama, antes de fusionar). Con la base nueva y
-- el front viejo no cambia nada: el front viejo sigue escribiendo 'kiosko'.
-- Con el front nuevo y la base vieja, el CHECK rechazaría 'tablet': por eso va
-- primero la base.
--
-- clock_entries no está en el camino del pedido.
--
-- cambia: public.clock_entries · prueba: supabase/staging/sql/20261027_l00_origen_del_fichaje_prueba.sql
-- cambia: public.tg_clock_entry_debounce · prueba: supabase/staging/sql/20261027_l00_origen_del_fichaje_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261027T1112_l00_origen_del_fichaje.down.sql

-- 1 · El CHECK admite 'tablet'.
alter table public.clock_entries drop constraint clock_entries_source_check;
alter table public.clock_entries add constraint clock_entries_source_check
  check (source = any (array['kiosko'::text, 'movil'::text, 'tablet'::text, 'manual'::text]));

-- 2 · El freno del doble toque, también para el móvil y la tablet.
select public._respaldar_funcion('public.tg_clock_entry_debounce()', '20261027T1112_l00_origen_del_fichaje');

create or replace function public.tg_clock_entry_debounce()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if coalesce(new.source,'kiosko') in ('kiosko','movil','tablet') then
    if exists (
      select 1 from public.clock_entries c
      where c.employee_id = new.employee_id
        and coalesce(c.voided,false) = false
        and abs(extract(epoch from (
              coalesce(c.real_datetime,c.datetime) - coalesce(new.real_datetime,new.datetime)
            ))) < 60
    ) then
      raise exception 'DOBLE_FICHAJE_MUY_RAPIDO'
        using hint = 'Ya se registró un fichaje hace unos segundos.';
    end if;
  end if;
  return new;
end $function$;

comment on constraint clock_entries_source_check on public.clock_entries is
  'L00 (27/10/2026). movil = portal del trabajador; tablet = kiosko del local; manual = puesto a mano; kiosko = filas anteriores al 27/10/2026, tablet o móvil sin distinguir.';
