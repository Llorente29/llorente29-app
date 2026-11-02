-- supabase/staging/sql/20261103_a01_techo_un_solo_aviso_prueba.sql
--
-- SOLO STAGING. Prueba de la 0012 (A01 · el techo, un solo aviso al día), con
-- \i dentro de la transacción y ROLLBACK: staging no cambia. Nombra lo que
-- cambia: public._aviso_poner_en_cola.
-- sin usuario: _aviso_poner_en_cola la llama encolar_alerta como su dueño (security definer); la app no tiene permiso sobre ella (lo quitó el #450).
--
-- La carrera de verdad (dos transacciones a la vez) no cabe en una sola
-- sesión. Lo que se prueba es lo que la evita: que con el techo lleno la
-- función toma el candado (4101, 1) ANTES de mirar si ya salió el aviso de
-- techo, que sin el techo lleno no lo toma, y que en serie sigue saliendo uno.
-- El candado dura hasta el final de la transacción: hasta el paso 3 no lo toma
-- nadie, así que los pasos 0 y 2 lo pueden medir.
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA A01 techo: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

create function pg_temp.candado() returns boolean language sql as $f$
  select exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
                  and classid = 4101 and objid = 1 and objsubid = 2 and granted)
$f$;
create function pg_temp.llenar() returns void language plpgsql as $f$
declare i integer;
begin
  -- La cola de hoy, vacía y con 10 avisos (ROLLBACK): el techo, lleno.
  delete from public.system_alert_queue where created_at >= (date_trunc('day', now() at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid';
  for i in 1..10 loop
    insert into public.system_alert_queue (kind, subject, message, severity) values ('a01_prueba_techo', 'A01 prueba · ' || i, 'prueba', 'aviso');
  end loop;
end $f$;

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select exists (select 1 from public.funcion_respaldo where migracion = '20261103T0012_a01_techo_un_solo_aviso') as a01_techo_aplicada \gset
\if :a01_techo_aplicada
\i supabase/vuelta-atras/20261103T0012_a01_techo_un_solo_aviso.down.sql
\endif
select pg_temp.llenar();
select public._aviso_poner_en_cola('a01_prueba_techo', 'A01 prueba · de más', 'prueba', null, null, null, null, 'aviso', 1);
do $$ begin
  if pg_temp.candado() then raise exception 'PRUEBA A01 techo · 0: la función de antes ya toma el candado: la prueba no mediría nada.'; end if;
  raise notice 'A01 techo · 0 (rojo a propósito): con la de antes, el techo lleno no toma ningún candado (por eso salieron dos a la vez).';
end $$;
-- ── 1 · Recién aplicada ─────────────────────────────────────────────────────
\i supabase/migrations/20261103T0012_a01_techo_un_solo_aviso.sql

-- ── 2 · Sin el techo lleno, ningún candado ──────────────────────────────────
do $$ declare v bigint; begin
  delete from public.system_alert_queue where created_at >= (date_trunc('day', now() at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid';
  v := public._aviso_poner_en_cola('a01_prueba_techo', 'A01 prueba · normal', 'prueba', null, null, null, null, 'aviso', 1);
  if v is null then raise exception 'PRUEBA A01 techo · 2: sin el techo lleno no se encola.'; end if;
  if pg_temp.candado() then raise exception 'PRUEBA A01 techo · 2: un aviso normal toma el candado (haría esperar al camino de las ventas).'; end if;
  raise notice 'A01 techo · 2: un aviso normal se encola y no toma ningún candado.';
end $$;

-- ── 3 · Con el techo lleno: el candado, y un solo aviso de techo ─────────────
do $$ declare v bigint; begin
  perform pg_temp.llenar();
  v := public._aviso_poner_en_cola('a01_prueba_techo', 'A01 prueba · de más 1', 'prueba', null, null, null, null, 'aviso', 1);
  if v is not null then raise exception 'PRUEBA A01 techo · 3: con el techo lleno se encola.'; end if;
  if not pg_temp.candado() then raise exception 'PRUEBA A01 techo · 3: con el techo lleno no toma el candado.'; end if;
  perform public._aviso_poner_en_cola('a01_prueba_techo', 'A01 prueba · de más 2', 'prueba', null, null, null, null, 'alto', 2);
  if (select count(*) from public.system_alert_queue where debounce_kind = 'aviso-techo-diario'
        and created_at >= (date_trunc('day', now() at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid') <> 1 then
    raise exception 'PRUEBA A01 techo · 3: no sale un solo aviso de techo.';
  end if;
  if (select count(*) from public.aviso_callado where subject in ('A01 prueba · de más 1', 'A01 prueba · de más 2')) <> 2 then
    raise exception 'PRUEBA A01 techo · 3: los 2 de más no quedan en aviso_callado.';
  end if;
  v := public._aviso_poner_en_cola('a01_prueba_techo', 'A01 prueba · crítico', 'prueba', null, null, null, null, 'critico', 3);
  if v is null then raise exception 'PRUEBA A01 techo · 3: un crítico con el techo lleno no sale.'; end if;
  raise notice 'A01 techo · 3: con el techo lleno toma el candado, sale un solo aviso de techo, los de más se guardan y el crítico pasa.';
end $$;

-- ── 4 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261103T0012_a01_techo_un_solo_aviso.down.sql
do $$ begin
  if md5(pg_get_functiondef('public._aviso_poner_en_cola(text,text,text,text,uuid,uuid,uuid,text,integer)'::regprocedure)) <> '5364a26541a548d77af951331245f694' then
    raise exception 'PRUEBA A01 techo · 4: la vuelta atrás no la deja como la del #450.';
  end if;
  raise notice 'A01 techo · 4: la vuelta atrás la deja byte a byte como la del #450.';
end $$;

rollback;
