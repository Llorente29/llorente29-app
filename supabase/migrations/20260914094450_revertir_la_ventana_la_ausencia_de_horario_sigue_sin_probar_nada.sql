-- ═══════════════════════════════════════════════════════════════════════════
-- REVERTIR LA VENTANA · LA AUSENCIA DE HORARIO SIGUE SIN PROBAR NADA
-- 14/09/2026, 11:44 (reloj de la base)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Deshace la migración 20260914094339, aplicada 71 segundos antes.
--
-- ── LO QUE ESCRIBÍ Y ERA FALSO ────────────────────────────────────────────
--
-- Dentro de la propia función puse: «No era un hueco: era el dia de cierre.
-- Julio lo confirma: los lunes en Alcala no se trabaja».
--
-- Medido después, en `sale`, últimos 70 días, Foodint Alcalá: 487 ventas en
-- los DIEZ lunes, uno por semana. Alcalá ABRE los lunes. Lo de hoy es una
-- excepción de un día que dijo Julio, no un patrón semanal.
--
-- O sea que leí una ausencia de datos como una intención, que es exactamente
-- el error que la regla original estaba puesta para evitar. Y el 13/09 yo
-- mismo había llamado bien a ese hueco en Plaza Castilla; lo que nadie vio es
-- que Alcalá tiene el mismo hueco y Alcalá sí opera.
--
-- ── Y EL FALLO NO ERA SÓLO DE PREMISA: ERA DE DIRECCIÓN ───────────────────
--
-- Mi argumento para quitar el freno fue que el resto del sistema ya lee «sin
-- fila = cerrado» (`is_brand_open` arranca en false, y
-- `availability_location_open_minutes` hace JOIN por día). Eso es cierto, y
-- sigue siéndolo. Lo que no vi es que LA DIRECCIÓN SEGURA NO ES LA MISMA:
--
--   · En `is_brand_open`, «sin declarar = cerrado» falla del lado bueno:
--     dejas de coger pedidos que quizá no puedes cocinar.
--   · En la ventana de mantenimiento, «cerrado» significa ventana LIBRE, y eso
--     falla del lado malo: empujas un paquete a las tablets en pleno servicio.
--
-- Con mi cambio puesto, el lunes 21 --Alcalá abierto y sin lunes declarado--
-- las dos tablets se habrían actualizado a cualquier hora de la comida. La
-- regla original deja las tablets sin actualizar los lunes, que es un fallo de
-- verdad y hay que arreglarlo, pero se aguanta hasta el martes. El otro rompe
-- un servicio.
--
-- La duda va a favor de esperar. Se vuelve a poner tal cual estaba.
--
-- ── LO QUE SÍ HAY QUE ARREGLAR, Y NO ES ESTO ──────────────────────────────
--
-- El hueco es de DATOS: a `business_hours` le falta el lunes de Alcalá. Se
-- arregla metiendo el horario, y el horario LO DA JULIO: no se deduce de los
-- martes. Va al parte como pregunta abierta, antes del lunes 21.
--
-- Y lo que ese hueco rompía, medido y no supuesto:
--   · `ingesta_silencio_watchdog` hace `CONTINUE WHEN NOT is_brand_open(...)`,
--     o sea que SE SALTA EL LOCAL ENTERO cuando cree que está cerrado.
--     Comprobado: `is_brand_open(Alcalá, lunes 07/09 21:00)` = false, y ese
--     lunes Alcalá hizo 45 ventas. El martes a la misma hora = true.
--     Diez lunes ciegos sobre el local que más vende.
--   · `kds_device_silence_check` y `kds_device_stale_bundle_check` NO leen el
--     horario: ésos no están afectados (medido).
--
-- ── LA BANDA ──────────────────────────────────────────────────────────────
-- `create or replace` de una función STABLE. No toma cierre sobre ninguna
-- tabla. Aplicada a las 11:44, fuera de la banda por delante.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._ventana_de_mantenimiento(
  p_location_id uuid, p_margen_min integer DEFAULT 45)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
declare
  v_margen      interval := make_interval(mins => greatest(0, coalesce(p_margen_min, 45)));
  v_ahora       timestamp;   -- hora de Madrid, sin zona (regla 4: se convierte ANTES)
  v_hoy         date;
  v_filas_hoy   integer := 0;
  v_en_servicio boolean := false;
  v_hasta       timestamp;
begin
  v_ahora := now() at time zone 'Europe/Madrid';
  v_hoy   := v_ahora::date;

  select count(*) into v_filas_hoy
    from business_hours bh
   where bh.location_id = p_location_id
     and bh.brand_id is null
     and bh.weekday = extract(dow from v_hoy)::smallint;

  -- Un día sin horario declarado NO es un día libre: la ausencia de un dato no
  -- prueba que el local cierre. La duda va siempre a favor de esperar.
  --
  -- (14/09: esto se quitó por la mañana creyendo que la ausencia declaraba el
  -- cierre, y se volvió a poner el mismo día. Alcalá vendió 487 veces en diez
  -- lunes sin tener el lunes declarado: la ausencia no probaba nada, y aquí
  -- equivocarse significa actualizar una tablet en mitad del servicio.)
  if v_filas_hoy = 0 then
    return jsonb_build_object(
      'en_ventana', false, 'motivo', 'sin_horario_declarado_hoy',
      'hasta', null, 'margen_minutos', extract(epoch from v_margen)::int / 60);
  end if;

  -- Se miran AYER, HOY y MAÑANA porque los márgenes cruzan la medianoche: el de
  -- después del último tramo de ayer entra en la madrugada de hoy.
  with dias as (
    select generate_series(v_hoy - 1, v_hoy + 1, interval '1 day')::date as d
  ),
  tramos as (
    select
      (d.d + bh.open_time) - v_margen as empieza,
      (case when bh.close_time <= bh.open_time
            then d.d + bh.close_time + interval '1 day'
            else d.d + bh.close_time
       end) + v_margen                as termina
    from dias d
    join business_hours bh
      on bh.location_id = p_location_id
     and bh.brand_id is null
     and bh.weekday = extract(dow from d.d)::smallint
  )
  select coalesce(bool_or(v_ahora >= t.empieza and v_ahora < t.termina), false),
         min(t.empieza) filter (where t.empieza > v_ahora)
    into v_en_servicio, v_hasta
    from tramos t;

  return jsonb_build_object(
    'en_ventana',     not v_en_servicio,
    'motivo',         case when v_en_servicio then 'servicio_o_margen' else null end,
    'hasta',          case when v_en_servicio then null else v_hasta end,
    'margen_minutos', extract(epoch from v_margen)::int / 60);
end;
$fn$;
