-- supabase/vuelta-atras/20261027T1112_l00_origen_del_fichaje.down.sql
--
-- Vuelta atrás de 20261027T1112_l00_origen_del_fichaje (L00).
--   · tg_clock_entry_debounce vuelve a ser EXACTAMENTE la de antes: se ejecuta
--     el texto que la migración guardó en funcion_respaldo, y
--     _restaurar_funcion comprueba la huella.
--   · clock_entries_source_check vuelve a no admitir 'tablet'.
-- PARA si ya hay algún fichaje con source = 'tablet': quitar 'tablet' del CHECK
-- obligaría a reescribir el origen de marcas del registro de jornada, y eso no
-- se hace a ciegas. Entonces se deja como está y se decide a mano.
-- Un solo bloque: el freno y lo que quita, juntos (si para, no quita nada).
-- OJO: con el front nuevo publicado, quitar 'tablet' hace que la pantalla de
-- kiosko no pueda fichar. Primero se devuelve el front.

do $$
begin
  if exists (select 1 from public.clock_entries where source = 'tablet') then
    raise exception 'L00 · vuelta atrás: hay fichajes con origen tablet. No se quita del CHECK.';
  end if;
  perform public._restaurar_funcion('public.tg_clock_entry_debounce()', '20261027T1112_l00_origen_del_fichaje');
  alter table public.clock_entries drop constraint clock_entries_source_check;
  alter table public.clock_entries add constraint clock_entries_source_check
    check (source = any (array['kiosko'::text, 'movil'::text, 'manual'::text]));
end $$;
