-- ═══════════════════════════════════════════════════════════════════════════
-- UNA PÁGINA POR COCINA · LA BASE · escrita el 15/09/2026 · NO APLICADA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 🔴 FUERA DE `supabase/migrations/` A PROPÓSITO, como la tanda del Pase: si
-- estuviera dentro, la fusión a `main` la aplicaría por CI a la hora que fuese.
-- Se aplica a mano, FUERA DE LA BANDA Y POR LA MAÑANA, y entonces el fichero se
-- mueve con su versión registrada.
--
-- ── QUÉ HACE ──────────────────────────────────────────────────────────────
--
-- El interruptor del Pase se muda de `kitchen_time_config` (por LOCAL) a
-- `kitchen_station` (por ESTACIÓN), con su traza.
--
-- Por qué es el modelo correcto y no una mudanza por gusto: lo que se enciende
-- es la PANTALLA DE UNA ESTACIÓN. Que hoy coincida --un local, una estación de
-- salida-- es casualidad de este cliente. Medido: 14 estaciones activas, 7 de
-- preparación, 7 locales, una expo por local. Un local con dos salidas rompe el
-- modelo viejo y no rompe el nuevo.
--
-- ── 🔴 Y UN DETALLE DE CALENDARIO QUE CAMBIA ESTA MIGRACIÓN ───────────────
--
-- El encargo dice «las siete filas están en false, no lo usa nadie y no hay
-- nada que migrar». Eso era cierto a las 09:20. **Deja de serlo a las 17:00**,
-- cuando Julio encienda Alcalá desde la pantalla.
--
-- Así que cuando esto se aplique --mañana por la mañana-- habrá EXACTAMENTE UN
-- local encendido, con su `pase_activo_at`, su `pase_activo_por` y su
-- `pase_activo_desde = 'pantalla'`. La mudanza tiene que llevarse el estado Y
-- LA TRAZA, no sólo crear columnas nuevas: si no, el lunes el Pase aparecería
-- apagado en Alcalá sin que nadie lo hubiera apagado, y la traza del primer
-- encendido de la historia se perdería.
--
-- El ensayo de abajo lo comprueba explícitamente en vez de suponerlo.

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


-- ═══ 1 · LAS COLUMNAS, EN LA ESTACIÓN ══════════════════════════════════════
--
-- ⚠️ `kitchen_station` la lee `kds_board` en cada pedido, así que el ADD COLUMN
-- y sobre todo el CHECK toman ACCESS EXCLUSIVE sobre una tabla del camino del
-- pedido: condición 2 de la banda. Por eso esto va fuera de banda y de mañana.
alter table public.kitchen_station
  add column if not exists pase_activo         boolean not null default false,
  add column if not exists pase_activo_at      timestamptz,
  add column if not exists pase_activo_por     uuid,
  add column if not exists pase_activo_desde   text,
  add column if not exists pase_apagado_motivo text;

comment on column public.kitchen_station.pase_activo is
  'El Pase, por ESTACIÓN. Sólo tiene sentido en `kind = ''expo''`, y hay un '
  'CHECK que lo impide en el resto: ignorarlo daría una pantalla que dice '
  '«encendido» y no enciende nada (regla 8).';

-- ═══ 2 · EL CHECK · que sólo se pueda encender una SALIDA ══════════════════
--
-- La decisión del §2 del encargo, tomada y dicha: restricción, no «que se
-- ignore». Con el CHECK, encenderlo en una `prep` falla en voz alta.
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


-- ═══ 3 · LA MUDANZA · el estado y la traza, no sólo el estado ══════════════
--
-- A cada estación de SALIDA se le pone lo que tuviera su local. Si un local
-- tuviera dos salidas --hoy ninguno-- las dos heredarían lo mismo, que es lo
-- correcto: lo que había era una decisión del local.
update kitchen_station k
   set pase_activo         = c.pase_activo,
       pase_activo_at      = c.pase_activo_at,
       pase_activo_por     = c.pase_activo_por,
       pase_activo_desde   = c.pase_activo_desde,
       pase_apagado_motivo = c.pase_apagado_motivo
  from kitchen_time_config c
 where c.location_id = k.location_id
   and k.kind = 'expo';

-- 🔴 Y UNA GUARDA DE MUDANZA: si algún local estaba encendido y su estación de
-- salida NO se ha quedado encendida, la migración se cae. Es el único fallo que
-- no se vería --el Pase aparecería apagado y nadie sabría por qué-- así que es
-- el que más falta hace comprobar.
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
                    'O no tienen estación expo, o el update no los ha cogido. NO CONFIRMAR.', v_perdidos;
  end if;

  select count(*) into v_perdidos
    from kitchen_time_config c
   where c.pase_activo_at is not null
     and not exists (select 1 from kitchen_station k
                      where k.location_id = c.location_id and k.kind = 'expo'
                        and k.pase_activo_at = c.pase_activo_at);
  if v_perdidos > 0 then
    raise exception 'MUDANZA: % locales tenían traza y no ha viajado. El primer encendido de la '
                    'historia de esta base no se pierde en una mudanza. NO CONFIRMAR.', v_perdidos;
  end if;
  raise notice 'MUDANZA: estado y traza en su sitio.';
