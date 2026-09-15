-- ═══════════════════════════════════════════════════════════════════════════
-- EL PASE · PIEZAS 3 Y 4 · las que tocan el camino del pedido
-- Aplicada el 15/09/2026 a las 07:3x de Madrid, FUERA de la banda.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- La otra mitad de la tanda del 14/09. Anoche no entraron porque su ensayo no
-- se podía correr: el tablero estaba vacío y el ensayo E habría comparado cero
-- contra cero. Hoy los ensayos NO DEPENDEN DEL TRÁFICO: plantan su propia
-- población (regla 36 — si el defecto no existe en los datos, la prueba tiene
-- que crearlo).
--
-- 🔴 POR QUÉ PLANTAR AQUÍ ES SEGURO, y va citado porque en enero nadie se
-- acordará. Medido anoche, con testigo a los dos lados:
--
--   · No existe vía síncrona de salir de esta base. De las DIEZ extensiones
--     instaladas, la única que sale afuera es `pg_net` 0.20.0. Cero funciones
--     en toda la base llaman a un `http_post(`/`http_get(` que no sea `net.`.
--   · Un `pg_net` encolado y revertido NO SALE: revertido → 0 en la cola y 0
--     respuestas; testigo sin revertir → salió, respuesta id 145336. La
--     ausencia sólo significa algo porque el testigo dejó fila.
--   · `tg_auto_print_on_accept` encola en `print_job` con un `insert` normal:
--     otra sesión no puede leer una fila sin confirmar, así que el agente de
--     impresión no la ve.
--
-- Por eso TODO lo que se planta va dentro de un punto de retorno y se deshace
-- solo. Lo único que no se deshace es el cerrojo de fila mientras corre, que
-- son segundos: que un ensayo sea reversible no lo hace invisible, y por eso
-- esto se aplica a las 07:30 y no a las 14:00.

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


-- ═══ EL «ANTES», CON LAS FUNCIONES VIEJAS TODAVÍA PUESTAS ══════════════════
-- Sobre el TRÁFICO REAL, que a esta hora puede ser cero. Se guarda igual: si
-- sale cero contra cero se dice, y la prueba de verdad es la población
-- plantada de más abajo.
create temp table _antes on commit drop as
select l.id as location_id, l.name as local,
       (select d.token from kds_device d
         where d.location_id = l.id and d.is_active order by d.label limit 1) as token,
       jsonb_array_length(coalesce(
         public.kds_board(l.id, (select d.token from kds_device d
                                  where d.location_id = l.id and d.is_active
                                  order by d.label limit 1)) -> 'tickets', '[]'::jsonb)) as tickets
  from locations l
 where l.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and exists (select 1 from kds_device d where d.location_id = l.id and d.is_active);

create temp table _md5_antes on commit drop as
select proname, md5(prosrc) as md5, length(prosrc) as largo
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('kds_board', 'tg_sale_seal_kpi_hitos');


-- ═══ 3 · LA CONDICIÓN DE `kds_board` ═══════════════════════════════════════
--
-- 🔴 SE INSERTA POR ANCLAJE, NO SE REESCRIBE LA FUNCIÓN. El cuerpo tiene 5 KB
-- y saltos de línea CRLF mezclados con LF (el bloque de B47 es LF y el resto
-- CRLF). Reteclearlo es como se cuela una diferencia que nadie ve: hoy mismo,
-- al copiar el fichero de anoche, me salió un md5 distinto por eso. Insertando
-- sobre `pg_get_functiondef` queda garantizado que TODO LO DEMÁS es idéntico
-- byte a byte, y si el ancla no aparece la migración se cae en vez de adivinar.
--
-- La condición pregunta por el SELLO, no repite la lista de estados: `ready_at`
-- tiene un solo escritor en toda la base y ya es la definición de «listo». Una
-- lista escrita a mano aquí sería la quinta definición.
--
-- Y va colgada del interruptor: con `pase_activo` en false el `or` es cierto
-- para toda fila y el filtro es un no-op — literalmente nada cambia.
do $pieza3$
declare
  ANCLA constant text :=
    'and (s.status <> ''closed'' or coalesce(s.closed_at, s.sold_at) >= now() - interval ''2 hours'')';
  NUEVO constant text := '
      -- EL PASE (15/09/2026): con el Pase encendido en este local, un pedido
      -- que ya tiene sello de cocina sale del tablero de cocina. Antes sólo
      -- salía cuando la expo lo bajaba, y donde hay Pase ya no hay expo que lo
      -- baje. Se pregunta por `ready_at` --un solo escritor en toda la base--
      -- y no por una lista de estados, que sería la quinta definición de
      -- «listo». Con el interruptor apagado el `or` es cierto siempre: no-op.
      and (
        s.ready_at is null
        or not coalesce((select k2.pase_activo from kitchen_time_config k2
                          where k2.location_id = v_location_id), false)
      )';
  v_def text := pg_get_functiondef('public.kds_board(uuid,text)'::regprocedure);
  v_ocurrencias int;
