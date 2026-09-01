-- PROPUESTA_20260901T0740_cierre_indefinido_declarado.sql
-- ============================================================================
-- APLICADA el 01/09/2026 a las 08:44 (Madrid) = 06:44 UTC. Registrada como
-- 20260901064416. Cuerpo exacto, contrastado con diff + md5
-- (cece6bc3bce4a0ab5be5dac72d8da6ba) antes de ejecutar.
--
-- VERIFICACION POR CONSULTA, despues de aplicar:
--   columnas deliberate_* en brand_closure ....... 3
--   cierres que nacen declarados ................. 0   (la intencion no se inventa)
--   brand_closure ................................ 3 filas
--     huella ..................................... 97198276bec01167f722b49c29ca8424
--     IDENTICA a la de antes: esta migracion NO toca ninguna fila de cierres.
--   marcas ABIERTAS con restos de closure_set_at . 0   (eran 6)
--   marcas en 'paused' ........................... 1   (Meraki Pita, intacta)
--   marcas totales ............................... 36  (ninguna perdida)
--   anon puede ejecutar la RPC nueva ............. NO
--   authenticated ................................ si
--
-- LO QUE ESTO TODAVIA NO HACE: no hay boton. La columna existe y el vigia ya
-- respeta la declaracion, pero nada en pantalla la escribe todavia, asi que de
-- momento el comportamiento visible es identico al de ayer. El boton «es a
-- proposito» en la tarjeta, y la eleccion al cerrar, son la pieza siguiente de
-- este frente. Se dice aqui para que nadie lea la migracion y crea que ya esta
-- resuelto.
--
-- «Un cierre de +24 h no es por definicion un descuido: Julio tiene cierres
-- indefinidos a proposito. La alarma roja permanente que no se puede quitar es
-- invisible, que es lo contrario de una alarma.» (01/09)
--
-- LA INTENCION SE DECLARA, NO SE ADIVINA
-- Al cerrar hay dos cosas distintas y hasta hoy solo se guardaba una:
--   · CUANDO se reabre  -> resume_at (ya existia).
--   · SI el sin-fecha es a proposito -> no habia donde ponerlo. Esto lo añade.
-- La alarma queda para el caso real: sin fecha Y sin declarar que sea a
-- proposito.
--
-- POR QUE UNA COLUMNA NUEVA Y NO reason_code (RECON del 01/09)
-- `reason_code` ya tiene dueño: es la taxonomia sin_stock | incidencia |
-- fin_servicio | promocion | mantenimiento | otro, la escribe BrandCloseControl
-- y la LEE availabilityReportService para los informes de downtime. Meter
-- «a proposito» ahi corromperia esos informes. Confirmado por Julio.
--
-- POR QUE TRES COLUMNAS Y NO UN ENUM «temporal | indefinido_a_proposito»
-- Un enum obligaria a dar un valor a las 3 filas que ya existen, y eso es
-- INVENTAR LA INTENCION de cierres que nadie declaro. Con NULL = «no
-- declarado», las filas viejas siguen alarmando —que es lo correcto— hasta que
-- alguien pulse «es a proposito» en su tarjeta. Ademas un cierre CON resume_at
-- ya es temporal por construccion: no necesita declararse nada.
-- Y reconocer es DECLARAR, no ocultar: por eso van el autor y el momento, no
-- un booleano suelto.
--
-- brand_closure ES LA UNICA VERDAD DEL CIERRE (Julio, 01/09)
-- Nada de espejar esto en brand.closure_*: espejar es crear la segunda verdad
-- otra vez. Ver la DEUDA al final del fichero.
-- ============================================================================

begin;

-- ── 1. Donde vive la declaracion ────────────────────────────────────────────
alter table public.brand_closure
  add column if not exists deliberate_at   timestamptz,
  add column if not exists deliberate_by   uuid,
  add column if not exists deliberate_note text;

comment on column public.brand_closure.deliberate_at is
  'Cuando se declaro que este cierre SIN FECHA es a proposito. NULL = nadie lo '
  'ha declarado, y entonces pasadas 24 h el vigia avisa. Se escribe al cerrar '
  '(eligiendo «cierre indefinido a proposito») o despues, desde la propia '
  'tarjeta de la alarma. Un cierre CON resume_at no necesita esto: ya es '
  'temporal por construccion.';
comment on column public.brand_closure.deliberate_by is
  'auth.uid() de quien lo declaro. Reconocer una alarma es DECLARAR, no '
  'ocultar: por eso queda con nombre.';
