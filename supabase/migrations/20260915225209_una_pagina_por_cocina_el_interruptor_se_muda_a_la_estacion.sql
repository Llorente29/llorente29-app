-- ═══════════════════════════════════════════════════════════════════════════
-- UNA PÁGINA POR COCINA · LA BASE · 16/09/2026, 02:0x Madrid, FUERA DE BANDA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El interruptor del Pase se muda de `kitchen_time_config` (por LOCAL) a
-- `kitchen_station` (por ESTACIÓN), con su estado y su traza.
--
-- ── LA BANDA, con las tres condiciones medidas ───────────────────────────
--   Hora: 02:0x Madrid, fuera de 12:15–23:45.
--   Locales: los tres cerrados (Alcalá cerró a las 23:30).
--   Pedidos abiertos: 0 en los tres.
--   `kitchen_station` la lee `kds_board` en cada pedido, y el CHECK toma
--   ACCESS EXCLUSIVE sobre ella: por eso NO se hacía en banda.
--
-- ── EL ESTADO QUE SE MUEVE, medido antes de escribir esto ────────────────
--   Foodint Alcalá (cuenta 51ad1792, local 38158159)
--     pase_activo        true
--     pase_activo_at     15/09 09:10:17 Madrid
--     pase_activo_desde  'pantalla'
--     pase_activo_por    673fca49  (Julio)
--   Los otros seis locales, en false y sin traza.
--   §2bis.2 del encargo: ningún local tiene más de una estación `expo`.
--   Comprobado con `account_id` delante (regla 9): 7 locales, 7 expo, 7 prep.
--   La ambigüedad que obligaba a pararse NO existe.
--
-- ── 🔴 SEGUNDO INTENTO. El primero lo paró su propio ensayo ──────────────
--   `pase_board` leía las estaciones de salida QUE MIRA EL APARATO. Suena más
--   fino y es un cambio de comportamiento: la tablet «Cocina» de Alcalá mira
--   una `prep`, así que pasaba de `pase_activo: true` a `false`, y con eso le
--   volvía el botón de «Listo» --el que el 15/09 se quitó de ahí para que el
--   gesto viviera en un solo sitio--. Lo cazó el ensayo 1 al primer intento y
--   la transacción entera se revirtió sin aplicar nada.
--   Corregido: lee las expo DEL LOCAL, igual que `kds_board`.

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
  raise notice 'GUARDIA: relojes puestos (lock=%ms, statement=%ms).', v_lock, v_stmt;
end
$guardia$;


-- ═══ 0 · EL ANTES, TOMADO CON LAS FUNCIONES VIEJAS ═════════════════════════
--
-- 🔴 Esto va ARRIBA DEL TODO y no abajo. El 15/09 comparé una función consigo
-- misma --las dos medidas después del cambio-- y no probé nada (regla 33). El
-- «antes» sólo existe si se captura antes. Hoy ha servido: paró el primer
-- intento.
--
-- No se imprime: los tableros llevan nombre y teléfono del repartidor. Se
-- compara el jsonb entero, que es más fuerte que mirarlo por encima.
create temp table _antes (
  quien   text primary key,
  tablero jsonb,
  fallo   text
) on commit drop;

do $antes$
declare r record; v_j jsonb;
begin
  for r in select d.id, d.label, d.token, d.location_id, l.name as local
             from kds_device d join locations l on l.id = d.location_id
            where d.is_active
  loop
    begin
      v_j := public.pase_board(r.token);
      insert into _antes values ('pase_board · ' || r.local || ' · ' || r.label, v_j, null);
    exception when others then
      insert into _antes values ('pase_board · ' || r.local || ' · ' || r.label, null, sqlerrm);
    end;
    begin
      v_j := public.kds_board(r.location_id, r.token);
      insert into _antes values ('kds_board · ' || r.local || ' · ' || r.label, v_j, null);
    exception when others then
      insert into _antes values ('kds_board · ' || r.local || ' · ' || r.label, null, sqlerrm);
    end;
  end loop;
  raise notice 'ANTES: % tableros capturados.', (select count(*) from _antes);
end
$antes$;


-- ═══ 1 · LAS COLUMNAS, EN LA ESTACIÓN ══════════════════════════════════════
alter table public.kitchen_station
  add column if not exists pase_activo         boolean not null default false,
  add column if not exists pase_activo_at      timestamptz,
  add column if not exists pase_activo_por     uuid,
  add column if not exists pase_activo_desde   text,
  add column if not exists pase_apagado_motivo text;

