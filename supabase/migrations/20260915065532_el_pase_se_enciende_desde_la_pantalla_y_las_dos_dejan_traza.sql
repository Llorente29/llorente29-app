-- ═══════════════════════════════════════════════════════════════════════════
-- EL PASE · ENCENDER DESDE LA PANTALLA, Y LAS DOS CON TRAZA · 15/09/2026
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Apagar ya se puede desde la tablet. Encender no se puede desde ningún sitio:
-- hoy sólo existe un UPDATE escrito a mano. Eso convierte la retirada en un
-- viaje sin vuelta — el pase apaga un viernes a las 21:30, que es justo para lo
-- que está, y reintentarlo el sábado exige que esté alguien de fuera delante.
--
-- Un interruptor que sólo el desarrollador puede rearmar no es del cliente.
--
-- Y hoy `pase_apagar` escribe `false` sin dejar constancia de nada: el sábado
-- nadie sabe que se apagó, ni cuándo, ni quién. Eso es la regla 8 --esconder
-- que algo ha pasado-- aplicada al interruptor.

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


-- ═══ 1 · LA TRAZA · cuatro columnas, y las escriben LAS DOS funciones ══════
--
-- Nullable a propósito: hoy los siete locales llevan un `pase_activo` que nadie
-- ha tocado nunca desde una pantalla, y un `now()` de relleno diría que alguien
-- lo cambió esta mañana. NULL aquí significa «no se ha tocado desde que hay
-- traza», que es la verdad (regla 32: el hueco y el dato medido no comparten
-- representación).
alter table public.kitchen_time_config
  add column if not exists pase_activo_at     timestamptz,
  add column if not exists pase_activo_por    uuid,
  add column if not exists pase_activo_desde  text,
  add column if not exists pase_apagado_motivo text;

comment on column public.kitchen_time_config.pase_activo_at is
  'Cuándo cambió `pase_activo` por última vez. NULL = nunca desde que hay traza.';
comment on column public.kitchen_time_config.pase_activo_por is
  'Quién: el usuario si se encendió desde la pantalla, el APARATO (kds_device.id) '
  'si se apagó desde la tablet. Cuál de los dos lo dice `pase_activo_desde`.';
comment on column public.kitchen_time_config.pase_activo_desde is
  '«pantalla» o «tablet». Sin esto, `pase_activo_por` es un uuid sin contexto.';
comment on column public.kitchen_time_config.pase_apagado_motivo is
  'Lo que escriba quien apaga, si escribe algo. NUNCA obligatorio: quien está '
  'apagando tiene un problema encima; se le pregunta después, no antes.';

-- La raya de arriba tiene que aguantar sola: sin CHECK, `desde` podría acabar
-- con cualquier palabra y la pantalla no sabría cómo leer `por`.
alter table public.kitchen_time_config
  drop constraint if exists kitchen_time_config_pase_desde_ck;
alter table public.kitchen_time_config
  add constraint kitchen_time_config_pase_desde_ck
  check (pase_activo_desde is null or pase_activo_desde in ('pantalla', 'tablet'));


