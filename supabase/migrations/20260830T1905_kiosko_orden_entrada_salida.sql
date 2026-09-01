-- 20260830T1905_kiosko_orden_entrada_salida.sql
-- ============================================================================
-- EL KIOSKO DEJA DE ACEPTAR FICHAJES IMPOSIBLES.
--
-- APLICADA el 01/09/2026 a las 07:15 (Madrid) = 05:14 UTC, con los dos locales
-- cerrados. Registrada como 20260901051458. Ensayada antes contra produccion
-- dentro de una transaccion revertida: los 8 casos salieron bien y no se
-- escribio ni una fila.
--
-- ###########################################################################
-- #                                                                         #
-- #   SI ESTA NOCHE ALGUIEN NO PUEDE FICHAR LA SALIDA, PEGA ESTA LINEA:     #
-- #                                                                         #
-- #     alter table public.clock_entries disable trigger trg_clock_entry_orden;
-- #                                                                         #
-- #   Desarma el guard entero al instante. No hay que pensar, no hay que    #
-- #   buscar y no hay que entender nada de lo que viene debajo. Los         #
-- #   fichajes vuelven a entrar como entraban ayer. Se arregla por la       #
-- #   manana.                                                               #
-- #                                                                         #
-- #   Para volver a armarlo:                                                #
-- #     alter table public.clock_entries enable trigger trg_clock_entry_orden;
-- #                                                                         #
-- ###########################################################################
--
-- Un guard nuevo que bloquea a la 01:30 es peor que el problema que arregla
-- (Julio, 01/09). Esa linea existe para que esa frase no sea solo una opinion.
--
-- ── REVERSION COMPLETA, si hay que deshacerlo del todo ─────────────────────
-- La linea de arriba basta para desatascar. Esto es para dejar la base como
-- estaba, y OJO: no vale solo con borrar lo nuevo, porque esta migracion
-- RETIRA el guard de pausas y hay que devolverlo o las pausas se quedan sin
-- ninguno.
--
--   begin;
--     drop trigger if exists trg_clock_entry_orden on public.clock_entries;
--     drop function if exists public.tg_clock_entry_orden();
--
--     -- Devolver el guard de pausas TAL CUAL estaba (20260807T2425):
--     create or replace function public.tg_clock_entry_pause_order()
--     returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
--     as $$
--     declare v_last text;
--     begin
--       if new.type not in ('pausa_inicio','pausa_fin') then return new; end if;
--       if coalesce(new.source,'') = 'manual' then return new; end if;
--       select ce.type into v_last
--       from clock_entries ce
--       where ce.employee_id = new.employee_id
--         and coalesce(ce.voided,false) = false
--         and ce.real_datetime <= coalesce(new.real_datetime, new.datetime, now())
--       order by ce.real_datetime desc limit 1;
--       if new.type = 'pausa_inicio' then
--         if v_last is null or v_last in ('salida','pausa_inicio') then
--           raise exception 'PAUSA_FUERA_DE_ORDEN: no se puede iniciar una pausa sin estar fichado dentro'
--             using hint = 'Ficha la entrada antes de iniciar la pausa.';
--         end if;
--       else
--         if v_last is distinct from 'pausa_inicio' then
--           raise exception 'PAUSA_FUERA_DE_ORDEN: no hay ninguna pausa iniciada que cerrar'
--             using hint = 'Solo se puede volver de pausa si antes se inicio una.';
--         end if;
--       end if;
--       return new;
--     end $$;
--     drop trigger if exists trg_clock_entry_pause_order on public.clock_entries;
--     create trigger trg_clock_entry_pause_order
--       before insert on public.clock_entries
--       for each row execute function public.tg_clock_entry_pause_order();
--
--     delete from supabase_migrations.schema_migrations
--      where name = 'kiosko_orden_entrada_salida';
--   commit;
--
--   La columna stale_prev_open_at se puede DEJAR: es nullable, no la lee nadie
--   mas y borrarla perderia las marcas ya escritas. Si aun asi se quiere:
--     alter table public.clock_entries drop column if exists stale_prev_open_at;
--
-- ── ENSAYO CONTRA PRODUCCION, revertido (01/09 07:12) ──────────────────────
--   1 ENTRADA estando fuera .................................... ACEPTA
--   2 ENTRADA de madrugada estando YA DENTRO .................... RECHAZA
--       «YA_ESTA_DENTRO: hay una jornada abierta desde 01/09 04:12»
--       pista: «Ya estas dentro desde las 04:12. ¿Querias fichar la SALIDA?»
--   3 SALIDA estando dentro ..................................... ACEPTA
--   4 SALIDA en frio, sin entrada abierta ....................... RECHAZA
--       pista: «No hay ninguna entrada abierta. ¿Querias fichar la ENTRADA?»
--   5 ENTRADA con jornada rancia de 20 h ........................ ACEPTA
--       y stale_prev_open_at queda relleno (31/08 11:12)
--   6 PAUSA sin estar dentro .................................... RECHAZA
--   7 El gestor (source='manual') pasa por encima ............... ACEPTA
--   8 Debounce <60 s sigue vivo ................................. SALTA
--
-- ── VERIFICACION DESPUES DE APLICAR ────────────────────────────────────────
--   trg_clock_entry_orden enganchado ......... 1
--   trg_clock_debounce intacto ............... 1
--   trg_clock_entry_pause_order (vieja) ...... 0, y su funcion retirada
--   anon / authenticated pueden ejecutarla ... false / false
--   service_role ............................. true
--   clock_entries ............................ 855 filas, ninguna tocada
--   filas con stale_prev_open_at ............. 0
--
-- EL FALLO, CON NOMBRES
-- Al cierre, la persona quiere fichar SALIDA y pulsa ENTRADA. Nadie la para, y
-- a la mañana siguiente su salida real cierra una jornada que incluye la noche
-- entera durmiendo:
--   Mirlenys  28/08 00:15 -> 16:09  (15,89 h), y otra vez el 29 y el 30.
--   Natacha   19/08 00:11 -> 15:55  (15,73 h).
--   Marlon    01 -> 02/08           (28,17 h).
-- 46 jornadas de >=10,5 h en agosto; 12 casi seguro falsas, ~80 h infladas en
-- bolsa y en gestoria.
--
-- POR QUE NO LO PARABA NADIE (verificado el 30/08)
-- El kiosko NO pasa por ninguna RPC: inserta directo en clock_entries. Un solo
-- camino de escritura en todo el front (supabaseSync.ts:451). Y de las dos
-- guardas vivas, ninguna mira el orden entrada/salida:
--   trg_clock_debounce          -> solo anti-doble-toque <60 s.
--   trg_clock_entry_pause_order -> solo el orden de las PAUSAS.
-- El camino del gestor si estaba guardado desde el 29/08 (add_manual_clock_entry
-- con p_force y YA_ESTA_FICHADO). Un guard que solo vive en una de las puertas
-- no es un guard.
--
-- UNA SOLA FUNCION DECIDE EL ORDEN
-- Se retira tg_clock_entry_pause_order y su logica pasa TAL CUAL a
-- tg_clock_entry_orden, que ademas cubre entrada/salida. Dos funciones
-- decidiendo el orden de la misma tabla es como se acaba arreglando una y
-- dejando la otra: exactamente lo que pasa hoy.
-- El comportamiento de las pausas NO cambia: misma consulta del ultimo fichaje
-- (real_datetime, que esta relleno en las 837 filas), mismas dos condiciones,
-- mismos dos mensajes.
--
-- LA ENTRADA RANCIA SE ACEPTA Y SE MARCA
-- Si la jornada abierta lleva >= 12 h, la entrada de hoy se ACEPTA: es el caso
-- legitimo de "ayer olvide la salida", y bloquearla dejaria a la persona sin
-- poder trabajar. Se marca en la fila NUEVA, no en la vieja: el encargo dice
-- que ningun fichaje historico se toca, y marcar la huerfana seria tocarlo.
-- Un dato que el motor no sabe interpretar se marca, nunca se descarta.
-- ============================================================================