begin
  v_ocurrencias := (length(v_def) - length(replace(v_def, ANCLA, ''))) / length(ANCLA);
  if v_ocurrencias <> 1 then
    raise exception 'PIEZA 3: el ancla aparece % veces, esperaba 1. `kds_board` ha '
                    'cambiado desde que se escribió esto: parar y volver a mirar.', v_ocurrencias;
  end if;
  execute replace(v_def, ANCLA, ANCLA || NUEVO);
end
$pieza3$;


-- ═══ 3b · LAS DOS MEJORAS QUE `pase_board` TIENE Y ÉSTA NO ═════════════════
--
-- El bloqueo y el ensayo ya están pagados por la pieza 3, así que van de
-- propina. Son dos de las tres que se ficharon anoche:
--
--   · `search_path` a `public, pg_temp` — sin `pg_temp` al final, una tabla
--     temporal puede suplantar a una real dentro de una función SECURITY
--     DEFINER.
--   · revocar `PUBLIC:EXECUTE`.
--
-- 🔴 LA TERCERA NO ENTRA, y no por lo que se pensaba. Se fichó como «deja de
-- aceptar `p_location_id` y derívalo del token, como `pase_board`». Medido hoy:
-- `KdsBoardPage.tsx:104` la llama con local y SIN TOKEN — es la oficina. Ese
-- parámetro no es una debilidad ahí: es la única forma que tiene la oficina de
-- preguntar por un local. `pase_board` puede prescindir de él porque nació sólo
-- para tablets. Así que no es «habría que tocar el front»: es que la mejora
-- está mal planteada para esta función. Se retira de la lista.
alter function public.kds_board(uuid, text) set search_path = public, pg_temp;
revoke execute on function public.kds_board(uuid, text) from public;


-- ═══ 4 · LA LÍNEA DEL SELLO ════════════════════════════════════════════════
--
-- Mismo anclaje y por el mismo motivo (CRLF).
--
-- Al volver a cocina se borra el sello. `kds_board` pregunta ahora por
-- `ready_at`, así que sin esto un pedido reabierto NO volvería al tablero. Y es
-- correcto por sí mismo: un pedido que vuelve a cocina no tiene cumplido el
-- hito de cocina, y el cronómetro no puede medir desde un «listo» que ya no
-- vale. El botón «Reabrir» existe y se pinta (OrderCard.tsx:757); no se ha
-- pulsado nunca --0 de 10.719-- y por eso nadie lo había notado.
do $pieza4$
declare
  ANCLA constant text := chr(13)||chr(10)||'  end if;'||chr(13)||chr(10)||
                         '  return new;'||chr(13)||chr(10)||'end;';
  NUEVO constant text := chr(13)||chr(10)||'  end if;'||chr(13)||chr(10)||
    '  -- EL PASE (15/09/2026): reabrir borra el sello. Ver la nota de la'||chr(13)||chr(10)||
    '  -- migración; sin esto un pedido reabierto no vuelve al tablero de cocina.'||chr(13)||chr(10)||
    '  if new.order_status in (''new'',''received'',''accepted'',''in_preparation'')'||chr(13)||chr(10)||
    '     and old.order_status is distinct from new.order_status'||chr(13)||chr(10)||
    '     and new.ready_at is not null then'||chr(13)||chr(10)||
    '    new.ready_at := null;'||chr(13)||chr(10)||
    '  end if;'||chr(13)||chr(10)||
    '  return new;'||chr(13)||chr(10)||'end;';
  v_def text := pg_get_functiondef('public.tg_sale_seal_kpi_hitos()'::regprocedure);
  v_ocurrencias int;