-- ═══ 2 · `pase_encender` ═══════════════════════════════════════════════════
--
-- 🔴 SECURITY INVOKER, Y ESO ES LA DECISIÓN IMPORTANTE. No comprueba el permiso
-- por su cuenta: deja que lo compruebe la política que YA gobierna esta tabla,
--
--     kitchen_time_config_rw:
--       current_user_is_admin()
--       OR current_user_is_admin_or_manager_of(<la cuenta del local>)
--
-- El encargo decía «no inventes un permiso nuevo: si alguien puede cambiar los
-- horarios de un local, puede encender su Pase». Existe, y es ése. Escribir
-- aquí una segunda comprobación sería la misma regla en dos sitios, que es la
-- forma en que un día dicen cosas distintas.
--
-- 🔴 Y POR ESO MISMO NO PUEDE SER DEFINER: una función DEFINER se salta la
-- política y tendría que reimplementarla. Invoker es lo que hace que el alcance
-- por cuenta sea el de la casa y no uno mío.
--
-- 🔴 UN UPDATE QUE NO TOCA NINGUNA FILA NO ES UN ÉXITO. Con RLS, a quien no le
-- corresponde el local le salen cero filas y la función devolvería «hecho» sin
-- haber hecho nada: éxito silencioso de la regla 8, y encima en una frontera
-- entre inquilinos. Se cuenta la fila y si no la hay se levanta excepción.
--
-- 🔴 Y NO SE ACEPTA LA CUENTA DEL LLAMANTE. Sólo el local; la cuenta la deduce
-- la política a partir de `locations`. Lo que manda el cliente no decide nunca
-- de quién es lo que va a escribir.
create or replace function public.pase_encender(p_location_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_filas  int;
  v_nombre text;
begin
  if p_location_id is null then
    raise exception 'pase_encender: falta el local';
  end if;

  update kitchen_time_config
     set pase_activo         = true,
         pase_activo_at      = now(),
         pase_activo_por     = auth.uid(),
         pase_activo_desde   = 'pantalla',
         pase_apagado_motivo = null,   -- se enciende: el motivo de apagado caduca
         updated_at          = now()
   where location_id = p_location_id;
  get diagnostics v_filas = row_count;

  if v_filas = 0 then
    -- No se distingue «no existe» de «no es tuyo», y es a propósito: decirlo
    -- sería confirmarle a un inquilino que el local de otro existe.
    raise exception 'pase_encender: este local no existe o no tienes permiso para cambiar sus ajustes';
  end if;

  select l.name into v_nombre from locations l where l.id = p_location_id;

  return jsonb_build_object(
    'local',  v_nombre,
    'activo', true,
    'cuando', now(),
    'por',    auth.uid(),
    'desde',  'pantalla');
end;
$fn$;

-- 🔴 Y AQUÍ VA UNA COSA QUE CAZÓ LA GUARDA DE ESTE MISMO FICHERO, no yo.
--
-- La primera versión hacía sólo `revoke all … from public` y daba EXECUTE a
-- `authenticated`. La guarda del final se disparó: `pase_encender` SEGUÍA
-- siendo ejecutable por `anon`.
--
-- El motivo no es un descuido: `pg_default_acl` del esquema `public` tiene
-- puesto, por `postgres` y por `supabase_admin`,
--
--     {postgres=X, anon=X, authenticated=X, service_role=X}
--
-- o sea que TODA función nueva de este esquema nace ejecutable por `anon`, y
-- `revoke … from public` no lo quita porque el permiso está concedido
-- DIRECTAMENTE a `anon`, no a PUBLIC. Hay que revocárselo por su nombre.
--
-- Esto explica de paso las 306 funciones definer con `anon` que están en la
-- lista: no es que nadie se acordara, es que el permiso se pone solo.
revoke all on function public.pase_encender(uuid) from public;
revoke all on function public.pase_encender(uuid) from anon;
-- 🔴 A `authenticated` Y NO A `anon`: una tablet NO enciende. Nadie le cambia
-- la pantalla a la cocina desde el propio pase en mitad de un servicio.
grant execute on function public.pase_encender(uuid) to authenticated, service_role;


-- ═══ 3 · `pase_apagar` GANA UN PARÁMETRO ═══════════════════════════════════
--
-- 🔴 DROP + CREATE, NUNCA `create or replace`. Añadir un parámetro con replace
-- no reemplaza: crea una SOBRECARGA, y a partir de ahí las llamadas de un
-- argumento son ambiguas. Es la regla 2, y costó siete vigías sin poder encolar
-- el 27/08. El motivo lleva `default null`, así que la llamada de hoy --sólo el
-- token-- sigue siendo válida sin tocar la tablet.
drop function if exists public.pase_apagar(text);

create or replace function public.pase_apagar(p_device_token text, p_motivo text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_device kds_device;
  v_local  uuid;
  v_nombre text;
  v_estaba boolean;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'pase_apagar: token de dispositivo no válido';
  end if;
  v_local := v_device.location_id;

  select l.name into v_nombre from locations l
   where l.id = v_local and l.account_id = v_device.account_id;
  if v_nombre is null then
    raise exception 'pase_apagar: el aparato no corresponde a un local de su cuenta';
  end if;

  select coalesce(k.pase_activo, false) into v_estaba
    from kitchen_time_config k where k.location_id = v_local;

  update kitchen_time_config
     set pase_activo         = false,
         pase_activo_at      = now(),
         -- Aquí `por` es el APARATO, no una persona: el token identifica la
         -- tablet y en el pase de Alcalá pulsan varias personas con el mismo.
         -- Inventar un nombre sería lo que llevamos dos días quitando.
         pase_activo_por     = v_device.id,
         pase_activo_desde   = 'tablet',
         pase_apagado_motivo = nullif(btrim(p_motivo), ''),
         updated_at          = now()
   where location_id = v_local;

  return jsonb_build_object(
    'local',   v_nombre,
    'estaba',  coalesce(v_estaba, false),
    'activo',  false,
    'cuando',  now(),
    'desde',   'tablet');
end;
$fn$;

-- El DROP se llevó los permisos por delante: se reponen EXACTAMENTE los que
-- tenía, ni uno más. Y el ensayo lo comprueba, que es la única forma.
revoke all on function public.pase_apagar(text, text) from public;
grant execute on function public.pase_apagar(text, text) to anon, authenticated, service_role;


-- ═══ EL ENSAYO ═════════════════════════════════════════════════════════════
--
-- 🔴 SE IMPERSONA DE VERDAD. Como `postgres` la RLS no se aplica, así que un
-- ensayo sin `set local role authenticated` probaría que la función escribe,
-- no que el permiso sirve — verde sobre algo incapaz de fallar (regla 36).
do $ensayo$
declare
  ALCALA   constant uuid := '38158159-cd71-4056-950b-53425afac1ce';
  JULIO    constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';  -- admin de Foodint
  AJENO    constant uuid := 'aeaafb7e-7911-4095-a773-4ae63dc77a9e';  -- admin de OTRA cuenta
  CURRANTE constant uuid := '20b3f992-7210-45c5-af92-8d16f0ee2a3c';  -- worker de Foodint
  v_tok text; v_r jsonb; v_fallos text[] := '{}'; v_ok boolean;
begin
  select token into v_tok from kds_device where label = 'Pase' and location_id = ALCALA;

  -- 🔴 ANTES DE NADA: si el usuario «ajeno» resultara ser admin de plataforma,
  -- podría encender legítimamente y el ensayo saldría verde sin haber probado
  -- el alcance. Se comprueba, no se supone.
  if exists (select 1 from platform_admins where user_id = AJENO and active) then
    raise exception 'ENSAYO ROTO: el usuario de otra cuenta es admin de plataforma, '
                    'así que el ensayo de alcance no prueba nada. Elegir otro.';
  end if;
  if exists (select 1 from platform_admins where user_id = CURRANTE and active) then
    raise exception 'ENSAYO ROTO: el currante es admin de plataforma.';
  end if;

  -- ── A · JULIO SÍ PUEDE, y deja traza de pantalla ────────────────────────
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      format('{"sub":"%s","role":"authenticated"}', JULIO), true);

    v_r := public.pase_encender(ALCALA);

    if not (select pase_activo from kitchen_time_config where location_id = ALCALA) then
      v_fallos := v_fallos || 'A: el admin de la cuenta no ha conseguido encender';
    end if;
    if (select pase_activo_desde from kitchen_time_config where location_id = ALCALA) <> 'pantalla' then
      v_fallos := v_fallos || 'A: la traza no dice «pantalla»';
    end if;
    if (select pase_activo_por from kitchen_time_config where location_id = ALCALA) <> JULIO then
      v_fallos := v_fallos || 'A: la traza no guarda al usuario que encendió';
    end if;
    if (select pase_activo_at from kitchen_time_config where location_id = ALCALA) is null then
      v_fallos := v_fallos || 'A: la traza no guarda cuándo';
    end if;
    raise exception 'DESHACER_A';
  exception when others then
    if sqlerrm <> 'DESHACER_A' then v_fallos := v_fallos || ('A sin ensayar: ' || sqlerrm); end if;
  end;

  -- ── B · EL DE OTRA CUENTA NO PUEDE ──────────────────────────────────────
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      format('{"sub":"%s","role":"authenticated"}', AJENO), true);
    v_ok := false;
    begin
      perform public.pase_encender(ALCALA);
      v_ok := true;   -- si llega aquí, ha encendido el local de otro
    exception when others then
      null;           -- lo esperado
    end;
    if v_ok then
      v_fallos := v_fallos || 'B: un usuario de OTRA CUENTA ha encendido el Pase de Alcala';
    end if;
    if (select pase_activo from kitchen_time_config where location_id = ALCALA) then
      v_fallos := v_fallos || 'B: el interruptor quedo encendido tras el intento ajeno';
    end if;
    raise exception 'DESHACER_B';
  exception when others then
    if sqlerrm <> 'DESHACER_B' then v_fallos := v_fallos || ('B sin ensayar: ' || sqlerrm); end if;
  end;

  -- ── C · UN CURRANTE DE LA MISMA CUENTA TAMPOCO ──────────────────────────
  -- Misma cuenta, rol distinto: es el caso que se cuela cuando sólo se prueba
  -- el alcance entre inquilinos.
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      format('{"sub":"%s","role":"authenticated"}', CURRANTE), true);
    v_ok := false;
    begin
      perform public.pase_encender(ALCALA);
      v_ok := true;
    exception when others then
      null;
    end;
    if v_ok then
      v_fallos := v_fallos || 'C: un worker ha encendido el Pase';
    end if;
    raise exception 'DESHACER_C';
  exception when others then
    if sqlerrm <> 'DESHACER_C' then v_fallos := v_fallos || ('C sin ensayar: ' || sqlerrm); end if;
  end;

  -- ── D · APAGAR DEJA TRAZA DE TABLET, con motivo y sin él ────────────────
  begin
    update kitchen_time_config set pase_activo = true where location_id = ALCALA;

    v_r := public.pase_apagar(v_tok, '  la pantalla se quedó en blanco  ');
    if (select pase_activo_desde from kitchen_time_config where location_id = ALCALA) <> 'tablet' then
      v_fallos := v_fallos || 'D: apagar no deja traza de «tablet»';
    end if;
    if (select pase_activo_por from kitchen_time_config where location_id = ALCALA)
       <> (select id from kds_device where label = 'Pase' and location_id = ALCALA) then
      v_fallos := v_fallos || 'D: la traza no guarda el APARATO que apagó';
    end if;
    if (select pase_apagado_motivo from kitchen_time_config where location_id = ALCALA)
       <> 'la pantalla se quedó en blanco' then
      v_fallos := v_fallos || 'D: el motivo no se guarda recortado';
    end if;

    -- Y sin motivo: nunca es obligatorio.
    update kitchen_time_config set pase_activo = true where location_id = ALCALA;
    v_r := public.pase_apagar(v_tok);
    if (select pase_activo from kitchen_time_config where location_id = ALCALA) then
      v_fallos := v_fallos || 'D: apagar sin motivo no apaga';
    end if;
    if (select pase_apagado_motivo from kitchen_time_config where location_id = ALCALA) is not null then
      v_fallos := v_fallos || 'D: apagar sin motivo deja el motivo anterior pegado';
    end if;

    -- Y encender LIMPIA el motivo del apagado anterior.
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      format('{"sub":"%s","role":"authenticated"}', JULIO), true);
    perform public.pase_encender(ALCALA);
    if (select pase_apagado_motivo from kitchen_time_config where location_id = ALCALA) is not null then
      v_fallos := v_fallos || 'D: encender no limpia el motivo del apagado anterior';
    end if;

    raise exception 'DESHACER_D';
  exception when others then
    if sqlerrm <> 'DESHACER_D' then v_fallos := v_fallos || ('D sin ensayar: ' || sqlerrm); end if;
  end;

  if array_length(v_fallos, 1) > 0 then
    raise exception 'ENSAYO DEL INTERRUPTOR: %', array_to_string(v_fallos, ' · ');
  end if;
  raise notice 'ENSAYO DEL INTERRUPTOR (A, B, C, D): en verde, y con impersonación de verdad.';
