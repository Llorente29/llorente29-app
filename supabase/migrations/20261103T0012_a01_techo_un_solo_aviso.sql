-- cambia: public._aviso_poner_en_cola · prueba: supabase/staging/sql/20261103_a01_techo_un_solo_aviso_prueba.sql
--
-- supabase/migrations/20261103T0012_a01_techo_un_solo_aviso.sql
--
-- A01 · El techo, un solo aviso al día (03/11/2026). Arreglo del #450.
-- El 02/11 a las 22:30 UTC salieron DOS «Techo de avisos alcanzado» (ids 1430 y
-- 1431, con 39 ms entre los dos): dos vigías (ingesta y Last) corrieron a la vez,
-- cada uno en su transacción, y ninguno vio el aviso de techo del otro porque
-- aún no estaba confirmado.
--
-- Arreglo: con el techo lleno, _aviso_poner_en_cola toma un candado de la
-- transacción (pg_advisory_xact_lock(4101, 1)) ANTES de mirar si ya salió el
-- aviso de techo. El segundo espera a que el primero confirme, y su consulta
-- (otra foto, en read committed) ya lo ve: no lo repite. El candado solo se
-- toma con el techo lleno: el camino normal de un aviso no espera nunca.
-- Lo demás, byte a byte.
--
-- Guarda: la función tiene que ser la del #450 (md5 5364a265…, igual en
-- producción y en staging). Se respalda antes. El analizador dice «sigue»; a
-- encolar_alerta la llega a llamar algún disparador de ventas, y por eso el real
-- va fuera del servicio (Julio).
--
-- Vuelta atrás: supabase/vuelta-atras/20261103T0012_a01_techo_un_solo_aviso.down.sql

do $guarda$
begin
  if md5(pg_get_functiondef('public._aviso_poner_en_cola(text,text,text,text,uuid,uuid,uuid,text,integer)'::regprocedure)) <> '5364a26541a548d77af951331245f694' then
    raise exception 'A01 techo PARADA: _aviso_poner_en_cola no es la del #450 (md5 5364a265…). Reescribirla pisaría ese cambio.';
  end if;
end $guarda$;

select public._respaldar_funcion('public._aviso_poner_en_cola(text,text,text,text,uuid,uuid,uuid,text,integer)', '20261103T0012_a01_techo_un_solo_aviso');

CREATE OR REPLACE FUNCTION public._aviso_poner_en_cola(p_kind text, p_subject text, p_message text, p_debounce_kind text, p_account_id uuid, p_location_id uuid, p_brand_id uuid, p_severity text, p_rango integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  k_techo constant integer := 10;
  v_hoy timestamptz := (date_trunc('day', now() at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid';
  v_id bigint;
begin
  if p_rango < 3 and (select count(*) from public.system_alert_queue
                       where created_at >= v_hoy and public._aviso_rango(severity, debounce_kind) < 3
                         and debounce_kind is distinct from 'aviso-techo-diario') >= k_techo then
    insert into public.aviso_callado (kind, subject, message, debounce_kind, account_id, location_id, brand_id, severity, motivo)
    values (p_kind, p_subject, p_message, p_debounce_kind, p_account_id, p_location_id, p_brand_id, p_severity, 'techo diario');
    -- A01 (03/11): dos vigías a la vez mandaban dos avisos de techo. Con el
    -- candado, el segundo espera al primero y ya ve el suyo.
    perform pg_advisory_xact_lock(4101, 1);
    if not exists (select 1 from public.system_alert_queue
                    where debounce_kind = 'aviso-techo-diario' and created_at >= v_hoy) then
      insert into public.system_alert_queue (kind, subject, message, debounce_kind, severity)
      values ('aviso-techo', 'Techo de avisos alcanzado: hoy ya van ' || k_techo,
              'Hoy ya han salido ' || k_techo || ' avisos. Hasta mañana solo salen los críticos; los demás se guardan '
              || 'sin mandar en aviso_callado (empezando por: ' || coalesce(p_subject, p_kind) || ').',
              'aviso-techo-diario', 'aviso');
    end if;
    return null;
  end if;
  insert into public.system_alert_queue (kind, subject, message, debounce_kind, account_id, location_id, brand_id, severity)
  values (p_kind, p_subject, p_message, p_debounce_kind, p_account_id, p_location_id, p_brand_id, p_severity)
  returning id into v_id;
  return v_id;
end $function$;
