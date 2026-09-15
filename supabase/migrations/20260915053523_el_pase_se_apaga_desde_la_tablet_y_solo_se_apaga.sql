-- ═══════════════════════════════════════════════════════════════════════════
-- EL PASE · APAGARLO DESDE LA TABLET · 15/09/2026, 07:4x de Madrid
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El respaldo del Pase no es un segundo botón de «Listo»: es `pase_activo` a
-- false, que devuelve la tablet exactamente a como estaba, con su botón en
-- «Pedidos» y sin perder un solo pedido. Eso ya estaba construido.
--
-- Lo que faltaba es que la persona del pase pueda hacerlo ELLA. Hasta ahora se
-- apagaba desde la oficina, y un respaldo que hay que pedir por teléfono a las
-- 21:00 no es un respaldo.
--
-- 🔴 ESTA FUNCIÓN SÓLO APAGA. No hay parámetro para encender, y no es una
-- omisión: encender cambia cómo trabaja el local entero y se decide con Julio
-- delante. Apagar es salir de un sitio en el que ya estás y volver al de
-- siempre. Las dos cosas no merecen la misma puerta.
--
-- Y CONFIRMA CON CONTENIDO (regla 8): devuelve el local y si ya estaba apagado,
-- para que la pantalla pueda decir «Apagado en Foodint Alcalá» y no un visto.

set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $guardia$
declare
  v_lock int := (select setting::int from pg_settings where name = 'lock_timeout');
  v_stmt int := (select setting::int from pg_settings where name = 'statement_timeout');
begin
  if v_lock <> 3000 or v_stmt <> 60000 then
    raise exception 'GUARDIA: los relojes no han prendido (lock=% ms, statement=% ms). NO SEGUIR.',
                    v_lock, v_stmt;
  end if;
end
$guardia$;

create or replace function public.pase_apagar(p_device_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_device kds_device;
  v_local  uuid;
  v_nombre text;
  v_estaba boolean;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'pase_apagar: token de dispositivo no válido';
  end if;
  v_local := v_device.location_id;

  select l.name into v_nombre from locations l
   where l.id = v_local and l.account_id = v_device.account_id;
  if v_nombre is null then
    raise exception 'pase_apagar: el aparato no corresponde a un local de su cuenta';
  end if;

  -- Se lee lo que había ANTES de escribir, para poder decir la verdad: apagar
  -- algo ya apagado no es un fallo, pero la pantalla no puede decir que ha
  -- hecho algo que no ha hecho.
  select coalesce(k.pase_activo, false) into v_estaba
    from kitchen_time_config k where k.location_id = v_local;

  update kitchen_time_config set pase_activo = false where location_id = v_local;

  return jsonb_build_object(
    'local',   v_nombre,
    'estaba',  coalesce(v_estaba, false),
    'activo',  false);
end;
$fn$;

revoke all on function public.pase_apagar(text) from public;
grant execute on function public.pase_apagar(text) to anon, authenticated, service_role;


-- ═══ EL ENSAYO · con población plantada y deshecho ═════════════════════════
do $ensayo$
declare
  ALCALA constant uuid := '38158159-cd71-4056-950b-53425afac1ce';
  v_tok text; v_r jsonb; v_fallos text[] := '{}';
begin
  select token into v_tok from kds_device
   where label = 'Pase' and location_id = ALCALA;

  begin
    -- Se enciende a propósito para tener algo que apagar: si se ensayara sobre
    -- un local ya apagado, el ensayo saldría verde sin haber apagado nada.
    -- Regla 36.
    update kitchen_time_config set pase_activo = true where location_id = ALCALA;

    v_r := public.pase_apagar(v_tok);

    if (select coalesce(pase_activo, false) from kitchen_time_config
         where location_id = ALCALA) then
      v_fallos := v_fallos || 'el interruptor sigue encendido después de apagarlo';
    end if;
    if (v_r ->> 'estaba') <> 'true' then
      v_fallos := v_fallos || 'no dice que estaba encendido, y lo estaba';
    end if;
    if nullif(trim(v_r ->> 'local'), '') is null then
      v_fallos := v_fallos || 'no devuelve el nombre del local, así que la pantalla no puede confirmar con contenido';
    end if;

    -- Apagar dos veces no revienta, y lo dice.
    v_r := public.pase_apagar(v_tok);
    if (v_r ->> 'estaba') <> 'false' then
      v_fallos := v_fallos || 'la segunda vez dice que estaba encendido';
    end if;

    -- Y NO enciende: no existe la puerta.
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'pase_apagar'
                  and p.prosrc ~ 'pase_activo[[:space:]]*=[[:space:]]*true') then
      v_fallos := v_fallos || 'la función contiene una escritura a true: puede encender';
    end if;

    raise exception 'DESHACER_ENSAYO';
  exception when others then
    if sqlerrm <> 'DESHACER_ENSAYO' then
      v_fallos := v_fallos || ('sin ensayar: ' || sqlerrm);
    end if;
  end;

  if array_length(v_fallos, 1) > 0 then
    raise exception 'ENSAYO pase_apagar: %', array_to_string(v_fallos, ' · ');
  end if;
  raise notice 'ENSAYO pase_apagar: en verde.';
end
$ensayo$;

do $guarda$
declare v_n int;
begin
  select count(*) into v_n from kitchen_time_config where coalesce(pase_activo, false);
  if v_n > 0 then
    raise exception 'GUARDA: han quedado % locales ENCENDIDOS. NO CONFIRMAR.', v_n;
  end if;
  if has_function_privilege('public', 'public.pase_apagar(text)'::regprocedure, 'EXECUTE') then
    raise exception 'GUARDA: `pase_apagar` ha quedado con PUBLIC:EXECUTE.';
  end if;
  raise notice 'GUARDA: cero locales encendidos, PUBLIC sin execute.';
end
$guarda$;
