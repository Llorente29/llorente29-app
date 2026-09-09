-- ══════════════════════════════════════════════════════════════════════════
-- Estándar de alertas · paso 1 — el local deja de ser texto y pasa a ser CAMPO
-- ══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ SIN APLICAR. Nombre provisional: se renombra a la versión que registre la
-- base (regla 17). Transaccional: o entra entera o no entra, y su propia
-- verificación la aborta si algo no cuadra.
--
-- ── LO QUE HACE ───────────────────────────────────────────────────────────
-- 1. `system_alert_queue` gana `account_id`, `location_id`, `brand_id` y
--    `severity`. Nullables: hay avisos de cuenta (`edge_drift`, `db-health`) y
--    hay 76 filas vivas que no los tienen.
-- 2. Función NUEVA `encolar_alerta(...)` con esos campos.
-- 3. `_queue_system_alert` NO se toca por fuera: conserva su firma exacta y
--    pasa a ser un envoltorio de una línea sobre la nueva. Una sola puerta de
--    entrada desde el primer día, y los 16 llamadores siguen funcionando sin
--    que nadie los toque.
--
-- ── POR QUÉ UN ENVOLTORIO Y NO AMPLIAR LA FUNCIÓN (regla 2) ───────────────
-- Ampliar los argumentos de `_queue_system_alert` es EXACTAMENTE lo que el
-- 27/08 dejó a los siete vigías sin poder encolar: `CREATE OR REPLACE` con otra
-- firma no reemplaza, crea una SOBRECARGA, y las llamadas viejas se vuelven
-- ambiguas (`ERROR 42725 … is not unique`). Hoy hay MÁS que perder: 16 funciones
-- y 24 puntos de llamada.
--
-- Aquí `_queue_system_alert` se reemplaza con LA MISMA firma —mismos 5
-- argumentos, mismos tipos, mismo `returns void`— así que no hay sobrecarga
-- posible. Y con LOS MISMOS VALORES POR DEFECTO, que es el detalle que se
-- escapa: hoy son `p_debounce_kind default null` y **`p_debounce_window default
-- interval '20:00:00'`**. Ese 20 horas NO es NULL. Un envoltorio que lo
-- defaulteara a NULL dejaría sin antirruido a todas las llamadas de 3 y 4
-- argumentos, y el síntoma no sería un error: sería correo repetido. Va escrito
-- porque es la clase de detalle que sólo se ve mirando `proargdefaults`.
--
-- ── LOS 16 LLAMADORES, MEDIDOS (24 puntos de llamada) ─────────────────────
--   db_health_watchdog (6) · db_health_stale_devices_report (2)
--   db_health_writer_regression_check (2) · edge_drift_salud_watchdog (2)
--   ingesta_silencio_watchdog (2) · _generate_daily_count_core (1)
--   codigo_plataforma_watchdog (1) · db_health_connection_guard (1)
--   edge_drift_watchdog (1) · hubrise_order_stuck_watchdog (1)
--   kds_device_silence_check (1) · kds_device_stale_bundle_check (1)
--   modifier_zero_cost_watchdog (1) · sale_line_cost_sweep (1)
--   sales_unmapped_watchdog (1) · system_alert_queue_drain (1, su meta-aviso)
-- Más una edge function, `availability-watchdog`, que lo llama por RPC.
-- Ninguno se toca en esta migración: migran de uno en uno (§7.5 del encargo).
--
-- ── BARRIDO DE LECTORES DE LA TABLA (regla 32) ────────────────────────────
-- Tres, y ninguno se rompe al añadir columnas nullables:
--   · `system_alert_queue_drain` — `select *` a un record y usa campos por
--     nombre. Añadir columnas no le afecta.
--   · `hubrise_ops_dashboard` — sólo un `count(*)` filtrado por kind y fecha.
--   · `_queue_system_alert` — `exists(...)` por `debounce_kind`.
-- En `src/`: ninguno. La tabla tiene RLS activo y CERO políticas, y ni `anon`
-- ni `authenticated` pueden leerla — es de `service_role`. No hay pantalla que
-- romper.
--
-- ── LO QUE ESTA MIGRACIÓN NO HACE, A PROPÓSITO ────────────────────────────
-- · No compone asunto ni cuerpo: eso es el paso 4 (plantilla única en el
--   drenaje). Aquí `subject` y `message` los sigue escribiendo cada vigía.
-- · No rellena los campos de las 76 filas vivas. No se puede saber de qué local
--   hablaban: es texto libre. Se quedan en NULL, que es la verdad.
-- · No migra ningún vigía. Eso es el paso 3 (`ingesta_silencio`) y el 5.
-- · No toca el drenaje ni la edge del correo.
--
-- ── SOBRE `severity` NULL, QUE NO ES 'info' ───────────────────────────────
-- Los 16 llamadores viejos no declaran severidad, así que sus avisos entran con
-- `severity` NULL. Cuando el paso 4 use la severidad para decidir qué
-- interrumpe de madrugada, **NULL tiene que tratarse como alto**, no como bajo:
-- «no lo sé» no es «no importa». Tratar lo no declarado como poco importante
-- silenciaría 24 puntos de llamada de golpe y sin que nadie se entere — que es
-- la regla 7 al revés, y el fallo más caro que puede tener un canal de alertas.
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Los campos ─────────────────────────────────────────────────────────
alter table public.system_alert_queue
  add column if not exists account_id  uuid,
  add column if not exists location_id uuid,
  add column if not exists brand_id    uuid,
  add column if not exists severity    text;

