-- ==========================================================================
-- EL VIGIA MIRA TAMBIEN LAS FICHAS A MEDIAS
--
-- Tercera pieza. Instruccion de Julio, 14:35: «antes de inventar ninguna
-- alarma: mira `modifier_zero_cost_watchdog`. Si la red ya existe, se
-- remienda; no se duplica». Existe. Esto la remienda, estrecho.
--
-- LO QUE LA RED YA COGE, y no se toca ni una letra:
--   Una opcion ACTIVA, que COBRA dinero (`price_impact > 0`) y cuyos impactos
--   confirmados suman exactamente 0 EUR. Con su trinquete por cuenta, su
--   marca sembrada la primera vez y su antirruido de 20 h.
--
-- LO QUE SE LE ESCAPABA:
--   Una ficha a medias --un `add_item` con articulo y SIN CANTIDAD-- suma
--   0 EUR, si. Pero solo entra por la puerta del dinero: si la opcion es
--   GRATIS (`price_impact = 0`), la red ni la mira. Y una respuesta gratis
--   con ficha a medias es exactamente el agujero del 13/09: cuenta como
--   decidida y descuenta cero. Dos de las que apareceron esta manana eran asi.
--
-- LO QUE **NO** SE HACE, Y ES LA MITAD IMPORTANTE:
--   NO se ensancha la puerta del dinero. Quitar `price_impact > 0` de la
--   rama vieja meteria en el aviso de «cuesta 0 EUR» a todas las respuestas
--   gratis sin escandallo, que son legion y no son una averia. La rama nueva
--   va APARTE, con su propio tipo de aviso y su propio antirruido, y se cuenta
--   aparte. Una red que avisa de todo no avisa de nada.
--
-- LA RAMA NUEVA, y por que no lleva trinquete:
--   Desde la pieza 1 de esta misma tanda, la TABLA prohibe una fila
--   confirmada incompleta. O sea que esta cifra tiene que ser CERO siempre.
--   No es un pasivo que baja poco a poco --eso pide trinquete--: es una
--   afirmacion que o se cumple o no. Si algun dia no es cero, o alguien ha
--   rodeado la tabla, o el candado se ha caido. Las dos cosas son noticia el
--   mismo dia, asi que avisa mientras haya una sola.
--
-- Medido hoy a las 19:50, tabla entera: 0 filas confirmadas incompletas.
-- O sea que esta rama nace callada, que es como tiene que nacer.
--
-- BANDA: `CREATE OR REPLACE FUNCTION` no toma ningun cierre. Va en la tanda
-- de las 23:45 porque la pieza 1 la arrastra --el mensaje del aviso habla del
-- candado-- no porque tuviera que esperar por si misma.
-- ==========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.modifier_incomplete_impact_watchdog(
  p_debounce_window interval DEFAULT '20:00:00'::interval
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
declare
  r         record;
  v_avisos  integer := 0;
  v_candado boolean;
begin
  -- ¿Sigue puesto el candado? Es la explicacion de como puede haber filas, y
  -- por eso se mira ANTES: sin el, la cifra de abajo solo dice que ya ha
  -- pasado.
  select c.convalidated into v_candado
    from pg_constraint c
   where c.conrelid = 'public.modifier_recipe_impact'::regclass
     and c.conname  = 'impacto_confirmado_completo';

  if v_candado is null or not v_candado then
    perform public._queue_system_alert(
      'ficha_a_medias_candado_caido',
      'El candado que impide fichas a medias ya no esta puesto',
      'La tabla `modifier_recipe_impact` tenia un candado --`impacto_confirmado_completo`-- '
      || 'que impedia guardar una decision confirmada que no descuenta nada: un «anade» sin '
      || 'articulo, una cantidad a cero, una ficha sin cantidad.' || chr(10) || chr(10)
      || case when v_candado is null
              then 'Ahora **no existe**.'
              else 'Ahora existe pero **no esta validado**, o sea que no dice nada de las filas que ya hay.' end
      || chr(10) || chr(10)
      || 'Mientras no este, las tres puertas de pantalla siguen preguntando, pero una escritura '
      || 'directa a la tabla puede volver a dejar respuestas que la pantalla da por decididas y '
      || 'que descuentan cero del almacen.',
      'ficha_a_medias_candado_caido_'
        || to_char(now() at time zone 'Europe/Madrid', 'YYYYMMDD'),
      p_debounce_window);
    v_avisos := v_avisos + 1;
    raise warning 'modifier_incomplete_impact_watchdog: EL CANDADO NO ESTA PUESTO.';
  end if;

  -- Y las filas, por cuenta (regla 9: una cifra sin cuenta no es de nadie).
  for r in
    select i.account_id,
           coalesce(a.name, '(cuenta sin nombre)') as cuenta,
           count(*)::int as filas,
           count(distinct i.modifier_option_id)::int as respuestas,
           count(*) filter (where coalesce(o.is_active, true))::int as vivas,
           string_agg(distinct coalesce(o.name, '(sin nombre)'), ', '
                      order by coalesce(o.name, '(sin nombre)')) as cuales
      from public.modifier_recipe_impact i
      left join public.modifier_option o on o.id = i.modifier_option_id
      left join public.accounts a on a.id = i.account_id
     where i.status = 'confirmed'
       and not public._impacto_completo(i.impact_type, i.target_recipe_item_id, i.quantity)
     group by i.account_id, a.name
  loop
    perform public._queue_system_alert(
      'modificador_ficha_a_medias',
      'Hay ' || r.respuestas::text || ' respuestas con ficha a medias en ' || r.cuenta,
      'En ' || r.cuenta || ' hay **' || r.respuestas::text || ' respuestas de modificador cuya '
      || 'ficha esta confirmada y NO DESCUENTA NADA** (' || r.vivas::text || ' de ellas siguen '
      || 'encendidas). La pantalla las da por decididas; el almacen no ve salir nada.'
      || chr(10) || chr(10)
      || 'Son: ' || r.cuales || '.' || chr(10) || chr(10)
      || 'Esto no deberia poder pasar: desde el 13/09 la propia tabla lo prohibe. Si hay filas, '
      || 'o se han escrito rodeando la tabla, o el candado se ha caido.' || chr(10) || chr(10)
      || 'Se arregla en Folvy Kitchen -> Modificadores -> la pregunta -> la respuesta, poniendo '
      || 'el articulo y la cantidad.',
      'modificador_ficha_a_medias_' || r.account_id::text || '_'
        || to_char(now() at time zone 'Europe/Madrid', 'YYYYMMDD'),
      p_debounce_window);
    v_avisos := v_avisos + 1;
    raise warning 'modifier_incomplete_impact_watchdog: % — % filas a medias en % respuestas (% vivas).',
      r.cuenta, r.filas, r.respuestas, r.vivas;
  end loop;

  if v_avisos = 0 then
    -- Un vigia que calla no se distingue de uno roto (regla 8).
    raise warning 'modifier_incomplete_impact_watchdog: candado puesto y validado, cero fichas a medias.';
  end if;

  return v_avisos;
end;
$fn$;

REVOKE ALL ON FUNCTION public.modifier_incomplete_impact_watchdog(interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.modifier_incomplete_impact_watchdog(interval) FROM anon;

-- ── Y QUE CORRA. Un vigia sin cron no es un vigia: es una funcion -------
-- Trabajo APARTE del de las 05:40, a proposito. pg_cron corre el mandato
-- entero en UNA transaccion: si se metiera junto al viejo y el nuevo fallara,
-- se llevaria por delante el trinquete que el viejo acaba de consolidar. Dos
-- trabajos, dos suertes.
SELECT cron.schedule(
  'modifier-incomplete-impact-watchdog',
  '45 5 * * *',                      -- 05:45 UTC = 07:45 de Madrid
  $cron$select public.modifier_incomplete_impact_watchdog()$cron$);

-- -- HUELLA ---------------------------------------------------------------
DO $huella$
DECLARE v_n int; v_r int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='modifier_incomplete_impact_watchdog';
  IF v_n <> 1 THEN RAISE EXCEPTION 'el vigia nuevo tiene % firmas, no 1', v_n; END IF;

  -- La rama vieja NO se ha tocado: su puerta del dinero sigue donde estaba.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='modifier_zero_cost_watchdog'
       AND p.prosrc LIKE '%coalesce(mo.price_impact, 0) > 0%'
  ) THEN
    RAISE EXCEPTION 'la puerta del dinero de la red vieja ha cambiado: eso no es lo pedido';
  END IF;

  -- Y nace callado: con el candado puesto tiene que devolver 0 avisos.
  v_r := public.modifier_incomplete_impact_watchdog();
  IF v_r <> 0 THEN
    RAISE EXCEPTION 'el vigia nuevo nace avisando % veces: hay fichas a medias o el candado no esta', v_r;
  END IF;

  -- Y que este de verdad en la agenda, activo.
  IF NOT EXISTS (SELECT 1 FROM cron.job j
                  WHERE j.jobname = 'modifier-incomplete-impact-watchdog' AND j.active) THEN
    RAISE EXCEPTION 'el vigia nuevo no ha quedado en la agenda, o ha quedado apagado';
  END IF;

  RAISE NOTICE 'vigia nuevo puesto, en la agenda, la red vieja intacta, y nace callado';
END;
$huella$;

COMMIT;