begin
  v_ocurrencias := (length(v_def) - length(replace(v_def, ANCLA, ''))) / length(ANCLA);
  if v_ocurrencias <> 1 then
    raise exception 'PIEZA 4: el ancla aparece % veces, esperaba 1. El sello ha '
                    'cambiado desde que se escribió esto: parar y volver a mirar.', v_ocurrencias;
  end if;
  execute replace(v_def, ANCLA, NUEVO);
end
$pieza4$;


-- ═══ ENSAYO E · el «después», con la misma vara ════════════════════════════
do $ensayo_e$
declare
  v_local text; v_antes int; v_ahora int; v_fallos text[] := '{}';
  v_vacio boolean := true;
begin
  for v_local, v_antes, v_ahora in
    select a.local, a.tickets,
           jsonb_array_length(coalesce(public.kds_board(a.location_id, a.token) -> 'tickets', '[]'::jsonb))
      from _antes a
  loop
    if v_ahora is distinct from v_antes then
      v_fallos := v_fallos || format('E: %s tenía %s tickets y ahora %s, con el Pase APAGADO',
                                     v_local, v_antes, v_ahora);
    end if;
    if v_antes > 0 then v_vacio := false; end if;
    raise notice 'ENSAYO E · %: % tickets antes, % después.', v_local, v_antes, v_ahora;
  end loop;

  if array_length(v_fallos, 1) > 0 then
    raise exception 'ENSAYO E: %', array_to_string(v_fallos, ' · ');
  end if;
  if v_vacio then
    raise notice 'ENSAYO E · AVISO: el tráfico real era CERO en todos los locales, '
                 'así que esta mitad no prueba nada por sí sola. La que prueba es '
                 'la población plantada del ensayo siguiente.';
  end if;
end
$ensayo_e$;


-- ═══ ENSAYOS CON POBLACIÓN PLANTADA · E2 · F · G · A2 · D · H ══════════════
--
-- Todo lo que se planta vive dentro de este punto de retorno y se deshace con
-- el `raise` del final: las ventas, sus trabajos de impresión, sus movimientos
-- de stock y el interruptor. Las variables de plpgsql NO se revierten, así que
-- los fallos recogidos sobreviven y se levantan después.
do $ensayo_plantado$
declare
  CUENTA    constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  PLANTILLA constant uuid := '00000000-0000-0000-0000-000000000001';
  ALCALA    constant uuid := '38158159-cd71-4056-950b-53425afac1ce';
  v_tok_cocina text; v_tok_pase text;
  v_normal uuid; v_sellada uuid; v_cancelada uuid; v_ajena uuid; v_flota uuid;
  v_b jsonb; v_fallos text[] := '{}';
  function_dummy int;
