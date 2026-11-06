-- supabase/migrations/20261106T1531_g01_gocardless_cobro.sql
--
-- G01 · Tarea 3 (06/11/2026) · Lo que CAMBIA en caliente para que GoCardless
-- sea una forma de cobro y Bitrix24 un origen de clientes. Va después de la
-- 1530 (que solo añade).
--
-- cambia: public.conta_pasarela_cuenta · prueba: supabase/staging/sql/20261106_g01_clientes_cuotas_prueba.sql
-- cambia: public.party · prueba: supabase/staging/sql/20261106_g01_clientes_cuotas_prueba.sql
-- cambia: public.conta_mandato · prueba: supabase/staging/sql/20261106_g01_clientes_cuotas_prueba.sql
-- cambia: public._s01_cuenta_pasarela · prueba: supabase/staging/sql/20261106_g01_clientes_cuotas_prueba.sql
--
--   1. conta_pasarela_cuenta.proveedor admite «gocardless» (solo amplía: lo
--      de Stripe y Redsys sigue igual). Deja sitio a su cuenta 572 y a su
--      tesorería de tipo pasarela, para conciliar después en Bancos sus abonos.
--   2. party.source admite «crm»: el cliente que llega de Bitrix24 (solo amplía).
--   3. conta_mandato: el enlace de firma (token) y su caducidad solo son
--      obligatorios en los mandatos firmados en Sumied; uno de GoCardless no
--      los tiene. Un CHECK lo dice: los de origen «sumied» los siguen llevando.
--   4. _s01_cuenta_pasarela: admite «gocardless» y llama a su cuenta
--      «GoCardless · por abonar». La misma firma; Stripe y Redsys, igual.
--
-- Julio (respuesta 5 a la tarea 1) aprobó cambiar las 4 funciones que nombran
-- el proveedor. Medido el 06/11: solo _s01_cuenta_pasarela rechaza un
-- proveedor que no sea stripe o redsys. Las otras tres (_s01_asiento_cobro,
-- conta_abono_pasarela_casar, conta_abonos_pasarela_pendientes) son del cobro
-- por ENLACE de pago (tarjeta o Bizum), por el que GoCardless no pasa: se
-- tocarán cuando se concilien sus abonos, que no es este encargo.
-- conta_enlace_pago no se toca.
--
-- Nada en el camino del pedido. En producción, 0 filas en conta_pasarela_cuenta
-- y 0 en conta_mandato (06/11): nada que mover.
-- Vuelta atrás: supabase/vuelta-atras/20261106T1531_g01_gocardless_cobro.down.sql

-- 1 · GoCardless en las pasarelas de cobro
alter table public.conta_pasarela_cuenta drop constraint if exists conta_pasarela_cuenta_proveedor_check;
alter table public.conta_pasarela_cuenta add constraint conta_pasarela_cuenta_proveedor_check
  check (proveedor = any (array['stripe'::text, 'redsys'::text, 'gocardless'::text]));

-- 2 · El cliente que llega de Bitrix24
alter table public.party drop constraint if exists party_source_check;
alter table public.party add constraint party_source_check
  check (source = any (array['manual'::text, 'supplier'::text, 'migrated'::text, 'ticket'::text, 'crm'::text]));

-- 3 · El mandato de GoCardless no tiene enlace de firma
alter table public.conta_mandato alter column token drop not null;
alter table public.conta_mandato alter column expires_at drop not null;
alter table public.conta_mandato drop constraint if exists conta_mandato_firma_en_sumied;
alter table public.conta_mandato add constraint conta_mandato_firma_en_sumied
  check (origen <> 'sumied' or (token is not null and expires_at is not null));

-- 4 · La cuenta de la pasarela, también de GoCardless. Antes, su respaldo: la
-- vuelta atrás la devuelve byte a byte (_restaurar_funcion).
select public._respaldar_funcion('public._s01_cuenta_pasarela(uuid,text)', '20261106T1531_g01_gocardless_cobro');
create or replace function public._s01_cuenta_pasarela(p_company uuid, p_proveedor text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_cuenta uuid; v_plan text; v_d int; v_code text; v_ca uuid; v_ta uuid; v_nombre text; v_existe text;
begin
  if p_proveedor not in ('stripe', 'redsys', 'gocardless') then raise exception 'Proveedor: stripe, redsys o gocardless.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('conta_pasarela:' || p_company::text || ':' || p_proveedor, 0));
  select code into v_existe from public.conta_pasarela_cuenta where company_id = p_company and proveedor = p_proveedor;
  if v_existe is not null then return v_existe; end if;
  select account_id into v_cuenta from public.company where id = p_company;
  select a.plan into v_plan from public.company_account a where a.company_id = p_company and a.account_id = v_cuenta limit 1;
  if v_cuenta is null or v_plan is null then return null; end if;
  select p.account_digits into v_d from public.company_tax_profile p where p.company_id = p_company;
  v_code := public.company_account_siguiente(p_company, '572', coalesce(v_d, 8));
  if v_code is null then raise exception 'No queda numeración libre en 572 para la cuenta de la pasarela.' using errcode = '23514'; end if;
  v_nombre := case p_proveedor when 'stripe' then 'Stripe · por abonar' when 'gocardless' then 'GoCardless · por abonar' else 'TPV del banco · por abonar' end;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, kind, source, created_by_name)
  values (v_cuenta, p_company, v_plan, v_code, '572', v_nombre, v_nombre, 'own', 'manual', 'Sumied')
  returning id into v_ca;
  insert into public.treasury_account (account_id, company_id, kind, name, short_name)
  values (v_cuenta, p_company, 'pasarela', v_nombre, case p_proveedor when 'stripe' then 'Stripe' when 'gocardless' then 'GoCardless' else 'TPV' end)
  returning id into v_ta;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (v_cuenta, p_company, v_ca, 'bank_account', v_ta::text, 'principal', 'manual');
  insert into public.conta_pasarela_cuenta (company_id, proveedor, account_id, treasury_account_id, company_account_id, code)
  values (p_company, p_proveedor, v_cuenta, v_ta, v_ca, v_code);
  return v_code;
end $function$;