end
$mudanza$;


-- ═══ 4 · LAS DOS FUNCIONES PASAN A RECIBIR LA ESTACIÓN ═════════════════════
--
-- 🔴 `pase_encender` CAMBIA DE SIGNIFICADO SIN CAMBIAR DE FIRMA: antes recibía
-- un local, ahora una estación, y las dos son `uuid`. Un `create or replace`
-- dejaría al front viejo llamando con un local contra una función que espera
-- una estación, y el error sería «no existe o no tienes permiso» — un mensaje
-- que manda a mirar los permisos cuando el problema es otro.
--
-- Por eso: DROP + CREATE, y además la función DIAGNOSTICA el caso. Si el uuid
-- que le pasan resulta ser un LOCAL, lo dice con esas palabras.
drop function if exists public.pase_encender(uuid);

create or replace function public.pase_encender(p_station_id uuid)
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

-- 🔴 El `revoke` de `anon` va POR SU NOMBRE. `pg_default_acl` del esquema
-- public concede EXECUTE a anon a toda función nueva, y `revoke … from public`
-- no lo quita. Lo cazó la guarda de la migración de esta mañana.
revoke all on function public.pase_encender(uuid) from public;
revoke all on function public.pase_encender(uuid) from anon;
grant execute on function public.pase_encender(uuid) to authenticated, service_role;


-- `pase_apagar` NO cambia de firma: sigue recibiendo el token y el motivo. Lo
-- que cambia es de dónde saca la estación — y la saca del APARATO, nunca de lo
-- que mande el llamante, igual que hasta ahora sacaba el local.
--
-- ⚠️ Si la tablet mira varias estaciones, se apaga la de SALIDA que mire. Si
-- mirase dos salidas --hoy ninguna-- se apagan las dos: es lo que significa
-- «apaga el Pase de esta tablet».
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

  select bool_or(k.pase_activo), count(*) into v_estaba, v_cuantas
    from kitchen_station k
   where k.id = any(coalesce(v_device.station_ids, '{}'::uuid[]))
     and k.account_id = v_device.account_id
     and k.kind = 'expo';

  update kitchen_station k
     set pase_activo         = false,
         pase_activo_at      = now(),
         pase_activo_por     = v_device.id,
         pase_activo_desde   = 'tablet',
         pase_apagado_motivo = nullif(btrim(p_motivo), ''),
         updated_at          = now()
   where k.id = any(coalesce(v_device.station_ids, '{}'::uuid[]))
     and k.account_id = v_device.account_id
     and k.kind = 'expo';

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


-- ═══ 5 · LOS DOS TABLEROS LEEN LA ESTACIÓN ═════════════════════════════════
--
-- Por anclaje, como esta mañana: los cuerpos tienen CRLF mezclado con LF y
-- reteclearlos es como se cuela una diferencia que nadie ve.
--
--   · `pase_board` — el `select … from kitchen_time_config` que llena
--     `v_activo` pasa a leer la estación de salida del aparato.
--   · `kds_board` — la condición del Pase deja de preguntar por el local.
--
-- 🔴 `pase_board` SIGUE IGUAL POR FUERA: mismo argumento, mismas claves del
-- jsonb. La tablet no se entera de la mudanza, que es la prueba de que el
-- cambio es de modelo y no de comportamiento.


-- ═══ 6 · Y SÓLO ENTONCES, QUITAR LAS COLUMNAS VIEJAS ═══════════════════════
--
-- ⚠️ EN OTRA MIGRACIÓN Y OTRO DÍA, no aquí. Entre que esto se aplica y que las
-- tablets cogen el paquete nuevo hay una ventana en la que conviven el front
-- viejo y la base nueva. Quitar hoy `kitchen_time_config.pase_activo` es lo
-- mismo que el 13/08: una corrección que se lleva por delante algo que todavía
-- se está usando. Se quitan cuando las tres tablets estén en el paquete nuevo,
-- medido y pegado.
--
--   alter table public.kitchen_time_config
--     drop column pase_activo, drop column pase_activo_at,
--     drop column pase_activo_por, drop column pase_activo_desde,
--     drop column pase_apagado_motivo;


-- ═══ EL ENSAYO ═════════════════════════════════════════════════════════════
--
-- 🔴 EL QUE MANDA ES EL PRIMERO: con la columna mudada, una tablet de Alcalá
-- tiene que ver EXACTAMENTE LO MISMO que antes del cambio. Se toma el tablero
-- ANTES --arriba del fichero, con las funciones viejas-- y se compara con el de
-- después, con la misma vara (regla 33).
--
-- Los demás plantan su población, como la tanda de esta mañana:
--
--   · El CHECK: intentar encender una `prep` tiene que fallar.
--   · La mudanza: un local encendido llega encendido a su estación, con traza.
--   · `pase_encender` con un LOCAL dice que es un local, no «sin permiso».
--   · El alcance: el admin de otra cuenta sigue sin poder, con impersonación
--     de verdad --`set local role authenticated`--, que sin eso la RLS no se
--     aplica y el ensayo no prueba nada (regla 36).
--   · `pase_apagar` apaga la estación de salida de SU tablet y ninguna otra.
