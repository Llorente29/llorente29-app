-- ══════════════════════════════════════════════════════════════════════════
-- Estándar de alertas · paso 6 — `db-health` ENTERO dice QUÉ local, y el vigía
-- de silencio deja de fiarse de una bandera
-- ══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ SIN APLICAR. **VA DESPUÉS de `20260909133018_alertas_plantilla_unica.sql`**
-- (el paso 4, ya aplicado): reescribe `ingesta_silencio_watchdog` partiendo del
-- cuerpo que deja aquélla. Aplicarla antes dejaría el prefijo `[Negocio · Local]`
-- otra vez escrito a mano dentro de los asuntos. Nombre provisional (regla 17).
--
-- ── CAMBIO DE ALCANCE, Y ES UNA CORRECCIÓN MÍA ───────────────────────────
-- Este fichero salió como «fase 1» y dejaba fuera los avisos 4 y 5 «para no
-- tocar tres bloques del mismo cuerpo en una pasada». Estaba mal, y la razón
-- es de fontanería: cada bloque se reemplaza por ANCLA sobre el cuerpo VIVO,
-- así que una fase 2 escrita hoy tendría que anclar contra un cuerpo que aún
-- no existe —el que dejaría esta migración sin aplicar— y no habría forma de
-- probarla hasta después. Encadenar anclas contra un cuerpo no aplicado es
-- peor que tres anclas en una pasada, y cada una lleva su propia guarda de
-- «aparece exactamente una vez». Así que `db-health` va entero, de una.
--
-- ── POR QUÉ `db-health` VA EL PRIMERO DE LOS DIECISÉIS ───────────────────
-- Por el ruido medido, no por orden alfabético: es el segundo emisor de la cola
-- y su aviso del 09/09 a las 14:31 decía, literalmente, «Pedido(s) aceptado(s)
-- sin impresora activa EN EL LOCAL» — sin decir cuál. El vigía no lo sabía:
-- contaba filas de `print_route_failure_log` sin agrupar.
--
-- Y la tabla YA TRAE `account_id` y `location_id`. No había que buscarlos en
-- ningún sitio: había que dejar de tirarlos.
--
-- ── DOS CORRECCIONES A LA MEDICIÓN DEL ENCARGO, Y LAS DOS SON DE REGLA 9 ──
-- El encargo dice «85 avisos en 14 días desde el 26/08, y los 85 son del MISMO
-- local». Medido sobre la tabla entera:
--
--   Kitchen Grill LstQ · Kitchen Grill LstQ .... 96 avisos · 12/08 → 09/09
--   Folvy Interno · Foodint Alcalá .............  2 avisos · 11/08 → 15/08
--   ───────────────────────────────────────────────────────────────────────
--   total ...................................... 98
--
-- Son 98 y no 85, empiezan el 12/08 y no el 26/08, y **no son todos del mismo
-- local**: hay dos de la cuenta plantilla. La conclusión del encargo no cambia
-- —el aviso sigue sin decir dónde, que es el problema— pero la cifra sí, y es
-- otra vez el mismo patrón: un `count(*)` sin cuenta mezcla producción con la
-- plantilla.
--
-- ── Y UN FALLO DEL VIGÍA QUE NADIE HABÍA VISTO ───────────────────────────
-- El antirruido de este aviso era GLOBAL:
--
--   not exists (select 1 from db_health_alert_log
--                where kind = 'db-health-print-no-active-printer'
--                  and sent_at >= now() - interval '60 minutes')
--
-- O sea que **un local tapaba al otro**: si Kitchen Grill fallaba, un fallo
-- simultáneo en Alcalá no avisaba en una hora. Con la clave por local, cada uno
-- avisa por su cuenta. Esto no estaba en el encargo; sale de leer el bloque.
--
-- ── EL CRITERIO DEL VIGÍA DE SILENCIO: LO QUE VENDE, NO LA BANDERA ───────
-- Escribí en el estándar «sólo se vigilan locales ACTIVOS» y estaba mal. El
-- caso que lo tumba está medido:
--
--   cuenta               local                bandera  ventas 30d   importe   tramos
--   Kitchen Grill LstQ   Kitchen Grill LstQ   FALSE       138       3.254 €      0
--
-- Con aquella vara, un local que factura 3.254 € al mes **no se vigila nunca**.
-- La bandera la mantiene una persona; las ventas no mienten. Así que el filtro
-- pasa a ser la actividad, y «vende con la bandera apagada» genera su propio
-- aviso — no es una razón para callar, es la noticia.
--
-- ── PERO LA REGLA LITERAL DEL ENCARGO SE PASA DE FRENADA, Y HAY QUE DECIRLO ──
-- «Si un local tiene ventas, está operando» aplicado tal cual mete dentro a la
-- CUENTA PLANTILLA: `Folvy Interno · Foodint Alcalá` tiene **1 venta de 28,60 €
-- del 11/08**. Una venta hace cinco semanas no es un local operando.
--
-- Por eso el corte es **ventas en los últimos 7 días**, que separa limpiamente
-- lo que hay hoy sin inventar un umbral de dinero:
--   Alcalá, Carabanchel, Kitchen Grill .... dentro (venden hoy)
--   la plantilla .......................... fuera (última venta, 11/08)
-- Y además se mantiene `is_internal IS NOT TRUE`, que es el cinturón.
--
-- ── EL ESTADO DE CUENTA SÍ SE RESPETA, Y EL AVISO NUEVO NO ───────────────
-- `status`, `suspended_at`, `archived_at` y `deleted_at` no son banderas
-- olvidadas: son decisiones con fecha y motivo. El bucle las respeta.
--
-- Pero el aviso de «vende con la bandera apagada» se mira APARTE y SIN ese
-- filtro, a propósito: **una cuenta suspendida que sigue vendiendo es justo la
-- noticia**. Filtrando por `status='active'` ahí, el único caso que existe hoy
-- —el que destapó todo esto— sería invisible. Es un estado, no un suceso, así
-- que la clave del antirruido va por la LISTA y no por la fecha.
--
-- ── LAS FIRMAS NO CAMBIAN (regla 2) ──────────────────────────────────────
--   `db_health_watchdog()` ............... sin argumentos, `void`, una firma
--   `ingesta_silencio_watchdog(int,int,interval)` ... defaults 30, 60, '02:00:00'
-- Las dos por `CREATE OR REPLACE` sin tocar la firma. El de db-health, además,
-- por ANCLA: su cuerpo vivo NO ESTÁ EN EL REPO —deuda de la regla 1, anotada—
-- así que reescribirlo entero exigiría transcribir 5.861 caracteres a mano, que
-- es la mejor forma de perder por el camino algo que nadie pidió cambiar.
--
-- ── LOS AVISOS 4 Y 5, Y LO QUE DICE MEDIRLOS ─────────────────────────────
-- Los otros dos avisos que hablan de un local sin decirlo:
--
--   Aviso 4 · «trabajo(s) de impresion atascados >2h»
--   Aviso 5 · «encolados a impresora INACTIVA»
--
-- Los dos suman `print_job` de la TABLA ENTERA, sin `account_id` (regla 9). Hoy
-- eso no ha mordido todavía y hay que decir por qué: los 9.488 `print_job` que
-- existen son TODOS de Foodint, así que el total sin cuenta y el total de la
-- cuenta coinciden por casualidad. El día que entre el cliente 2, el número
-- pasa a no ser de nadie sin que cambie una línea de código.
--
-- ── Y LA POBLACIÓN DE HOY ES CERO, QUE TAMBIÉN HAY QUE DECIRLO ───────────
-- No hay antes/después que enseñar con estos dos, porque ahora mismo no hay
-- nada que avisar. Medido, no supuesto:
--
--   print_job en pending >2h ......................... 0 filas
--   print_job (pending/sent) en impresora inactiva ... 0 filas
--   avisos de estos dos tipos en db_health_alert_log .. 0 en 30 días
--
-- No es que el aviso esté roto: es que no ha habido caso. Los 76 de Carabanchel
-- del 08/08 —el incidente que hizo nacer el aviso 4— siguen en la tabla, pero
-- en `cancelled`, así que ya no cuentan. Con población cero, la prueba de que
-- esto no rompe nada es que el cuerpo compila y que los otros cuatro avisos
-- siguen intactos; lo demás sería inventarse un ensayo (regla 31).
--
-- ── EL ENSAYO, Y LO QUE COSTÓ ───────────────────────────────────────────
-- Copia de usar y tirar (`zz_ensayo_dbhealth`, sin SECURITY DEFINER) con las
-- dos puertas de encolado sustituidas por sellos que escriben en una tabla en
-- vez de encolar: cero efectos sobre la cola real. Correrla tal cual no probaba
-- NADA —los tres `if n > 0` daban falso, población cero— así que se corrió una
-- segunda copia ensanchando SOLO el predicado (`pending`→`done`, la bandera de
-- impresora invertida) para que los bloques nuevos pasaran por filas de verdad.
-- Lo que sale:
--
--   Aviso 4 (forzado a `done`)
--     [Foodint · Alcalá] ............ 6.117 tickets, el más viejo del 20/07
--     [Foodint · Carabanchel] ....... 2.257 tickets, el más viejo del 09/08
--     [Foodint · Plaza Castilla] .......  29 tickets, el más viejo del 21/06
--   Aviso 5 (forzado a impresora activa) — y aquí se ve lo que aporta
--     [Foodint · Alcalá] ......... 1.680 · «Cocina, Pase, Pegatina»
--     [Foodint · Carabanchel] .... 2.290 · «Impre»
--     [Foodint · Plaza Castilla] ....  30 · «NT311 Plaza Castilla»
--   Aviso 6 (forzado a 60 días)
--     [Kitchen Grill LstQ] .......... 97 pedidos
--     [Folvy Interno · Alcalá] ....... 2 pedidos
--
-- Tres cosas que sólo se ven corriéndolo:
--   · Cada fila lleva su `account_id` y su `location_id`, y la clave de
--     antirruido lleva el UUID del local: ya no se tapan entre sí.
--   · El aviso 5 dice el NOMBRE de la impresora. Sin eso hay que ir a buscarla.
--   · El aviso 6 separa Kitchen Grill de la plantilla en DOS avisos, que es lo
--     que la cifra de 98 del encargo tenía mezclado.
--
-- El cuerpo que produce esto: **9.251 chars, md5 `c14fdaf3b7025f70e306e68bff35800f`**.
-- Es la misma vara a los dos lados: el `prosrc` de la copia de ensayo y el que
-- dejará esta migración son el mismo texto (el nombre y el SECURITY DEFINER no
-- viven en `prosrc`). Si al aplicar sale otro md5, algo ha cambiado por el
-- camino y hay que mirarlo antes de dar nada por bueno.
--
-- Y el ensayo dejó rastro, que también se dice: la copia ejecuta el cuerpo
-- entero, así que las 5 pasadas insertaron 5 filas en `db_health_snapshot_log`
-- y corrieron sus dos purgas. Es exactamente lo que hace el cron cada tick; las
-- 5 filas se borran solas a las 48 h. Los objetos de ensayo (`zz_ensayo_*`)
-- quedan borrados — comprobado, 0. Y el `db_health_watchdog` VIVO no se ha
-- tocado: sigue en 5.861 chars, md5 `6b64ffdda90d55ea2ddf97bf0c878086`.
--
-- Las anclas se comprobaron contra la base ANTES de escribir nada, con la
-- misma vara a los dos lados: el trozo vivo del aviso 4 mide 789 chars con
-- md5 `12a6bd0bc734b90b7f3cbe5817f6ed6f` y el del 5, 899 con
-- `a0477db3af638fae481d9e62561cc78e` — idénticos a los de este fichero. Y los
-- tres bloques NUEVOS que se ensayaron son los de aquí, byte a byte:
-- `62701c…` (4), `1bf68c…` (5), `6b25a4…` (6).
--
-- ── LOS AVISOS 1 Y 2 SE QUEDAN COMO ESTÁN, Y ES A PROPÓSITO ─────────────
-- «Bloqueos sostenidos» y «cerca del límite de conexiones» hablan de la BASE
-- DE DATOS entera, no de un local: la medida de este paso —que todo aviso de
-- local diga el local— no les aplica, y ponerles un `location_id` inventado
-- sería mentir en un campo. Se quedan en `_queue_system_alert`, que es lo que
-- deja `db-health` con dos llamadas a la puerta vieja y tres a la nueva. Lo que
-- SÍ les falta es la severidad declarada (hoy caen al `alto` por defecto, y un
-- bloqueo sostenido es `critico`); eso va en la pasada que le dé severidad a
-- todo, no en ésta.
--
-- ── UNA COSA QUE NO DECIDO YO ────────────────────────────────────────────
-- Los tres avisos salen con `severity = 'alto'`. El 4 es el del incidente de
-- tres días en silencio y se podría argumentar `critico`; lo dejo en `alto`
-- por coherencia con los otros dos y porque subir un umbral de interrupción es
-- decisión de Julio, no mía (regla 7). Si lo quieres en `critico`, es cambiar
-- una palabra en el bloque 2.
-- ══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. db-health · aviso 6, por LOCAL ─────────────────────────────────────
DO $ancla$
DECLARE
  v_def   text;
  v_viejo text := $viejo$    -- Aviso 6 — pedidos aceptados sin ninguna impresora activa
    select count(*) into v_route_failures
    from public.print_route_failure_log
    where created_at >= now() - interval '10 minutes';
    if v_route_failures > 0
       and not exists (
         select 1 from public.db_health_alert_log
         where kind = 'db-health-print-no-active-printer' and sent_at >= now() - interval '60 minutes'
       ) then
      perform public._queue_system_alert(
        'db-health',
        'Pedido(s) aceptado(s) sin impresora activa en el local',
        'db_health_watchdog detecto ' || v_route_failures || ' aviso(s) en print_route_failure_log de los ultimos 10 minutos.',
        'db-health-print-no-active-printer'
      );
    end if;$viejo$;
  v_nuevo text := $nuevo$    -- Aviso 6 — pedidos aceptados sin ninguna impresora activa, POR LOCAL.
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
    end if;$nuevo$;
  v_veces integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'db_health_watchdog';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'no existe db_health_watchdog';
  END IF;
  v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  IF v_veces <> 1 THEN
    RAISE EXCEPTION 'el ancla del aviso 6 aparece % veces, esperaba 1', v_veces;
  END IF;
  EXECUTE replace(v_def, v_viejo, v_nuevo);
