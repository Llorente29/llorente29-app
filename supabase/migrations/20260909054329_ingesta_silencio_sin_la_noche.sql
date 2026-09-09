-- ══════════════════════════════════════════════════════════════════════════
-- Vigía de silencio · que la primera pasada del día no cuente la noche
-- ══════════════════════════════════════════════════════════════════════════
--
-- ✅ APLICADA el 09/09/2026 por MCP, con Julio delante (F2). La base la
-- registró como 20260909054329 y el fichero lleva ya ese nombre (regla 17).
-- Huellas DESPUÉS de aplicar, medidas:
--   ingesta_silencio_watchdog  739aea30b0e19356c1181fb3d18af0bd  4814 chars Luz verde de Julio (08/09) para sacarlo YA,
-- aparte del estándar de alertas.
--
-- ── EL FALLO, MEDIDO ──────────────────────────────────────────────────────
--
-- `ingesta_silencio_watchdog` corre cada 10 minutos y no hace nada fuera de
-- la franja fija 12:00–23:59 (Madrid). A las 12:00 en punto, la PRIMERA pasada
-- del día mide el silencio desde la última venta —que es de la madrugada— y
-- avisa de que ha pasado la noche. Todos los días. En los últimos 30:
--
--   03/09 12:00  ALTO: NO ENTRAN PEDIDOS desde hace 665 min   (última: 00:55)
--   04/09 12:00  ALTO: NO ENTRAN PEDIDOS desde hace 665 min   (última: 00:55)
--   05/09 12:00  ALTO: NO ENTRAN PEDIDOS desde hace 665 min   (última: 00:55)
--   06/09 12:00  ALTO: NO ENTRAN PEDIDOS desde hace 670 min   (última: 00:50)
--   07/09 12:00  ALTO: NO ENTRAN PEDIDOS desde hace 666 min   (última: 00:54)
--
-- No es que falle al comprobar algo: FABRICA una alerta falsa cada mañana a la
-- misma hora. Y un vigía que miente puntualmente todos los días enseña a no
-- leerlo — que es exactamente lo que pasó («ya las elimino sin mirar»).
--
-- ── EL ARREGLO, Y SÓLO ÉSE ────────────────────────────────────────────────
--
-- El silencio se cuenta desde el más tardío de: la última venta, o la apertura
-- de la franja de hoy (12:00 Madrid). O sea: no se cuenta lo que pasó fuera de
-- la ventana en la que este vigía mira.
--
--   v_mudo := ... (now() - GREATEST(v_ultima, v_apertura)) ...
--
-- A las 12:00 da 0 y calla. A las 13:05 con la mañana entera muda da 65 y
-- avisa — que es correcto: 65 minutos de servicio sin un pedido SÍ es algo.
-- No silencia ningún caso real; sólo deja de contar la noche.
--
-- ── LOS DOS LADOS, CON LA MISMA VARA (regla 31) ───────────────────────────
--
-- Sobre los 43 avisos de `ingesta_silencio` de 30 días con minutos legibles en
-- el asunto, reconstruyendo para cada uno la hora de su última venta:
--
--   siguen saltando ..... 38
--   dejan de saltar ......  5   (11,6 %)
--
-- Y los 5 se listan uno a uno arriba: son EXACTAMENTE los cinco de las 12:00.
-- Ni un aviso legítimo se pierde.
--
-- ── LO QUE ESTE PARCHE NO HACE, A PROPÓSITO ───────────────────────────────
--
--   · NO toca la franja fija 12–23 ni la reparte por local. Eso es el estándar
--     (§2.2: disparar por la historia del local), y va en su encargo.
--   · NO toca el texto. «en pleno horario de servicio» sigue siendo un literal
--     que se afirma sin calcular — mal, y es del estándar. Se deja para no
--     mezclar dos cambios en una migración que Julio quiere poder leer entera.
--   · NO filtra por cuenta. Que Kitchen Grill LstQ deje de generar avisos es
--     también del estándar.
--
-- ── DEUDA QUE QUEDA DICHA, PORQUE SE VE DESDE AQUÍ ────────────────────────
--
-- La consulta de la última venta filtra `sold_at >= now() - interval '12 hours'`
-- y luego exige `v_ultima IS NOT NULL`. O sea: si NO hay ninguna venta en 12
-- horas, `v_ultima` es NULL y el vigía CALLA. Una caída de más de 12 horas es
-- invisible para él — hoy y antes de este parche igual. No se arregla aquí
-- (sería cambiar el comportamiento, no quitar el falso positivo), pero queda
-- anotado: es la regla 7 al revés, un silencio que esconde.
--
-- ── REGLA 2: por qué aquí CREATE OR REPLACE es lo correcto ────────────────
--
-- La regla 2 prohíbe REPLACE cuando se AÑADE UN PARÁMETRO, porque crea una
-- sobrecarga y deja las llamadas viejas ambiguas (27/08, los siete vigías sin
-- poder encolar). Aquí la firma NO cambia: mismos tres argumentos, mismos
-- tipos, mismos DEFAULT, mismo tipo de retorno. Sólo cambia el cuerpo, así que
-- REPLACE sustituye en su sitio y no puede crear una segunda firma.
-- Se conservan `SECURITY DEFINER` y `SET search_path TO 'public'`, que la
-- función viva tiene y perder cualquiera de los dos sería una regresión.
--
-- ── CÓMO VERIFICAR DESPUÉS (pegar el resultado, no el resumen — regla 5) ──
--
--   select md5(prosrc), length(prosrc) from pg_proc p
--     join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='ingesta_silencio_watchdog';
--   -- antes:    312d553b6a9f637f9193dde48456f8bc / 3878 chars
--   -- despues:  739aea30b0e19356c1181fb3d18af0bd / 4814 chars
--
-- ── QUE ESTO CAMBIA SOLO LO QUE DICE, DEMOSTRADO ─────────────────────────
--
-- No es una afirmacion: se ha medido. Tomando el cuerpo de ESTE fichero y
-- deshaciendo los TRES cambios (la declaracion de `v_apertura`, su asignacion,
-- y los dos GREATEST con sus comentarios), lo que queda son 3878 caracteres
-- con md5 312d553b6a9f637f9193dde48456f8bc — byte a byte el cuerpo vivo.
-- O sea que entre el vivo y este fichero no hay ni una diferencia mas que las
-- tres dichas. Si alguien anade algo aqui, que repita la cuenta.
--
--   -- Y mañana, la comprobación de verdad: que a las 12:00 no haya aviso.
--   select to_char(created_at at time zone 'Europe/Madrid','YYYY-MM-DD HH24:MI'),
--          subject
--     from system_alert_queue
--    where kind='ingesta_silencio' and created_at > now() - interval '2 days'
--    order by created_at desc;
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ── Guarda: que el cuerpo vivo sea EL QUE SE LEYÓ ─────────────────────────
-- Si alguien tocó la función después del 08/09 (y la regla 1 dice que eso pasa:
-- correcciones que viven sólo en el desplegado), este REPLACE se la llevaría
-- por delante sin avisar. Con la huella delante, aborta.
do $guarda$
declare
  v_md5   text;
  v_chars integer;
  v_args  text;