begin
  select token into v_tok_cocina from kds_device
   where account_id = CUENTA and label = 'Cocina' and location_id = ALCALA;
  select token into v_tok_pase   from kds_device
   where account_id = CUENTA and label = 'Pase'   and location_id = ALCALA;

  begin
    -- ── LA POBLACIÓN, elegida a mano: cada fila prueba una cosa ───────────
    insert into sale (account_id, location_id, sold_at, status, order_status, external_ref)
         values (CUENTA, ALCALA, now(), 'open', 'in_preparation', 'ENSAYO-PASE-normal')
      returning id into v_normal;

    insert into sale (account_id, location_id, sold_at, status, order_status, external_ref)
         values (CUENTA, ALCALA, now(), 'open', 'in_preparation', 'ENSAYO-PASE-sellada')
      returning id into v_sellada;

    insert into sale (account_id, location_id, sold_at, status, order_status, external_ref,
                      cancelled_at)
         values (CUENTA, ALCALA, now(), 'open', 'cancelled', 'ENSAYO-PASE-cancelada',
                 now() - interval '3 hours')
      returning id into v_cancelada;

    insert into sale (account_id, location_id, sold_at, status, order_status, external_ref)
         values (PLANTILLA, ALCALA, now(), 'open', 'in_preparation', 'ENSAYO-PASE-ajena')
      returning id into v_ajena;

    insert into sale (account_id, location_id, sold_at, status, order_status, external_ref,
                      service_type, has_courier, carrier_code, rider_name, rider_phone,
                      customer_phone, customer_name)
         values (CUENTA, ALCALA, now(), 'open', 'in_preparation', 'ENSAYO-PASE-flota',
                 'own_delivery', true, 'catcher', 'Repartidor de ensayo', '+34600000001',
                 '+34600000002', 'Cliente de ensayo')
      returning id into v_flota;

    -- El sello se pone POR EL CAMINO, no a mano: se mueve el estado como lo
    -- hace la tablet y se mira qué escribe el disparador (regla 10).
    update sale set order_status = 'awaiting_collection' where id = v_sellada;
    if (select ready_at from sale where id = v_sellada) is null then
      v_fallos := v_fallos || 'G: marcar listo NO sella `ready_at`';
    end if;

    -- ── E2 · CON EL PASE APAGADO, la condición nueva es un no-op ──────────
    v_b := public.kds_board(ALCALA, v_tok_cocina);
    if not exists (select 1 from jsonb_array_elements(v_b->'tickets') t
                    where (t->>'sale_id')::uuid = v_normal) then
      v_fallos := v_fallos || 'E2: el pedido normal NO sale en cocina con el Pase apagado';
    end if;
    if not exists (select 1 from jsonb_array_elements(v_b->'tickets') t
                    where (t->>'sale_id')::uuid = v_sellada) then
      v_fallos := v_fallos || 'E2: el pedido SELLADO ya no sale con el Pase APAGADO (la condición no es no-op)';
    end if;
    if exists (select 1 from jsonb_array_elements(v_b->'tickets') t
                where (t->>'sale_id')::uuid = v_cancelada) then
      v_fallos := v_fallos || 'E2: un pedido cancelado sale en cocina';
    end if;
    if exists (select 1 from jsonb_array_elements(v_b->'tickets') t
                where (t->>'sale_id')::uuid = v_ajena) then
      v_fallos := v_fallos || 'E2: un pedido de OTRA CUENTA sale en cocina';
    end if;

    -- ── F · CON EL PASE ENCENDIDO, el sellado se va y el resto se queda ───
    update kitchen_time_config set pase_activo = true where location_id = ALCALA;
    v_b := public.kds_board(ALCALA, v_tok_cocina);
    if exists (select 1 from jsonb_array_elements(v_b->'tickets') t
                where (t->>'sale_id')::uuid = v_sellada) then
      v_fallos := v_fallos || 'F: con el Pase ENCENDIDO el pedido sellado sigue en cocina';
    end if;
    if not exists (select 1 from jsonb_array_elements(v_b->'tickets') t
                    where (t->>'sale_id')::uuid = v_normal) then
      v_fallos := v_fallos || 'F: con el Pase encendido se ha llevado por delante un pedido SIN sellar';
    end if;
    update kitchen_time_config set pase_activo = false where location_id = ALCALA;

    -- ── G · REABRIR borra el sello y el pedido vuelve ─────────────────────
    update sale set order_status = 'in_preparation' where id = v_sellada;
    if (select ready_at from sale where id = v_sellada) is not null then
      v_fallos := v_fallos || 'G: reabrir NO borra el sello';
    end if;
    update kitchen_time_config set pase_activo = true where location_id = ALCALA;
    if not exists (select 1 from jsonb_array_elements(public.kds_board(ALCALA, v_tok_cocina)->'tickets') t
                    where (t->>'sale_id')::uuid = v_sellada) then
      v_fallos := v_fallos || 'G: el pedido reabierto no vuelve al tablero de cocina';
    end if;
    update kitchen_time_config set pase_activo = false where location_id = ALCALA;

    -- ── A2 · ALCANCE POR CUENTA en `pase_board` ───────────────────────────
    v_b := public.pase_board(v_tok_pase);
    if exists (select 1 from jsonb_array_elements(v_b->'tarjetas') t
                where (t->>'sale_id')::uuid = v_ajena) then
      v_fallos := v_fallos || 'A2: una venta de OTRA cuenta sale en el Pase';
    end if;
    if not exists (select 1 from jsonb_array_elements(v_b->'tarjetas') t
                    where (t->>'sale_id')::uuid = v_normal) then
      v_fallos := v_fallos || 'A2: la venta de la cuenta buena NO sale en el Pase (el ensayo no mide nada)';
    end if;

    -- ── D · EL TELÉFONO DEL CLIENTE NO VIAJA ──────────────────────────────
    -- 🔴 Anoche este ensayo salió en verde sobre un tablero vacío: no había
    -- ninguna tarjeta con teléfono de cliente, así que no podía fallar. Ahora
    -- la hay, plantada a propósito, y se compara el VALOR contra el texto
    -- entero del jsonb.
    if v_b::text like '%+34600000002%' then
      v_fallos := v_fallos || 'D: el teléfono del CLIENTE viaja en el tablero del Pase';
    end if;
    if v_b::text not like '%+34600000001%' then
      v_fallos := v_fallos || 'D/H: el teléfono del REPARTIDOR no viaja, y tiene que viajar';
    end if;

    -- ── H · LA RAMA DE FLOTA, que anoche quedó sin ensayar ────────────────
    if not exists (select 1 from jsonb_array_elements(v_b->'tarjetas') t
                    where (t->>'sale_id')::uuid = v_flota
                      and nullif(trim(t->>'repartidor_nombre'), '') is not null
                      and nullif(trim(t->>'repartidor_telefono'), '') is not null) then
      v_fallos := v_fallos || 'H: una tarjeta con flota no trae nombre Y teléfono de repartidor';
    end if;

    raise exception 'DESHACER_PLANTADO';
  exception when others then
    if sqlerrm <> 'DESHACER_PLANTADO' then
      v_fallos := v_fallos || ('PLANTADO sin ensayar: ' || sqlerrm);
    end if;
  end;

  if array_length(v_fallos, 1) > 0 then
    raise exception 'ENSAYOS PLANTADOS: %', array_to_string(v_fallos, ' · ');
  end if;
  raise notice 'ENSAYOS PLANTADOS (E2, F, G, A2, D, H): en verde, y con población.';