-- FKs con `on delete set null`: la cola no puede impedir borrar un local, y un
-- aviso huérfano sigue siendo mejor que un borrado bloqueado.
do $fk$
begin
  if not exists (select 1 from pg_constraint where conname = 'system_alert_queue_account_fk') then
    alter table public.system_alert_queue
      add constraint system_alert_queue_account_fk
      foreign key (account_id) references public.accounts(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'system_alert_queue_location_fk') then
    alter table public.system_alert_queue
      add constraint system_alert_queue_location_fk
      foreign key (location_id) references public.locations(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'system_alert_queue_brand_fk') then
    alter table public.system_alert_queue
      add constraint system_alert_queue_brand_fk
      foreign key (brand_id) references public.brand(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'system_alert_queue_severity_chk') then
    alter table public.system_alert_queue
      add constraint system_alert_queue_severity_chk
      check (severity is null or severity in ('critico','alto','aviso','info'));
  end if;
end;
$fk$;

comment on column public.system_alert_queue.account_id  is
  'Negocio del que habla el aviso. NULL = aviso de sistema, no de una cuenta.';
comment on column public.system_alert_queue.location_id is
  'Local del que habla el aviso. NULL = el hecho no es de un local. Si el hecho SÍ es de un local y esto viene NULL, es un bug (regla 7).';
comment on column public.system_alert_queue.brand_id    is
  'Marca del que habla el aviso, si aplica.';
comment on column public.system_alert_queue.severity    is
  'critico | alto | aviso | info. NULL = no declarada (llamador aún sin migrar): se trata como ALTO, nunca como bajo.';

-- ── 2. La puerta de entrada nueva ─────────────────────────────────────────
create or replace function public.encolar_alerta(
  p_kind            text,
  p_subject         text,
  p_message         text,
  p_debounce_kind   text     default null,
  p_debounce_window interval default null,
  p_account_id      uuid     default null,
  p_location_id     uuid     default null,
  p_brand_id        uuid     default null,
  p_severity        text     default null
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $encolar$
DECLARE
  v_id bigint;
BEGIN
  -- El antirruido, igual que antes. Devuelve NULL cuando NO encola, para que
  -- el llamador pueda distinguir «encolado» de «callado a propósito». La vieja
  -- devolvía void y las dos cosas se veían igual desde fuera.
  IF p_debounce_kind IS NOT NULL THEN
    -- 1) Ya hay uno pendiente con esta clave: no apilar.
    IF EXISTS (
      SELECT 1 FROM public.system_alert_queue
       WHERE debounce_kind = p_debounce_kind AND status = 'pending'
    ) THEN
      RETURN NULL;
    END IF;

    -- 2) Ya se encoló uno con esta clave dentro de la ventana: no repetir.
    IF p_debounce_window IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.system_alert_queue
       WHERE debounce_kind = p_debounce_kind
         AND created_at > now() - p_debounce_window
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO public.system_alert_queue
    (kind, subject, message, debounce_kind, account_id, location_id, brand_id, severity)
  VALUES
    (p_kind, p_subject, p_message, p_debounce_kind,
     p_account_id, p_location_id, p_brand_id, p_severity)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$encolar$;

