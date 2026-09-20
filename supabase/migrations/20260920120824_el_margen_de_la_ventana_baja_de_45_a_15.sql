-- ---------------------------------------------------------------------------
-- EL MARGEN DE LA VENTANA OTA BAJA DE 45 A 15 MINUTOS · 20/09/2026, 12:08
-- ---------------------------------------------------------------------------
--
-- 🔴 YA APLICADA EN PRODUCCIÓN a las 12:08:24, con Julio pidiéndolo en vivo y
--    la cocina vacía. Se commitea inmediatamente después porque una corrección
--    que sólo vive en lo desplegado es una corrección con fecha de caducidad:
--    el siguiente despliegue desde el repositorio la borra sin avisar.
--
-- QUÉ CAMBIA, Y ES UN SOLO NÚMERO
--
-- `_ventana_de_mantenimiento` abre la ventana de actualización de las tablets
-- cuando el local está FUERA de su horario, con un margen antes y después.
-- Ese margen era de 45 minutos y ahora es de 15. Julio, hoy: «las tiendas
-- abren a las 13 h, así que 12:45 es perfectamente posible».
--
-- El efecto medido, sobre las tres tablets vivas, antes y después:
--
--   antes  →  en_ventana true, ventana_hasta 2026-09-20T12:15:00, margen 45
--   después → en_ventana true, ventana_hasta 2026-09-20T12:45:00, margen 15
--
-- POR QUÉ IMPORTABA HOY: el bundle 308 se subió a las 11:45:53 y la tablet
-- mira el manifiesto cada 15 minutos (`UpdateGate.tsx`, RECHECK_MS). Con la
-- ventana cerrándose a las 12:15 no daba tiempo a descubrir, descargar 5,37 MB
-- y aplicar. Con media hora más, sí.
--
-- LA SEGUNDA LLAVE NO SE TOCA. La cocina sigue teniendo que estar en calma
-- (`_cocina_en_calma`: 20 minutos sin actividad, cero pedidos vivos, cero
-- trabajos de impresión pendientes). Esto sólo mueve la PRIMERA llave, la del
-- horario. Una tablet con trabajo delante sigue sin actualizarse.
--
-- LO QUE SE PIERDE, Y SE DICE: treinta minutos de colchón antes de abrir. Si
-- alguien llega a las 12:30 a preparar y toca la tablet, la segunda llave lo
-- para igual; si no la toca, puede pillarla actualizándose. Julio conoce su
-- cocina y lo ha pedido sabiéndolo.
--
-- BANDA DE SERVICIO: aplicada a las 12:08, ANTES de las 12:15. No es una
-- excepción a la banda, es llegar antes. Medido igualmente, por si sirve de
-- precedente: la llaman tres funciones —`station_update_window`,
-- `kds_device_bundle_status` y `_servicio_del_local`—, CERO disparadores, y un
-- cron (`kds-device-silence-check`, cada 5 min) que es un vigía de tablets y
-- no el camino del pedido. `create or replace` de función no cierra ninguna
-- tabla.
--
-- VUELTA ATRÁS: cambiar los dos 15 por 45. Nada más, y sin tocar datos.
-- ---------------------------------------------------------------------------

create or replace function public._ventana_de_mantenimiento(p_location_id uuid, p_margen_min integer DEFAULT 15)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_margen      interval := make_interval(mins => greatest(0, coalesce(p_margen_min, 15)));
  v_ahora       timestamp;
  v_hoy         date;
  v_hay_hoy     boolean := false;
  v_cerrado_hoy boolean := false;
  v_en_servicio boolean := false;
  v_hasta       timestamp;
begin
  v_ahora := now() at time zone 'Europe/Madrid';
  v_hoy   := v_ahora::date;

  select exists (select 1 from business_hours_exception e
                  where e.location_id = p_location_id and e.brand_id is null
                    and e.exception_date = v_hoy),
         exists (select 1 from business_hours_exception e
                  where e.location_id = p_location_id and e.brand_id is null
                    and e.exception_date = v_hoy and e.is_closed)
    into v_hay_hoy, v_cerrado_hoy;

  if not v_hay_hoy then
    select count(*) > 0 into v_hay_hoy
      from business_hours bh
     where bh.location_id = p_location_id
       and bh.brand_id is null
       and bh.weekday = extract(dow from v_hoy)::smallint;
  end if;

  if not v_hay_hoy then
    return jsonb_build_object(
      'en_ventana', false, 'motivo', 'sin_horario_declarado_hoy',
      'hasta', null, 'hoy_cerrado_declarado', false,
      'margen_minutos', extract(epoch from v_margen)::int / 60);
  end if;

  with dias as (
    select generate_series(v_hoy - 1, v_hoy + 1, interval '1 day')::date as d
  ),
  bruto as (
    select d.d, e.open_time, e.close_time
      from dias d
      join business_hours_exception e
        on e.location_id = p_location_id and e.brand_id is null
       and e.exception_date = d.d
       and e.is_closed = false
       and e.open_time is not null and e.close_time is not null
    union all
    select d.d, bh.open_time, bh.close_time
      from dias d
      join business_hours bh
        on bh.location_id = p_location_id and bh.brand_id is null
       and bh.weekday = extract(dow from d.d)::smallint
     where not exists (select 1 from business_hours_exception e
                        where e.location_id = p_location_id and e.brand_id is null
                          and e.exception_date = d.d)
  ),
  tramos as (
    select
      (b.d + b.open_time) - v_margen as empieza,
      (case when b.close_time <= b.open_time
            then b.d + b.close_time + interval '1 day'
            else b.d + b.close_time
       end) + v_margen               as termina
    from bruto b
  )
  select coalesce(bool_or(v_ahora >= t.empieza and v_ahora < t.termina), false),
         min(t.empieza) filter (where t.empieza > v_ahora)
    into v_en_servicio, v_hasta
    from tramos t;

  return jsonb_build_object(
    'en_ventana',     not v_en_servicio,
    'motivo',         case when v_en_servicio then 'servicio_o_margen' else null end,
    'hasta',          case when v_en_servicio then null else v_hasta end,
    'hoy_cerrado_declarado', v_cerrado_hoy,
    'margen_minutos', extract(epoch from v_margen)::int / 60);
end;
$function$;