comment on column public.kitchen_station.pase_activo is
  'El Pase, por ESTACIÓN. Sólo tiene sentido en kind = expo, y hay un CHECK que '
  'lo impide en el resto: ignorarlo daría una pantalla que dice «encendido» y no '
  'enciende nada (regla 8).';


-- ═══ 2 · LOS DOS CHECK ═════════════════════════════════════════════════════
--
-- La decisión del §2 del encargo, tomada y dicha: RESTRICCIÓN, no «que se
-- ignore». Encenderlo en una `prep` falla en voz alta.
alter table public.kitchen_station
  drop constraint if exists kitchen_station_pase_solo_en_expo_ck;
alter table public.kitchen_station
  add constraint kitchen_station_pase_solo_en_expo_ck
  check (pase_activo = false or kind = 'expo');

alter table public.kitchen_station
  drop constraint if exists kitchen_station_pase_desde_ck;
alter table public.kitchen_station
  add constraint kitchen_station_pase_desde_ck
  check (pase_activo_desde is null or pase_activo_desde in ('pantalla', 'tablet'));


-- ═══ 3 · LA MUDANZA · el estado Y la traza ═════════════════════════════════
update kitchen_station k
   set pase_activo         = c.pase_activo,
       pase_activo_at      = c.pase_activo_at,
       pase_activo_por     = c.pase_activo_por,
       pase_activo_desde   = c.pase_activo_desde,
       pase_apagado_motivo = c.pase_apagado_motivo
  from kitchen_time_config c
 where c.location_id = k.location_id
   and k.kind = 'expo';

-- 🔴 LA GUARDA DE MUDANZA. Es el único fallo que NO se vería: el Pase
-- aparecería apagado en un local donde la cocina ya ha hecho un servicio con
-- él, y nadie sabría por qué.
do $mudanza$
declare v_perdidos int;
begin
  select count(*) into v_perdidos
    from kitchen_time_config c
   where c.pase_activo
     and not exists (select 1 from kitchen_station k
                      where k.location_id = c.location_id and k.kind = 'expo' and k.pase_activo);
  if v_perdidos > 0 then
    raise exception 'MUDANZA: % locales estaban ENCENDIDOS y su estación de salida no lo está. '
                    'NO CONFIRMAR.', v_perdidos;
  end if;

  select count(*) into v_perdidos
    from kitchen_time_config c
   where c.pase_activo_at is not null
     and not exists (select 1 from kitchen_station k
                      where k.location_id = c.location_id and k.kind = 'expo'
                        and k.pase_activo_at   is not distinct from c.pase_activo_at
                        and k.pase_activo_por  is not distinct from c.pase_activo_por
                        and k.pase_activo_desde is not distinct from c.pase_activo_desde);
  if v_perdidos > 0 then
    raise exception 'MUDANZA: % locales tenían traza y no ha viajado ENTERA. El primer encendido '
                    'de la historia de esta base no se pierde en una mudanza. NO CONFIRMAR.', v_perdidos;
  end if;
  raise notice 'MUDANZA: estado y traza en su sitio.';
end
$mudanza$;


-- ═══ 4 · `pase_encender` PASA A RECIBIR LA ESTACIÓN ════════════════════════
--
-- 🔴 CAMBIA DE SIGNIFICADO SIN CAMBIAR DE FIRMA: antes un local, ahora una
-- estación, y las dos son `uuid`. Un `create or replace` dejaría al front viejo
-- llamando con un local y el error diría «no existe o no tienes permiso»,
-- mandando a mirar los permisos cuando el problema es otro. DROP + CREATE, y
-- la función DIAGNOSTICA ese caso con esas palabras.
drop function if exists public.pase_encender(uuid);