end
$ensayo$;


-- ═══ GUARDA FINAL ══════════════════════════════════════════════════════════
do $guarda$
declare v_n int;
begin
  select count(*) into v_n from kitchen_time_config where coalesce(pase_activo, false);
  if v_n > 0 then
    raise exception 'GUARDA: han quedado % locales ENCENDIDOS. NO CONFIRMAR.', v_n;
  end if;
  select count(*) into v_n from kitchen_time_config where pase_activo_at is not null;
  if v_n > 0 then
    raise exception 'GUARDA: han quedado % trazas escritas por el ensayo. NO CONFIRMAR.', v_n;
  end if;
  if has_function_privilege('anon', 'public.pase_encender(uuid)'::regprocedure, 'EXECUTE') then
    raise exception 'GUARDA: `pase_encender` es ejecutable por anon. Una tablet no enciende.';
  end if;
  if not has_function_privilege('authenticated', 'public.pase_encender(uuid)'::regprocedure, 'EXECUTE') then
    raise exception 'GUARDA: `pase_encender` no es ejecutable por authenticated. Nadie podría encender.';
  end if;
  if not has_function_privilege('anon', 'public.pase_apagar(text,text)'::regprocedure, 'EXECUTE') then
    raise exception 'GUARDA: el DROP+CREATE ha dejado a `pase_apagar` sin el permiso de anon que tenía.';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='pase_apagar') <> 1 then
    raise exception 'GUARDA: hay más de una `pase_apagar`. El DROP+CREATE ha dejado una sobrecarga.';
  end if;
  raise notice 'GUARDA: cero encendidos, cero trazas, anon sin encender, apagar con sus permisos y sin sobrecarga.';
end
$guarda$;