begin;

-- ── La señal, en la fila nueva. No se toca ninguna fila historica ───────────
alter table public.clock_entries
  add column if not exists stale_prev_open_at timestamptz;

comment on column public.clock_entries.stale_prev_open_at is
  'Si este fichaje es una ENTRADA aceptada habiendo otra jornada abierta y RANCIA '
  '(>= 12 h), aqui queda cuando empezo esa jornada anterior. Deja rastro de que se '
  'olvido una salida sin tocar la fila vieja. NULL = el caso normal.';

-- ── La maquina de estados, una sola ─────────────────────────────────────────
create or replace function public.tg_clock_entry_orden()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  -- A partir de aqui una jornada abierta deja de ser "esta dentro" y pasa a ser
  -- "se olvido la salida". 12 h: por encima del turno mas largo real (el cierre
  -- tardio de Alcala son 5,75 h) y por debajo del hueco entre el cierre de una
  -- noche y la entrada del dia siguiente. No se inventa en cada rama: se declara
  -- aqui una vez.
  c_jornada_rancia constant interval := interval '12 hours';
  v_last     text;
  v_last_at  timestamptz;
  v_ts       timestamptz;
begin
  -- Las correcciones del gestor no pasan por aqui: van por
  -- add_manual_clock_entry, que tiene su propia guarda y su p_force.
  if coalesce(new.source,'') = 'manual' then
    return new;
  end if;

  v_ts := coalesce(new.real_datetime, new.datetime, now());

  select ce.type, ce.real_datetime
    into v_last, v_last_at
  from clock_entries ce
  where ce.employee_id = new.employee_id
    and coalesce(ce.voided,false) = false
    and ce.real_datetime <= v_ts
  order by ce.real_datetime desc
  limit 1;

  -- ── PAUSAS — identico a tg_clock_entry_pause_order, que esta se retira ────
  if new.type in ('pausa_inicio','pausa_fin') then
    if new.type = 'pausa_inicio' then
      if v_last is null or v_last in ('salida','pausa_inicio') then
        raise exception 'PAUSA_FUERA_DE_ORDEN: no se puede iniciar una pausa sin estar fichado dentro'
          using hint = 'Ficha la entrada antes de iniciar la pausa.';
      end if;
    else
      if v_last is distinct from 'pausa_inicio' then
        raise exception 'PAUSA_FUERA_DE_ORDEN: no hay ninguna pausa iniciada que cerrar'
          using hint = 'Solo se puede volver de pausa si antes se inicio una.';
      end if;
    end if;
    return new;
  end if;

  -- ── ENTRADA ──────────────────────────────────────────────────────────────
  if new.type = 'entrada' then
    if v_last in ('entrada','pausa_inicio','pausa_fin') then
      if v_ts - v_last_at < c_jornada_rancia then
        raise exception 'YA_ESTA_DENTRO: hay una jornada abierta desde %',
          to_char(v_last_at at time zone 'Europe/Madrid','DD/MM HH24:MI')
          using hint = 'Ya estas dentro desde las '
                       || to_char(v_last_at at time zone 'Europe/Madrid','HH24:MI')
                       || '. ¿Querias fichar la SALIDA?';
      else
        -- "Ayer olvide la salida". Se acepta para no dejarla sin trabajar, y se
        -- deja dicho de donde viene.
        new.stale_prev_open_at := v_last_at;
      end if;
    end if;
    return new;
  end if;

  -- ── SALIDA ───────────────────────────────────────────────────────────────
  if new.type = 'salida' then
    if v_last is null or v_last = 'salida' then
      raise exception 'NO_ESTA_FICHADO: no hay ninguna entrada abierta que cerrar'
        using hint = 'No hay ninguna entrada abierta. ¿Querias fichar la ENTRADA?';
    end if;
    return new;
  end if;

  return new;
