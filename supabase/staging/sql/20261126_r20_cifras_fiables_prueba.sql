-- supabase/staging/sql/20261126_r20_cifras_fiables_prueba.sql
--
-- SOLO STAGING. Prueba del R20 (20261126T0807_r20_cifras_del_cobro y 20261126T0808_r20_cifras_no_cuadran), que el
-- ensayo de staging pone delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
--
-- Una cuenta inventada con una empresa, dos fichas y lo leído de su GoCardless (inventado, T11): un cliente ATADO a la
-- ficha 1, otro PROPUESTO por correo (sin confirmar) y otro sin nada; tres suscripciones que cobran el mes que viene y
-- una anual que cobra el siguiente. Por sus CAMINOS:
--   1. Como la administradora: conta_cifras_del_cobro da el mes del próximo cobro y las tres suscripciones de ese mes,
--      con su próximo importe y su ficha ATADA (la propuesta por correo y la que no tiene nada, sin ficha); la anual del
--      mes siguiente, no.
--   2. Como alguien de otra cuenta: nada. Y como el servidor (la comprobación de cada noche): lo mismo que la
--      administradora.
--   3. conta_gestoria_diferencia: el tipo nuevo entra, los de antes siguen (el CHECK solo amplía), uno inventado no.
--   4. Las vueltas atrás (los ficheros de verdad, en orden inverso): quitan los pendientes del tipo nuevo, dejan el CHECK
--      de antes y quitan la función.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R20: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

do $$
declare
  u constant uuid := 'ae200000-0000-4000-8000-000000000001';
  o constant uuid := 'ae200000-0000-4000-8000-000000000002';
  x constant uuid := 'ae200000-0000-4000-8000-000000000010';
  y constant uuid := 'ae200000-0000-4000-8000-000000000011';
  e constant uuid := 'ae200000-0000-4000-8000-000000000020';
  p1 constant uuid := 'ae200000-0000-4000-8000-000000000031';
  p2 constant uuid := 'ae200000-0000-4000-8000-000000000032';
  d1 date := (date_trunc('month', current_date) + interval '1 month' + interval '3 day')::date;
  d2 date := (date_trunc('month', current_date) + interval '2 month' + interval '3 day')::date;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'admin@r20-prueba.test',
          extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
         ('00000000-0000-0000-0000-000000000000', o, 'authenticated', 'authenticated', 'otra@r20-prueba.test',
          extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values
    (x, 'Prueba R20', 'r20-prueba', 'active', 'otra_actividad', 'contabilidad'), (y, 'Otra prueba R20', 'r20-prueba-otra', 'active', 'otra_actividad', 'contabilidad');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at) values
    (u, x, 'admin', true, 'Prueba R20', now(), now()), (o, y, 'admin', true, 'Otra prueba R20', now(), now());
  insert into public.company (id, account_id, legal_name) values (e, x, 'Empresa de prueba R20, S.L.');
  insert into public.party (id, account_id, name) values (p1, x, 'Ficha uno de prueba'), (p2, x, 'Ficha dos de prueba');
  insert into public.conta_gc_cliente (company_id, gc_id, account_id, nombre, correo) values
    (e, 'CUR20A', x, 'Atado de prueba', null), (e, 'CUR20B', x, 'Propuesto de prueba', 'repetido@example.com'), (e, 'CUR20C', x, 'Sin nada de prueba', null);
  insert into public.conta_gc_suscripcion (company_id, gc_id, account_id, gc_cliente_id, nombre, importe, al_mes, estado, proximo_cobro_fecha, proximo_cobro_importe) values
    (e, 'SBR20A', x, 'CUR20A', 'GESTORIA MENSUAL', 60.50, 60.50, 'active', d1, 60.50),
    (e, 'SBR20B', x, 'CUR20B', 'GESTORIA MENSUAL', 72.60, 72.60, 'active', d1, 72.60),
    (e, 'SBR20C', x, 'CUR20C', 'GESTION LABORAL', 24.20, 24.20, 'active', d1, 24.20),
    (e, 'SBR20D', x, 'CUR20C', 'ANUAL', 120.00, 10.00, 'active', d2, 120.00),
    (e, 'SBR20E', x, 'CUR20A', 'CANCELADA', 12.10, 12.10, 'cancelled', null, null);
  insert into public.conta_gc_enlace (company_id, gc_cliente_id, account_id, party_id, por, estado, candidatas, porque) values
    (e, 'CUR20A', x, p1, 'persona', 'atado', '{}', 'Lo ató una persona de prueba.'),
    (e, 'CUR20B', x, null, 'correo', 'propuesto', array[p1, p2], 'Su correo está en 2 fichas.');
end $$;