end
$ensayo_plantado$;


-- ═══ GUARDA FINAL · ni una planta se queda, y el revoke se comprueba ═══════
do $guarda_final$
declare
  v_plantadas int;
  v_publico boolean;
  v_encendidos int;
begin
  select count(*) into v_plantadas from sale where external_ref like 'ENSAYO-PASE-%';
  if v_plantadas > 0 then
    raise exception 'GUARDA: han quedado % ventas plantadas sin deshacer. NO CONFIRMAR.', v_plantadas;
  end if;

  -- Un revoke que no se comprueba es la regla 36 otra vez.
  select has_function_privilege('public', 'public.kds_board(uuid,text)'::regprocedure, 'EXECUTE')
    into v_publico;
  if v_publico then
    raise exception 'GUARDA: `kds_board` sigue con PUBLIC:EXECUTE después del revoke.';
  end if;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='kds_board'
         and p.proconfig @> array['search_path=public, pg_temp']) <> 1 then
    raise exception 'GUARDA: `kds_board` no ha quedado con `search_path = public, pg_temp`.';
  end if;

  select count(*) into v_encendidos from kitchen_time_config where coalesce(pase_activo, false);
  if v_encendidos > 0 then
    raise exception 'GUARDA: han quedado % locales con el Pase ENCENDIDO. NO CONFIRMAR.', v_encendidos;
  end if;

  raise notice 'GUARDA FINAL: cero plantas, PUBLIC revocado, search_path puesto, cero locales encendidos.';
end
$guarda_final$;
