-- supabase/staging/sql/20261109_gb_pestana_tarifa_prueba.sql
--
-- SOLO STAGING. Prueba de la 2250 del GB (nº 9, punto 2: cambiar el nivel o
-- poner un precio especial desde la pestaña de Bitrix24). Va después de la 2235
-- (#549): si no está, la pasa antes. Todo en ROLLBACK, datos inventados (T11).
--
--   1. Cambiar de nivel: lo hace conta_tarifa_nivel_cambiar (la línea de antes
--      acaba el mes anterior y sigue con el nivel nuevo) y queda apuntado.
--   2. Precio especial con su motivo: lo guarda conta_tarifa_precio_guardar
--      para este cliente; el motivo queda en lo apuntado. Sin motivo, no.
--   3. Nivel y precio a la vez, en un solo cambio.
--   4. Quien solo puede ver: nada; una línea de otro cliente: nada.
--   5. Las acciones de la 2235 siguen (una baja); la vuelta atrás deja la 2235.
--
-- sin usuario: lo llama el servidor (service_role) y dentro actúa como la persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GB-2250: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

select to_regprocedure('public.conta_bitrix_pestana_hacer(text,text,text,text,text,jsonb)') is null as falta_la_2235 \gset
\if :falta_la_2235
\i supabase/migrations/20261109T2235_gb_pestana_alta_baja.sql
\endif

create temp table _u on commit drop as
select p.account_id as cuenta, p.user_id as usuario, lower(u.email) as correo,
       (select c.id from public.company c where c.account_id = p.account_id and c.is_active order by c.created_at limit 1) as empresa,
       null::uuid as cliente, null::uuid as servicio, null::uuid as basica, null::uuid as premium, null::uuid as linea, null::uuid as linea_otro, null::uuid as trabajador
  from public.user_profiles p join auth.users u on u.id = p.user_id
 where p.active and p.role in ('admin', 'manager') and u.email is not null
   and exists (select 1 from public.company c where c.account_id = p.account_id and c.is_active)
 order by p.created_at limit 1;

do $$
declare a uuid := (select cuenta from _u); e uuid := (select empresa from _u); c1 uuid; c2 uuid; s uuid; nb uuid; np uuid; l uuid; l2 uuid; lt uuid; lab uuid;
        ver uuid := 'b0000000-0000-4000-8000-000000002250'; antes date := (date_trunc('month', current_date) - interval '2 month')::date;
begin
  if a is null or e is null then raise exception 'PRUEBA GB-2250 · 0: staging no tiene una persona con empresa.'; end if;
  insert into public.conta_crm (account_id, crm, entorno, portal) values (a, 'bitrix24', 'pruebas', 'gb-prueba-a.bitrix24.es')
  on conflict (account_id, crm) do update set portal = excluded.portal;
  insert into public.conta_gestoria_ajustes (company_id, account_id, mitad_de_mes, cambios_de_tarifa) values (e, a, 'mes_entero', true)
  on conflict (company_id) do update set cambios_de_tarifa = true;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba GB 2250, S.L.', 'B00002250') returning id into c1;
  insert into public.party (account_id, name, tax_id) values (a, 'Otro Cliente Prueba GB 2250, S.L.', 'B00002251') returning id into c2;
  insert into public.conta_gestoria_ficha (account_id, crm, tipo_ficha, id_externo, de_empresa, party_id, situacion, ficha)
  values (a, 'bitrix24', 'empresa', '92250', '', c1, 'activo', '{}');
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (a, e, 'gestoria gb 2250', 'Gestoría de prueba GB', 'fijo_mes') returning id into s;
  insert into public.conta_servicio_nivel (account_id, company_id, servicio_id, nombre, orden) values (a, e, s, 'Básica', 1) returning id into nb;
  insert into public.conta_servicio_nivel (account_id, company_id, servicio_id, nombre, orden) values (a, e, s, 'Premium', 2) returning id into np;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, nivel_id, origen, periodo, desde)
  values (a, e, c1, s, np, 'manual', 'mes', antes) returning id into l;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, nivel_id, origen, periodo, desde)
  values (a, e, c2, s, np, 'manual', 'mes', antes) returning id into l2;
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (a, e, 'laboral gb 2250', 'Laboral de prueba GB 2250', 'por_empleado') returning id into lab;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, empleado_nombre, origen, periodo, desde)
  values (a, e, c1, lab, 'TRABAJADOR PRUEBA 2250', 'manual', 'mes', antes) returning id into lt;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', ver, 'authenticated', 'authenticated', 'solo.ver.2250@gb-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.user_profiles (user_id, account_id, role, active, display_name) values (ver, a, 'worker', true, 'Solo ver GB 2250');
  update _u set cliente = c1, servicio = s, basica = nb, premium = np, linea = l, linea_otro = l2, trabajador = lt;
