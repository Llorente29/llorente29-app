-- supabase/staging/sql/20261125_r19b_sumied_igual_gocardless_prueba.sql
--
-- SOLO STAGING. Prueba del R19 · paso 1 (20261125T1329_r19b_sumied_igual_gocardless), que el ensayo de staging pone
-- delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
--
-- Una cuenta inventada con una empresa, dos fichas y lo leído de su GoCardless (inventado, T11): un cliente ATADO a la
-- ficha 1, otro PROPUESTO por correo (sin confirmar) y otro sin nada; sus suscripciones, una que cobra el mes que viene y
-- otra el siguiente. Por sus CAMINOS:
--   1. Lo que crea y los permisos: lo igualado, solo leerlo; y los tres tipos nuevos de «Pendiente de revisar» entran.
--   2. conta_gestoria_diferencia: los tipos de antes siguen valiendo (el CHECK solo amplía); uno inventado, no.
--   3. «Cobros de GoCardless sin cliente» (conta_lista_que_hacer): cuenta lo SIN ATAR que cobra el mes que viene, con
--      su próximo importe: lo propuesto por correo, también; lo atado, no; lo que cobra el mes siguiente, no.
--   4. conta_pantalla_asignar: trae el próximo cobro, si cobra en el mes, el enlace de cada cliente y sus mandatos.
--   5. Como usuario (la administradora; los pasos 3 y 4 también van como ella): ve lo de su cuenta; lo de otra, no.
--   6. La vuelta atrás (el fichero de verdad): devuelve la línea igualada a como estaba y lo quita todo.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R19b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

do $$
declare
  u constant uuid := 'ae19b000-0000-4000-8000-000000000001';
  x constant uuid := 'ae19b000-0000-4000-8000-000000000010';
  e constant uuid := 'ae19b000-0000-4000-8000-000000000020';
  p1 constant uuid := 'ae19b000-0000-4000-8000-000000000031';
  p2 constant uuid := 'ae19b000-0000-4000-8000-000000000032';
  sv constant uuid := 'ae19b000-0000-4000-8000-000000000041';
  d1 date := (date_trunc('month', current_date) + interval '1 month' + interval '3 day')::date;
  d2 date := (date_trunc('month', current_date) + interval '2 month' + interval '3 day')::date;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'admin@r19b-prueba.test',
         extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values (x, 'Prueba R19b', 'r19b-prueba', 'active', 'otra_actividad', 'contabilidad');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at) values (u, x, 'admin', true, 'Prueba R19b', now(), now());
  insert into public.company (id, account_id, legal_name) values (e, x, 'Empresa de prueba R19b, S.L.');
  insert into public.party (id, account_id, name) values (p1, x, 'Ficha uno de prueba'), (p2, x, 'Ficha dos de prueba');
  insert into public.conta_gc_cliente (company_id, gc_id, account_id, nombre, correo) values
    (e, 'CUR19B1', x, 'Atado de prueba', null), (e, 'CUR19B2', x, 'Propuesto de prueba', 'repetido@example.com'), (e, 'CUR19B3', x, 'Sin nada de prueba', null);
  insert into public.conta_gc_mandato (company_id, gc_id, account_id, gc_cliente_id, estado, banco, cuenta_final) values (e, 'MDR19B2', x, 'CUR19B2', 'active', 'Banco de prueba', '00');
  insert into public.conta_gc_suscripcion (company_id, gc_id, account_id, gc_cliente_id, nombre, importe, al_mes, estado, proximo_cobro_fecha, proximo_cobro_importe) values
    (e, 'SBR19B1', x, 'CUR19B1', 'GESTORIA MENSUAL', 60.50, 60.50, 'active', d1, 60.50),
    (e, 'SBR19B2', x, 'CUR19B2', 'GESTORIA MENSUAL', 72.60, 72.60, 'active', d1, 72.60),
    (e, 'SBR19B3', x, 'CUR19B3', 'GESTION LABORAL', 24.20, 24.20, 'active', d1, 24.20),
    (e, 'SBR19B4', x, 'CUR19B3', 'ANUAL', 120.00, 10.00, 'active', d2, 120.00);
  insert into public.conta_gc_enlace (company_id, gc_cliente_id, account_id, party_id, por, estado, candidatas, porque) values
    (e, 'CUR19B1', x, p1, 'persona', 'atado', '{}', 'Lo ató una persona de prueba.'),
    (e, 'CUR19B2', x, null, 'correo', 'propuesto', array[p1, p2], 'Su correo está en 2 fichas.');
  insert into public.conta_servicio (id, account_id, company_id, clave, nombre, forma) values (sv, x, e, 'gestoria_mensual', 'Gestoría mensual', 'fijo_mes');
  insert into public.conta_linea (id, account_id, company_id, party_id, servicio_id, origen, periodo, desde, suscripcion_gc_id, importe_propio)
  values ('ae19b000-0000-4000-8000-000000000051', x, e, p1, sv, 'gocardless', 'mes', date_trunc('month', current_date)::date, 'SBR19B1', 55.00);
