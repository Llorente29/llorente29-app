-- supabase/staging/sql/20261109_gp_portal_cuenta_prueba.sql
--
-- SOLO STAGING. Prueba de la 1720 (GP, «Tu cuenta» con los nombres de Code 1,
-- y los permisos del portal a service_role). Todo en una transacción con
-- ROLLBACK, con datos inventados (T11): no cambia staging.
--
--   1. public.conta_portal_cuenta: la persona del portal ve los últimos dígitos
--      de su cuenta de cargo, su país y su banco (conta_gc_mandato.cuenta_final,
--      cuenta_pais y banco, de Code 1).
--   2. LA REGLA DE LOS PERMISOS (Julio, nº 5): Supabase da EXECUTE por defecto a
--      anon y authenticated en cada función nueva de public. Se comprueba con
--      todas las funciones del portal que haya, no con una lista de las que se
--      acuerda quien escribe:
--        · anon no puede llamar a ninguna;
--        · authenticated solo a las de PUEDE_CON_SESION (las que comprueban
--          quién llama); una función nueva que no esté ahí y se pueda llamar con
--          sesión pone la prueba en rojo, con su nombre;
--        · service_role, a las de dentro y las del servidor (SOLO_SERVIDOR), que
--          la 1720 le da de forma explícita: no se dejan al permiso por defecto.
--   3. La vuelta atrás: conta_portal_cuenta, como la dejó la 1530.
--
-- sin usuario: sembrar los datos inventados lo hace el servidor; la lectura se prueba como la persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GP-1720: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- La 1530 tiene que estar (la 1720 la cambia). Si la 1720 ya está, primero su vuelta atrás.
select to_regprocedure('public.conta_portal_inicio(uuid)') is null as falta_la_1530 \gset
\if :falta_la_1530
\i supabase/migrations/20261109T1530_gp_portal_base.sql
\endif
select position('cuenta_final' in pg_get_functiondef('public.conta_portal_cuenta(uuid)'::regprocedure)) > 0 as ya_esta_la_1720 \gset
\if :ya_esta_la_1720
\i supabase/vuelta-atras/20261109T1720_gp_portal_cuenta.down.sql
\endif
\i supabase/migrations/20261109T1720_gp_portal_cuenta.sql

-- ── 1 · «Tu cuenta», con la cuenta de cargo ────────────────────────────────────
create temp table _g on commit drop as
select p.account_id as cuenta, (select c.id from public.company c where c.account_id = p.account_id order by c.created_at limit 1) as empresa,
       '0000a1a1-0000-4000-8000-000000001720'::uuid as pa, null::uuid as ca
  from public.user_profiles p where p.active and p.role = 'admin' order by p.created_at limit 1;
do $$
declare g _g; xa uuid;
begin
  select * into g from _g;
  if g.cuenta is null or g.empresa is null then raise exception 'PRUEBA GP-1720 · 0: staging no tiene un administrador con empresa.'; end if;
  insert into auth.users (id, email) values (g.pa, 'portal.cuenta@ejemplo.invalid');
  insert into public.party (account_id, name, tax_id) values (g.cuenta, 'Cliente Portal Cuenta Prueba, S.L.', 'B00001720') returning id into xa;
  insert into public.conta_cobro_cliente (account_id, company_id, party_id, forma_cobro, gc_cliente_id) values (g.cuenta, g.empresa, xa, 'gocardless', 'CU1720A');
  insert into public.conta_gc_mandato (account_id, company_id, gc_id, gc_cliente_id, estado, creado, cuenta_final, cuenta_pais, banco)
  values (g.cuenta, g.empresa, 'MD1720A', 'CU1720A', 'active', now(), '00', 'ES', 'Banco Ejemplo');
  insert into public.conta_portal_acceso (account_id, party_id, correo, user_id, permiso) values (g.cuenta, xa, 'portal.cuenta@ejemplo.invalid', g.pa, 'todo');
  update _g set ca = xa;