begin
  select md5(p.prosrc), length(p.prosrc), pg_get_function_identity_arguments(p.oid)
    into v_md5, v_chars, v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ingesta_silencio_watchdog';

  if v_md5 is null then
    raise exception 'ABORTA: public.ingesta_silencio_watchdog no existe. Nada que reemplazar.';
  end if;

  if v_args is distinct from 'p_min_punta integer, p_min_valle integer, p_debounce_window interval' then
    raise exception 'ABORTA: la firma viva es «%» y no la esperada. Con otra firma esto CREARÍA UNA SOBRECARGA (regla 2), no un reemplazo.', v_args;
  end if;

  if v_md5 <> '312d553b6a9f637f9193dde48456f8bc' then
    raise exception 'ABORTA: el cuerpo vivo (md5 %, % chars) no es el que se leyó el 08/09 (312d553b6a9f637f9193dde48456f8bc, 3878 chars). Alguien lo cambió: hay que releerlo antes de reemplazarlo.', v_md5, v_chars;
  end if;

  raise notice 'Guarda OK: firma y cuerpo son los leídos el 08/09 (% chars).', v_chars;
end
$guarda$;

-- ── La función, con el único cambio: GREATEST(v_ultima, v_apertura) ───────
create or replace function public.ingesta_silencio_watchdog(
  p_min_punta integer default 30,
  p_min_valle integer default 60,
  p_debounce_window interval default '02:00:00'::interval
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  a record; v_n integer := 0;
  v_hora integer; v_umbral integer; v_sev text;
  v_ultima timestamptz; v_mudo integer;
  v_dominante text; v_pct numeric; v_ultima_dom timestamptz; v_mudo_dom integer;
  -- NUEVO (08/09): la apertura de la franja de HOY, en hora de Madrid.
  v_apertura timestamptz;
BEGIN
  v_hora := extract(hour from (now() at time zone 'Europe/Madrid'));

  -- Fuera de horario de servicio no se avisa: a las 04:00 no entrar pedidos es
  -- lo correcto, no una averia.
  IF v_hora < 12 OR v_hora > 23 THEN
    RETURN 0;
  END IF;

  -- NUEVO (08/09): las 12:00 de hoy, hora de Madrid, como timestamptz.
  -- Por el IF de arriba, aqui siempre se cumple now() >= v_apertura, asi que
  -- los minutos calculados con GREATEST nunca salen negativos.
  v_apertura := (date_trunc('day', now() at time zone 'Europe/Madrid')
                 + interval '12 hours') at time zone 'Europe/Madrid';

  IF v_hora >= 20 THEN
    v_umbral := greatest(coalesce(p_min_punta,30), 5);
    v_sev := 'CRITICO';
  ELSE
    v_umbral := greatest(coalesce(p_min_valle,60), 5);
    v_sev := 'ALTO';
  END IF;

  FOR a IN
    SELECT DISTINCT s.account_id
      FROM public.sale s
     WHERE s.sold_at >= now() - interval '7 days'
  LOOP
    -- ── 1) TODO CALLADO ───────────────────────────────────────────────────
    SELECT max(s.sold_at) INTO v_ultima
      FROM public.sale s
     WHERE s.account_id = a.account_id
       AND s.sold_at >= now() - interval '12 hours';

    -- CAMBIO (08/09): se cuenta desde la apertura de la franja, no desde la
    -- ultima venta de la madrugada. Sin esto, la primera pasada del dia avisa
    -- de que ha pasado la noche: 665 min a las 12:00, todos los dias.
    v_mudo := CASE WHEN v_ultima IS NULL THEN NULL
                   ELSE round(extract(epoch from (now() - greatest(v_ultima, v_apertura)))/60) END;

    IF v_ultima IS NOT NULL AND v_mudo >= v_umbral THEN
      PERFORM public._queue_system_alert(
        'ingesta_silencio',
        v_sev || ': NO ENTRAN PEDIDOS desde hace ' || v_mudo::text || ' min',
        'Ninguna venta, de ninguna plataforma, desde hace ' || v_mudo::text || ' minutos, '
          || 'en pleno horario de servicio.' || chr(10) || chr(10)
          || 'Ultimo pedido: ' || to_char(v_ultima at time zone 'Europe/Madrid', 'HH24:MI')
          || ' (hora de Madrid).' || chr(10)
          || 'Esto NO es que se venda poco: es que no llega nada. Mira si las tiendas '
          || 'siguen conectadas al POS en los paneles de Glovo y Uber, y si el POS sigue '
          || 'enviando.',
        'ingesta_silencio_' || a.account_id::text || '_' || v_sev || '_'
          || to_char(now() at time zone 'Europe/Madrid', 'YYYYMMDD'),
        p_debounce_window
      );
      v_n := v_n + 1;
      CONTINUE;  -- si no entra NADA, no tiene sentido avisar ademas por fuente
    END IF;

    -- ── 2) LA FUENTE DOMINANTE, MUDA ──────────────────────────────────────
    SELECT s.source,
           round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 1)
      INTO v_dominante, v_pct
      FROM public.sale s
     WHERE s.account_id = a.account_id
       AND s.sold_at >= now() - interval '7 days'
     GROUP BY s.source
     ORDER BY count(*) DESC
     LIMIT 1;

    CONTINUE WHEN v_dominante IS NULL OR coalesce(v_pct,0) < 60;

    SELECT max(s.sold_at) INTO v_ultima_dom
      FROM public.sale s
     WHERE s.account_id = a.account_id
       AND s.source = v_dominante
       AND s.sold_at >= now() - interval '12 hours';

    -- CAMBIO (08/09): mismo arreglo que arriba. La rama de la fuente dominante
    -- tiene el mismo fallo aunque hoy no se le haya visto disparar a las 12:00;
    -- dejar media correccion es como no hacerla.
    v_mudo_dom := CASE WHEN v_ultima_dom IS NULL THEN NULL
                       ELSE round(extract(epoch from (now() - greatest(v_ultima_dom, v_apertura)))/60) END;

    IF v_ultima_dom IS NOT NULL AND v_mudo_dom >= greatest(coalesce(p_min_valle,60), 5) THEN
      PERFORM public._queue_system_alert(
        'ingesta_silencio',
        'AVISO: ' || v_dominante || ' lleva ' || v_mudo_dom::text || ' min sin traer pedidos',
        v_dominante || ' aporta el ' || v_pct::text || ' % de los pedidos y lleva '
          || v_mudo_dom::text || ' minutos sin traer ninguno, mientras otras fuentes SI '
          || 'estan entrando.' || chr(10) || chr(10)
          || 'Ultimo pedido suyo: ' || to_char(v_ultima_dom at time zone 'Europe/Madrid', 'HH24:MI')
          || ' (hora de Madrid).' || chr(10)
          || 'Suele ser la conexion de esa via, no la cocina.',
        'ingesta_fuente_' || a.account_id::text || '_' || v_dominante || '_'
          || to_char(now() at time zone 'Europe/Madrid', 'YYYYMMDD'),
        p_debounce_window
      );
      v_n := v_n + 1;
    END IF;
  END LOOP;

  RETURN v_n;
END;
$function$;

comment on function public.ingesta_silencio_watchdog(integer, integer, interval) is
  'Vigia de silencio de ingesta. 08/09/2026: el silencio se cuenta desde la '
  'apertura de la franja (12:00 Madrid), no desde la ultima venta de la '
  'madrugada — antes fabricaba un aviso falso cada dia a las 12:00 en punto '
  '(665-670 min, cinco dias seguidos). Pendiente del estandar de alertas: '
  'repartir por local, disparar por la historia del local en vez de por la '
  'franja fija, filtrar cuentas activas y reescribir el texto.';

commit;
