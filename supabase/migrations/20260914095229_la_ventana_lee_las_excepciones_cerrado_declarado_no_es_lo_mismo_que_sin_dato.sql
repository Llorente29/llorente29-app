-- ═══════════════════════════════════════════════════════════════════════════
-- LA VENTANA LEE LAS EXCEPCIONES
-- «Cerrado declarado» y «sin dato» dejan de ser la misma cosa · 14/09/2026
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Tercer intento de esto hoy, y el bueno. Los dos anteriores están en el
-- repositorio con su error escrito (20260914094339 y su reversión 094450):
-- quité el freno de «sin dato» creyendo que una ausencia declaraba el cierre,
-- y hubo que revertirlo 71 segundos después.
--
-- ── LO QUE FALTABA NO ERA UNA REGLA: ERA MIRAR UNA TABLA ──────────────────
--
-- `business_hours_exception` existe desde antes de hoy, con `exception_date`,
-- `is_closed`, `open_time`, `close_time` y `note`, por cuenta / local / marca.
-- Y ESTÁ EN USO: 92 filas de Foodint Plaza Castilla, `is_closed = true`, nota
-- «Vacaciones», del 30/06 al 29/09, escritas el 12/07. Eso explica por qué
-- Plaza Castilla no vende desde julio: no está rota, está declarada cerrada.
--
-- La leen `is_brand_open` y `ingesta_silencio_watchdog`. NO la leía la ventana
-- de mantenimiento, que es la que decide cuándo se actualizan las tablets. El
-- mecanismo estaba, el dato estaba, y la mitad de los que dependen de él lo
-- ignoraban.
--
-- ── LOS TRES ESTADOS, QUE ANTES ERAN DOS ──────────────────────────────────
--
--   CERRADO DECLARADO  → hay excepción con `is_closed` → VENTANA LIBRE. No hay
--                        servicio que proteger, y lo sabemos porque alguien lo
--                        escribió, no porque falte un dato.
--   CON HORARIO        → excepción con horas, o el patrón semanal → se calcula
--                        como siempre, con sus 45 minutos de margen.
--   SIN DATO           → ni excepción ni patrón → SE ESPERA. La ausencia no
--                        prueba nada, y aquí equivocarse significa actualizar
--                        una tablet en mitad del servicio.
--
-- La precedencia --excepción manda sobre patrón semanal-- es la MISMA que la de
-- `is_brand_open`, copiada de allí y no inventada. Se aplica a los TRES días
-- que se miran (ayer, hoy y mañana), porque los márgenes cruzan la medianoche.
--
-- ── MEDIDO DESPUÉS DE APLICAR ─────────────────────────────────────────────
--
--   Alcalá       en_ventana true · hoy_cerrado_declarado true · hasta 15/09 12:15
--   Carabanchel  en_ventana true · hoy_cerrado_declarado false · hasta 14/09 12:15
--
-- Carabanchel, intacto: abre a las 13:00 y 45 minutos antes son las 12:15.
-- Alcalá, libre hasta el margen de mañana, que es lo que debe pasar un día que
-- el local tiene el cierre escrito.
--
-- ── LO QUE ESTO NO ARREGLA, Y SIGUE ABIERTO ───────────────────────────────
--
-- · A `business_hours` le falta el LUNES de Alcalá. Alcalá abre los lunes --487
--   ventas en los diez últimos-- y sin esa fila, el lunes 21 sus dos tablets
--   caen en «sin dato» y no se actualizan. El horario lo da Julio; no se deduce
--   de los martes.
-- · `ingesta_silencio_watchdog` se salta el local entero cuando lo cree
--   cerrado (`CONTINUE WHEN NOT is_brand_open`). Con el lunes sin declarar,
--   lleva diez lunes ciego sobre el local que más vende.
-- · Y en grande: `business_hours` sólo tiene filas de Foodint. El día que entre
--   el cliente 2, sus locales caen en «sin dato» para todo. «Sin dato» no
--   puede significar «cerrado»: significa «sin configurar», y eso se dice en el
--   alta y no calla a ningún vigía.
--
-- ── LA BANDA ──────────────────────────────────────────────────────────────
-- `create or replace` de una función STABLE. No toma cierre sobre ninguna
-- tabla. Aplicada a las 11:52, fuera de la banda por delante.
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
  v_hay_hoy     boolean := false;   -- ¿sabemos ALGO del horario de hoy?
  v_cerrado_hoy boolean := false;   -- ¿está DECLARADO que hoy no abre?
  v_en_servicio boolean := false;
  v_hasta       timestamp;
begin
  v_ahora := now() at time zone 'Europe/Madrid';
  v_hoy   := v_ahora::date;

  -- ── QUÉ SABEMOS DE HOY. Tres estados, no dos.
  --
  -- 🔴 ESTO ES LO QUE FALTABA (14/09). Antes sólo se miraba `business_hours`,
  -- el patrón semanal, y un día sin fila era «no se sabe» --que es lo correcto
  -- para un hueco de datos y lo INCORRECTO para un cierre declarado--.
  --
  -- `business_hours_exception` existe desde antes, tiene 92 filas en uso
  -- (Plaza Castilla, «Vacaciones», 30/06 a 29/09) y la leen `is_brand_open` y
  -- `ingesta_silencio_watchdog`. La ventana de las tablets NO la leía. El
  -- mecanismo estaba, el dato estaba, y la mitad de los que dependen de él lo
  -- ignoraban.
  --
  -- La precedencia es la MISMA que la de `is_brand_open`, copiada de allí y no
  -- inventada: si hay excepción para esa fecha, manda la excepción; si no,
  -- manda el patrón semanal.
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

  -- SIN DATO: se espera. La ausencia de un dato no prueba que el local cierre,
  -- y aquí equivocarse significa actualizar una tablet en mitad del servicio.
  -- (Esto se quitó por la mañana creyendo que la ausencia declaraba el cierre,
  -- y se volvió a poner el mismo día: Alcalá vendió 487 veces en diez lunes sin
  -- tener el lunes declarado.)
  if not v_hay_hoy then
    return jsonb_build_object(
      'en_ventana', false, 'motivo', 'sin_horario_declarado_hoy',
      'hasta', null, 'hoy_cerrado_declarado', false,
      'margen_minutos', extract(epoch from v_margen)::int / 60);
  end if;

  -- Se miran AYER, HOY y MAÑANA porque los márgenes cruzan la medianoche: el de
  -- después del último tramo de ayer entra en la madrugada de hoy. Cada uno de
  -- los tres días con SU horario efectivo: excepción si la hay, semanal si no.
  with dias as (
    select generate_series(v_hoy - 1, v_hoy + 1, interval '1 day')::date as d
  ),
  bruto as (
    -- De la excepción: sólo las que NO cierran y traen horas. Una excepción de
    -- cierre no aporta tramos, que es justo lo que la hace dar ventana libre.
    select d.d, e.open_time, e.close_time
      from dias d
      join business_hours_exception e
        on e.location_id = p_location_id and e.brand_id is null
       and e.exception_date = d.d
       and e.is_closed = false
       and e.open_time is not null and e.close_time is not null
    union all
    -- Del patrón semanal, SÓLO si ese día no tiene excepción.
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
    -- Para que la pantalla pueda decir «hoy no abre» en vez de un rojo de
    -- avería. Y sólo se dice cuando está DECLARADO, nunca por ausencia.
    'hoy_cerrado_declarado', v_cerrado_hoy,
    'margen_minutos', extract(epoch from v_margen)::int / 60);
end;
$fn$;
