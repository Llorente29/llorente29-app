-- supabase/staging/sql/20261109_gb_pestana_alta_baja_prueba.sql
--
-- SOLO STAGING. Prueba de la 2235 del GB (alta y baja de un trabajador desde la
-- pestaña de Bitrix24). Todo en una transacción con ROLLBACK, con datos
-- inventados (T11): no cambia staging.
--
--   1. Quien puede cambiar (administrador o encargado): el alta crea la línea
--      con las funciones del G04 (la misma frase que la ficha) y queda apuntada
--      en conta_bitrix_pestana_cambio; la baja, también.
--   2. Lo que necesita la función para Bitrix24: el campo de la cuota del mapa,
--      lo que Sumied leyó y, después de apuntar lo escrito, lo último escrito.
--   3. Quien solo puede ver (trabajador): «sin_permiso» y nada cambia.
--   4. Desde la pestaña de un cliente no se da de baja a nadie de otro.
--   5. Sin acceso, de otro portal o sin enlazar: nada cambia.
--   6. Solo el servidor; y la vuelta atrás.
--
-- sin usuario: lo llama el servidor (service_role) y dentro actúa como la persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GB-2235: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

select to_regprocedure('public.conta_bitrix_pestana_hacer(text,text,text,text,text,jsonb)') is not null as ya_esta_la_2235 \gset
\if :ya_esta_la_2235
\i supabase/vuelta-atras/20261109T2235_gb_pestana_alta_baja.down.sql
\endif

create temp table _u on commit drop as
select p.account_id as cuenta, p.user_id as usuario, lower(u.email) as correo,
       (select c.id from public.company c where c.account_id = p.account_id and c.is_active order by c.created_at limit 1) as empresa,
       null::uuid as cliente, null::uuid as otro, null::uuid as servicio, null::uuid as linea_otro
  from public.user_profiles p join auth.users u on u.id = p.user_id
 where p.active and p.role in ('admin', 'manager') and u.email is not null
   and exists (select 1 from public.company c where c.account_id = p.account_id and c.is_active)
 order by p.created_at limit 1;

do $$
declare a uuid := (select cuenta from _u); e uuid := (select empresa from _u); c1 uuid; c2 uuid; s uuid; l2 uuid;
        ver uuid := 'b0000000-0000-4000-8000-000000002235';
begin
  if a is null or e is null then raise exception 'PRUEBA GB-2235 · 0: staging no tiene una persona con empresa.'; end if;
  insert into public.conta_crm (account_id, crm, entorno, portal, mapa) values (a, 'bitrix24', 'pruebas', 'gb-prueba-a.bitrix24.es',
    '{"campos":[{"codigo":"UF_CRM_CUOTA_PRUEBA","campo":"cuota_referencia","etiqueta":"Cuota mensual"}]}')
  on conflict (account_id, crm) do update set portal = excluded.portal, mapa = excluded.mapa;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba GB 2235, S.L.', 'B00002235') returning id into c1;
  insert into public.party (account_id, name, tax_id) values (a, 'Otro Cliente Prueba GB 2235, S.L.', 'B00002236') returning id into c2;
  insert into public.conta_gestoria_cliente (account_id, party_id, situacion, ficha, crm, tipo_ficha, id_externo)
  values (a, c1, 'activo', '{}', 'bitrix24', 'empresa', '92235');
  insert into public.conta_gestoria_ficha (account_id, crm, tipo_ficha, id_externo, de_empresa, party_id, situacion, ficha)
  values (a, 'bitrix24', 'empresa', '92235', '', c1, 'activo', '{"cuotasReferencia":[{"etiqueta":"Cuota mensual","importeCent":22500,"texto":"225,00"}]}');
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (a, e, 'laboral gb 2235', 'Laboral de prueba GB', 'por_empleado') returning id into s;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, empleado_nombre, origen, periodo, desde)
  values (a, e, c2, s, 'TRABAJADOR DE OTRO CLIENTE', 'manual', 'mes', date_trunc('month', current_date)::date) returning id into l2;
  -- Una persona de la cuenta que solo puede ver.
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', ver, 'authenticated', 'authenticated', 'solo.ver@gb-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.user_profiles (user_id, account_id, role, active, display_name) values (ver, a, 'worker', true, 'Solo ver GB');
  update _u set cliente = c1, otro = c2, servicio = s, linea_otro = l2;