end $$;

-- 1 · Lo que crea y los permisos
do $$ begin
  if to_regclass('public.conta_gc_igualado') is null then raise exception 'PRUEBA R19b · 1: falta conta_gc_igualado'; end if;
  if has_table_privilege('authenticated', 'public.conta_gc_igualado', 'insert') or has_table_privilege('authenticated', 'public.conta_gc_igualado', 'update') then
    raise exception 'PRUEBA R19b · 1: una sesión solo lee lo igualado';
  end if;
  if not has_table_privilege('service_role', 'public.conta_gc_igualado', 'insert') then raise exception 'PRUEBA R19b · 1: el servidor no puede apuntar'; end if;
  insert into public.conta_gc_igualado (account_id, company_id, linea_id, party_id, que, antes, despues, porque)
  values ('ae19b000-0000-4000-8000-000000000010', 'ae19b000-0000-4000-8000-000000000020', 'ae19b000-0000-4000-8000-000000000051', 'ae19b000-0000-4000-8000-000000000031',
          'importe', '{"hasta": null, "importePropioCent": 5500, "alMesCent": 5500}', '{"importe_propio_cent": 6050}', 'Prueba: se pone el de GoCardless.');
  update public.conta_linea set importe_propio = 60.50 where id = 'ae19b000-0000-4000-8000-000000000051';
  raise notice 'PRUEBA R19b · 1 OK: lo igualado, solo el servidor lo apunta; una línea igualada (55,00 → 60,50 €)';
end $$;

-- 2 · Los tipos de «Pendiente de revisar»: los nuevos entran, los de antes siguen, uno inventado no
do $$ declare l uuid; begin
  insert into public.conta_gestoria_lectura (account_id, company_id, origen, entorno, por) values ('ae19b000-0000-4000-8000-000000000010', 'ae19b000-0000-4000-8000-000000000020', 'gocardless', 'real', 'persona') returning id into l;
  insert into public.conta_gestoria_diferencia (account_id, lectura_id, company_id, party_id, gc_cliente_id, tipo, porque_codigo, porque, datos) values
    ('ae19b000-0000-4000-8000-000000000010', l, 'ae19b000-0000-4000-8000-000000000020', 'ae19b000-0000-4000-8000-000000000031', 'CUR19B2', 'linea_sin_atar', 'cliente_gc_sin_atar', 'Prueba.', '{}'),
    ('ae19b000-0000-4000-8000-000000000010', l, 'ae19b000-0000-4000-8000-000000000020', 'ae19b000-0000-4000-8000-000000000032', 'CUR19B1', 'linea_en_otra_ficha', 'atado_a_otra_ficha', 'Prueba.', '{}'),
    ('ae19b000-0000-4000-8000-000000000010', l, 'ae19b000-0000-4000-8000-000000000020', null, 'CUR19B3', 'gc_sin_atar', 'cliente_gc_sin_atar', 'Prueba.', '{}'),
    ('ae19b000-0000-4000-8000-000000000010', l, 'ae19b000-0000-4000-8000-000000000020', null, 'CUR19B3', 'totales_distintos', 'sumied_mas', 'Prueba.', '{}');
  begin
    insert into public.conta_gestoria_diferencia (account_id, lectura_id, company_id, tipo, porque_codigo, porque, datos)
    values ('ae19b000-0000-4000-8000-000000000010', l, 'ae19b000-0000-4000-8000-000000000020', 'inventado', 'x', 'x', '{}');
    raise exception 'PRUEBA R19b · 2: entra un tipo inventado';
  exception when check_violation then null; end;
  raise notice 'PRUEBA R19b · 2 OK: los tres tipos nuevos entran, los de antes siguen, uno inventado no';
end $$;