comment on column public.brand_closure.deliberate_note is
  'El motivo en palabras de quien lo declara («la marca no opera en este local '
  'hasta nueva orden»). Opcional, pero es lo que hace util la declaracion '
  'dentro de seis meses.';

-- ── 2. La RPC para declararlo ───────────────────────────────────────────────
-- SOLO PUERTA WEB, con sesion. La tablet NO puede declarar: decidir que un
-- cierre es indefinido a proposito es una decision de negocio, no de pase, y
-- quien esta en la cocina no tiene por que cargar con ella. Si algun dia hace
-- falta desde la tablet, sera un _by_token aparte y con su propia guarda, como
-- set_brand_status_by_token -- no ensanchando esta.
drop function if exists public.declare_closure_deliberate(uuid, uuid, text);

create function public.declare_closure_deliberate(
  p_closure_id uuid,
  p_note       text default null
) returns table (closure_id uuid, deliberate_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account uuid;
begin
  select bc.account_id into v_account
    from public.brand_closure bc where bc.id = p_closure_id;
  if v_account is null then
    raise exception 'declare_closure_deliberate: el cierre % no existe', p_closure_id;
  end if;
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(v_account)) then
    raise exception 'declare_closure_deliberate: sin acceso a la cuenta %', v_account;
  end if;

  -- Declarar dos veces no es un error: se queda la primera declaracion, que es
  -- la que tiene la fecha y el autor de verdad.
  update public.brand_closure bc
     set deliberate_at   = coalesce(bc.deliberate_at, now()),
         deliberate_by   = coalesce(bc.deliberate_by, auth.uid()),
         deliberate_note = coalesce(bc.deliberate_note, nullif(btrim(p_note), '')),
         updated_at      = now()
   where bc.id = p_closure_id;

  return query
    select bc.id, bc.deliberate_at from public.brand_closure bc where bc.id = p_closure_id;
end;
$function$;

comment on function public.declare_closure_deliberate(uuid, text) is
  'Declara que un cierre sin fecha es a proposito. Deja de alarmar, con autor y '
  'momento. Idempotente: la segunda llamada conserva la primera declaracion.';

-- `from public` NO basta en este proyecto: el ACL por defecto concede EXECUTE a
-- anon DIRECTAMENTE, y revocar de PUBLIC no toca una concesion nominal. Se
-- comprobo el 01/09 al aplicar avt_consumption_coverage, que nacio alcanzable
-- por anon. Esta nace cerrada.
revoke all on function public.declare_closure_deliberate(uuid, text) from public;
revoke all on function public.declare_closure_deliberate(uuid, text) from anon;
grant execute on function public.declare_closure_deliberate(uuid, text) to authenticated;

-- ── 3. El vigia de pantalla deja de contar los declarados ───────────────────
-- UNICO cambio respecto a la version viva: `and bc.deliberate_at is null` en la
-- rama de los indefinidos. La rama de los VENCIDOS no se toca: un cierre con
-- fecha que ya paso es un descuido lo declare quien lo declare.
create or replace function public.anomalous_brand_closures(
  p_account_id uuid default null::uuid,
  p_token text default null::text
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_device  kds_device;
  v_account uuid;
  v_loc     uuid := null;
  v_result  jsonb;
begin
  if p_token is not null then
    v_device := public.kds_resolve_device(p_token);
    if v_device.id is null then
      raise exception 'anomalous_brand_closures: token de dispositivo no valido';
    end if;
    v_account := v_device.account_id;
    v_loc     := v_device.location_id;
  else
    if p_account_id is null then
      raise exception 'anomalous_brand_closures: falta account_id';
    end if;
    v_account := p_account_id;
    if not (public.current_user_is_admin()
            or public.current_user_is_admin_or_manager_of(v_account)) then
      raise exception 'anomalous_brand_closures: sin acceso a la cuenta %', v_account;
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'closure_id',    bc.id,
           'brand_id',      b.id,
           'brand_name',    b.name,
           'location_id',   l.id,
           'location_name', l.name,
           'resume_at',     bc.resume_at,
           'set_at',        bc.set_at,
           'reason',        bc.reason,
           'kind',          case when bc.resume_at is null then 'indefinite' else 'expired' end
         ) order by b.name, l.name), '[]'::jsonb)
    into v_result
  from brand_closure bc
  join brand b     on b.id = bc.brand_id
  join locations l on l.id = bc.location_id
  where bc.account_id = v_account
    and (v_loc is null or bc.location_id = v_loc)
    and ( (bc.resume_at is null     and bc.set_at    < now() - interval '24 hours'
           and bc.deliberate_at is null)
       or (bc.resume_at is not null and bc.resume_at < now()) );

  return v_result;