end $$;

\i supabase/migrations/20261109T2235_gb_pestana_alta_baja.sql

grant select on _u to service_role;
set local role service_role;

create temp table _r (paso text, r jsonb) on commit drop;
grant all on _r to service_role;

-- 1 y 2 · Alta y baja, como quien puede (las comprobaciones de las tablas, después, fuera del papel del servidor).
do $$
declare u record; r jsonb; mes_alta date := (date_trunc('month', current_date) + interval '1 month')::date;
begin
  select * into u from _u;
  r := public.conta_bitrix_pestana_hacer('gb-prueba-a.bitrix24.es', u.correo, 'empresa', '92235', 'alta',
         jsonb_build_object('empresa', u.empresa, 'servicio', u.servicio, 'nombre', 'Ana Prueba Uno', 'desde', mes_alta));
  insert into _r values ('alta', r);
  if r->>'estado' <> 'ok' then raise exception 'PRUEBA GB-2235 · 1: el alta no se ha hecho (%).', r; end if;
  if r->>'frase' not like 'Alta de ANA PRUEBA UNO en laboral de prueba gb de Cliente Prueba GB 2235, S.L.%' then raise exception 'PRUEBA GB-2235 · 1: la frase no es la de la ficha (%).', r->>'frase'; end if;
  if r->'bitrix' <> jsonb_build_object('campo', 'UF_CRM_CUOTA_PRUEBA', 'conocida', '225,00', 'escrita', null) then
    raise exception 'PRUEBA GB-2235 · 2: lo de Bitrix24 no es lo esperado (%).', r->'bitrix';
  end if;
  perform public.conta_bitrix_pestana_bitrix((r->>'cambio')::uuid, '{"campo":"UF_CRM_CUOTA_PRUEBA","escrito":"250,00"}');
  r := public.conta_bitrix_pestana_hacer('gb-prueba-a.bitrix24.es', u.correo, 'empresa', '92235', 'baja',
         jsonb_build_object('linea', (select (x.r->>'id') from _r x where x.paso = 'alta'), 'mes', mes_alta));
  insert into _r values ('baja', r);
  if r->>'estado' <> 'ok' then raise exception 'PRUEBA GB-2235 · 1: la baja no se ha hecho (%).', r; end if;
  if r->'bitrix'->>'escrita' <> '250,00' then raise exception 'PRUEBA GB-2235 · 2: no recuerda lo último escrito (%).', r->'bitrix'; end if;
end $$;

reset role;
do $$
declare u record; l uuid := (select (r->>'id')::uuid from _r where paso = 'alta'); mes_alta date := (date_trunc('month', current_date) + interval '1 month')::date;
begin
  select * into u from _u;
  if not exists (select 1 from public.conta_linea where id = l and party_id = u.cliente and servicio_id = u.servicio and empleado_nombre = 'ANA PRUEBA UNO' and desde = mes_alta and hasta = mes_alta) then
    raise exception 'PRUEBA GB-2235 · 1: la línea no tiene el alta y la baja.';
  end if;
  if (select count(*) from public.conta_bitrix_pestana_cambio where party_id = u.cliente and hecho_por = u.usuario) <> 2 then
    raise exception 'PRUEBA GB-2235 · 1: faltan cambios apuntados.';
  end if;
  raise notice 'GB-2235 · 1 y 2: alta y baja con las funciones de la ficha, apuntadas, con lo que necesita Bitrix24. OK';
end $$;
create temp table _antes on commit drop as select (select count(*) from public.conta_linea where account_id = (select cuenta from _u)) as lineas;
grant select on _antes to service_role;
set local role service_role;