END;
$ancla$;

-- ── 2. db-health · aviso 4, por LOCAL ─────────────────────────────────────
DO $ancla4$
DECLARE
  v_def   text;
  v_viejo text := $viejo$    -- Aviso 4 — print_job en pending >2h
    select count(*) into v_stuck_print
    from print_job
    where status = 'pending' and created_at < now() - interval '2 hours';
    if v_stuck_print > 0
       and not exists (
         select 1 from public.db_health_alert_log
         where kind = 'db-health-print-stuck' and sent_at >= now() - interval '60 minutes'
       ) then
      perform public._queue_system_alert(
        'db-health',
        v_stuck_print || ' trabajo(s) de impresion atascados >2h',
        'db_health_watchdog detecto ' || v_stuck_print || ' print_job en pending desde hace mas de 2 horas.' || chr(10)
          || 'Asi se acumularon los 76 de Carabanchel (08-09/08) durante 3 dias sin que nadie se enterara.',
        'db-health-print-stuck'
      );
    end if;$viejo$;
  v_nuevo text := $nuevo$    -- Aviso 4 — tickets atascados en cola mas de 2h, POR LOCAL.
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
    end if;$nuevo$;
  v_veces integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'db_health_watchdog';
  v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  IF v_veces <> 1 THEN
    RAISE EXCEPTION 'el ancla del aviso 4 aparece % veces, esperaba 1', v_veces;
  END IF;
  EXECUTE replace(v_def, v_viejo, v_nuevo);