end;
$function$;

-- ── 4. La basura que confunde a quien mire (Julio, 01/09) ───────────────────
-- Seis marcas con closure_mode='normal' —o sea, ABIERTAS— arrastran un
-- closure_set_at viejo que nadie limpio al reabrir. No alarman (el vigia por
-- correo filtra por closure_mode='paused'), pero cualquiera que mire la ficha
-- lee «cerrada desde el 31/07» de una marca que esta sirviendo.
-- Se limpia SOLO donde el modo dice que esta abierta. Ni una fila de
-- brand_closure se toca: esto es la tabla vieja.
update public.brand
   set closure_set_at    = null,
       closure_resume_at = null,
       closure_reason    = null,
       closure_set_by    = null
 where closure_mode = 'normal'
   and (closure_set_at is not null or closure_resume_at is not null
        or closure_reason is not null or closure_set_by is not null);

-- ── 5. GUARDA ───────────────────────────────────────────────────────────────
do $ver$
declare v_n int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='brand_closure'
                    and column_name='deliberate_at') then
    raise exception 'falta deliberate_at';
  end if;

  select count(*) into v_n from pg_proc
   where pronamespace='public'::regnamespace and proname='anomalous_brand_closures';
  if v_n <> 1 then
    raise exception 'anomalous_brand_closures tiene % firmas, deberia tener 1', v_n;
  end if;

  select count(*) into v_n from pg_proc
   where pronamespace='public'::regnamespace and proname='declare_closure_deliberate';
  if v_n <> 1 then
    raise exception 'declare_closure_deliberate tiene % firmas, deberia tener 1', v_n;
  end if;

  -- NINGUNA fila puede nacer declarada: la intencion no se inventa.
  select count(*) into v_n from public.brand_closure where deliberate_at is not null;
  if v_n <> 0 then
    raise exception 'ABORTA: % cierres nacen declarados. Esta migracion solo CREA las columnas', v_n;
  end if;

  -- Y ninguna marca ABIERTA puede quedarse con restos de cierre.
  select count(*) into v_n from public.brand
   where closure_mode='normal' and closure_set_at is not null;
  if v_n <> 0 then
    raise exception 'ABORTA: quedan % marcas abiertas con closure_set_at', v_n;
  end if;

  -- Y que no nazca alcanzable por anon (leccion del 01/09).
  if has_function_privilege('anon','public.declare_closure_deliberate(uuid, text)','EXECUTE') then
    raise exception 'declare_closure_deliberate nace ejecutable por anon';
  end if;
  if not has_function_privilege('authenticated','public.declare_closure_deliberate(uuid, text)','EXECUTE') then
    raise exception 'authenticated no puede ejecutar declare_closure_deliberate';
  end if;

  raise notice 'VERIFICACION OK: declaracion creada y vacia, vigia filtrando, marcas abiertas limpias, anon fuera';
end
$ver$;

commit;

-- ============================================================================
-- DEUDA QUE ESTO ABRE, CON SU DISPARADOR DE BORRADO
--
-- brand.closure_mode / closure_set_at / closure_resume_at / closure_reason /
-- closure_set_by quedan HUERFANAS en cuanto availability-watchdog deje de
-- leerlas. Hoy 01/09 estaban divergidas 34 h respecto a la fila por local
-- (brand decia 29/08 12:13, brand_closure decia 30/08 22:51): son exactamente
-- la segunda verdad que este encargo viene a cerrar.
--
-- DISPARADOR DE BORRADO — se pueden tirar cuando se cumplan las TRES:
--   1. availability-watchdog desplegado leyendo brand_closure, y con al menos
--      una corrida real sin usar las columnas viejas.
--   2. `grep -rn "closure_mode\|closure_set_at\|closure_resume_at" src/ supabase/`
--      no devuelve ningun LECTOR (solo esta nota y el historico de migraciones).
--      OJO: closure_mode lo escriben/leen hoy set_brand_status y el push a
--      HubRise — es el que mas lectores tiene y probablemente el ultimo en caer.
--   3. Una huella de brand_closure y otra de brand, antes y despues, iguales.
--
-- Mientras no se cumplan, las columnas se quedan: una columna huerfana no hace
-- daño; borrarla con un lector vivo, si.
-- ============================================================================