end $$;
grant select on _g to authenticated;
select pa as pa from _g \gset
select set_config('request.jwt.claims', json_build_object('sub', :'pa', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare j jsonb := public.conta_portal_cuenta((select ca from _g)) -> 'domiciliacion';
begin
  if j ->> 'cuenta_final' is distinct from '00' or j ->> 'cuenta_pais' is distinct from 'ES' or j ->> 'banco' is distinct from 'Banco Ejemplo' then
    raise exception 'PRUEBA GP-1720 · 1: «Tu cuenta» no trae la cuenta de cargo de Code 1: %', j;
  end if;
  raise notice 'GP-1720 · 1: public.conta_portal_cuenta trae los últimos dígitos, el país y el banco. OK';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 2 · LA REGLA DE LOS PERMISOS ───────────────────────────────────────────────
do $$
declare
  -- Las que se pueden llamar con sesión: cada una comprueba quién llama (el
  -- acceso al portal, o que sea de la gestoría). Añadir una aquí es decidirlo.
  puede_con_sesion constant text[] := array[
    'conta_portal_ve', 'conta_portal_ruta_puede', 'conta_portal_entrada', 'conta_portal_inicio', 'conta_portal_facturas', 'conta_portal_pagos',
    'conta_portal_documentos', 'conta_portal_trabajadores', 'conta_portal_mensajes', 'conta_portal_cuenta', 'conta_portal_archivo',
    'conta_portal_mensaje_enviar', 'conta_portal_mensajes_leidos', 'conta_portal_solicitud_pedir', 'conta_portal_incidencia_crear',
    'conta_portal_peticion_contestar', 'conta_portal_invitar', 'conta_portal_acceso_quitar', 'conta_portal_firma_comprobar',
    'conta_portal_ficha', 'conta_portal_pendiente', 'conta_portal_peticion_crear', 'conta_portal_peticion_anular',
    'conta_portal_incidencia_resolver', 'conta_portal_ajustes_guardar',
    -- GP · T4 (la 2030), si ya está:
    'conta_portal_solicitud_hacer', 'conta_portal_solicitud_rechazar'];
  -- Las que llama el servidor con la clave de servicio (y las de dentro).
  solo_servidor constant text[] := array[
    '_conta_portal_yo', '_conta_portal_empresa', '_conta_portal_marca', '_conta_portal_estado_recibo', '_conta_portal_devuelto_pagado',
    '_conta_portal_devueltos', '_conta_portal_proximo', '_conta_portal_cuenta_propia', 'conta_portal_acceso_usuario', 'conta_portal_firma_pedir',
    'conta_portal_firma_pdf', 'conta_portal_incidencia_parada', 'conta_portal_archivo',
    -- GP · T4 (la 2030), si ya está (conta_portal_despertar solo la llama el cron: ni sesión ni servicio):
    'conta_portal_avisos_pendientes', 'conta_portal_avisos_hechos',
    -- GP · nº 17 (la 2345), si ya está: la pestaña de Bitrix24, solo el servidor.
    '_conta_portal_bitrix_quien', 'conta_portal_bitrix_invitar', 'conta_portal_bitrix_contestar'];
  f record; malos text[] := '{}'; n int := 0;
begin
  for f in select p.oid, p.proname, p.oid::regprocedure::text as firma from pg_catalog.pg_proc p join pg_catalog.pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public' and (p.proname like 'conta\_portal\_%' or p.proname like '\_conta\_portal\_%') loop
    n := n + 1;
    if has_function_privilege('anon', f.oid, 'execute') then malos := malos || ('anon puede llamar a ' || f.firma); end if;
    if has_function_privilege('authenticated', f.oid, 'execute') <> (f.proname = any (puede_con_sesion)) then
      malos := malos || (case when f.proname = any (puede_con_sesion) then 'authenticated NO puede llamar a ' else 'authenticated puede llamar a ' end || f.firma);
    end if;
    if f.proname = any (solo_servidor) and not has_function_privilege('service_role', f.oid, 'execute') then malos := malos || ('service_role no puede llamar a ' || f.firma); end if;
    if not (f.proname = any (puede_con_sesion) or f.proname = any (solo_servidor) or f.proname = 'conta_portal_despertar') then malos := malos || ('función del portal sin decidir quién la llama: ' || f.firma); end if;
  end loop;
  if n < 37 then raise exception 'PRUEBA GP-1720 · 2: solo hay % funciones del portal; deberían ser 37 o más.', n; end if;
  if cardinality(malos) > 0 then raise exception 'PRUEBA GP-1720 · 2: permisos que no son los decididos: %', array_to_string(malos, '; '); end if;
  raise notice 'GP-1720 · 2: las % funciones del portal, cada una con los permisos decididos (anon ninguna, authenticated solo las %, service_role las del servidor). OK', n, cardinality(puede_con_sesion);
end $$;

-- ── 3 · La vuelta atrás ────────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261109T1720_gp_portal_cuenta.down.sql
do $$ begin
  if position('cuenta_final' in pg_get_functiondef('public.conta_portal_cuenta(uuid)'::regprocedure)) > 0 then
    raise exception 'PRUEBA GP-1720 · 3: la vuelta atrás no deja public.conta_portal_cuenta como la 1530.';
  end if;
  raise notice 'GP-1720 · 3: la vuelta atrás deja public.conta_portal_cuenta como la 1530. OK';
end $$;

rollback;
