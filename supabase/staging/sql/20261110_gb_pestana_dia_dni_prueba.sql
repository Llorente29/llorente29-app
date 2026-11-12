-- supabase/staging/sql/20261110_gb_pestana_dia_dni_prueba.sql
--
-- SOLO STAGING. Prueba de la 1324 del GB (nº 17, D: el alta y la baja desde la
-- pestaña de Bitrix24 con su día exacto y su DNI o NIE). Nombra el objeto que
-- cambia: public.conta_bitrix_pestana_hacer. Necesita la 1108 (Code 1) y la
-- 2250: si falta alguna, para o la pasa antes. Todo en ROLLBACK, datos
-- inventados que se ven inventados (T11).
--
--   1. Alta con día y DNI: la de Code 1 (conta_gestoria_alta_trabajador): la
--      línea desde el mes del día, con el día y el documento; lo apuntado no
--      guarda el documento, solo que lo había.
--   2. Un documento con la letra mal: no se hace y lo dice.
--   3. Baja con día: la de Code 1 (conta_gestoria_baja_trabajador), con el día.
--   4. Sin día, lo de siempre (G01): alta y baja por meses.
--   5. Quien solo puede ver, nada; y la vuelta atrás deja la función de la 2250.
--
-- sin usuario: lo llama el servidor (service_role) y dentro actúa como la persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GB-1324: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public.conta_gestoria_alta_trabajador(uuid,uuid,uuid,text,date,text)') is null
     or to_regprocedure('public.conta_gestoria_baja_trabajador(uuid,date)') is null then
    raise exception 'PRUEBA GB-1324 · 0: falta la 1108 (Code 1) en esta base.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

select to_regprocedure('public.conta_bitrix_pestana_hacer(text,text,text,text,text,jsonb)') is null as falta_la_2235 \gset
\if :falta_la_2235
\i supabase/migrations/20261109T2235_gb_pestana_alta_baja.sql
\endif
select coalesce((select position('conta_tarifa_precio_guardar' in prosrc) = 0 from pg_proc where oid = to_regprocedure('public.conta_bitrix_pestana_hacer(text,text,text,text,text,jsonb)')), true) as falta_la_2250 \gset
\if :falta_la_2250
\i supabase/migrations/20261109T2250_gb_pestana_tarifa.sql
\endif
select position('conta_gestoria_alta_trabajador' in prosrc) > 0 as ya_esta_la_1324 from pg_proc where oid = to_regprocedure('public.conta_bitrix_pestana_hacer(text,text,text,text,text,jsonb)') \gset
\if :ya_esta_la_1324
\i supabase/vuelta-atras/20261110T1324_gb_pestana_dia_dni.down.sql
\endif

-- La huella de la función de antes, para la vuelta atrás.
create temp table _antes on commit drop as
select md5(prosrc) as cuerpo from pg_proc where oid = to_regprocedure('public.conta_bitrix_pestana_hacer(text,text,text,text,text,jsonb)');

create temp table _u on commit drop as
select p.account_id as cuenta, p.user_id as usuario, lower(u.email) as correo,
       (select c.id from public.company c where c.account_id = p.account_id and c.is_active order by c.created_at limit 1) as empresa,
       null::uuid as cliente, null::uuid as servicio
  from public.user_profiles p join auth.users u on u.id = p.user_id
 where p.active and p.role in ('admin', 'manager') and u.email is not null
   and exists (select 1 from public.company c where c.account_id = p.account_id and c.is_active)
 order by p.created_at limit 1;

do $$
declare a uuid := (select cuenta from _u); e uuid := (select empresa from _u); c1 uuid; s uuid; ver uuid := 'b0000000-0000-4000-8000-000000001324';
begin
  if a is null or e is null then raise exception 'PRUEBA GB-1324 · 0: staging no tiene una persona con empresa.'; end if;
  insert into public.conta_crm (account_id, crm, entorno, portal, mapa) values (a, 'bitrix24', 'pruebas', 'gb-prueba-d.bitrix24.es', '{"campos":[]}')
  on conflict (account_id, crm) do update set portal = excluded.portal;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba GB 1324, S.L.', 'B00001324') returning id into c1;
  insert into public.conta_gestoria_ficha (account_id, crm, tipo_ficha, id_externo, de_empresa, party_id, situacion, ficha)
  values (a, 'bitrix24', 'empresa', '91324', '', c1, 'activo', '{}');
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (a, e, 'gb1324_laboral', 'Laboral de prueba GB 1324', 'por_empleado') returning id into s;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', ver, 'authenticated', 'authenticated', 'solo.ver.1324@gb-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.user_profiles (user_id, account_id, role, active, display_name) values (ver, a, 'worker', true, 'Solo ver GB 1324');
  update _u set cliente = c1, servicio = s;
end $$;

\i supabase/migrations/20261110T1324_gb_pestana_dia_dni.sql

create temp table _r (paso text, r jsonb) on commit drop;
grant all on _r to service_role;
grant select on _u to service_role;
set local role service_role;
do $$
declare u record; p text := 'gb-prueba-d.bitrix24.es'; dia date := (date_trunc('month', current_date) + interval '1 month 14 days')::date;
        mes date := (date_trunc('month', current_date) + interval '1 month')::date; r jsonb;