end $function$;

comment on function public.tg_clock_entry_orden() is
  'Orden de los fichajes que NO son manuales: pausas (heredado de '
  'tg_clock_entry_pause_order, sin cambios) y entrada/salida (30/08/2026). Una '
  'ENTRADA sobre una jornada abierta de menos de 12 h se rechaza con YA_ESTA_DENTRO; '
  'si la jornada abierta es mas vieja se acepta y se marca en stale_prev_open_at. '
  'Una SALIDA sin entrada abierta se rechaza con NO_ESTA_FICHADO.';

-- Se retira la de pausas: su logica vive ahora dentro de la de arriba.
drop trigger if exists trg_clock_entry_pause_order on public.clock_entries;
drop function if exists public.tg_clock_entry_pause_order();

-- El nombre importa: los BEFORE se disparan por orden alfabetico, y asi el
-- debounce (trg_clock_debounce) sigue siendo el primero.
drop trigger if exists trg_clock_entry_orden on public.clock_entries;
create trigger trg_clock_entry_orden
  before insert on public.clock_entries
  for each row execute function public.tg_clock_entry_orden();

-- ── Permisos EXPLICITOS ────────────────────────────────────────────────────
-- Patron de la casa para funciones de trigger, el que ya tienen
-- tg_clock_entry_debounce, tg_clock_entry_audit y _fill_acc_from_employee:
-- solo postgres y service_role. La que se retira era la unica del grupo con
-- PUBLIC, anon y authenticated -- nacio abierta y nadie la cerro.
revoke all on function public.tg_clock_entry_orden() from public;
revoke all on function public.tg_clock_entry_orden() from anon;
revoke all on function public.tg_clock_entry_orden() from authenticated;
grant execute on function public.tg_clock_entry_orden() to service_role;