-- 1 · Como la administradora de la cuenta
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ae200000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$ declare j jsonb; a jsonb; begin
  j := public.conta_cifras_del_cobro('ae200000-0000-4000-8000-000000000010');
  if jsonb_array_length(j->'meses') <> 1 or j->'meses'->0->>'mes' <> to_char(date_trunc('month', current_date) + interval '1 month', 'YYYY-MM') then
    raise exception 'PRUEBA R20 · 1: el mes del próximo cobro: %', j->'meses';
  end if;
  if jsonb_array_length(j->'suscripciones') <> 3 then raise exception 'PRUEBA R20 · 1: % suscripciones (esperaba 3: ni la anual del mes siguiente ni la cancelada)', jsonb_array_length(j->'suscripciones'); end if;
  if (select sum((s->>'importe')::numeric) from jsonb_array_elements(j->'suscripciones') s) <> 157.30 then raise exception 'PRUEBA R20 · 1: no suman 157,30 €: %', j->'suscripciones'; end if;
  select s into a from jsonb_array_elements(j->'suscripciones') s where s->>'gc_id' = 'SBR20A';
  if a->>'ficha_id' <> 'ae200000-0000-4000-8000-000000000031' or a->>'cliente_gc' <> 'Atado de prueba' then raise exception 'PRUEBA R20 · 1: la atada no trae su ficha: %', a; end if;
  if exists (select 1 from jsonb_array_elements(j->'suscripciones') s where s->>'gc_id' in ('SBR20B', 'SBR20C') and s->>'ficha_id' is not null) then
    raise exception 'PRUEBA R20 · 1: la propuesta por correo o la sin nada salen con ficha';
  end if;
  raise notice 'PRUEBA R20 · 1 OK: el mes del próximo cobro, 3 suscripciones por 157,30 €; solo la atada lleva ficha';
end $$;

-- 2 · Alguien de otra cuenta: nada. El servidor: lo mismo que la administradora.
select set_config('request.jwt.claims', '{"sub":"ae200000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$ declare j jsonb; begin
  j := public.conta_cifras_del_cobro('ae200000-0000-4000-8000-000000000010');
  if jsonb_array_length(j->'meses') <> 0 or jsonb_array_length(j->'suscripciones') <> 0 then raise exception 'PRUEBA R20 · 2: otra cuenta ve algo: %', j; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$ declare j jsonb; begin
  j := public.conta_cifras_del_cobro('ae200000-0000-4000-8000-000000000010');
  if jsonb_array_length(j->'suscripciones') <> 3 then raise exception 'PRUEBA R20 · 2: el servidor ve % suscripciones (esperaba 3)', jsonb_array_length(j->'suscripciones'); end if;
  raise notice 'PRUEBA R20 · 2 OK: otra cuenta no ve nada; el servidor, lo mismo que la administradora';
end $$;
select set_config('request.jwt.claims', '', true);

-- 3 · El tipo nuevo de «Pendiente de revisar»
do $$ declare l uuid; begin
  insert into public.conta_gestoria_lectura (account_id, company_id, origen, entorno, por) values ('ae200000-0000-4000-8000-000000000010', 'ae200000-0000-4000-8000-000000000020', 'gocardless', 'real', 'persona') returning id into l;
  insert into public.conta_gestoria_diferencia (account_id, lectura_id, company_id, party_id, gc_cliente_id, tipo, porque_codigo, porque, datos) values
    ('ae200000-0000-4000-8000-000000000010', l, 'ae200000-0000-4000-8000-000000000020', null, null, 'cifras_no_cuadran', 'cuotas_no_cuadran', 'Prueba: no cuadran.', '{}'),
    ('ae200000-0000-4000-8000-000000000010', l, 'ae200000-0000-4000-8000-000000000020', null, 'CUR20C', 'gc_sin_atar', 'cliente_gc_sin_atar', 'Prueba.', '{}');
  begin
    insert into public.conta_gestoria_diferencia (account_id, lectura_id, company_id, tipo, porque_codigo, porque, datos)
    values ('ae200000-0000-4000-8000-000000000010', l, 'ae200000-0000-4000-8000-000000000020', 'inventado', 'x', 'x', '{}');
    raise exception 'PRUEBA R20 · 3: entra un tipo inventado';
  exception when check_violation then null; end;
  raise notice 'PRUEBA R20 · 3 OK: el tipo nuevo entra, los de antes siguen, uno inventado no';
end $$;

-- 4 · La vuelta atrás, el fichero de verdad
\i supabase/vuelta-atras/20261126T0808_r20_cifras_no_cuadran.down.sql
\i supabase/vuelta-atras/20261126T0807_r20_cifras_del_cobro.down.sql
do $$ begin
  if to_regprocedure('public.conta_cifras_del_cobro(uuid)') is not null then raise exception 'PRUEBA R20 · 4: la vuelta atrás dejó la función'; end if;
  if exists (select 1 from public.conta_gestoria_diferencia where tipo = 'cifras_no_cuadran') then raise exception 'PRUEBA R20 · 4: quedan pendientes del tipo nuevo'; end if;
  if not exists (select 1 from public.conta_gestoria_diferencia where tipo = 'gc_sin_atar' and account_id = 'ae200000-0000-4000-8000-000000000010') then
    raise exception 'PRUEBA R20 · 4: la vuelta atrás se llevó lo de antes';
  end if;
  raise notice 'PRUEBA R20 · 4 OK: la vuelta atrás quita la función y el tipo nuevo, y deja lo de antes';
end $$;

rollback;