-- 3 a 5, como la administradora de la cuenta (las dos funciones solo contestan a quien es de la cuenta).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ae19b000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- 3 · «Cobros de GoCardless sin cliente»: lo sin atar que cobra el mes que viene
do $$ declare r record; begin
  select * into r from public.conta_lista_que_hacer('ae19b000-0000-4000-8000-000000000010') q where q.tipo = 'gocardless_sin_cliente';
  if r.n is distinct from 2 or r.euros is distinct from 96.80 then raise exception 'PRUEBA R19b · 3: cuenta % por % € (esperaba 2 por 96,80: el propuesto y el sin nada; ni el atado ni el del mes siguiente)', r.n, r.euros; end if;
  if not exists (select 1 from public.conta_lista_que_hacer('ae19b000-0000-4000-8000-000000000010') q where q.tipo = 'diferencia:gc_sin_atar') then
    raise exception 'PRUEBA R19b · 3: lo demás de «Lo que tienes que hacer» ya no sale';
  end if;
  raise notice 'PRUEBA R19b · 3 OK: 2 suscripciones sin atar por 96,80 € (la propuesta por correo, también); lo atado y lo del mes siguiente, no';
end $$;

-- 4 · conta_pantalla_asignar
do $$ declare j jsonb; g jsonb; s jsonb; begin
  j := public.conta_pantalla_asignar('ae19b000-0000-4000-8000-000000000010');
  select x into g from jsonb_array_elements(j->'gc_clientes') x where x->>'gc_id' = 'CUR19B2';
  if g->'enlace'->>'estado' <> 'propuesto' or jsonb_array_length(g->'enlace'->'candidatas') <> 2 or g->'mandatos'->0->>'cuenta_final' <> '00' then
    raise exception 'PRUEBA R19b · 4: el cliente propuesto no trae su enlace o su mandato: %', g;
  end if;
  select x into s from jsonb_array_elements(j->'suscripciones') x where x->>'gc_id' = 'SBR19B4';
  if (s->>'cobra_en_el_mes')::boolean is not false or (s->>'proximo_cobro_importe')::numeric <> 120 then raise exception 'PRUEBA R19b · 4: la anual del mes siguiente: %', s; end if;
  if jsonb_array_length(j->'meses') <> 1 then raise exception 'PRUEBA R19b · 4: el mes que se cuenta: %', j->'meses'; end if;
  raise notice 'PRUEBA R19b · 4 OK: la pantalla trae el próximo cobro, si cobra en el mes, el enlace y los mandatos';
end $$;

-- 5 · Como usuario: la administradora de la cuenta
do $$ declare n int; begin
  select count(*) into n from public.conta_gc_igualado;
  if n <> 1 then raise exception 'PRUEBA R19b · 5: la administradora ve % igualados (esperaba 1)', n; end if;
  if (select count(*) from public.conta_lista_que_hacer('ae19b000-0000-4000-8000-000000000010') q where q.tipo = 'gocardless_sin_cliente') <> 1 then
    raise exception 'PRUEBA R19b · 5: la administradora no ve sus cobros sin cliente';
  end if;
  if exists (select 1 from public.conta_lista_que_hacer('51ad1792-0000-4000-8000-00000000ffff')) then raise exception 'PRUEBA R19b · 5: ve lo de otra cuenta'; end if;
  raise notice 'PRUEBA R19b · 5 OK: la administradora ve lo suyo; lo de otra cuenta, nada';
end $$;
reset role;

-- 6 · La vuelta atrás, el fichero de verdad
\i supabase/vuelta-atras/20261125T1329_r19b_sumied_igual_gocardless.down.sql
do $$ declare r record; begin
  if to_regclass('public.conta_gc_igualado') is not null then raise exception 'PRUEBA R19b · 6: la vuelta atrás dejó lo igualado'; end if;
  if (select importe_propio from public.conta_linea where id = 'ae19b000-0000-4000-8000-000000000051') <> 55.00 then raise exception 'PRUEBA R19b · 6: la línea no ha vuelto a 55,00 €'; end if;
  if exists (select 1 from public.conta_gestoria_diferencia where tipo in ('linea_sin_atar', 'linea_en_otra_ficha', 'gc_sin_atar')) then raise exception 'PRUEBA R19b · 6: quedan pendientes de los tipos nuevos'; end if;
  perform set_config('request.jwt.claims', '{"sub":"ae19b000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  select * into r from public.conta_lista_que_hacer('ae19b000-0000-4000-8000-000000000010') q where q.tipo = 'gocardless_sin_cliente';
  if r.n is distinct from 4 then raise exception 'PRUEBA R19b · 6: la cuenta de antes no ha vuelto (% en vez de 4: todas, sin mirar el atado ni el mes)', r.n; end if;
  raise notice 'PRUEBA R19b · 6 OK: la vuelta atrás devuelve la línea a 55,00 €, quita lo nuevo y deja la cuenta de antes';
end $$;

rollback;
