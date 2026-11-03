-- supabase/staging/sql/20261103_dm1_invitaciones_prueba.sql
--
-- SOLO STAGING. Prueba de la 0812 (DM1 · Accesos 1: una invitación que se
-- acepta), con \i dentro de la transacción y ROLLBACK: staging no cambia.
-- Nombra lo que crea: public.invitacion, public.invitacion_crear,
-- public.invitacion_aceptar, public.invitaciones_de_cuenta,
-- public.invitacion_anular, public.accesos_de_cuenta y public.acceso_quitar.
--
-- Entra COMO CADA UNO, con su sesión de verdad (request.jwt.claims + role):
-- el administrador de A, el encargado de A y una persona nueva, invitada, con un
-- correo inventado (T11). La pregunta de Julio: el invitado solo ve las
-- empresas que le dieron, con el permiso que le dieron.
--
--   0 · ROJO A PROPÓSITO: con un acceso a B metido a mano (lo que NO debe
--       pasar), la comprobación «solo ve A» lo detecta. Si no lo detectara, no
--       mediría nada.
--   2 · el administrador de A invita a la persona a A como Encargado; no puede
--       invitarla a B (no es su administrador). La ve en «Pendientes».
--   3 · la invitada, antes de aceptar, no ve ninguna empresa; ve su invitación;
--       acepta; ve A y nada de B, como Encargado y no como administradora.
--   4 · el encargado de A no ve las pendientes ni quién tiene acceso.
--   5 · anular y reenviar: una anulada no se reenvía ni se acepta.
--   6 · quién tiene acceso y quitarlo: la invitada sale en la lista y, al
--       quitarla, deja de ver A. Nadie se quita a sí mismo.
--   7 · la vuelta atrás: fuera lo nuevo.
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DM1 Accesos: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select to_regclass('public.invitacion') is not null as dm1_inv_aplicada \gset
\if :dm1_inv_aplicada
\i supabase/vuelta-atras/20261103T0812_dm1_invitaciones.down.sql
\endif

create temp table _s (clave text primary key, v text) on commit drop;
grant select, insert, update on _s to authenticated, anon;
insert into _s values
  ('a', 'c01a0000-0000-4000-8000-00000000000a'), ('b', 'c01b0000-0000-4000-8000-00000000000b'),
  ('admin_a', 'c01a0000-0000-4000-8000-0000000000a1'), ('encargado', 'c01a0000-0000-4000-8000-0000000000a6'),
  ('invitada', 'd1a10000-0000-4000-8000-0000000000e1'), ('correo', 'invitada.dm1@example.invalid'),
  ('otra', 'otra.dm1@example.invalid');

do $$ begin
  if not exists (select 1 from public.user_profiles where user_id = (select v::uuid from _s where clave = 'admin_a')
                  and account_id = (select v::uuid from _s where clave = 'a') and role = 'admin' and active) then
    raise exception 'PRUEBA DM1 Accesos · 0: falta el administrador de A de las semillas.';
  end if;
end $$;
-- La persona nueva: un usuario sin ninguna empresa (se va con el ROLLBACK).
insert into auth.users (id, email) values ((select v::uuid from _s where clave = 'invitada'), (select v from _s where clave = 'correo'));

-- Como quien sea.
create or replace function pg_temp.como(p_quien text) returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = p_quien), 'role', 'authenticated')::text, true)
$f$;
-- ¿Ve solo A? Devuelve qué ve de más, o null si ve justo A (o nada si p_ninguna).
create or replace function pg_temp.ve_de_mas(p_ninguna boolean) returns text language plpgsql as $f$
declare v_ids uuid[] := public.current_user_account_ids(); v_b int;
begin
  select count(*) into v_b from public.supplier where account_id = (select v::uuid from _s where clave = 'b');
  if v_b > 0 then return 've ' || v_b || ' proveedores de B'; end if;
  if p_ninguna then
    if coalesce(array_length(v_ids, 1), 0) > 0 then return 've ' || array_length(v_ids, 1) || ' empresa(s)'; end if;
  else
    if v_ids is distinct from array[(select v::uuid from _s where clave = 'a')] then return 've estas empresas: ' || v_ids::text; end if;
  end if;
  return null;
end $f$;