END;
$ancla4$;

-- ── 3. db-health · aviso 5, por LOCAL y diciendo QUÉ impresora ────────────
DO $ancla5$
DECLARE
  v_def   text;
  v_viejo text := $viejo$    -- Aviso 5 — print_job no terminal en impresora inactiva
    select count(*) into v_inactive_print
    from print_job pj
    join printer p on p.id = pj.printer_id
    where pj.status in ('pending', 'sent') and p.is_active = false;
    if v_inactive_print > 0
       and not exists (
         select 1 from public.db_health_alert_log
         where kind = 'db-health-print-inactive-printer' and sent_at >= now() - interval '60 minutes'
       ) then
      perform public._queue_system_alert(
        'db-health',
        v_inactive_print || ' trabajo(s) de impresion encolados a impresora INACTIVA',
        'db_health_watchdog detecto ' || v_inactive_print || ' print_job (pending/sent) cuya impresora tiene is_active=false.' || chr(10)
          || 'Nunca se van a imprimir: claim_print_jobs solo reclama de impresoras activas.',
        'db-health-print-inactive-printer'
      );
    end if;$viejo$;
  v_nuevo text := $nuevo$    -- Aviso 5 — tickets encolados a una impresora marcada como inactiva, POR LOCAL.
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
    end if;$nuevo$;
  v_veces integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'db_health_watchdog';
  v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  IF v_veces <> 1 THEN
    RAISE EXCEPTION 'el ancla del aviso 5 aparece % veces, esperaba 1', v_veces;
  END IF;
  EXECUTE replace(v_def, v_viejo, v_nuevo);