create function public.pase_encender(p_station_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_filas  int;
  v_nombre text;
  v_local  text;
begin
  if p_station_id is null then
    raise exception 'pase_encender: falta la estación';
  end if;

  -- El diagnóstico va ANTES del intento: si no, el fallo de permiso lo tapa.
  if exists (select 1 from locations l where l.id = p_station_id) then
    raise exception 'pase_encender: eso es un LOCAL, no una estación. Desde el 16/09 el Pase '
                    'se enciende por estación de salida, no por local.';
  end if;

  update kitchen_station
     set pase_activo         = true,
         pase_activo_at      = now(),
         pase_activo_por     = auth.uid(),
         pase_activo_desde   = 'pantalla',
         pase_apagado_motivo = null,
         updated_at          = now()
   where id = p_station_id;
  get diagnostics v_filas = row_count;

  if v_filas = 0 then
    raise exception 'pase_encender: esta estación no existe o no tienes permiso para cambiar '
                    'los ajustes de su local';
  end if;

  select k.name, l.name into v_nombre, v_local
    from kitchen_station k join locations l on l.id = k.location_id
   where k.id = p_station_id;

  return jsonb_build_object(
    'estacion', v_nombre,
    'local',    v_local,
    'activo',   true,
    'cuando',   now(),
    'por',      auth.uid(),
    'desde',    'pantalla');
end;
$fn$;

-- 🔴 El `revoke` de `anon` VA POR SU NOMBRE. `pg_default_acl` del esquema
-- public concede EXECUTE a anon a toda función nueva, y `revoke … from public`
-- no lo quita. Lo cazó la guarda de la migración del 15/09.
revoke all on function public.pase_encender(uuid) from public;
revoke all on function public.pase_encender(uuid) from anon;
grant execute on function public.pase_encender(uuid) to authenticated, service_role;


-- ═══ 5 · `pase_apagar` SACA LA ESTACIÓN DEL APARATO, NO DEL LLAMANTE ═══════
create or replace function public.pase_apagar(p_device_token text, p_motivo text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_device  kds_device;
  v_nombre  text;
  v_estaba  boolean;
  v_cuantas int;
  v_objetivo uuid[];
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'pase_apagar: token de dispositivo no válido';
  end if;

  select l.name into v_nombre from locations l
   where l.id = v_device.location_id and l.account_id = v_device.account_id;
  if v_nombre is null then
    raise exception 'pase_apagar: el aparato no corresponde a un local de su cuenta';
  end if;

  -- 🔴 AQUÍ SÍ MANDA EL APARATO, y es la diferencia con `pase_board`: apagar es
  -- un GESTO de quien está delante de una tablet, y apaga la salida que esa
  -- tablet mira. Si no mira ninguna --hoy `camichi4`-- cae a las de su local,
  -- que es lo que hacía el modelo viejo: una tablet sin estación asignada no
  -- puede quedarse sin poder apagar.
  --
  -- Se resuelve a un array y NO a una tabla temporal: esta función la llama la
  -- tablet en cada apagado, y crear una temporal por llamada es un coste y un
  -- riesgo (colisión entre llamadas de la misma sesión) a cambio de nada.
  select coalesce(array_agg(k.id), '{}'::uuid[]) into v_objetivo
    from kitchen_station k
   where k.account_id = v_device.account_id
     and k.kind = 'expo'
     and ( k.id = any(coalesce(v_device.station_ids, '{}'::uuid[]))
           or ( coalesce(array_length(v_device.station_ids, 1), 0) = 0
                and k.location_id = v_device.location_id ) );

  select bool_or(k.pase_activo), count(*) into v_estaba, v_cuantas
    from kitchen_station k where k.id = any(v_objetivo);

  update kitchen_station k
     set pase_activo         = false,
         pase_activo_at      = now(),
         pase_activo_por     = v_device.id,
         pase_activo_desde   = 'tablet',
         pase_apagado_motivo = nullif(btrim(p_motivo), ''),
         updated_at          = now()
   where k.id = any(v_objetivo);

  return jsonb_build_object(
    'local',      v_nombre,
    'estaciones', coalesce(v_cuantas, 0),
    'estaba',     coalesce(v_estaba, false),
    'activo',     false,
    'cuando',     now(),
    'desde',      'tablet');
end;
$fn$;

revoke all on function public.pase_apagar(text, text) from public;
grant execute on function public.pase_apagar(text, text) to anon, authenticated, service_role;


-- ═══ 6 · LOS DOS TABLEROS LEEN LA ESTACIÓN · POR ANCLAJE ═══════════════════
--
-- 🔴 POR ANCLAJE Y NO RETECLEADO. Los cuerpos mezclan CRLF y LF; reescribirlos
-- a mano es como se cuela una diferencia que nadie ve. Se cuenta la ocurrencia
-- del ancla y si no es EXACTAMENTE UNA, se aborta.

do $tableros$
declare
  v_src text;
  v_ancla text;
  v_nuevo text;
  v_n int;
begin
  -- ── pase_board ──────────────────────────────────────────────────────────
  -- 🔴 LAS EXPO DEL LOCAL, NO LAS DEL APARATO. Es la corrección del segundo
  -- intento: `v_activo` significa «el Pase está encendido en este local», y
  -- tiene que seguir significando eso para TODAS las tablets del local, no
  -- sólo para la que mira la salida. Leerlo por aparato apagaba el Pase en la
  -- tablet de cocina y le devolvía el botón de «Listo».
  --
  -- El día que un local tenga dos salidas habrá que decidir si cada tablet ve
  -- la suya. Hoy no lo hay --medido: 7 locales, 7 expo-- y no se inventa.
  v_ancla := '  select coalesce(k.pase_activo, false) into v_activo' || E'\n'
          || '    from kitchen_time_config k where k.location_id = v_local;';
  v_nuevo := '  select coalesce(bool_or(k.pase_activo), false) into v_activo' || E'\n'
          || '    from kitchen_station k' || E'\n'
          || '   where k.location_id = v_local' || E'\n'
          || '     and k.kind = ''expo'';';

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'pase_board';

  v_n := (length(v_src) - length(replace(v_src, v_ancla, ''))) / length(v_ancla);
  if v_n <> 1 then
    raise exception 'ANCLAJE pase_board: el ancla aparece % veces, esperaba 1. NO SEGUIR.', v_n;
  end if;
  execute replace(v_src, v_ancla, v_nuevo);
  raise notice 'pase_board: anclada y reescrita.';

  -- ── kds_board ───────────────────────────────────────────────────────────
  -- La misma pregunta y la misma respuesta: el tablero de cocina suelta el
  -- pedido sellado cuando el Pase está encendido en la salida del local.
  v_ancla := '        or not coalesce((select k2.pase_activo from kitchen_time_config k2' || E'\n'
          || '                          where k2.location_id = v_location_id), false)';
  v_nuevo := '        or not coalesce((select bool_or(k2.pase_activo) from kitchen_station k2' || E'\n'
          || '                          where k2.location_id = v_location_id' || E'\n'
          || '                            and k2.kind = ''expo''), false)';

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'kds_board';

  v_n := (length(v_src) - length(replace(v_src, v_ancla, ''))) / length(v_ancla);
  if v_n <> 1 then
    raise exception 'ANCLAJE kds_board: el ancla aparece % veces, esperaba 1. NO SEGUIR.', v_n;
  end if;
  execute replace(v_src, v_ancla, v_nuevo);
  raise notice 'kds_board: anclada y reescrita.';
end
$tableros$;


-- ═══ 7 · EL ENSAYO QUE MANDA · la tablet ve LO MISMO ═══════════════════════
do $igual$
declare r record; v_ahora jsonb; v_dif int := 0;
begin
  for r in select d.id, d.label, d.token, d.location_id, l.name as local
             from kds_device d join locations l on l.id = d.location_id
            where d.is_active
  loop
    begin
      v_ahora := public.pase_board(r.token);
    exception when others then v_ahora := null;
    end;
    if (select tablero from _antes where quien = 'pase_board · ' || r.local || ' · ' || r.label)
         is distinct from v_ahora then
      v_dif := v_dif + 1;
      raise warning 'DISTINTO · pase_board · % · %', r.local, r.label;
    end if;

    begin
      v_ahora := public.kds_board(r.location_id, r.token);
    exception when others then v_ahora := null;
    end;
    if (select tablero from _antes where quien = 'kds_board · ' || r.local || ' · ' || r.label)
         is distinct from v_ahora then
      v_dif := v_dif + 1;
      raise warning 'DISTINTO · kds_board · % · %', r.local, r.label;
    end if;
  end loop;

  if v_dif > 0 then
    raise exception 'ENSAYO 1: % tableros han cambiado con la mudanza. La tablet tenía que ver '
                    'EXACTAMENTE lo mismo. NO CONFIRMAR.', v_dif;
  end if;
  raise notice 'ENSAYO 1 · los % tableros salen byte a byte iguales que antes.',
               (select count(*) from _antes);
end
$igual$;


-- ═══ 8 · LOS DEMÁS ENSAYOS, cada uno plantando su población ════════════════
do $ensayos$
declare
  v_prep   uuid;
  v_expo   uuid;
  v_local  uuid := '38158159-cd71-4056-950b-53425afac1ce';  -- Foodint Alcalá
  v_otro   uuid := 'aeaafb7e-7911-4095-a773-4ae63dc77a9e';  -- admin de OTRA cuenta
  v_token  text;
  v_r      jsonb;
  v_msg    text;
  v_ok     boolean;
begin
  select id into v_expo from kitchen_station where location_id = v_local and kind = 'expo';
  select id into v_prep from kitchen_station where location_id = v_local and kind = 'prep';
  select token into v_token from kds_device d
   where d.location_id = v_local and d.is_active and d.label = 'Pase';

  -- ── E2 · el CHECK impide encender una estación de PREPARACIÓN ───────────
  v_ok := false;
  begin
    update kitchen_station set pase_activo = true where id = v_prep;
    raise exception 'DESHACER_E2';
  exception
    when check_violation then v_ok := true;
    when others then
      if sqlerrm = 'DESHACER_E2' then v_ok := false; else raise; end if;
  end;
  if not v_ok then
    raise exception 'ENSAYO 2: se ha podido encender el Pase en una estación de PREPARACIÓN. '
                    'El CHECK no está haciendo su trabajo. NO CONFIRMAR.';
  end if;
  raise notice 'ENSAYO 2 · el CHECK rechaza encender una `prep`. Correcto.';

  -- ── E3 · `pase_encender` con un LOCAL lo dice con esas palabras ─────────
  v_msg := null;
  begin
    v_r := public.pase_encender(v_local);
  exception when others then v_msg := sqlerrm;
  end;
  if v_msg is null or v_msg not like '%es un LOCAL%' then
    raise exception 'ENSAYO 3: pase_encender con un local dijo «%» en vez de diagnosticarlo. '
                    'NO CONFIRMAR.', coalesce(v_msg, 'nada, funcionó');
  end if;
  raise notice 'ENSAYO 3 · pase_encender diagnostica el local: «%»', v_msg;

  -- ── E4 · ALCANCE, con impersonación de verdad ──────────────────────────
  -- 🔴 Sin `set local role authenticated` la RLS NO se aplica y el ensayo no
  -- prueba nada (regla 36). El admin de otra cuenta no puede encender Alcalá.
  v_msg := null;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
    begin
      v_r := public.pase_encender(v_expo);
    exception when others then v_msg := sqlerrm;
    end;
    execute 'reset role';
    perform set_config('request.jwt.claims', null, true);
  exception when others then
    execute 'reset role';
    perform set_config('request.jwt.claims', null, true);
    raise;
  end;
  if v_msg is null or v_msg not like '%no existe o no tienes permiso%' then
    raise exception 'ENSAYO 4: el admin de OTRA cuenta pudo encender la estación de Alcalá, o '
                    'falló por otra razón: «%». NO CONFIRMAR.', coalesce(v_msg, 'no falló');
  end if;
  raise notice 'ENSAYO 4 · el admin de otra cuenta NO puede. La RLS aplica.';

  -- ── E5 · `pase_apagar` apaga la salida de SU tablet, y sólo ésa ─────────
  begin
    v_r := public.pase_apagar(v_token, 'ensayo, se deshace');
    if (v_r->>'estaba')::boolean is not true then
      raise exception 'ENSAYO 5: pase_apagar dice que NO estaba encendido, y Alcalá lo estaba. '
                      'NO CONFIRMAR.';
    end if;
    if (select count(*) from kitchen_station where pase_activo) <> 0 then
      raise exception 'ENSAYO 5: después de apagar queda alguna estación encendida. NO CONFIRMAR.';
    end if;
    raise exception 'DESHACER_E5';
  exception when others then
    if sqlerrm <> 'DESHACER_E5' then raise; end if;
  end;
  raise notice 'ENSAYO 5 · pase_apagar apaga la salida de su tablet. Deshecho.';
end
$ensayos$;


-- ═══ 9 · EL CRITERIO DE ACEPTACIÓN DEL §2bis.3 ═════════════════════════════
do $criterio$
declare
  v_encendidas int;
  v_ok int;
begin
  select count(*) into v_encendidas from kitchen_station where pase_activo;
  if v_encendidas <> 1 then
    raise exception 'CRITERIO: hay % estaciones encendidas, esperaba exactamente 1. NO CONFIRMAR.',
                    v_encendidas;
  end if;

  select count(*) into v_ok
    from kitchen_station k
   where k.pase_activo
     and k.location_id       = '38158159-cd71-4056-950b-53425afac1ce'
     and k.kind              = 'expo'
     and k.pase_activo_desde = 'pantalla'
     and k.pase_activo_por   = '673fca49-f6b5-40ed-a8f7-558390acce10'
     -- 🔴 EN MADRID, NO EN UTC. La cifra que medí --09:10:17,829365-- salía ya
     -- convertida con `at time zone 'Europe/Madrid'`. Escribirla con un `+00`
     -- detrás la habría desplazado dos horas y la guarda habría abortado la
     -- migración entera por un error mío de huso (regla 4, que hoy ya me ha
     -- mordido una vez con el día de negocio).
     and (k.pase_activo_at at time zone 'Europe/Madrid') = timestamp '2026-09-15 09:10:17.829365';
  if v_ok <> 1 then
    raise exception 'CRITERIO: la única encendida no es la salida de Alcalá con su traza intacta '
                    '(15/09 09:10:17, pantalla, Julio). NO CONFIRMAR.';
  end if;
  raise notice 'CRITERIO §2bis.3 · Alcalá encendido en su salida, traza intacta, y ningún otro.';
end
$criterio$;


-- ═══ 10 · LOS PERMISOS, COMPROBADOS Y NO SUPUESTOS ═════════════════════════
do $permisos$
begin
  -- 🔴 MEDIDO ANTES DE ESCRIBIR ESTA GUARDA, y menos mal. Mi primera versión
  -- exigía que `anon` NO pudiera ejecutar los dos tableros, y habría abortado
  -- la migración entera: LA TABLET ENTRA CON LA LLAVE ANÓNIMA más su token de
  -- aparato. `pase_board` y `kds_board` son SECURITY DEFINER y TIENEN que ser
  -- ejecutables por `anon`; quien manda ahí es el token, no el rol.
  if not has_function_privilege('anon', 'public.pase_board(text)', 'EXECUTE') then
    raise exception 'PERMISOS: `anon` ha perdido pase_board. La tablet se queda sin tablero. '
                    'NO CONFIRMAR.';
  end if;
  if not has_function_privilege('anon', 'public.kds_board(uuid, text)', 'EXECUTE') then
    raise exception 'PERMISOS: `anon` ha perdido kds_board. La tablet de cocina se queda ciega. '
                    'NO CONFIRMAR.';
  end if;
  if not has_function_privilege('anon', 'public.pase_apagar(text, text)', 'EXECUTE') then
    raise exception 'PERMISOS: `anon` ha perdido pase_apagar. No se podría apagar desde la '
                    'tablet, que es la retirada. NO CONFIRMAR.';
  end if;

  -- `pase_encender` es la excepción y por eso lleva su `revoke ... from anon`
  -- POR SU NOMBRE: se enciende desde la oficina, con sesión, nunca por token.
  if has_function_privilege('anon', 'public.pase_encender(uuid)', 'EXECUTE') then
    raise exception 'PERMISOS: `anon` puede ejecutar pase_encender. `pg_default_acl` concede '
                    'EXECUTE a anon a toda función nueva y hay que revocarlo POR SU NOMBRE. '
                    'NO CONFIRMAR.';
  end if;
  if not has_function_privilege('authenticated', 'public.pase_encender(uuid)', 'EXECUTE') then
    raise exception 'PERMISOS: `authenticated` NO puede ejecutar pase_encender. La pantalla de '
                    'ajustes se quedaría sin poder encender. NO CONFIRMAR.';
  end if;
  raise notice 'PERMISOS · los tres tableros siguen con anon; pase_encender sin anon y con authenticated.';
end
$permisos$;


-- ═══ 11 · LO QUE NO SE HACE HOY ════════════════════════════════════════════
--
-- ⚠️ `kitchen_time_config.pase_*` SE QUEDA. Entre esto y que las tres tablets
-- cojan el paquete nuevo conviven front viejo y base nueva. Quitarlas hoy es lo
-- mismo que el 13/08: una corrección que se lleva por delante algo que todavía
-- se usa. Se quitan cuando las tres estén medidas en el paquete nuevo.
--
--   alter table public.kitchen_time_config
--     drop column pase_activo, drop column pase_activo_at,
--     drop column pase_activo_por, drop column pase_activo_desde,
--     drop column pase_apagado_motivo;