-- ROJO A PROPÓSITO: un acceso a B metido a mano. La comprobación lo tiene que ver.
insert into public.user_profiles (user_id, account_id, role, active, display_name)
values ((select v::uuid from _s where clave = 'invitada'), (select v::uuid from _s where clave = 'b'), 'manager', true, 'Fallo a propósito (prueba DM1)');
select pg_temp.como('invitada');
set local role authenticated;
select pg_temp.ve_de_mas(true) as de_mas \gset
reset role;
select set_config('request.jwt.claims', '', true);
\if :{?de_mas}
select set_config('dm1.de_mas', :'de_mas', true);
do $$ begin raise notice 'DM1 Accesos · 0 (rojo a propósito): con un acceso a B metido a mano, la comprobación lo ve: %.', current_setting('dm1.de_mas'); end $$;
\else
do $$ begin raise exception 'PRUEBA DM1 Accesos · 0: con un acceso a B metido a mano, la comprobación no ve nada: no mediría nada.'; end $$;
\endif
delete from public.user_profiles where user_id = (select v::uuid from _s where clave = 'invitada');

-- ── 1 · Recién aplicada ─────────────────────────────────────────────────────
\i supabase/migrations/20261103T0812_dm1_invitaciones.sql

-- ── 2 · El administrador de A invita (como invitar-persona, con su servicio) ─
do $$ declare v_lote uuid; v_err text; begin
  v_lote := public.invitacion_crear((select v from _s where clave = 'correo'),
    jsonb_build_array(jsonb_build_object('account_id', (select v from _s where clave = 'a'), 'rol', 'manager')),
    md5('token-de-prueba-dm1'), (select v::uuid from _s where clave = 'admin_a'), 'Administración de A');
  if v_lote is null then raise exception 'PRUEBA DM1 Accesos · 2: no se crea la invitación.'; end if;
  begin
    perform public.invitacion_crear((select v from _s where clave = 'correo'),
      jsonb_build_array(jsonb_build_object('account_id', (select v from _s where clave = 'b'), 'rol', 'admin')),
      md5('otro-token-dm1'), (select v::uuid from _s where clave = 'admin_a'), 'Administración de A');
    raise exception 'PRUEBA DM1 Accesos · 2: el administrador de A ha invitado a B.';
  exception when raise_exception then
    get stacked diagnostics v_err = message_text;
    if v_err like 'PRUEBA%' then raise; end if;
  end;
  raise notice 'DM1 Accesos · 2: el administrador de A invita a A; a B no puede.';
end $$;
select pg_temp.como('admin_a');
set local role authenticated;
do $$ begin
  if (select count(*) from public.invitaciones_de_cuenta((select v::uuid from _s where clave = 'a'))) <> 1 then
    raise exception 'PRUEBA DM1 Accesos · 2: el administrador de A no ve la invitación en Pendientes.';
  end if;
  raise notice 'DM1 Accesos · 2: el administrador de A la ve en Pendientes.';
end $$;
reset role;

-- ── 3 · La invitada: antes nada; acepta; ve A como Encargado y nada de B ─────
select pg_temp.como('invitada');
set local role authenticated;
do $$ declare v_vista text; v_nombres text[]; begin
  v_vista := pg_temp.ve_de_mas(true);
  if v_vista is not null then raise exception 'PRUEBA DM1 Accesos · 3: antes de aceptar ya %.', v_vista; end if;
  if (select count(*) from public.mis_invitaciones()) <> 1 then raise exception 'PRUEBA DM1 Accesos · 3: no ve su invitación.'; end if;
  v_nombres := public.invitacion_aceptar(null);
  if coalesce(array_length(v_nombres, 1), 0) <> 1 then raise exception 'PRUEBA DM1 Accesos · 3: aceptar no da una empresa.'; end if;
  v_vista := pg_temp.ve_de_mas(false);
  if v_vista is not null then raise exception 'PRUEBA DM1 Accesos · 3: después de aceptar %.', v_vista; end if;
  if public.current_user_is_admin_of((select v::uuid from _s where clave = 'a')) then
    raise exception 'PRUEBA DM1 Accesos · 3: la invitaron como Encargado y es administradora.';
  end if;
  if not public.current_user_is_admin_or_manager_of((select v::uuid from _s where clave = 'a')) then
    raise exception 'PRUEBA DM1 Accesos · 3: no es Encargado de A.';
  end if;
  if (select count(*) from public.mis_invitaciones()) <> 0 then raise exception 'PRUEBA DM1 Accesos · 3: sigue pendiente después de aceptar.'; end if;
  raise notice 'DM1 Accesos · 3: antes de aceptar no ve nada; acepta; ve A y nada de B, como Encargado.';
end $$;
reset role;