END;
$ancla5$;

-- ── 4. El vigía de silencio: la actividad manda sobre la bandera ──────────
create or replace function public.ingesta_silencio_watchdog(
  p_min_punta       integer  default 30,
  p_min_valle       integer  default 60,
  p_debounce_window interval default '02:00:00'::interval
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $watchdog$
DECLARE
  v_loc        record;
  v_n          integer := 0;
  v_hoy        date;
  v_hora       integer;
  v_apertura   timestamptz;
  v_cierre     timestamptz;
  v_exc_ap     timestamptz;
  v_exc_ci     timestamptz;
  v_ultima     timestamptz;
  v_ancla      timestamptz;
  v_mudo       integer;
  v_umbral     integer;
  v_sev        text;
  v_corto      text;
  v_otras      integer;
  v_sin_hora   text[] := '{}';
  v_vende_apagado text[] := '{}';
  v_dominante  text;
  v_pct        numeric;
  v_ultima_dom timestamptz;
  v_mudo_dom   integer;
BEGIN
  v_hoy  := (now() at time zone 'Europe/Madrid')::date;
  v_hora := extract(hour from (now() at time zone 'Europe/Madrid'));

  FOR v_loc IN
    SELECT l.id, l.name, l.account_id, a.name AS cuenta,
           EXISTS (SELECT 1 FROM public.business_hours bh WHERE bh.location_id = l.id) AS tiene_horario
      FROM public.locations l
      JOIN public.accounts a ON a.id = l.account_id
     -- ── EL CRITERIO YA NO ES LA BANDERA, ES LA ACTIVIDAD (09/09) ────────
     -- Escribí «sólo locales con `l.active`» y estaba mal, y se vio con un
     -- caso: un local con la bandera apagada desde el 18/06 facturando 3.254 €
     -- en 30 días. Con aquella vara no se habría vigilado NUNCA mientras
     -- facturaba. La bandera la mantiene una persona; las ventas no mienten.
     -- Y que la bandera diga lo contrario es un aviso en sí mismo — está
     -- abajo, en su propio bloque.
     --
     -- El estado de la CUENTA sí se respeta: eso no es una bandera olvidada,
     -- es una decisión de negocio con fecha y motivo escritos.
     WHERE a.is_internal IS NOT TRUE
       AND a.status = 'active'
       AND a.suspended_at IS NULL AND a.archived_at IS NULL AND a.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM public.sale s
                    WHERE s.location_id = l.id AND s.sold_at >= now() - interval '7 days')
     ORDER BY a.name, l.name
  LOOP
    -- Sin horario no hay veto posible, y vigilar sin veto es la franja fija
    -- otra vez. No se vigila — pero se dice, abajo.
    IF NOT v_loc.tiene_horario THEN
      v_sin_hora := v_sin_hora || (v_loc.cuenta || ' · ' || v_loc.name);
      CONTINUE;
    END IF;

    -- ── EL VETO ───────────────────────────────────────────────────────────
    CONTINUE WHEN NOT public.is_brand_open(v_loc.id, NULL, now());

    -- ── La apertura del tramo EN CURSO, que es el ancla del silencio ──────
    SELECT o.opened_from, o.opened_until INTO v_apertura, v_cierre
      FROM public.availability_location_open_minutes(
             v_loc.id, now() - interval '18 hours', now() + interval '12 hours') o
     WHERE o.opened_from <= now() AND o.opened_until > now()
     ORDER BY o.opened_from DESC
     LIMIT 1;

    -- Si hoy hay una excepción que ABRE en otro horario, manda ella (misma
    -- precedencia que `is_brand_open`). Hoy no existe ninguna en toda la tabla
    -- —las 92 que hay son cierres, y todas de un local inactivo— pero sin esto
    -- el ancla saldría del horario normal el día que aparezca la primera.
    -- Se lee aparte y sólo pisa si hay fila: un SELECT INTO sin resultados
    -- pone NULL, y eso se llevaría por delante lo que acabamos de calcular.
    SELECT (v_hoy + e.open_time) AT TIME ZONE 'Europe/Madrid',
           CASE WHEN e.close_time <= e.open_time
                THEN (v_hoy + 1 + e.close_time) AT TIME ZONE 'Europe/Madrid'
                ELSE (v_hoy + e.close_time) AT TIME ZONE 'Europe/Madrid' END
      INTO v_exc_ap, v_exc_ci
      FROM public.business_hours_exception e
     WHERE e.location_id = v_loc.id
       AND e.exception_date = v_hoy
       AND e.is_closed = false
       AND e.open_time IS NOT NULL AND e.close_time IS NOT NULL
     ORDER BY (e.brand_id IS NOT NULL) DESC
     LIMIT 1;
    IF v_exc_ap IS NOT NULL THEN
      v_apertura := v_exc_ap;
      v_cierre   := v_exc_ci;
    END IF;

    -- No se inventa un ancla: si el horario dice abierto pero no sabemos desde
    -- cuándo, no se avisa. Es preferible callar UNA pasada a contar minutos
    -- desde una hora que no es.
    CONTINUE WHEN v_apertura IS NULL;

    -- ── Cuánto lleva mudo ────────────────────────────────────────────────
    SELECT max(s.sold_at) INTO v_ultima
      FROM public.sale s
     WHERE s.location_id = v_loc.id AND s.sold_at >= v_apertura;

    -- Sin ventas desde que abrió, el ancla es la apertura. Aquí se cierra el
    -- punto ciego: antes eso era NULL y el vigía callaba.
    v_ancla := greatest(coalesce(v_ultima, v_apertura), v_apertura);
    v_mudo  := round(extract(epoch from (now() - v_ancla)) / 60);

    IF v_hora >= 20 THEN
      v_umbral := greatest(coalesce(p_min_punta, 30), 5);
      v_sev    := 'critico';
    ELSE
      v_umbral := greatest(coalesce(p_min_valle, 60), 5);
      v_sev    := 'alto';
    END IF;

    v_corto := CASE WHEN v_loc.name LIKE v_loc.cuenta || ' %'
                    THEN substr(v_loc.name, length(v_loc.cuenta) + 2)
                    ELSE v_loc.name END;

    -- ── 1) EL LOCAL, MUDO ────────────────────────────────────────────────
    IF v_mudo >= v_umbral THEN
      SELECT count(*) INTO v_otras
        FROM public.locations l2
       WHERE l2.account_id = v_loc.account_id AND l2.id <> v_loc.id AND l2.active
         AND EXISTS (SELECT 1 FROM public.sale s
                      WHERE s.location_id = l2.id
                        AND s.sold_at > now() - make_interval(mins => v_umbral));

      PERFORM public.encolar_alerta(
        p_kind    => 'ingesta_silencio',
        p_subject => 'Sin pedidos desde hace ' || v_mudo::text || ' min — está abierto',
        p_message =>
          v_corto || ' lleva ' || v_mudo::text || ' min sin ningún pedido y ahora mismo está abierto'
          || coalesce(' (cierra a las ' || to_char(v_cierre at time zone 'Europe/Madrid', 'HH24:MI') || ')', '')
          || '.' || chr(10)
          || CASE WHEN v_ultima IS NULL
                  THEN 'No ha entrado ninguno desde que abrió, a las '
                       || to_char(v_apertura at time zone 'Europe/Madrid', 'HH24:MI') || '.'
                  ELSE 'Último pedido: '
                       || to_char(v_ultima at time zone 'Europe/Madrid', 'HH24:MI') || '.' END
          || CASE WHEN v_otras > 0
                  THEN ' Las otras tiendas sí están recibiendo, así que no parece la cocina.'
                  ELSE '' END
          || chr(10) || chr(10)
          || 'Revisa la conexión de la caja en ' || v_corto || ' (paneles de Glovo y Uber).',
        p_debounce_kind   => 'ingesta_silencio_' || v_loc.id::text || '_' || v_sev || '_'
                             || to_char(v_hoy, 'YYYYMMDD'),
        p_debounce_window => p_debounce_window,
        p_account_id      => v_loc.account_id,
        p_location_id     => v_loc.id,
        p_brand_id        => NULL,
        p_severity        => v_sev
      );
      v_n := v_n + 1;
      CONTINUE;  -- si no entra NADA, no tiene sentido avisar además por vía
    END IF;

    -- ── 2) LA VÍA QUE MÁS PEDIDOS TRAE, MUDA ─────────────────────────────
    SELECT s.source, round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 1)
      INTO v_dominante, v_pct
      FROM public.sale s
     WHERE s.location_id = v_loc.id AND s.sold_at >= now() - interval '7 days'
     GROUP BY s.source
     ORDER BY count(*) DESC
     LIMIT 1;

    CONTINUE WHEN v_dominante IS NULL OR coalesce(v_pct, 0) < 60;

    SELECT max(s.sold_at) INTO v_ultima_dom
      FROM public.sale s
     WHERE s.location_id = v_loc.id AND s.source = v_dominante AND s.sold_at >= v_apertura;

    v_mudo_dom := round(extract(epoch from (now() - greatest(coalesce(v_ultima_dom, v_apertura), v_apertura))) / 60);

    IF v_mudo_dom >= greatest(coalesce(p_min_valle, 60), 5) THEN
      PERFORM public.encolar_alerta(
        p_kind    => 'ingesta_silencio',
        p_subject => v_dominante || ' lleva ' || v_mudo_dom::text || ' min sin traer pedidos',
        p_message =>
          'En ' || v_corto || ', ' || v_dominante || ' trae el ' || v_pct::text
          || ' % de los pedidos y lleva ' || v_mudo_dom::text
          || ' min sin traer ninguno, mientras otras vías sí están entrando.' || chr(10)
          || CASE WHEN v_ultima_dom IS NULL
                  THEN 'No ha traído ninguno desde que abrió.'
                  ELSE 'Último suyo: ' || to_char(v_ultima_dom at time zone 'Europe/Madrid','HH24:MI') || '.' END
          || chr(10) || chr(10)
          || 'Suele ser la conexión de esa vía, no la cocina.',
        p_debounce_kind   => 'ingesta_via_' || v_loc.id::text || '_' || v_dominante || '_'
                             || to_char(v_hoy, 'YYYYMMDD'),
        p_debounce_window => p_debounce_window,
        p_account_id      => v_loc.account_id,
        p_location_id     => v_loc.id,
        p_brand_id        => NULL,
        p_severity        => 'aviso'
      );
      v_n := v_n + 1;
    END IF;
  END LOOP;

  -- ── VENDE CON LA BANDERA APAGADA ───────────────────────────────────────
  -- Se mira APARTE y SIN el filtro de estado de cuenta, a propósito: una cuenta
  -- suspendida que sigue vendiendo es justo la noticia, no algo que callar. Si
  -- se filtrara aquí por `status='active'`, el único caso que existe hoy —el que
  -- destapó todo esto— sería invisible.
  --
  -- Es un ESTADO, no un suceso, así que la clave del antirruido va por la LISTA
  -- de locales y no por la fecha: sólo vuelve a sonar si la lista cambia.
  SELECT coalesce(array_agg(t.linea ORDER BY t.linea), '{}')
    INTO v_vende_apagado
    FROM (
      SELECT a2.name || ' · ' || l2.name || ' — ' || cnt.n || ' venta(s) en 7 días' AS linea
        FROM public.locations l2
        JOIN public.accounts a2 ON a2.id = l2.account_id
        JOIN LATERAL (SELECT count(*) AS n FROM public.sale s2
                       WHERE s2.location_id = l2.id
                         AND s2.sold_at >= now() - interval '7 days') cnt ON cnt.n > 0
       WHERE l2.active = false
         AND a2.is_internal IS NOT TRUE
         AND a2.archived_at IS NULL AND a2.deleted_at IS NULL
    ) t;

  IF array_length(v_vende_apagado, 1) > 0 THEN
    PERFORM public.encolar_alerta(
      p_kind    => 'ingesta_silencio',
      p_subject => 'Vende con el local apagado en Folvy: '
                   || array_length(v_vende_apagado, 1)::text || ' local(es)',
      p_message =>
        'Estos locales están marcados como INACTIVOS en Folvy y aun así han entrado ventas suyas '
        || 'en los últimos 7 días:' || chr(10)
        || '· ' || array_to_string(v_vende_apagado, chr(10) || '· ') || chr(10) || chr(10)
        || 'Mientras la bandera diga inactivo, ese local queda fuera de las pantallas y de los '
        || 'vigías que la miran. O el local se reactiva, o hay que dejar de aceptarle ventas: '
        || 'las dos cosas a la vez no se sostienen.',
      p_debounce_kind   => 'ingesta_vende_apagado_' || md5(array_to_string(v_vende_apagado, '|')),
      p_debounce_window => interval '7 days',
      p_account_id      => NULL,
      p_location_id     => NULL,
      p_brand_id        => NULL,
      p_severity        => 'alto'
    );
  END IF;

  -- ── AVISO DE COBERTURA ─────────────────────────────────────────────────
  -- Un vigía que no dice lo que NO mira da la sensación de que mira todo.
  --
  -- ⚠️ CAMBIO SOBRE EL FICHERO DE CODE, decidido por Julio (09/09): Code lo
  -- puso una vez AL DÍA. Diario está mal: esto no cambia de un día para otro y
  -- sería un correo cada mañana sobre lo mismo, que es justo el ruido que se
  -- viene a quitar. La clave de antirruido pasa a ir por la LISTA de locales
  -- afectados, no por la fecha: sólo vuelve a avisar cuando la lista CAMBIA.
  -- Techo real de 7 días, y no es un número elegido: el drenaje borra las filas
  -- enviadas a los 7 días, así que a partir de ahí la clave deja de existir y
  -- vuelve a sonar una vez. Ni calla sobre su punto ciego ni da la lata.
  IF array_length(v_sin_hora, 1) > 0 THEN
    PERFORM public.encolar_alerta(
      p_kind    => 'ingesta_silencio',
      p_subject => 'Sin vigilar por falta de horario: ' || array_length(v_sin_hora, 1)::text || ' local(es)',
      p_message =>
        'Estos locales tienen ventas y están activos, pero no tienen horario cargado, así que '
        || 'no se puede saber si deberían estar recibiendo pedidos. NO se vigilan:' || chr(10)
        || '· ' || array_to_string(v_sin_hora, chr(10) || '· ') || chr(10) || chr(10)
        || 'Cárgales el horario y empiezan a vigilarse solos.',
      p_debounce_kind   => 'ingesta_sin_horario_' || md5(array_to_string(v_sin_hora, '|')),
      p_debounce_window => interval '7 days',
      p_account_id      => NULL,
      p_location_id     => NULL,
      p_brand_id        => NULL,
      p_severity        => 'info'
    );
  END IF;

  RETURN v_n;