begin
  select * into u from _u;
  r := public.conta_bitrix_pestana_hacer(p, u.correo, 'empresa', '91324', 'alta',
         jsonb_build_object('empresa', u.empresa, 'servicio', u.servicio, 'nombre', 'Persona Prueba Uno', 'desde', mes, 'dia', dia, 'documento', '1234 5678-z'));
  insert into _r values ('alta', r);
  insert into _r values ('mal', public.conta_bitrix_pestana_hacer(p, u.correo, 'empresa', '91324', 'alta',
         jsonb_build_object('empresa', u.empresa, 'servicio', u.servicio, 'nombre', 'Persona Prueba Dos', 'desde', mes, 'dia', dia, 'documento', '12345678A')));
  insert into _r values ('ver', public.conta_bitrix_pestana_hacer(p, 'solo.ver.1324@gb-prueba.test', 'empresa', '91324', 'alta',
         jsonb_build_object('empresa', u.empresa, 'servicio', u.servicio, 'nombre', 'Persona Prueba Tres', 'desde', mes, 'dia', dia)));
  insert into _r values ('baja', public.conta_bitrix_pestana_hacer(p, u.correo, 'empresa', '91324', 'baja',
         jsonb_build_object('linea', r->>'id', 'nombre', 'PERSONA PRUEBA UNO', 'mes', (mes + interval '1 month')::date, 'dia', (dia + interval '1 month 5 days')::date)));
  insert into _r values ('alta_mes', public.conta_bitrix_pestana_hacer(p, u.correo, 'empresa', '91324', 'alta',
         jsonb_build_object('empresa', u.empresa, 'servicio', u.servicio, 'nombre', 'Persona Prueba Cuatro', 'desde', mes)));
end $$;
reset role;

do $$
declare u record; a jsonb := (select x.r from _r x where x.paso = 'alta'); b jsonb := (select x.r from _r x where x.paso = 'baja');
        m jsonb := (select x.r from _r x where x.paso = 'alta_mes'); l public.conta_linea;
        dia date := (date_trunc('month', current_date) + interval '1 month 14 days')::date; mes date := (date_trunc('month', current_date) + interval '1 month')::date;
begin
  select * into u from _u;
  -- 1 · Alta con día y DNI, con la de Code 1.
  select * into l from public.conta_linea where id = (a->>'id')::uuid;
  if a->>'estado' <> 'ok' or l.id is null or l.desde <> mes or l.alta_el <> dia or l.empleado_documento <> '12345678Z' or l.party_id <> u.cliente then
    raise exception 'PRUEBA GB-1324 · 1: el alta no es la de Code 1 (%, %).', a, row_to_json(l);
  end if;
  if (select datos ? 'documento' or not (datos->>'con_documento')::boolean from public.conta_bitrix_pestana_cambio where id = (a->>'cambio')::uuid) then
    raise exception 'PRUEBA GB-1324 · 1: lo apuntado guarda el documento o no dice que lo había.';
  end if;
  -- 2 · La letra mal.
  if (select x.r->>'estado' from _r x where x.paso = 'mal') <> 'no_se_pudo' or (select x.r->>'frase' from _r x where x.paso = 'mal') not like '%no es válido%' then
    raise exception 'PRUEBA GB-1324 · 2: un documento con la letra mal tenía que fallar (%).', (select x.r from _r x where x.paso = 'mal');
  end if;
  -- 3 · Baja con día.
  select * into l from public.conta_linea where id = (a->>'id')::uuid;
  if b->>'estado' <> 'ok' or l.baja_el <> (dia + interval '1 month 5 days')::date then
    raise exception 'PRUEBA GB-1324 · 3: la baja no es la de Code 1 (%, %).', b, row_to_json(l);
  end if;
  -- 4 · Sin día, lo de siempre.
  select * into l from public.conta_linea where id = (m->>'id')::uuid;
  if m->>'estado' <> 'ok' or l.desde <> mes or l.alta_el is not null or l.empleado_documento is not null then
    raise exception 'PRUEBA GB-1324 · 4: sin día no es lo de siempre (%, %).', m, row_to_json(l);
  end if;
  -- 5 · Solo ver.
  if (select x.r->>'estado' from _r x where x.paso = 'ver') <> 'sin_permiso' then
    raise exception 'PRUEBA GB-1324 · 5: solo ver tenía que dar sin_permiso.';
  end if;
  raise notice 'GB-1324 · 1 a 5: alta con día y DNI y baja con día con las de Code 1, la letra mal no, sin día lo de siempre y solo ver no. OK';
end $$;

\i supabase/vuelta-atras/20261110T1324_gb_pestana_dia_dni.down.sql
do $$ begin
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.conta_bitrix_pestana_hacer(text,text,text,text,text,jsonb)')) <> (select cuerpo from _antes) then
    raise exception 'PRUEBA GB-1324 · 5: la vuelta atrás no deja la función de antes.';
  end if;
  raise notice 'GB-1324 · 5: la vuelta atrás deja la función de antes, byte a byte. OK';
end $$;

rollback;