-- ── 4 · El encargado de A no ve las pendientes ni quién entra ───────────────
select pg_temp.como('encargado');
set local role authenticated;
do $$ declare v_err text; begin
  begin
    perform public.invitaciones_de_cuenta((select v::uuid from _s where clave = 'a'));
    raise exception 'PRUEBA DM1 Accesos · 4: el encargado ve las invitaciones.';
  exception when raise_exception then get stacked diagnostics v_err = message_text; if v_err like 'PRUEBA%' then raise; end if; end;
  begin
    perform public.accesos_de_cuenta((select v::uuid from _s where clave = 'a'));
    raise exception 'PRUEBA DM1 Accesos · 4: el encargado ve quién tiene acceso.';
  exception when raise_exception then get stacked diagnostics v_err = message_text; if v_err like 'PRUEBA%' then raise; end if; end;
  raise notice 'DM1 Accesos · 4: el encargado de A no ve las pendientes ni quién entra.';
end $$;
reset role;

-- ── 5 · Anular y reenviar ────────────────────────────────────────────────────
do $$ declare v_lote uuid; v_id uuid; v_err text; begin
  v_lote := public.invitacion_crear((select v from _s where clave = 'otra'),
    jsonb_build_array(jsonb_build_object('account_id', (select v from _s where clave = 'a'), 'rol', 'admin')),
    md5('token-otra-dm1'), (select v::uuid from _s where clave = 'admin_a'), 'Administración de A');
  select id into v_id from public.invitacion where lote = v_lote;
  perform public.invitacion_reenviar(v_id, md5('token-otra-dm1-2'), (select v::uuid from _s where clave = 'admin_a'));
  if (select envios from public.invitacion where id = v_id) <> 2 then raise exception 'PRUEBA DM1 Accesos · 5: reenviar no cuenta el envío.'; end if;
  perform set_config('dm1.inv', v_id::text, true);
end $$;
select pg_temp.como('admin_a');
set local role authenticated;
do $$ begin
  perform public.invitacion_anular(current_setting('dm1.inv')::uuid);
end $$;
reset role;
do $$ declare v_err text; begin
  if (select estado from public.invitacion where id = current_setting('dm1.inv')::uuid) <> 'anulada' then
    raise exception 'PRUEBA DM1 Accesos · 5: anular no la anula.';
  end if;
  begin
    perform public.invitacion_reenviar(current_setting('dm1.inv')::uuid, md5('x'), (select v::uuid from _s where clave = 'admin_a'));
    raise exception 'PRUEBA DM1 Accesos · 5: se reenvía una anulada.';
  exception when raise_exception then get stacked diagnostics v_err = message_text; if v_err like 'PRUEBA%' then raise; end if; end;
  if exists (select 1 from public.invitacion_por_token(md5('token-otra-dm1-2'))) then
    raise exception 'PRUEBA DM1 Accesos · 5: el enlace de una anulada sigue valiendo.';
  end if;
  raise notice 'DM1 Accesos · 5: reenviar renueva; anulada, ni se reenvía ni vale su enlace.';
end $$;

-- ── 6 · Quién tiene acceso, y quitarlo ───────────────────────────────────────
select pg_temp.como('admin_a');
set local role authenticated;
do $$ declare v_err text; begin
  if not exists (select 1 from public.accesos_de_cuenta((select v::uuid from _s where clave = 'a'))
                  where user_id = (select v::uuid from _s where clave = 'invitada') and rol = 'manager' and activo) then
    raise exception 'PRUEBA DM1 Accesos · 6: la invitada no sale en quién tiene acceso.';
  end if;
  begin
    perform public.acceso_quitar((select v::uuid from _s where clave = 'a'), (select v::uuid from _s where clave = 'admin_a'));
    raise exception 'PRUEBA DM1 Accesos · 6: el administrador se ha quitado el acceso a sí mismo.';
  exception when raise_exception then get stacked diagnostics v_err = message_text; if v_err like 'PRUEBA%' then raise; end if; end;
  perform public.acceso_quitar((select v::uuid from _s where clave = 'a'), (select v::uuid from _s where clave = 'invitada'));
end $$;
reset role;
select pg_temp.como('invitada');
set local role authenticated;
do $$ declare v_vista text; begin
  v_vista := pg_temp.ve_de_mas(true);
  if v_vista is not null then raise exception 'PRUEBA DM1 Accesos · 6: después de quitarle el acceso %.', v_vista; end if;
  raise notice 'DM1 Accesos · 6: sale en quién tiene acceso; al quitarlo deja de ver A; nadie se quita a sí mismo.';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 7 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261103T0812_dm1_invitaciones.down.sql
do $$ begin
  if to_regclass('public.invitacion') is not null or to_regprocedure('public.invitacion_aceptar(uuid[])') is not null then
    raise exception 'PRUEBA DM1 Accesos · 7: queda algo de lo nuevo.';
  end if;
  raise notice 'DM1 Accesos · 7: la vuelta atrás quita la tabla y las funciones.';
end $$;

rollback;