END;
$watchdog$;

revoke execute on function public.ingesta_silencio_watchdog(integer, integer, interval)
  from public, anon, authenticated;

-- ── Verificación DENTRO de la transacción ─────────────────────────────────
DO $verifica$
DECLARE
  v_oid oid;
  v_src text;
BEGIN
  -- db-health: una firma, y el aviso 6 ya agrupa y lleva el local.
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
  -- Sin contar espacios a ojo: la primera versión de esta guarda comparaba con
  -- un espacio de más y habría abortado la migración por su cuenta. Lo cazó
  -- probarla; leyéndola no se ve.
  IF v_src NOT LIKE '%=> t.location_id%'
     OR v_src NOT LIKE '%group by f.account_id, f.location_id%' THEN
    RAISE EXCEPTION 'el aviso 6 no lleva el local: es el bug que esto venia a arreglar';
  END IF;
  IF v_src LIKE '%sin impresora activa en el local%' THEN
    RAISE EXCEPTION 'sigue el asunto viejo, el que decia «el local» sin decir cual';
  END IF;

  -- Avisos 4 y 5: agrupados, con cuenta y local, y sin el antirruido global.
  IF v_src NOT LIKE '%group by j.account_id, j.location_id) t;%' THEN
    RAISE EXCEPTION 'los avisos 4 y 5 no agrupan por cuenta y local';
  END IF;
  IF v_src NOT LIKE '%db-health-print-stuck_%'
     OR v_src NOT LIKE '%db-health-print-inactive-printer_%' THEN
    RAISE EXCEPTION 'los avisos 4 y 5 siguen con el antirruido global: un local tapa al otro';
  END IF;
  IF v_src NOT LIKE '%t.impresoras%' THEN
    RAISE EXCEPTION 'el aviso 5 no dice que impresora es';
  END IF;
  -- Los TRES avisos de impresion pasan ya por la puerta nueva, y quedan
  -- exactamente TRES llamadas a la vieja: los avisos 1 y 2 —que hablan de la
  -- BASE DE DATOS entera, no de un local, asi que la medida de este paso no
  -- les aplica— y el manejador de excepciones del final.
  --
  -- TRES, y no dos: escribi la guarda esperando 2 contando los bloques a ojo,
  -- me olvide del manejador, y la guarda habria abortado la migracion ella
  -- sola. Lo cazo correrla contra el ensayo; leyendola no se ve. Es la
  -- segunda vez que pasa en este mismo fichero.
  --
  -- Se cuentan en vez de mirar si aparecen, porque si un ancla se llevara un
  -- bloque por delante el numero bajaria y un LIKE no lo veria.
  --
  -- Y se cuenta la LLAMADA (`public.x(`), no el nombre suelto: contando el
  -- nombre salian 4 encolados donde hay 3, porque uno de los comentarios que
  -- se meten aqui nombra `encolar_alerta` en prosa. Segunda guarda de este
  -- fichero que habria abortado la migracion ella sola, y otra vez la cazo
  -- correrla contra el ensayo, no leerla.
  IF (length(v_src) - length(replace(v_src, 'public._queue_system_alert(', '')))
       / length('public._queue_system_alert(') <> 3 THEN
    RAISE EXCEPTION 'esperaba 3 llamadas a _queue_system_alert (avisos 1 y 2 y el manejador), hay %',
      (length(v_src) - length(replace(v_src, 'public._queue_system_alert(', '')))
        / length('public._queue_system_alert(');
  END IF;
  IF (length(v_src) - length(replace(v_src, 'public.encolar_alerta(', '')))
       / length('public.encolar_alerta(') <> 3 THEN
    RAISE EXCEPTION 'esperaba 3 llamadas a encolar_alerta (avisos 4, 5 y 6), hay %',
      (length(v_src) - length(replace(v_src, 'public.encolar_alerta(', '')))
        / length('public.encolar_alerta(');
  END IF;
  -- Y que las anclas no se han llevado por delante los avisos 1 y 2, que no
  -- se tocan. No se comprueban por las claves de los avisos 4/5: esas ahora
  -- casan igual con el texto nuevo, asi que no probarian nada.
  IF v_src NOT LIKE '%db-health-lock%' OR v_src NOT LIKE '%db-health-connections%' THEN
    RAISE EXCEPTION 'el reemplazo por ancla se ha llevado otros avisos de db_health_watchdog';
  END IF;

  -- El vigía de silencio: firma intacta, criterio nuevo, aviso nuevo.
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
  IF v_src LIKE '%WHERE l.active%' THEN
    RAISE EXCEPTION 'el vigia sigue filtrando por la bandera del local';
  END IF;
  IF v_src NOT LIKE '%v_vende_apagado%' THEN
    RAISE EXCEPTION 'falta el aviso de «vende con la bandera apagada»';
  END IF;
  IF v_src NOT LIKE '%is_brand_open%' OR v_src NOT LIKE '%v_sin_hora%' THEN
    RAISE EXCEPTION 'al vigia le falta el veto o el aviso de cobertura';
  END IF;

  RAISE NOTICE 'Paso 6: los seis avisos de db-health dicen el local, y el vigia mira la actividad, no la bandera.';