-- ── GUARDA ─────────────────────────────────────────────────────────────────
do $ver$
begin
  if to_regprocedure('public.tg_clock_entry_orden()') is null then
    raise exception 'tg_clock_entry_orden no quedo creada';
  end if;
  if to_regprocedure('public.tg_clock_entry_pause_order()') is not null then
    raise exception 'la funcion de pausas sigue viva: dos funciones decidiendo el mismo orden';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.clock_entries'::regclass
                   and tgname='trg_clock_entry_orden' and not tgisinternal) then
    raise exception 'el trigger no quedo enganchado a clock_entries';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid='public.clock_entries'::regclass
                   and tgname='trg_clock_debounce' and not tgisinternal) then
    raise exception 'el debounce de 60 s ha desaparecido y NO debia';
  end if;
  if has_function_privilege('anon','public.tg_clock_entry_orden()','EXECUTE')
     or has_function_privilege('authenticated','public.tg_clock_entry_orden()','EXECUTE') then
    raise exception 'la funcion del trigger nacio alcanzable por anon o authenticated';
  end if;
  if not has_function_privilege('service_role','public.tg_clock_entry_orden()','EXECUTE') then
    raise exception 'service_role no puede ejecutarla';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='clock_entries'
                    and column_name='stale_prev_open_at') then
    raise exception 'falta la columna de la señal';
  end if;

  raise notice 'VERIFICACION OK: una sola maquina de estados, debounce intacto, permisos cerrados';
end
$ver$;

commit;

-- ── Comprobaciones DESPUES de aplicar. Se hacen EN TRANSACCION CON ROLLBACK ─
-- Ningun fichaje historico se toca: estos ensayos insertan y deshacen.
--
-- 1) Replay Mirlenys (verificacion 1). Estaba dentro desde ~16:00 del 27:
-- begin;
--   insert into clock_entries(employee_id, type, datetime, real_datetime, source)
--   values ('<mirlenys>', 'entrada', '2026-08-28 00:15+02', '2026-08-28 00:15+02', 'kiosko');
--   -- esperado: ERROR YA_ESTA_DENTRO, con la hora en el hint.
-- rollback;
--
-- 2) Y su SALIDA a la misma hora SI entra:
-- begin;
--   insert into clock_entries(employee_id, type, datetime, real_datetime, source)
--   values ('<mirlenys>', 'salida', '2026-08-28 00:15+02', '2026-08-28 00:15+02', 'kiosko');
--   -- esperado: 1 fila.
-- rollback;
--
-- 3) Caso legitimo (verificacion 3): entrada huerfana de ayer, entrada hoy ->
--    aceptada Y con stale_prev_open_at relleno:
--   select type, stale_prev_open_at from clock_entries where id = '<la nueva>';
--
-- 4) SALIDA en frio -> ERROR NO_ESTA_FICHADO.
-- 5) Los 4 casos de pausas siguen dando lo mismo que antes.
-- 6) add_manual_clock_entry con p_force sigue pudiendo todo (source='manual'
--    sale por la primera linea de la funcion).
-- 7) Debounce: dos fichajes a <60 s -> DOBLE_FICHAJE_MUY_RAPIDO.
