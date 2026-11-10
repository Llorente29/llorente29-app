-- supabase/migrations/20261110T1222_g05_gocardless_del_mes.sql
--
-- G05 · nº 81 y nº 82 · LO QUE GOCARDLESS COBRA A CADA CLIENTE EN UN MES, para la
-- ficha y la pantalla de Clientes. Hasta hoy comparaban el recibo del mes con la
-- media de GoCardless (conta_lista_clientes.gocardless_al_mes, la suma de al_mes),
-- que reparte la anual entre 12: Talleres Ruiz salía «250,00 € en GoCardless ·
-- Sumied calcula 225,00 €» por los 25 € de un impuesto de sociedades de 300 € que
-- se cobra en junio.
--
-- Solo añade:
--   conta_gocardless_del_mes(cuenta, mes 'AAAA-MM'): por cliente y empresa, lo que
--   GoCardless le cobra EN ese mes, con la regla de «Revisar el cobro» (nº 70,
--   gocardlessEnElMes en supabase/functions/_shared/cobro/gocardless.ts): una
--   mensual entra todos los meses; una anual (o cada varios meses), entera y solo
--   en el mes en que la cobra, que sale de su próximo cobro (o de su inicio); las
--   semanales no se cuentan. Una fila por cliente con alguna suscripción activa
--   (que = 'cliente') y una por empresa con todo lo suyo del mes, también lo que
--   aún no está unido a ningún cliente (que = 'empresa', sin cliente_id): el total
--   de la banda de arriba, que hasta hoy era la suma de al_mes.
-- Como conta_lista_clientes: SECURITY DEFINER, el permiso de la cuenta mirado una
-- vez (belongs_to_account) y cada tabla filtrada por ella; de otra cuenta, nada.
-- conta_lista_clientes y conta_pantalla_clientes se quedan como están.
-- No toca datos. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261110T1222_g05_gocardless_del_mes.down.sql

create or replace function public.conta_gocardless_del_mes(p_cuenta uuid, p_mes text)
returns table (que text, cliente_id uuid, empresa_id uuid, mes text, gocardless_del_mes numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_mes is null or p_mes !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Falta el mes (AAAA-MM).' using errcode = '22023';
  end if;
  return query
  with permiso as (
    select p_cuenta as cuenta where public.belongs_to_account(p_cuenta)
  ), sus as (
    select s.company_id, s.gc_cliente_id, s.importe,
           case s.intervalo when 'monthly' then greatest(1, coalesce(s.cada, 1))
                            when 'yearly' then 12 * greatest(1, coalesce(s.cada, 1)) end as meses,
           coalesce(s.proximo_cobro_fecha, s.inicio) as ref
      from public.conta_gc_suscripcion s
     where s.account_id = (select cuenta from permiso) and s.estado = 'active'
  ), cuenta_mes as (
    select x.company_id, x.gc_cliente_id,
           coalesce(sum(case
             when x.meses is null then 0
             when x.meses = 1 then coalesce(x.importe, 0)
             when x.ref is null then 0
             when mod(mod((extract(year from to_date(p_mes, 'YYYY-MM'))::int - extract(year from x.ref)::int) * 12
                          + extract(month from to_date(p_mes, 'YYYY-MM'))::int - extract(month from x.ref)::int, x.meses) + x.meses, x.meses) = 0
               then coalesce(x.importe, 0)
             else 0 end), 0) as importe
      from sus x
     group by x.company_id, x.gc_cliente_id
  )
  select 'cliente'::text, cc.party_id, cc.company_id, p_mes, cm.importe
    from public.conta_cobro_cliente cc
    join cuenta_mes cm on cm.company_id = cc.company_id and cm.gc_cliente_id = cc.gc_cliente_id
   where cc.account_id = (select cuenta from permiso)
  union all
  select 'empresa'::text, null::uuid, cm.company_id, p_mes, sum(cm.importe)
    from cuenta_mes cm
   group by cm.company_id;
end $$;
revoke all on function public.conta_gocardless_del_mes(uuid, text) from public, anon;
grant execute on function public.conta_gocardless_del_mes(uuid, text) to authenticated, service_role;

comment on function public.conta_gocardless_del_mes(uuid, text) is
  'G05 · nº 82 · Lo que GoCardless cobra a cada cliente EN un mes (la anual, entera en su mes; nunca repartida entre 12), para la ficha y Clientes. De quien es de la cuenta.';