end $$;

-- La huella de lo que se cobra, para comprobar que lo que no debe no cambia nada.
create temp table _h on commit drop as
select (select md5(string_agg(to_jsonb(x)::text, '' order by x.id)) from public.conta_linea x where x.account_id = (select cuenta from _u)) as lineas,
       (select md5(string_agg(to_jsonb(x)::text, '' order by x.id)) from public.conta_precio x where x.account_id = (select cuenta from _u)) as precios;

\i supabase/migrations/20261109T2250_gb_pestana_tarifa.sql

create temp table _r (paso text, r jsonb) on commit drop;
grant all on _r to service_role;
grant select on _u to service_role;
set local role service_role;

-- 4 · Quien solo puede ver, y una línea de otro cliente: nada.
do $$
declare u record; r jsonb; mes date := (date_trunc('month', current_date) + interval '1 month')::date;
begin
  select * into u from _u;
  r := public.conta_bitrix_pestana_hacer('gb-prueba-a.bitrix24.es', 'solo.ver.2250@gb-prueba.test', 'empresa', '92250', 'tarifa',
         jsonb_build_object('linea', u.linea, 'nivel', u.basica, 'desde', mes));
  if r->>'estado' <> 'sin_permiso' then raise exception 'PRUEBA GB-2250 · 4: solo ver tenía que dar sin_permiso (%).', r; end if;
  r := public.conta_bitrix_pestana_hacer('gb-prueba-a.bitrix24.es', u.correo, 'empresa', '92250', 'tarifa',
         jsonb_build_object('linea', u.linea_otro, 'nivel', u.basica, 'desde', mes));
  if r->>'estado' <> 'no_se_pudo' then raise exception 'PRUEBA GB-2250 · 4: la línea de otro cliente tenía que fallar (%).', r; end if;
  r := public.conta_bitrix_pestana_hacer('gb-prueba-a.bitrix24.es', u.correo, 'empresa', '92250', 'tarifa',
         jsonb_build_object('linea', u.linea, 'precio', 135, 'motivo', '  ', 'desde', mes));
  if r->>'estado' <> 'no_se_pudo' or r->>'frase' not like 'Di por qué%' then raise exception 'PRUEBA GB-2250 · 2: sin motivo tenía que fallar (%).', r; end if;
end $$;
reset role;
do $$ begin
  if (select (lineas, precios) from _h) is distinct from
     ((select md5(string_agg(to_jsonb(x)::text, '' order by x.id)) from public.conta_linea x where x.account_id = (select cuenta from _u)),
      (select md5(string_agg(to_jsonb(x)::text, '' order by x.id)) from public.conta_precio x where x.account_id = (select cuenta from _u))) then
    raise exception 'PRUEBA GB-2250 · 4: algo ha cambiado sin deber.';
  end if;
  raise notice 'GB-2250 · 4: solo ver, otro cliente y un precio sin motivo: nada cambia. OK';
end $$;
set local role service_role;

