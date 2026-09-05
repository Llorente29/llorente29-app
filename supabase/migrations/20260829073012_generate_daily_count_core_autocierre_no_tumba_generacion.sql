do $do$
declare v_def text; v_n int;
  v_old constant text := '  LOOP
    PERFORM public.autoclose_daily_count(v_stale_id);
  END LOOP;
';
  v_new constant text := '  LOOP
    -- EL AUTOCIERRE NO PUEDE TUMBAR LA GENERACION (29/08/2026).
    -- Este bucle es mantenimiento: cierra los conteos de dias anteriores que se
    -- quedaron abiertos. Generar el conteo de HOY es la tarea principal, y
    -- estaba muriendo aqui: autoclose_daily_count lleva guardia de sesion y
    -- pg_cron no tiene usuario, asi que el cron reventaba ANTES de generar nada
    -- y el conteo del dia solo aparecia cuando alguien abria la pantalla.
    --
    -- Se aisla el fallo: si no se puede cerrar un rezagado, se avisa y se sigue.
    -- El aviso va a system_alert, NO a un `raise warning`: pg_cron no cuenta los
    -- warnings como fallo, y ese es exactamente el motivo de que
    -- cron_autoclose_daily_counts lleve 144 ejecuciones "correctas" sin haber
    -- asentado un solo movimiento.
    BEGIN
      PERFORM public.autoclose_daily_count(v_stale_id);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public._queue_system_alert(
        ''autoinventario'',
        ''Autoinventario: no se pudo autocerrar un conteo rezagado'',
        format(''Conteo %s del local %s: %s. El conteo de hoy SI se ha generado; ''
               ''el rezagado sigue abierto y hay que cerrarlo a mano.'',
               v_stale_id, p_location_id, sqlerrm),
        ''autoinventario_autocierre'');
    END;
  END LOOP;
';
begin
  v_def := replace(
    pg_get_functiondef('public._generate_daily_count_core(uuid,uuid,uuid[],integer,numeric,boolean)'::regprocedure),
    chr(13), '');

  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then
    raise exception 'esperaba 1 bucle de autocierre y encuentro %; abortado', v_n;
  end if;

  execute replace(v_def, v_old, v_new);
end
$do$;