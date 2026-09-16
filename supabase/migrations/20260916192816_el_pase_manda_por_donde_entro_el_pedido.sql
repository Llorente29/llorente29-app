-- ============================================================================
-- `pase_board` MANDA `source` · 16/09/2026
--
-- Lo necesita `sabemosSuCiclo`, que decide el grupo 1 y el grupo 2 y de ahí
-- depende media pantalla. Sin `source`, el Pase no puede distinguir un Uber por
-- HubRise --que SÍ nos dice cuándo sale: 71 de 71-- de un Uber por Last, que no
-- dice nada. El canal es el mismo en los dos y el dato está en `sale.source`.
--
-- `orders_feed` y `orders_feed_by_token` YA lo mandaban; solo faltaba aquí.
-- Comprobado antes de tocar, no supuesto.
--
-- Se inserta en el cuerpo que hay en producción, leído de pg_proc, con el ancla
-- contada: si no aparece exactamente una vez, aborta. Es una lectura: no toma
-- cierre sobre ninguna tabla.
--
-- VOLVER ATRÁS: el mismo DO quitando la clave en vez de ponerla.
--   v_src := replace(v_src, chr(10) || '           ''source'',        v.source,', '');
-- ============================================================================
do $migracion$
declare v_src text; v_n int;
begin
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='pase_board';
  if v_src is null then raise exception 'no existe pase_board'; end if;
  if position('''source'',' in v_src) > 0 then
    raise notice 'pase_board ya manda source: no se toca'; return;
  end if;

  v_n := (length(v_src) - length(replace(v_src, '''carrier_code'',  v.carrier_code,','')))
         / length('''carrier_code'',  v.carrier_code,');
  if v_n <> 1 then raise exception 'el ancla aparece % veces, esperaba 1', v_n; end if;

  v_src := replace(v_src, '''carrier_code'',  v.carrier_code,',
                          '''carrier_code'',  v.carrier_code,' || chr(10) ||
                          '           ''source'',        v.source,');

  execute format('create or replace function public.pase_board(p_device_token text) '
    || 'returns jsonb language plpgsql security definer set search_path = public as %L', v_src);
end $migracion$;