-- 1 a 3 y 5 · Como quien puede.
do $$
declare u record; r jsonb; mes date := (date_trunc('month', current_date) + interval '1 month')::date;
begin
  select * into u from _u;
  r := public.conta_bitrix_pestana_hacer('gb-prueba-a.bitrix24.es', u.correo, 'empresa', '92250', 'tarifa',
         jsonb_build_object('linea', u.linea, 'nivel', u.basica, 'precio', 135, 'motivo', 'Cliente desde 2015', 'desde', mes));
  insert into _r values ('tarifa', r);
  if r->>'estado' <> 'ok' then raise exception 'PRUEBA GB-2250 · 3: el cambio no se ha hecho (%).', r; end if;
  if r->>'frase' not like 'Cliente Prueba GB 2250, S.L. pasa de % a %Básica%' or r->>'frase' not like '%135,00 € al mes%' then
    raise exception 'PRUEBA GB-2250 · 3: la frase no es la de la ficha (%).', r->>'frase';
  end if;
  r := public.conta_bitrix_pestana_hacer('gb-prueba-a.bitrix24.es', u.correo, 'empresa', '92250', 'tarifa',
         jsonb_build_object('linea', u.trabajador, 'precio', 22, 'motivo', 'Muchos trabajadores', 'desde', mes));
  if r->>'estado' <> 'ok' or r->>'frase' not like '%22,00 € por trabajador%' then raise exception 'PRUEBA GB-2250 · 2: el precio por trabajador no es por trabajador (%).', r; end if;
  r := public.conta_bitrix_pestana_hacer('gb-prueba-a.bitrix24.es', u.correo, 'empresa', '92250', 'baja',
         jsonb_build_object('linea', u.trabajador, 'mes', current_date));
  if r->>'estado' <> 'ok' then raise exception 'PRUEBA GB-2250 · 5: la baja de la 2235 ya no va (%).', r; end if;
end $$;
reset role;
do $$
declare u record; mes date := (date_trunc('month', current_date) + interval '1 month')::date;
begin
  select * into u from _u;
  if not exists (select 1 from public.conta_linea where id = u.linea and hasta = (mes - interval '1 month')::date) then
    raise exception 'PRUEBA GB-2250 · 1: la línea de antes no acaba el mes anterior.';
  end if;
  if not exists (select 1 from public.conta_linea where party_id = u.cliente and servicio_id = u.servicio and nivel_id = u.basica and desde = mes and hasta is null) then
    raise exception 'PRUEBA GB-2250 · 1: no sigue con el nivel nuevo.';
  end if;
  if not exists (select 1 from public.conta_precio where party_id = u.cliente and servicio_id = u.servicio and nivel_id = u.basica and forma = 'fijo' and importe = 135 and desde = mes) then
    raise exception 'PRUEBA GB-2250 · 2: no está el precio especial.';
  end if;
  if not exists (select 1 from public.conta_bitrix_pestana_cambio where party_id = u.cliente and accion = 'tarifa' and datos->>'motivo' = 'Cliente desde 2015') then
    raise exception 'PRUEBA GB-2250 · 2: el motivo no ha quedado apuntado.';
  end if;
  raise notice 'GB-2250 · 1 a 3 y 5: nivel y precio especial con las funciones de la ficha, el motivo apuntado, y la baja de la 2235 sigue. OK';
end $$;

-- 5 · La vuelta atrás deja la 2235.
\i supabase/vuelta-atras/20261109T2250_gb_pestana_tarifa.down.sql
do $$ begin
  if to_regprocedure('public.conta_bitrix_pestana_hacer(text,text,text,text,text,jsonb)') is null
     or pg_get_functiondef('public.conta_bitrix_pestana_hacer(text,text,text,text,text,jsonb)'::regprocedure) like '%tarifa%'
     or exists (select 1 from public.conta_bitrix_pestana_cambio where accion = 'tarifa') then
    raise exception 'PRUEBA GB-2250 · 5: la vuelta atrás no deja la 2235.';
  end if;
  raise notice 'GB-2250 · 5: la vuelta atrás deja la función y el CHECK de la 2235. OK';
end $$;

rollback;