END;
$verifica$;

commit;

-- ══════════════════════════════════════════════════════════════════════════
-- DESPUÉS DE APLICAR
--
-- 0) Que el cuerpo es EL MISMO que se ensayó, medido igual a los dos lados:
--   select length(prosrc) as chars, md5(prosrc) as md5
--     from pg_proc where oid = 'public.db_health_watchdog()'::regprocedure;
--   -- esperado: 9251 · c14fdaf3b7025f70e306e68bff35800f
--
-- 1) Que el aviso de impresoras ya dice de quién habla. Se dispara solo: hay
--    fallos casi a diario desde el 12/08.
--   select to_char(created_at at time zone 'Europe/Madrid','DD/MM HH24:MI') as cuando,
--          severity, a.name as cuenta, l.name as local, subject
--     from public.system_alert_queue q
--     left join public.accounts a on a.id = q.account_id
--     left join public.locations l on l.id = q.location_id
--    where q.kind = 'db-health' and q.created_at > now() - interval '2 hours'
--    order by q.created_at desc;
--
-- 2) Que «vende con la bandera apagada» sale UNA vez y no cada 10 minutos:
--   select count(*), min(created_at), max(created_at)
--     from public.system_alert_queue
--    where subject like 'Vende con el local apagado%';
--   -- Hoy la lista es de uno: Kitchen Grill LstQ. Cuando se arregle el webhook
--   -- (§6b del encargo) dejarán de entrarle ventas y el aviso se apagará solo.
-- ══════════════════════════════════════════════════════════════════════════
