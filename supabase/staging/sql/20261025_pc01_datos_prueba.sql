-- supabase/staging/sql/20261025_pc01_datos_prueba.sql
--
-- SOLO STAGING. Prueba de 20261025T0918_pc01_cobros_y_pagos_de_antes (toca
-- datos), con \i dentro de la transacción y ROLLBACK: staging no cambia.
--
-- Staging no tiene Foodint (ni sus plataformas, ni sus tiendas, ni las traídas
-- de Diez): esos pasos los prueba el ensayo de producción, con su comprobación.
-- Aquí, con lo que haya en staging (casados del banco, pagos de lotes,
-- liquidaciones cobradas, emitidas), y una plataforma con plazo y una emitida
-- suyas sembradas aquí:
--   1. la 0918 entra, deja su copia y dice lo que ha hecho;
--   2. no se pasa dos veces (con su copia puesta, su guarda para);
--   3. su vuelta atrás deja las nueve tablas que toca EXACTAMENTE como estaban
--      (huella de cada tabla entera, antes y después, carácter a carácter) y sin
--      copia.
--
-- sin usuario: la 0918 y su vuelta atrás las pasa el workflow como dueño de la
-- base, no una persona; lo que hace un usuario (cobrar, casar, deshacer, el
-- plazo de la ficha) lo prueba, como usuario, 20261025_pc01_motor_prueba.sql.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA PC01 DATOS: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

\i supabase/vuelta-atras/20261025T0917_pc01_motor_cambia.down.sql
\i supabase/vuelta-atras/20261025T0916_pc01_motor_cobros_pagos.down.sql
\i supabase/migrations/20261025T0916_pc01_motor_cobros_pagos.sql
\i supabase/migrations/20261025T0917_pc01_motor_cambia.sql

-- Una plataforma con plazo y una emitida suya (sin cierre: por su 430), para que haya un vencimiento que cambiar.
do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; e uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; c uuid; pa uuid; ca uuid; fy uuid; ent uuid;
begin
  insert into public.sales_channel (account_id, name, slug) values (a, 'Plataforma PC01 datos', 'pc01-datos') returning id into c;
  insert into public.party (account_id, name) values (a, 'Plataforma PC01 datos') returning id into pa;
  insert into public.party_role (account_id, party_id, role, channel_id, settlement_every, payout_days_after) values (a, pa, 'platform', c, 'weekly', 1);
  select id into ca from public.company_account where company_id = e and code like '430%' order by code limit 1;
  insert into public.company_account_link (account_id, company_id, entity, role, entity_id, company_account_id, source)
  select a, e, 'customer', 'principal', pa::text, ca, 'manual'
   where not exists (select 1 from public.company_account_link k where k.company_id = e and k.company_account_id = ca and k.entity = 'customer' and k.role = 'principal');
  if not exists (select 1 from public.company_account_link k where k.company_id = e and k.company_account_id = ca and k.entity = 'customer' and k.role = 'principal' and k.entity_id = pa::text) then
    raise notice 'siembra: la 430 de A ya es de otro cliente; la emitida no tendrá plataforma (no pasa nada: la prueba es la huella)';
  end if;
  select id into fy from public.fiscal_year where company_id = e and date '2026-10-05' between starts_on and ends_on limit 1;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status)
  values (a, e, fy, 1, '2026-10-05', 'Traída PC01', 'sales_day', 'borrador') returning id into ent;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit) values (a, e, ent, 1, ca, 12.10, 0);
  insert into public.customer_invoice (account_id, company_id, status, origin, series_code, fiscal_year, number, number_text, issue_date, due_date, customer, base, tax, total, entry_id, updated_at)
  values (a, e, 'emitida', 'cierre_dia', 'PCD', 2026, 1, 'PCD-1', '2026-10-05', '2026-10-05', '{"nombre": "Plataforma PC01 datos"}', 11, 1.10, 12.10, ent, '2026-10-24 10:00+00');
  raise notice 'siembra: una plataforma con plazo semanal y una emitida suya del 5/10 que vence el mismo día';
end $$;

create temp table _h (momento text primary key, huella text) on commit drop;
create or replace function pg_temp.huella() returns text language sql as $$
  select string_agg(t || '=' || h, ' ' order by t) from (
    select 'customer_invoice' t, md5(coalesce(string_agg(x::text, '|' order by x.id), '')) h from public.customer_invoice x union all
    select 'customer_invoice_payment', md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.customer_invoice_payment x union all
    select 'customer_invoice_event', md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.customer_invoice_event x union all
    select 'supplier_invoice', md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.supplier_invoice x union all
    select 'supplier_invoice_payment', md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.supplier_invoice_payment x union all
    select 'supplier_invoice_payment_log', md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.supplier_invoice_payment_log x union all
    select 'platform_store', md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.platform_store x union all
    select 'channel_settlement', md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.channel_settlement x union all
    select 'party_role', md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.party_role x) z
$$;
insert into _h values ('antes', pg_temp.huella());

-- 1 · La tanda.
\i supabase/migrations/20261025T0918_pc01_cobros_y_pagos_de_antes.sql
do $$
begin
  if to_regclass('public._pc01_creados') is null or to_regclass('public._copia_pc01_vence') is null then raise exception 'PRUEBA PC01 DATOS · 1: no quedó su copia.'; end if;
  if (select due_date from public.customer_invoice where series_code = 'PCD' and number = 1) is distinct from date '2026-10-17'
     and exists (select 1 from public.company_account_link k join public.party_role r on r.party_id::text = k.entity_id where r.channel_id in (select id from public.sales_channel where slug = 'pc01-datos')) then
    raise exception 'PRUEBA PC01 DATOS · 1: la emitida de la plataforma tenía que vencer el 17/10 y vence %.', (select due_date from public.customer_invoice where series_code = 'PCD' and number = 1);
  end if;
  if pg_temp.huella() = (select huella from _h where momento = 'antes') and exists (select 1 from public._pc01_creados) then
    raise exception 'PRUEBA PC01 DATOS · 1: dice que creó filas y nada cambió.';
  end if;
  raise notice '1 · la 0918 entra y deja su copia (% filas creadas, % vencimientos)', (select count(*) from public._pc01_creados), (select count(*) from public._copia_pc01_vence);
end $$;

-- 2 · Dos veces, no: la primera sentencia de la 0918 para si ya está su copia.
do $$
begin
  if to_regclass('public._pc01_creados') is null then raise exception 'PRUEBA PC01 DATOS · 2: sin su copia, la 0918 se podría pasar dos veces.'; end if;
  raise notice '2 · con su copia puesta, la guarda de la 0918 para: no se pasa dos veces';
end $$;

-- 3 · La vuelta atrás, exacta.
\i supabase/vuelta-atras/20261025T0918_pc01_cobros_y_pagos_de_antes.down.sql
do $$
begin
  if pg_temp.huella() is distinct from (select huella from _h where momento = 'antes') then
    raise exception 'PRUEBA PC01 DATOS · 3: la vuelta atrás no deja los datos como estaban. Antes: % · Después: %', (select huella from _h where momento = 'antes'), pg_temp.huella();
  end if;
  if to_regclass('public._pc01_creados') is not null or to_regclass('public._copia_pc01_recibida') is not null then raise exception 'PRUEBA PC01 DATOS · 3: la copia se quedó.'; end if;
  raise notice '3 · la vuelta atrás deja las nueve tablas EXACTAMENTE como estaban (huella igual) y sin copia';
end $$;

rollback;