-- 3 a 5 · Nadie cambia lo que no debe.
do $$
declare u record; r jsonb; c record;
begin
  select * into u from _u;
  for c in select * from (values
      ('solo ver',      'gb-prueba-a.bitrix24.es', 'solo.ver@gb-prueba.test', '92235', 'alta', 'sin_permiso'),
      ('baja de otro',  'gb-prueba-a.bitrix24.es', u.correo,                  '92235', 'baja', 'no_se_pudo'),
      ('nadie',         'gb-prueba-a.bitrix24.es', 'nadie@gb-prueba.test',    '92235', 'alta', 'sin_acceso'),
      ('otro portal',   'otro-portal.bitrix24.es', u.correo,                  '92235', 'alta', 'sin_acceso'),
      ('sin enlazar',   'gb-prueba-a.bitrix24.es', u.correo,                  '99999', 'alta', 'sin_enlazar'),
      ('acción rara',   'gb-prueba-a.bitrix24.es', u.correo,                  '92235', 'borrar', 'no_se_pudo')
    ) x(caso, portal, correo, id, accion, espera) loop
    r := public.conta_bitrix_pestana_hacer(c.portal, c.correo, 'empresa', c.id, c.accion,
           case when c.accion = 'baja' then jsonb_build_object('linea', u.linea_otro, 'mes', current_date)
                else jsonb_build_object('empresa', u.empresa, 'servicio', u.servicio, 'nombre', 'Intruso Prueba', 'desde', current_date) end);
    if r->>'estado' is distinct from c.espera then raise exception 'PRUEBA GB-2235 · 3-5 (%): esperaba «%» y sale «%» (%).', c.caso, c.espera, r->>'estado', r; end if;
  end loop;
end $$;

reset role;
do $$
declare u record;
begin
  select * into u from _u;
  if (select count(*) from public.conta_linea where account_id = u.cuenta) <> (select lineas from _antes)
     or exists (select 1 from public.conta_linea where id = u.linea_otro and hasta is not null)
     or exists (select 1 from public.conta_linea where empleado_nombre = 'INTRUSO PRUEBA') then
    raise exception 'PRUEBA GB-2235 · 3-5: algo ha cambiado sin deber.';
  end if;
  if (select count(*) from public.conta_bitrix_pestana_cambio where party_id in (u.cliente, u.otro)) <> 2 then
    raise exception 'PRUEBA GB-2235 · 3-5: se ha apuntado un cambio que no se hizo.';
  end if;
  raise notice 'GB-2235 · 3 a 5: solo ver, otro cliente, sin acceso, otro portal, sin enlazar y acción rara: nada cambia (6 casos). OK';
end $$;


-- 6 · Solo el servidor; y la vuelta atrás.
do $$
declare rol text;
begin
  foreach rol in array array['authenticated', 'anon'] loop
    if has_function_privilege(rol, 'public.conta_bitrix_pestana_hacer(text,text,text,text,text,jsonb)', 'execute')
       or has_function_privilege(rol, 'public.conta_bitrix_pestana_bitrix(uuid,jsonb)', 'execute') then
      raise exception 'PRUEBA GB-2235 · 6: % puede llamar a las funciones de la pestaña.', rol;
    end if;
  end loop;
  raise notice 'GB-2235 · 6: solo el servidor. OK';
end $$;
\i supabase/vuelta-atras/20261109T2235_gb_pestana_alta_baja.down.sql
do $$ begin
  if to_regprocedure('public.conta_bitrix_pestana_hacer(text,text,text,text,text,jsonb)') is not null or to_regclass('public.conta_bitrix_pestana_cambio') is not null then
    raise exception 'PRUEBA GB-2235 · 6: la vuelta atrás no lo quita todo.';
  end if;
  raise notice 'GB-2235 · 6: la vuelta atrás lo quita. OK';
end $$;

rollback;
