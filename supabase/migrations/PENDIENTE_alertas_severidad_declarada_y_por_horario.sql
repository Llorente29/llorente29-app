-- ══════════════════════════════════════════════════════════════════════════
-- Estándar de alertas · la severidad deja de caer por defecto, y `db-health`
-- deja de avisar de cuentas que no operan
-- ══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ SIN APLICAR. Va DESPUÉS de `20260909145156_alertas_paso6_dbhealth_y_actividad`:
-- ancla contra el cuerpo que dejó aquélla. Nombre provisional (regla 17).
--
-- Cuatro decisiones de Julio (09/09), las cuatro en el mismo cuerpo:
--
--   1) La severidad del aviso 4 la decide el HORARIO, no una constante.
--   2) Los avisos 1 y 2 declaran la suya AHORA, no «en la pasada de severidades».
--   3) Los TRES avisos de impresión sólo miran cuentas que operan.
--   4) Los 60 minutos se quedan.
--
-- ══════════════════════════════════════════════════════════════════════════
-- 3 · LA PREGUNTA NO ERA CADA CUÁNTO REPETIR EL AVISO
-- ══════════════════════════════════════════════════════════════════════════
-- Yo pregunté si bajar el aviso 6 de 60 min a 4 h, porque con 60 min habrían
-- salido 91 correos en 19 días. Julio fue a mirar DE QUIÉN son esas filas
-- (medido a las 18:07 del 09/09, tabla entera):
--
--   Kitchen Grill LstQ ..... 98 filas ..... status = SUSPENDED
--   Folvy Interno ..........  2 filas ..... is_internal = true
--   ───────────────────────────────────────────────────────────
--   de un cliente vivo .....  0 filas
--
-- El 100 % de los avisos de impresora vienen de una cuenta suspendida o de la
-- plantilla. Preguntar por la FRECUENCIA era preguntar por la etiqueta; la
-- pregunta buena es por el ORIGEN. Ninguna ventana —ni 60 min ni 4 h ni 20 h—
-- arregla avisar de cuentas que no operan: sólo lo espacia.
--
-- Así que los 60 minutos se quedan, que es lo correcto para la impresora caída
-- de un cliente que SÍ está sirviendo, y lo que se corrige es a quién se mira.
-- Con esto Kitchen Grill deja de generar avisos HOY, sin esperar al §6b.
--
-- ── Y LA NOTICIA DE VERDAD NO SE PIERDE ─────────────────────────────────
-- «Vende con el local apagado en Folvy» sigue saliendo, porque ese bloque mira
-- APARTE y SIN filtro de cuenta, a propósito: una cuenta suspendida que sigue
-- vendiendo es justo la noticia. Filtrar allí la haría invisible. Aquí se
-- filtra porque «a este cliente no le imprime» no es noticia si el cliente no
-- opera; allí no se filtra porque «esta cuenta suspendida factura» sí lo es.
-- Es la misma pregunta —¿opera?— con dos respuestas correctas distintas, y por
-- eso van en dos sitios y no en uno.
--
-- ── UNA SOLA DEFINICIÓN DE «OPERA» ──────────────────────────────────────
-- El filtro no se copia cuatro veces: se escribe una, en `public.cuenta_opera`,
-- y la usan los tres avisos Y el bucle del vigía de silencio, que es de donde
-- sale. Copiarlo habría dejado cuatro sitios que hay que mantener en paralelo,
-- que es la misma trampa de las dos verdades que perseguimos en §6b.
--
-- En el vigía se sustituyen las tres líneas del predicado por la llamada, pero
-- SE MANTIENE el comentario largo que explica por qué el criterio es la
-- actividad y no la bandera: el comentario dice POR QUÉ, la llamada dice QUÉ.
--
-- Y el filtro va en los DOS sitios de cada aviso —la puerta (`select count(*)
-- into v_x`) y el agrupado—, no en uno: si la puerta contara más ancho que el
-- agrupado, tendríamos un `if` que se abre para no encolar nada. Es regla 31
-- literal, la misma vara a los dos lados.
--
-- ══════════════════════════════════════════════════════════════════════════
-- 1 · «CRITICO» ES UNA AFIRMACIÓN SOBRE EL RELOJ, NO SOBRE EL DATO
-- ══════════════════════════════════════════════════════════════════════════
-- `critico` quiere decir «actúa ahora». Eso sólo es cierto si el local está
-- sirviendo: tickets atascados a las 21:00 con la cocina abierta son pedidos
-- perdiéndose; el mismo dato a las 4 de la mañana no justifica despertar a
-- nadie. Así que el aviso 4 sale `critico` si `is_brand_open(local, NULL, now())`
-- y `alto` si no — con la misma función que ya usa el vigía de silencio para
-- su veto, que es justo la razón de que exista una y no dos.
--
-- Se evalúa POR FILA, dentro del `perform ... from (...)`: dos locales del
-- mismo grupo pueden estar uno abierto y otro cerrado.
--
-- ══════════════════════════════════════════════════════════════════════════
-- 2 · UN VALOR POR DEFECTO NO ES UNA DECISIÓN
-- ══════════════════════════════════════════════════════════════════════════
-- Los avisos 1 y 2 pasaban por `_queue_system_alert`, que manda `severity`
-- NULL a propósito («este llamador no los sabe, y NULL es la verdad»). Aguas
-- abajo `severidadDe` convierte NULL en `alto` y lo marca como NO declarada.
-- Es exactamente lo que nos pasó con `severity` NULL en la plantilla: el valor
-- estaba bien y nadie lo había elegido.
--
--   Aviso 1 · bloqueos sostenidos >2 min ........ critico
--   Aviso 2 · conexiones de cliente >80 % ....... alto
--
-- El 1 es `critico` porque es el patrón con el que empezó el incidente del
-- 11/08, y ahí «actúa ahora» es literal. El 2 se queda en `alto` — el mismo
-- valor al que caía — pero ahora está ESCRITO. Ése es todo el cambio, y es el
-- que hace que se pueda discutir.
--
-- NO se les pone `account_id` ni `location_id`, y no es un olvido: hablan de
-- la base de datos entera. Rellenar un campo de local con algo sería mentir
-- en un campo, que es peor que dejarlo vacío. Y por lo mismo NO se les pone
-- el filtro de cuenta: no son de ninguna cuenta.
--
-- ── Y DE PASO, UN DESAJUSTE QUE SÓLO SE VE MIRANDO LAS DOS FUNCIONES ─────
-- El código de los avisos 1 y 2 dice «no repetir en 15 minutos». Lo que hacen
-- es no repetir en VEINTE HORAS, y hacen falta las dos funciones para verlo:
--
--   · el `not exists (… db_health_alert_log … 15 minutes)` mira `sent_at`,
--     o sea cuándo se ENVIÓ, no cuándo se encoló;
--   · `_queue_system_alert` tiene `p_debounce_window default '20:00:00'`, y
--     el vigía lo llama con CUATRO argumentos, así que se lleva el defecto;
--   · `encolar_alerta` corta por esa ventana de 20 h y gana siempre, porque
--     20 h ⊃ 15 min.
--
-- Resultado: un segundo episodio de bloqueos dentro de las 20 horas siguientes
-- al primero NO avisa. Nadie escribió eso; sale de sumar dos defectos. Al pasar
-- a la puerta nueva se declara `interval '15 minutes'`, que es lo que el código
-- decía desde el principio.
--
-- Volumen, medido antes de tocar nada (09/09, 17:00 Madrid, tabla entera):
--   db-health-lock ............... 0 envíos.  Nunca ha saltado.
--   db-health-connections ........ 1 envío, el 12/08 a las 18:47 de Madrid.
--   db-health-watchdog-error ..... 0 envíos.
-- Así que bajar la ventana de 20 h a 15 min no cambia el ruido de hoy: cambia
-- lo que pasará el día que haya dos episodios seguidos.
--
-- ══════════════════════════════════════════════════════════════════════════
-- EL ENSAYO, Y EL ANTES/DESPUÉS CON LA MISMA VARA
-- ══════════════════════════════════════════════════════════════════════════
-- Copias de usar y tirar, sin SECURITY DEFINER, con las dos puertas de
-- encolado y `cuenta_opera` sustituidas por sellos que escriben en una tabla:
-- cero efectos sobre la cola real. Construidas con los SEIS bloques byte a
-- byte de este fichero — comprobado contra el ensayo, no supuesto:
--
--   aviso 1 ...... 1.733 chars · 1b21cfd67e070c0330b2946e71622285
--   aviso 2 ...... 1.070 chars · dc352f19d397a689a95a98251b6dbd8d
--   aviso 4 ...... 2.942 chars · ac0260b5cdd0ad3602fe2c7831bd8181
--   aviso 5 ...... 2.165 chars · 382e68cb6f492ef26c0ea06dcc54f464
--   aviso 6 ...... 2.080 chars · 6a73cbe28670724706aaaeb6a6d973f9
--   vigía WHERE ...... 44 chars · 59939e4649ab3b74970658d8dcd1d451
--
-- **Cuerpos que producen:**
--   db_health_watchdog ........ 11.588 chars · 6addfeec6c5014615d88de41c64f151a
--   ingesta_silencio_watchdog . 12.626 chars · 4dace4648ef7320ffa92061e0adbabfc
-- Con 6 llamadas a `cuenta_opera` en el primero (puerta y agrupado de los tres
-- avisos) y 1 en el segundo. Si al aplicar sale otro md5, algo cambió.
--
-- ── EL ANTES Y EL DESPUÉS, MEDIDOS IGUAL ────────────────────────────────
-- La población real de los avisos 4 y 5 es CERO (no hay ni un `print_job` en
-- pending >2h ni nada encolado a impresora inactiva), así que correr las copias
-- tal cual no probaba nada. Se ensanchó SÓLO el predicado —el mismo ensanche a
-- los dos lados— y se corrieron las dos versiones seguidas:
--
--   ANTES (cuerpo vivo, forzado) ................................ 8 avisos
--     aviso 4 ... Alcalá, Carabanchel, Plaza Castilla ....... Foodint
--     aviso 5 ... Alcalá, Carabanchel, Plaza Castilla ....... Foodint
--     aviso 6 ... Kitchen Grill LstQ ........................ SUSPENDIDA
--     aviso 6 ... Foodint Alcalá ............................ PLANTILLA
--
--   DESPUÉS (cuerpo nuevo, forzado igual) ....................... 6 avisos
--     aviso 4 ... Alcalá, Carabanchel, Plaza Castilla ....... Foodint
--     aviso 5 ... Alcalá, Carabanchel, Plaza Castilla ....... Foodint
--     aviso 6 ... (ninguno)
--
-- Desaparecen DOS, y son exactamente los dos que no debían estar: la cuenta
-- suspendida y la plantilla. Los seis que quedan son todos de Foodint. No se
-- pierde ni uno de cliente vivo, porque no había ninguno.
--
-- ── Y EL VIGÍA DE SILENCIO, IGUAL ANTES Y DESPUÉS ───────────────────────
-- Corridos los dos cuerpos seguidos: los dos devuelven 0 avisos de silencio
-- (los locales están abiertos y vendiendo) y los dos sacan
-- «Vende con el local apagado en Folvy: 1 local(es)».
--
-- Eso es lo que había que comprobar: que meter `cuenta_opera` en el BUCLE no se
-- lleva por delante el aviso de la cuenta suspendida, que se calcula APARTE.
-- Si ese aviso hubiera desaparecido, el filtro se habría colado donde no va —
-- y hay una guarda abajo que aborta la migración si alguien lo mete ahí.
--
-- ── LA SEVERIDAD DEL AVISO 4, PROBADA POR LOS DOS LADOS ─────────────────
-- En el ensayo salió `alto` en los tres locales, porque era la tarde y a esa
-- hora no hay servicio. Un solo lado no prueba una condición, así que se
-- evaluó la misma expresión a cuatro horas del mismo día:
--
--   local                    04:00   14:00   18:00   21:00
--   Foodint Alcalá ......... alto   critico  alto   critico
--   Foodint Carabanchel .... alto   critico  alto   critico
--   Foodint Plaza Castilla . alto    alto    alto    alto
--
-- Los horarios de hoy explican las tres filas: Alcalá abre 13–16 y 20–23,
-- Carabanchel 13–15 y 20–23, y Plaza Castilla NO ABRE HOY — cero horas. La
-- regla distingue las tres cosas que tenía que distinguir: hora de servicio,
-- hueco entre servicios, y local que hoy no sirve. El hueco de la tarde es
-- justo el caso que la hace útil: a las 18:00 el dato es idéntico al de las
-- 21:00 y la urgencia no lo es.
--
-- ── RASTRO DEL ENSAYO, QUE TAMBIÉN SE DICE ──────────────────────────────
-- Las copias ejecutan el cuerpo entero, así que cada pasada insertó una fila
-- en `db_health_snapshot_log` y corrió sus dos purgas — exactamente lo que hace
-- el cron cada tick; se borran solas a las 48 h. Los objetos `zz_ensayo_*`
-- quedan borrados (comprobado: 0), `cuenta_opera` NO existe todavía en la base
-- (comprobado: 0) y `db_health_watchdog` sigue vivo e intacto en
-- c14fdaf3b7025f70e306e68bff35800f.
--
-- ══════════════════════════════════════════════════════════════════════════
-- LO QUE NO ENTRA, Y POR QUÉ SE DICE
-- ══════════════════════════════════════════════════════════════════════════
-- El MANEJADOR DE EXCEPCIONES del final sigue en `_queue_system_alert`, o sea
-- sin severidad declarada y con la misma ventana de 20 h. No es despiste: ése
-- es el aviso de «el vigía se ha caído», y va en el paso 7 con su hermano — el
-- vigía del vigía —, no suelto aquí. Queda escrito para que no se dé por hecho
-- que en este cuerpo ya no queda nada por declarar: queda uno.
--
-- Tampoco lleva filtro de cuenta, y es correcto: si el vigía se cae, se cae
-- para todos.
--
-- ── LAS FIRMAS NO CAMBIAN (regla 2) ──────────────────────────────────────
--   `db_health_watchdog()` ............... sin argumentos, `void`, una firma
--   `ingesta_silencio_watchdog(int,int,interval)` ... defaults 30, 60, '02:00:00'
-- Las dos por ANCLA sobre el cuerpo vivo. `cuenta_opera` es NUEVA, así que no
-- hay firma vieja que romper. El cuerpo vivo de `db_health_watchdog` sigue sin
-- estar en el repo (deuda de regla 1, anotada en
-- `docs/DEUDA_cuerpos_vivos_fuera_del_repo_20260909.md`).
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ── 0. Una sola definición de «esta cuenta opera» ─────────────────────────
-- Sale del bucle de `ingesta_silencio_watchdog`, que es donde se escribió
-- primero y donde se razonó (09/09). Se extrae aquí para que la usen también
-- los tres avisos de impresión, en vez de copiarla cuatro veces.
--
-- Las cuatro condiciones, y ninguna es decorativa:
--   is_internal IS NOT TRUE .... la plantilla del sistema no es un cliente
--   status = 'active' .......... el estado declarado manda
--   suspended_at IS NULL ....... suspensión = decisión con fecha y motivo
--   archived_at / deleted_at ... lo mismo, hacia el final del ciclo
--
-- Con `p_account_id` NULL devuelve FALSE, que es la dirección segura: una fila
-- sin cuenta no se puede afirmar que opere.
create or replace function public.cuenta_opera(p_account_id uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $cuenta_opera$
  select exists (
    select 1
      from public.accounts a
     where a.id = p_account_id
       and a.is_internal is not true
       and a.status = 'active'
       and a.suspended_at is null
       and a.archived_at is null
       and a.deleted_at is null
  );
$cuenta_opera$;

revoke execute on function public.cuenta_opera(uuid) from public, anon, authenticated;

comment on function public.cuenta_opera(uuid) is
  'TRUE si la cuenta es de un cliente que opera: no interna, status active, sin '
  'suspender/archivar/borrar. Definición única — la usan db_health_watchdog e '
  'ingesta_silencio_watchdog. NULL devuelve FALSE.';

-- ── 1. Aviso 1 · bloqueos sostenidos → critico, declarado ─────────────────────
DO $ancla1$
DECLARE
  v_def   text;
  v_viejo text := $viejo$    -- Aviso 1 — bloqueos sostenidos
    select count(*), count(*) filter (where waiting_locks > 3)
      into v_n_snapshots, v_n_breaching
      from public.db_health_snapshot_log
      where checked_at >= now() - interval '2 minutes';
    if v_n_snapshots >= 2 and v_n_breaching = v_n_snapshots
       and not exists (
         select 1 from public.db_health_alert_log
         where kind = 'db-health-lock' and sent_at >= now() - interval '15 minutes'
       ) then
      perform public._queue_system_alert(
        'db-health',
        'BBDD con bloqueos — ' || v_waiting || ' proceso(s) esperando lock, sostenido >2min',
        'db_health_watchdog detecto mas de 3 procesos esperando lock en ' || v_n_snapshots
          || ' snapshots consecutivos de los ultimos 2 minutos (ahora mismo: ' || v_waiting || ').' || chr(10)
          || 'Conexiones de cliente: ' || v_total_conn
          || '. Transaccion mas antigua: ' || (v_snap->>'oldest_tx_seconds') || 's.' || chr(10)
          || 'Asi empezo el incidente del 11/08. Revisar pg_stat_activity ya.',
        'db-health-lock'
      );
    end if;$viejo$;
  v_nuevo text := $nuevo$    -- Aviso 1 — bloqueos sostenidos. CRITICO, y dicho, no caido por defecto.
    -- Sin cuenta ni local a proposito: esto es la BASE ENTERA, y rellenar un
    -- campo de local aqui seria mentir en un campo.
    --
    -- La ventana pasa a los 15 minutos que el codigo decia. Antes decia 15 y
    -- hacia 20 HORAS: el `not exists` miraba `sent_at` (cuando se envio) y el
    -- envoltorio viejo traia `p_debounce_window default '20:00:00'`, que gana
    -- por ser mas ancha. Un segundo episodio dentro de esas 20 h no avisaba.
    select count(*), count(*) filter (where waiting_locks > 3)
      into v_n_snapshots, v_n_breaching
      from public.db_health_snapshot_log
      where checked_at >= now() - interval '2 minutes';
    if v_n_snapshots >= 2 and v_n_breaching = v_n_snapshots then
      perform public.encolar_alerta(
        p_kind    => 'db-health',
        p_subject => 'La base de datos esta bloqueada: ' || v_waiting
                     || ' proceso(s) esperando, y van mas de 2 min',
        p_message =>
          'Mas de 3 procesos llevan esperando un lock en ' || v_n_snapshots
          || ' medidas seguidas de los ultimos 2 minutos; ahora mismo hay ' || v_waiting || '.'
          || chr(10)
          || 'Conexiones de cliente: ' || v_total_conn
          || '. Transaccion mas antigua: ' || (v_snap->>'oldest_tx_seconds') || ' s.'
          || chr(10) || chr(10)
          || 'Asi empezo el incidente del 11/08. Mirar pg_stat_activity YA.',
        p_debounce_kind   => 'db-health-lock',
        p_debounce_window => interval '15 minutes',
        p_account_id      => NULL,
        p_location_id     => NULL,
        p_brand_id        => NULL,
        p_severity        => 'critico'
      );
    end if;$nuevo$;
  v_veces integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'db_health_watchdog';
  IF v_def IS NULL THEN RAISE EXCEPTION 'no existe db_health_watchdog'; END IF;
  v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  IF v_veces <> 1 THEN
    RAISE EXCEPTION 'el ancla del aviso 1 aparece % veces, esperaba 1', v_veces;
  END IF;
  EXECUTE replace(v_def, v_viejo, v_nuevo);
END;
$ancla1$;

-- ── 2. Aviso 2 · conexiones al 80 % → alto, pero ESCRITO ──────────────────────
DO $ancla2$
DECLARE
  v_def   text;
  v_viejo text := $viejo$    -- Aviso 2 — conexiones de CLIENTE cerca del maximo
    if v_max_conn > 0 and v_total_conn > 0.8 * v_max_conn
       and not exists (
         select 1 from public.db_health_alert_log
         where kind = 'db-health-connections' and sent_at >= now() - interval '15 minutes'
       ) then
      perform public._queue_system_alert(
        'db-health',
        'BBDD cerca del limite de conexiones — ' || v_total_conn || '/' || v_max_conn,
        'db_health_watchdog detecto ' || v_total_conn || ' conexiones de CLIENTE activas de un maximo de '
          || v_max_conn || ' (>80%).' || chr(10)
          || 'Revisar pg_stat_activity: puede ser el mismo patron del 11/08.',
        'db-health-connections'
      );
    end if;$viejo$;
  v_nuevo text := $nuevo$    -- Aviso 2 — conexiones de CLIENTE cerca del maximo. ALTO, y dicho.
    -- Se queda en el MISMO valor al que caia por defecto. Ese es todo el
    -- cambio, y es el que importa: ahora esta escrito, asi que se puede
    -- discutir. Antes no era una decision, era un hueco.
    if v_max_conn > 0 and v_total_conn > 0.8 * v_max_conn then
      perform public.encolar_alerta(
        p_kind    => 'db-health',
        p_subject => 'La base de datos se acerca a su limite de conexiones: '
                     || v_total_conn || ' de ' || v_max_conn,
        p_message =>
          'Hay ' || v_total_conn || ' conexiones de CLIENTE abiertas de un maximo de '
          || v_max_conn || ', mas del 80 %.' || chr(10) || chr(10)
          || 'Mirar pg_stat_activity: puede ser el mismo patron del 11/08.',
        p_debounce_kind   => 'db-health-connections',
        p_debounce_window => interval '15 minutes',
        p_account_id      => NULL,
        p_location_id     => NULL,
        p_brand_id        => NULL,
        p_severity        => 'alto'
      );
    end if;$nuevo$;
  v_veces integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'db_health_watchdog';
  IF v_def IS NULL THEN RAISE EXCEPTION 'no existe db_health_watchdog'; END IF;
  v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  IF v_veces <> 1 THEN
    RAISE EXCEPTION 'el ancla del aviso 2 aparece % veces, esperaba 1', v_veces;
  END IF;
  EXECUTE replace(v_def, v_viejo, v_nuevo);
END;
$ancla2$;

-- ── 3. Aviso 4 · solo cuentas que operan, y la severidad por horario ──────────
DO $ancla4$
DECLARE
  v_def   text;
  v_viejo text := $viejo$    -- Aviso 4 — tickets atascados en cola mas de 2h, POR LOCAL.
    -- `print_job` trae `account_id` y `location_id`, los dos NOT NULL: como en
    -- el aviso 6, no habia que buscarlos, habia que dejar de tirarlos. El
    -- viejo sumaba la tabla ENTERA y decia un numero que no es de nadie
    -- (regla 9); hoy solo hay una cuenta con trabajos de impresion, asi que
    -- todavia no ha mordido, pero muerde el dia que entre el cliente 2.
    -- Y el antirruido era global: un local tapaba al otro durante una hora.
    select count(*) into v_stuck_print
    from public.print_job
    where status = 'pending' and created_at < now() - interval '2 hours';
    if v_stuck_print > 0 then
      perform public.encolar_alerta(
        p_kind    => 'db-health',
        p_subject => 'Tickets sin imprimir desde hace horas: ' || t.n || ' en cola',
        p_message =>
          t.n || ' ticket(s) llevan en cola sin imprimirse mas de 2 horas. El mas viejo espera '
          || 'desde las ' || to_char(t.mas_viejo at time zone 'Europe/Madrid', 'HH24:MI')
          || ' del ' || to_char(t.mas_viejo at time zone 'Europe/Madrid', 'DD/MM') || '.'
          || chr(10) || chr(10)
          || 'Mira la impresora del local: encendida, con papel y con la tablet conectada.'
          || chr(10)
          || 'Asi se acumularon los 76 de Carabanchel del 08/08, tres dias sin que nadie se enterara.',
        p_debounce_kind   => 'db-health-print-stuck_'
                             || coalesce(t.location_id::text, 'sin-local'),
        p_debounce_window => interval '60 minutes',
        p_account_id      => t.account_id,
        p_location_id     => t.location_id,
        p_brand_id        => NULL,
        p_severity        => 'alto'
      )
      from (select j.account_id, j.location_id, count(*) as n, min(j.created_at) as mas_viejo
              from public.print_job j
             where j.status = 'pending' and j.created_at < now() - interval '2 hours'
             group by j.account_id, j.location_id) t;
    end if;$viejo$;
  v_nuevo text := $nuevo$    -- Aviso 4 — tickets atascados en cola mas de 2h, POR LOCAL, y SOLO de
    -- cuentas que operan.
    --
    -- `print_job` trae `account_id` y `location_id`, los dos NOT NULL: como en
    -- el aviso 6, no habia que buscarlos, habia que dejar de tirarlos. El
    -- viejo sumaba la tabla ENTERA y decia un numero que no es de nadie
    -- (regla 9). Y el antirruido era global: un local tapaba al otro una hora.
    --
    -- El filtro de cuenta va en los DOS sitios —la puerta y el agrupado— a
    -- proposito: si la puerta contara mas ancho que el agrupado, tendriamos un
    -- `if` que se abre para no encolar nada. La misma vara a los dos lados.
    select count(*) into v_stuck_print
    from public.print_job
    where status = 'pending' and created_at < now() - interval '2 hours'
      and public.cuenta_opera(account_id);
    if v_stuck_print > 0 then
      perform public.encolar_alerta(
        p_kind    => 'db-health',
        p_subject => 'Tickets sin imprimir desde hace horas: ' || t.n || ' en cola',
        p_message =>
          t.n || ' ticket(s) llevan en cola sin imprimirse mas de 2 horas. El mas viejo espera '
          || 'desde las ' || to_char(t.mas_viejo at time zone 'Europe/Madrid', 'HH24:MI')
          || ' del ' || to_char(t.mas_viejo at time zone 'Europe/Madrid', 'DD/MM') || '.'
          || chr(10) || chr(10)
          || 'Mira la impresora del local: encendida, con papel y con la tablet conectada.'
          || chr(10)
          || 'Asi se acumularon los 76 de Carabanchel del 08/08, tres dias sin que nadie se enterara.',
        p_debounce_kind   => 'db-health-print-stuck_'
                             || coalesce(t.location_id::text, 'sin-local'),
        p_debounce_window => interval '60 minutes',
        p_account_id      => t.account_id,
        p_location_id     => t.location_id,
        p_brand_id        => NULL,
        -- La severidad la decide el HORARIO, no una constante (Julio, 09/09).
        -- `critico` quiere decir «actua ahora», y eso solo es verdad si el
        -- local esta sirviendo: tickets atascados a las 21:00 con la cocina
        -- abierta son pedidos perdiendose; el mismo dato a las 4 de la manana
        -- no justifica despertar a nadie.
        --
        -- Se evalua POR FILA: dos locales del mismo grupo pueden estar uno
        -- abierto y otro cerrado, y cada aviso se lleva la suya.
        p_severity        => case
                               when public.is_brand_open(t.location_id, NULL::uuid, now())
                               then 'critico' else 'alto'
                             end
      )
      from (select j.account_id, j.location_id, count(*) as n, min(j.created_at) as mas_viejo
              from public.print_job j
             where j.status = 'pending' and j.created_at < now() - interval '2 hours'
               and public.cuenta_opera(j.account_id)
             group by j.account_id, j.location_id) t;
    end if;$nuevo$;
  v_veces integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'db_health_watchdog';
  IF v_def IS NULL THEN RAISE EXCEPTION 'no existe db_health_watchdog'; END IF;
  v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  IF v_veces <> 1 THEN
    RAISE EXCEPTION 'el ancla del aviso 4 aparece % veces, esperaba 1', v_veces;
  END IF;
  EXECUTE replace(v_def, v_viejo, v_nuevo);
END;
$ancla4$;

-- ── 4. Aviso 5 · solo cuentas que operan ──────────────────────────────────────
DO $ancla5$
DECLARE
  v_def   text;
  v_viejo text := $viejo$    -- Aviso 5 — tickets encolados a una impresora marcada como inactiva, POR LOCAL.
    -- Mismo arreglo que el 4, y aqui ademas se puede decir QUE impresora: sin
    -- el nombre, el aviso obliga a ir a buscarla a mano.
    --
    -- Se agrupa por el local del TRABAJO, no por el de la impresora. No es lo
    -- mismo por definicion, asi que se comprobo sobre la tabla entera: de los
    -- 9.488 print_job, CERO apuntan a una impresora de otro local. Agrupar por
    -- el del trabajo no parte hoy ningun aviso en dos.
    select count(*) into v_inactive_print
    from public.print_job pj
    join public.printer p on p.id = pj.printer_id
    where pj.status in ('pending', 'sent') and p.is_active = false;
    if v_inactive_print > 0 then
      perform public.encolar_alerta(
        p_kind    => 'db-health',
        p_subject => 'Tickets encolados a una impresora apagada en Folvy: ' || t.n,
        p_message =>
          t.n || ' ticket(s) estan esperando en una impresora que en Folvy figura como INACTIVA: '
          || t.impresoras || '.' || chr(10) || chr(10)
          || 'No se van a imprimir nunca: la tablet solo recoge trabajos de impresoras activas.'
          || chr(10)
          || 'O se vuelve a marcar activa esa impresora, o esos tickets hay que mandarlos a otra.',
        p_debounce_kind   => 'db-health-print-inactive-printer_'
                             || coalesce(t.location_id::text, 'sin-local'),
        p_debounce_window => interval '60 minutes',
        p_account_id      => t.account_id,
        p_location_id     => t.location_id,
        p_brand_id        => NULL,
        p_severity        => 'alto'
      )
      from (select j.account_id, j.location_id, count(*) as n,
                   string_agg(distinct pr.name, ', ') as impresoras
              from public.print_job j
              join public.printer pr on pr.id = j.printer_id
             where j.status in ('pending', 'sent') and pr.is_active = false
             group by j.account_id, j.location_id) t;
    end if;$viejo$;
  v_nuevo text := $nuevo$    -- Aviso 5 — tickets encolados a una impresora marcada como inactiva, POR
    -- LOCAL, y SOLO de cuentas que operan.
    --
    -- Mismo arreglo que el 4, y aqui ademas se puede decir QUE impresora: sin
    -- el nombre, el aviso obliga a ir a buscarla a mano.
    --
    -- Se agrupa por el local del TRABAJO, no por el de la impresora. No es lo
    -- mismo por definicion, asi que se comprobo sobre la tabla entera: de los
    -- 9.488 print_job, CERO apuntan a una impresora de otro local. Agrupar por
    -- el del trabajo no parte hoy ningun aviso en dos.
    select count(*) into v_inactive_print
    from public.print_job pj
    join public.printer p on p.id = pj.printer_id
    where pj.status in ('pending', 'sent') and p.is_active = false
      and public.cuenta_opera(pj.account_id);
    if v_inactive_print > 0 then
      perform public.encolar_alerta(
        p_kind    => 'db-health',
        p_subject => 'Tickets encolados a una impresora apagada en Folvy: ' || t.n,
        p_message =>
          t.n || ' ticket(s) estan esperando en una impresora que en Folvy figura como INACTIVA: '
          || t.impresoras || '.' || chr(10) || chr(10)
          || 'No se van a imprimir nunca: la tablet solo recoge trabajos de impresoras activas.'
          || chr(10)
          || 'O se vuelve a marcar activa esa impresora, o esos tickets hay que mandarlos a otra.',
        p_debounce_kind   => 'db-health-print-inactive-printer_'
                             || coalesce(t.location_id::text, 'sin-local'),
        p_debounce_window => interval '60 minutes',
        p_account_id      => t.account_id,
        p_location_id     => t.location_id,
        p_brand_id        => NULL,
        p_severity        => 'alto'
      )
      from (select j.account_id, j.location_id, count(*) as n,
                   string_agg(distinct pr.name, ', ') as impresoras
              from public.print_job j
              join public.printer pr on pr.id = j.printer_id
             where j.status in ('pending', 'sent') and pr.is_active = false
               and public.cuenta_opera(j.account_id)
             group by j.account_id, j.location_id) t;
    end if;$nuevo$;
  v_veces integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'db_health_watchdog';
  IF v_def IS NULL THEN RAISE EXCEPTION 'no existe db_health_watchdog'; END IF;
  v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  IF v_veces <> 1 THEN
    RAISE EXCEPTION 'el ancla del aviso 5 aparece % veces, esperaba 1', v_veces;
  END IF;
  EXECUTE replace(v_def, v_viejo, v_nuevo);
END;
$ancla5$;

-- ── 5. Aviso 6 · solo cuentas que operan ──────────────────────────────────────
DO $ancla6$
DECLARE
  v_def   text;
  v_viejo text := $viejo$    -- Aviso 6 — pedidos aceptados sin ninguna impresora activa, POR LOCAL.
    -- `print_route_failure_log` ya trae account_id y location_id: no habia que
    -- buscarlos, habia que dejar de tirarlos. El antirruido va por local, que
    -- antes era global y un local tapaba al otro durante una hora.
    --
    -- `perform ... from (...)` llama a encolar_alerta una vez por fila sin
    -- declarar variables nuevas: el resto de este cuerpo no se toca.
    select count(*) into v_route_failures
    from public.print_route_failure_log
    where created_at >= now() - interval '10 minutes';
    if v_route_failures > 0 then
      perform public.encolar_alerta(
        p_kind    => 'db-health',
        p_subject => 'Pedidos aceptados y sin imprimir: no hay ninguna impresora activa',
        p_message =>
          t.n || ' pedido(s) se han aceptado en los ultimos 10 minutos y no se han podido '
          || 'enviar a imprimir: el local no tiene ninguna impresora activa dada de alta.'
          || chr(10) || chr(10)
          || 'El pedido esta cocinandose sin ticket. Da de alta una impresora en ese local, '
          || 'o marcala como activa si ya existe.',
        p_debounce_kind   => 'db-health-print-no-active-printer_'
                             || coalesce(t.location_id::text, 'sin-local'),
        p_debounce_window => interval '60 minutes',
        p_account_id      => t.account_id,
        p_location_id     => t.location_id,
        p_brand_id        => NULL,
        p_severity        => 'alto'
      )
      from (select f.account_id, f.location_id, count(*) as n
              from public.print_route_failure_log f
             where f.created_at >= now() - interval '10 minutes'
             group by f.account_id, f.location_id) t;
    end if;$viejo$;
  v_nuevo text := $nuevo$    -- Aviso 6 — pedidos aceptados sin ninguna impresora activa, POR LOCAL, y
    -- SOLO de cuentas que operan.
    --
    -- `print_route_failure_log` ya trae account_id y location_id: no habia que
    -- buscarlos, habia que dejar de tirarlos. El antirruido va por local, que
    -- antes era global y un local tapaba al otro durante una hora.
    --
    -- `perform ... from (...)` llama a encolar_alerta una vez por fila sin
    -- declarar variables nuevas: el resto de este cuerpo no se toca.
    --
    -- Este es el aviso que hizo ver el problema: las 100 filas de la tabla son
    -- 98 de una cuenta SUSPENDIDA y 2 de la plantilla. Cero de un cliente vivo.
    select count(*) into v_route_failures
    from public.print_route_failure_log
    where created_at >= now() - interval '10 minutes'
      and public.cuenta_opera(account_id);
    if v_route_failures > 0 then
      perform public.encolar_alerta(
        p_kind    => 'db-health',
        p_subject => 'Pedidos aceptados y sin imprimir: no hay ninguna impresora activa',
        p_message =>
          t.n || ' pedido(s) se han aceptado en los ultimos 10 minutos y no se han podido '
          || 'enviar a imprimir: el local no tiene ninguna impresora activa dada de alta.'
          || chr(10) || chr(10)
          || 'El pedido esta cocinandose sin ticket. Da de alta una impresora en ese local, '
          || 'o marcala como activa si ya existe.',
        p_debounce_kind   => 'db-health-print-no-active-printer_'
                             || coalesce(t.location_id::text, 'sin-local'),
        p_debounce_window => interval '60 minutes',
        p_account_id      => t.account_id,
        p_location_id     => t.location_id,
        p_brand_id        => NULL,
        p_severity        => 'alto'
      )
      from (select f.account_id, f.location_id, count(*) as n
              from public.print_route_failure_log f
             where f.created_at >= now() - interval '10 minutes'
               and public.cuenta_opera(f.account_id)
             group by f.account_id, f.location_id) t;
    end if;$nuevo$;
  v_veces integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'db_health_watchdog';
  IF v_def IS NULL THEN RAISE EXCEPTION 'no existe db_health_watchdog'; END IF;
  v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  IF v_veces <> 1 THEN
    RAISE EXCEPTION 'el ancla del aviso 6 aparece % veces, esperaba 1', v_veces;
  END IF;
  EXECUTE replace(v_def, v_viejo, v_nuevo);
END;
$ancla6$;

-- ── 6. El vigía de silencio pasa a usar la MISMA definición ───────────────
-- Se cambian las tres líneas del predicado por la llamada. El comentario largo
-- de encima NO se toca: dice POR QUÉ el criterio es la actividad y no la
-- bandera, y eso no lo dice una llamada a función.
DO $anclavigia$
DECLARE
  v_def   text;
  v_viejo text := $viejo$     WHERE a.is_internal IS NOT TRUE
       AND a.status = 'active'
       AND a.suspended_at IS NULL AND a.archived_at IS NULL AND a.deleted_at IS NULL$viejo$;
  v_nuevo text := $nuevo$     WHERE public.cuenta_opera(l.account_id)$nuevo$;
  v_veces integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ingesta_silencio_watchdog';
  IF v_def IS NULL THEN RAISE EXCEPTION 'no existe ingesta_silencio_watchdog'; END IF;
  v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  IF v_veces <> 1 THEN
    RAISE EXCEPTION 'el ancla del vigia aparece % veces, esperaba 1', v_veces;
  END IF;
  EXECUTE replace(v_def, v_viejo, v_nuevo);
END;
$anclavigia$;

-- ── Verificación DENTRO de la transacción ─────────────────────────────────
DO $verifica$
DECLARE
  v_oid oid;
  v_src text;
  v_n   integer;
BEGIN
  -- El ayudante, y que responde lo que tiene que responder sobre los datos
  -- REALES. No es un ejemplo inventado: son las tres cuentas que hay.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='cuenta_opera') <> 1 THEN
    RAISE EXCEPTION 'cuenta_opera no existe o tiene mas de una firma';
  END IF;
  SELECT count(*) INTO v_n FROM public.accounts a WHERE public.cuenta_opera(a.id);
  IF v_n <> (SELECT count(*) FROM public.accounts a
              WHERE a.is_internal IS NOT TRUE AND a.status = 'active'
                AND a.suspended_at IS NULL AND a.archived_at IS NULL AND a.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'cuenta_opera no dice lo mismo que el predicado que sustituye';
  END IF;
  IF public.cuenta_opera(NULL) IS NOT FALSE THEN
    RAISE EXCEPTION 'cuenta_opera con NULL deberia ser FALSE, no %', public.cuenta_opera(NULL);
  END IF;

  -- db_health_watchdog: forma intacta.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='db_health_watchdog') <> 1 THEN
    RAISE EXCEPTION 'db_health_watchdog tiene mas de una firma (regla 2)';
  END IF;
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='db_health_watchdog';
  IF pg_get_function_identity_arguments(v_oid) <> '' OR pg_get_function_result(v_oid) <> 'void' THEN
    RAISE EXCEPTION 'db_health_watchdog ha cambiado de forma';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_oid;

  -- Las severidades, dichas.
  IF v_src NOT LIKE '%p_severity        => ''critico''%' THEN
    RAISE EXCEPTION 'el aviso 1 no declara critico';
  END IF;
  IF v_src NOT LIKE '%is_brand_open(t.location_id%' THEN
    RAISE EXCEPTION 'el aviso 4 no decide la severidad por el horario';
  END IF;

  -- El filtro de cuenta, en los SEIS sitios: puerta y agrupado de cada uno de
  -- los tres avisos de impresion. Se cuenta, no se mira si aparece: si un
  -- ancla se llevara una mitad por delante, un LIKE no lo veria.
  v_n := (length(v_src) - length(replace(v_src, 'public.cuenta_opera(', '')))
           / length('public.cuenta_opera(');
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'esperaba 6 llamadas a cuenta_opera (puerta y agrupado de los avisos 4, 5 y 6), hay %', v_n;
  END IF;

  -- Queda UNA sola llamada a la puerta vieja: el manejador de excepciones.
  v_n := (length(v_src) - length(replace(v_src, 'public._queue_system_alert(', '')))
           / length('public._queue_system_alert(');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'esperaba 1 llamada a _queue_system_alert (el manejador), hay %', v_n;
  END IF;
  v_n := (length(v_src) - length(replace(v_src, 'public.encolar_alerta(', '')))
           / length('public.encolar_alerta(');
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'esperaba 5 llamadas a encolar_alerta (avisos 1, 2, 4, 5 y 6), hay %', v_n;
  END IF;

  -- Y que las anclas no se han llevado por delante lo de la pasada anterior.
  IF v_src NOT LIKE '%db-health-print-stuck\_%'
     OR v_src NOT LIKE '%db-health-print-inactive-printer\_%'
     OR v_src NOT LIKE '%db-health-print-no-active-printer\_%' THEN
    RAISE EXCEPTION 'el reemplazo por ancla se ha llevado los avisos de impresion';
  END IF;
  IF v_src NOT LIKE '%t.impresoras%' OR v_src NOT LIKE '%group by j.account_id, j.location_id) t;%' THEN
    RAISE EXCEPTION 'los avisos 4 y 5 han perdido el agrupado o el nombre de la impresora';
  END IF;
  -- Y que el `not exists` muerto contra db_health_alert_log ya no gobierna
  -- los avisos 1 y 2: la unica ventana que manda es la de la cola.
  IF v_src LIKE '%kind = ''db-health-lock'' and sent_at%'
     OR v_src LIKE '%kind = ''db-health-connections'' and sent_at%' THEN
    RAISE EXCEPTION 'los avisos 1 y 2 siguen con la guarda vieja de 15 min que hacia 20 h';
  END IF;

  -- El vigia de silencio: firma intacta, y usando la definicion unica.
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='ingesta_silencio_watchdog';
  IF pg_get_function_identity_arguments(v_oid)
       <> 'p_min_punta integer, p_min_valle integer, p_debounce_window interval' THEN
    RAISE EXCEPTION 'la firma del vigia ha cambiado: %', pg_get_function_identity_arguments(v_oid);
  END IF;
  IF pg_get_expr((SELECT proargdefaults FROM pg_proc WHERE oid = v_oid), 0)
       <> '30, 60, ''02:00:00''::interval' THEN
    RAISE EXCEPTION 'los defaults del vigia han cambiado';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_oid;
  IF v_src NOT LIKE '%WHERE public.cuenta_opera(l.account_id)%' THEN
    RAISE EXCEPTION 'el vigia no usa la definicion unica';
  END IF;
  -- El bloque de «vende con la bandera apagada» sigue SIN filtro de cuenta, a
  -- proposito: una cuenta suspendida que sigue vendiendo es la noticia.
  IF v_src NOT LIKE '%v_vende_apagado%'
     OR v_src NOT LIKE '%a2.is_internal IS NOT TRUE%' THEN
    RAISE EXCEPTION 'se ha tocado el bloque de «vende con la bandera apagada», que no se toca';
  END IF;
  IF v_src LIKE '%cuenta_opera(l2.account_id)%' THEN
    RAISE EXCEPTION 'se ha metido el filtro de cuenta en «vende con la bandera apagada»: ahi NO va';
  END IF;
  IF v_src NOT LIKE '%is_brand_open%' OR v_src NOT LIKE '%v_sin_hora%' THEN
    RAISE EXCEPTION 'al vigia le falta el veto o el aviso de cobertura';
  END IF;

  RAISE NOTICE 'Severidad dicha (1 critico, 2 alto, 4 por horario) y los tres avisos de impresion solo miran cuentas que operan.';