-- ── 3. La vieja, MISMA FIRMA y MISMOS VALORES POR DEFECTO ────────────────
-- Sin esto no hay una sola puerta de entrada, y con la firma cambiada habría
-- dos funciones. Los defaults son los que tiene hoy, leídos de
-- `pg_get_expr(proargdefaults)`: NULL::text, '20:00:00'::interval.
create or replace function public._queue_system_alert(
  p_kind            text,
  p_subject         text,
  p_message         text,
  p_debounce_kind   text     default null,
  p_debounce_window interval default '20:00:00'::interval
) returns void
language plpgsql
security definer
set search_path to 'public'
as $vieja$
BEGIN
  -- Envoltorio. Los campos nuevos van NULL a propósito: este llamador no los
  -- sabe, y NULL es la verdad. `severity` NULL se trata como alto aguas abajo.
  PERFORM public.encolar_alerta(
    p_kind            => p_kind,
    p_subject         => p_subject,
    p_message         => p_message,
    p_debounce_kind   => p_debounce_kind,
    p_debounce_window => p_debounce_window,
    p_account_id      => NULL,
    p_location_id     => NULL,
    p_brand_id        => NULL,
    p_severity        => NULL
  );
END;
$vieja$;

-- ── 4. Permisos ───────────────────────────────────────────────────────────
-- `ALTER DEFAULT PRIVILEGES` de este proyecto concede EXECUTE a anon y
-- authenticated en cada función nueva de `public`, así que la nueva NACE
-- ABIERTA. Se cierra aquí. Y se revoca de PUBLIC además de los nombres: la
-- entrada del ACL con el concedido vacío es PUBLIC, y PUBLIC incluye a anon.
revoke execute on function
  public.encolar_alerta(text, text, text, text, interval, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.encolar_alerta(text, text, text, text, interval, uuid, uuid, uuid, text)
  to service_role;

-- La vieja ya estaba cerrada (anon no, authenticated no, service_role sí).
-- `CREATE OR REPLACE` conserva el ACL, pero se reafirma por si acaso.
revoke execute on function
  public._queue_system_alert(text, text, text, text, interval)
  from public, anon, authenticated;
grant execute on function
  public._queue_system_alert(text, text, text, text, interval)
  to service_role;

-- ── 5. Verificación DENTRO de la transacción: si miente, no entra ─────────
-- Incluye la prueba que faltó el 27/08: llamar a la función vieja con las
-- MISMAS formas que usan los 16 llamadores (3, 4 y 5 argumentos) y comprobar
-- que la fila aparece. Aquello se detectó por probar justo después de aplicar;
-- esto lo prueba ANTES de que la transacción confirme.
DO $verifica$
DECLARE
  v_clave  text := 'prueba-migracion-' || gen_random_uuid()::text;
  v_id     bigint;
  v_n      integer;
  v_oid    oid;
BEGIN
  -- 5.1 Las columnas existen
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='system_alert_queue'
         AND column_name IN ('account_id','location_id','brand_id','severity')) <> 4 THEN
    RAISE EXCEPTION 'faltan columnas en system_alert_queue';
  END IF;

  -- 5.2 Una sola firma de cada función (regla 2: nada de sobrecargas)
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='_queue_system_alert') <> 1 THEN
    RAISE EXCEPTION '_queue_system_alert tiene mas de una firma: se ha creado una sobrecarga (regla 2)';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='encolar_alerta') <> 1 THEN
    RAISE EXCEPTION 'encolar_alerta tiene mas de una firma';
  END IF;

  -- 5.3 La vieja conserva sus 5 argumentos, sus 2 defaults y su void
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_queue_system_alert';
  IF (SELECT pronargs FROM pg_proc WHERE oid=v_oid) <> 5
     OR (SELECT pronargdefaults FROM pg_proc WHERE oid=v_oid) <> 2
     OR pg_get_function_result(v_oid) <> 'void' THEN
    RAISE EXCEPTION '_queue_system_alert ha cambiado de forma: % args, % defaults, devuelve %',
      (SELECT pronargs FROM pg_proc WHERE oid=v_oid),
      (SELECT pronargdefaults FROM pg_proc WHERE oid=v_oid),
      pg_get_function_result(v_oid);
  END IF;
  IF pg_get_expr((SELECT proargdefaults FROM pg_proc WHERE oid=v_oid), 0)
     <> 'NULL::text, ''20:00:00''::interval' THEN
    RAISE EXCEPTION 'los valores por defecto de _queue_system_alert han cambiado: % (el de la ventana tiene que seguir siendo 20 h)',
      pg_get_expr((SELECT proargdefaults FROM pg_proc WHERE oid=v_oid), 0);
  END IF;

  -- 5.4 LA PRUEBA DEL 27/08: las tres formas de llamada que existen ahí fuera
  PERFORM public._queue_system_alert('prueba', 'asunto 3 args', 'cuerpo');
  PERFORM public._queue_system_alert('prueba', 'asunto 4 args', 'cuerpo', v_clave || '-a');
  PERFORM public._queue_system_alert('prueba', 'asunto 5 args', 'cuerpo', v_clave || '-b', interval '1 hour');
  SELECT count(*) INTO v_n FROM public.system_alert_queue WHERE kind='prueba';
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'la funcion vieja no encola: esperaba 3 filas de prueba y hay %', v_n;
  END IF;

  -- 5.5 La nueva encola CON los campos, y devuelve el id
  SELECT public.encolar_alerta(
    'prueba', 'asunto con campos', 'cuerpo',
    v_clave || '-c', interval '1 hour',
    (SELECT id FROM public.accounts ORDER BY name LIMIT 1),
    (SELECT id FROM public.locations ORDER BY name LIMIT 1),
    NULL, 'aviso') INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'encolar_alerta no ha encolado nada';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.system_alert_queue
                  WHERE id=v_id AND account_id IS NOT NULL AND location_id IS NOT NULL
                    AND severity='aviso') THEN
    RAISE EXCEPTION 'encolar_alerta no ha guardado los campos estructurados';
  END IF;

  -- 5.6 El antirruido sigue funcionando: la misma clave dentro de la ventana calla
  IF public.encolar_alerta('prueba','repetida','cuerpo', v_clave || '-c', interval '1 hour') IS NOT NULL THEN
    RAISE EXCEPTION 'el antirruido no funciona: ha encolado dos veces la misma clave';
  END IF;

  -- 5.7 La severidad inventada no entra
  BEGIN
    PERFORM public.encolar_alerta('prueba','severidad mala','cuerpo', v_clave||'-d', null, null, null, null, 'urgentisimo');
    RAISE EXCEPTION 'la restriccion de severity no esta puesta: ha aceptado un valor inventado';
  EXCEPTION WHEN check_violation THEN
    NULL; -- correcto
  END;

  -- 5.8 Limpieza de las pruebas
  DELETE FROM public.system_alert_queue WHERE kind='prueba';
  IF EXISTS (SELECT 1 FROM public.system_alert_queue WHERE kind='prueba') THEN
    RAISE EXCEPTION 'han quedado filas de prueba en la cola';
  END IF;

  -- 5.9 Permisos, con la vara buena
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='encolar_alerta';
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'encolar_alerta esta abierta a anon o authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role no puede ejecutar encolar_alerta: los vigias se quedan sin encolar';
  END IF;

  RAISE NOTICE 'Alertas: campos puestos, una sola firma de cada funcion, la vieja encola con 3, 4 y 5 argumentos, el antirruido vivo y la nueva cerrada a anon.';
END;
$verifica$;

commit;

-- ══════════════════════════════════════════════════════════════════════════
-- DESPUÉS DE APLICAR — comprobar que los vigías de verdad siguen encolando.
-- No basta con la prueba de dentro: esto mira el mundo real, y hay vigías que
-- corren cada minuto, así que en 10 minutos ya hay muestra.
--
--   select kind, count(*), max(created_at at time zone 'Europe/Madrid') as ultimo
--     from public.system_alert_queue
--    where created_at > now() - interval '30 minutes'
--    group by 1 order by 2 desc;
--
-- Y que ninguna fila nueva traiga los campos a NULL por accidente cuando su
-- vigía ya esté migrado (paso 3 en adelante):
--
--   select kind, count(*) filter (where location_id is null) as sin_local, count(*)
--     from public.system_alert_queue
--    where created_at > now() - interval '7 days' group by 1 order by 3 desc;
-- ══════════════════════════════════════════════════════════════════════════
