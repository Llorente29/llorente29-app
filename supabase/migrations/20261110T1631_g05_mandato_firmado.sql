-- supabase/migrations/20261110T1631_g05_mandato_firmado.sql
-- cambia: public.conta_lista_que_hacer · prueba: supabase/staging/sql/20261110_g05_mandato_firmado_prueba.sql
--
-- G05 · nº 90 · UN MANDATO EN «pending_submission» YA ESTÁ FIRMADO. En GoCardless,
-- un mandato SEPA en pending_submission (o submitted) lo ha firmado el cliente: se
-- manda al banco con su primer cobro, y ya se pueden crear cobros con él. Sumied
-- lo contaba «por firmar». Con eso, un cliente nuevo no salía como listo para su
-- primer cobro.
--   conta_lista_que_hacer: «Mandatos por firmar» cuenta solo los que esperan la
--   aprobación del cliente (pending_customer_approval); antes, también
--   pending_submission y submitted.
-- La función es la de producción (medida el 10/11 a las 16:45 UTC) con ese único
-- cambio. Con su respaldo. La pantalla (g04/modelo.ts y vista.ts) cambia en el
-- mismo PR; el cobro (conta-cobro, mandatoParaCobrar y conta_cobro_para_enviar)
-- ya los aceptaba.
-- Nada en el camino del pedido. No toca datos.
-- Vuelta atrás: supabase/vuelta-atras/20261110T1631_g05_mandato_firmado.down.sql

select public._respaldar_funcion('public.conta_lista_que_hacer(uuid)', '20261110T1631_g05_mandato_firmado');

create or replace function public.conta_lista_que_hacer(p_cuenta uuid)
 returns table(cuenta_id uuid, empresa_id uuid, tipo text, n bigint, euros numeric)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with permiso as (
    select p_cuenta as cuenta where public.belongs_to_account(p_cuenta)
  ), gc_sin_cliente as (
    select s.account_id, s.company_id, count(*) as n, sum(s.al_mes) as eur from public.conta_gc_suscripcion s
     where s.account_id = (select cuenta from permiso) and s.estado = 'active'
       and not exists (select 1 from public.conta_cobro_cliente cc where cc.company_id = s.company_id and cc.gc_cliente_id = s.gc_cliente_id)
     group by s.account_id, s.company_id
  ), gc_varios as (
    select cc.account_id, cc.company_id, count(*) as n from (
      select k.account_id, k.company_id, k.gc_cliente_id from public.conta_cobro_cliente k
       where k.account_id = (select cuenta from permiso) and k.gc_cliente_id is not null
       group by k.account_id, k.company_id, k.gc_cliente_id having count(*) > 1) cc
     group by cc.account_id, cc.company_id
  ), devueltos as (
    select b.account_id, b.company_id, count(*) as n, sum(b.importe) as eur from public.conta_gc_cobro b
     where b.account_id = (select cuenta from permiso) and b.estado in ('failed', 'charged_back') and b.fecha >= date_trunc('month', current_date)::date
     group by b.account_id, b.company_id
  ), por_firmar as (
    -- nº 90 · Por firmar, solo el que espera la aprobación del cliente: en pending_submission o submitted ya está firmado.
    select m.account_id, m.company_id, count(*) as n,
           sum((select sum(s.al_mes) from public.conta_gc_suscripcion s where s.company_id = m.company_id and s.mandato_gc_id = m.gc_id and s.estado = 'active')) as eur
      from public.conta_gc_mandato m
     where m.account_id = (select cuenta from permiso) and m.estado = 'pending_customer_approval'
     group by m.account_id, m.company_id
  ), difs as (
    select d.account_id, d.company_id, d.tipo, count(*) as n from public.conta_gestoria_diferencia d
     where d.account_id = (select cuenta from permiso) and d.vigente
     group by d.account_id, d.company_id, d.tipo
  )
  select account_id, company_id, 'gocardless_sin_cliente', n, eur from gc_sin_cliente
  union all select account_id, company_id, 'gocardless_varios_clientes', n, null::numeric from gc_varios
  union all select account_id, company_id, 'recibos_devueltos', n, eur from devueltos
  union all select account_id, company_id, 'mandatos_por_firmar', n, eur from por_firmar
  union all select account_id, company_id, 'diferencia:' || tipo, n, null::numeric from difs
$function$;