END;
$verifica$;

commit;

-- ══════════════════════════════════════════════════════════════════════════
-- DESPUÉS DE APLICAR
--
-- 1) Que el cuerpo es el que se ensayó, medido igual a los dos lados:
--   select p.proname, length(p.prosrc) as chars, md5(p.prosrc) as md5
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('db_health_watchdog','ingesta_silencio_watchdog','cuenta_opera')
--    order by 1;
--   -- esperado:
--   --   cuenta_opera .............. (nueva)
--   --   db_health_watchdog ........ 11588 · 6addfeec6c5014615d88de41c64f151a
--   --   ingesta_silencio_watchdog . 12626 · 4dace4648ef7320ffa92061e0adbabfc
--
-- 2) Que Kitchen Grill deja de generar avisos de impresora. Hoy entra una fila
--    por hora en print_route_failure_log; a partir de ahora no debe salir NI UN
--    aviso de esa cuenta:
--   select to_char(q.created_at at time zone 'Europe/Madrid','DD/MM HH24:MI') as cuando,
--          a.name as cuenta, q.severity, q.subject
--     from public.system_alert_queue q
--     left join public.accounts a on a.id = q.account_id
--    where q.kind = 'db-health' and q.created_at > now() - interval '3 hours'
--    order by q.created_at desc;
--
-- 3) Que la fuente sigue llenándose aunque el aviso calle — o sea que esto
--    filtra el AVISO, no esconde el HECHO (regla 7: el umbral ordena, no
--    decide la existencia):
--   select a.name as cuenta, count(*) as fallos, max(f.created_at) as ultimo
--     from public.print_route_failure_log f
--     join public.accounts a on a.id = f.account_id
--    where f.created_at > now() - interval '24 hours'
--    group by 1 order by 2 desc;
--
-- 4) Que «Vende con el local apagado en Folvy» SIGUE saliendo. Si desapareciera,
--    el filtro se habría colado donde no va:
--   select subject, created_at from public.system_alert_queue
--    where subject like 'Vende con el local apagado%' order by created_at desc limit 3;
-- ══════════════════════════════════════════════════════════════════════════
