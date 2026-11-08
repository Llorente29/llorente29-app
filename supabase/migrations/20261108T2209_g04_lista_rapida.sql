-- supabase/migrations/20261108T2209_g04_lista_rapida.sql
--
-- G04 · Arreglo definitivo de la lista de Clientes (Julio, nº 19, 08/11): la
-- lista tiene que abrir en menos de 1 s. SOLO AÑADE: dos funciones nuevas.
--
-- Por qué la vista no basta, ni reescrita (medido en producción el 08/11 como
-- authenticated, con el administrador de QBO, ya con los índices de la 2057):
--   · conta_consulta_cliente_empresa: 5,2 s; reescrita sin subconsultas por
--     fila (cada tabla agregada una vez y unida), 4,9 s. Casi igual.
--   · El coste es la RLS: belongs_to_account (SECURITY DEFINER, no se puede
--     meter en la consulta) cuesta unos 0,24 ms por fila leída. Solo contar
--     las 2.636 suscripciones tarda 643 ms; los 2.855 cobros, 694 ms; los
--     1.535 clientes, 527 ms. La lista lee unas 20.000 filas entre todas sus
--     tablas: con la RLS fila a fila no baja de varios segundos.
--
-- Arreglo, como conta_pagos_lista (B01·15): funciones SECURITY DEFINER que
-- comprueban UNA vez que quien llama es de la cuenta (belongs_to_account) y
-- leen cada tabla filtrando por esa cuenta. Si no es de la cuenta, no sale
-- ninguna fila: lo mismo que hacía la RLS. Devuelven exactamente las columnas
-- de la vista, en el mismo orden; la lista, ya sin subconsultas por fila. Una
-- sola diferencia, a propósito: el «último cargo» de un día con dos cargos
-- (10 clientes de GoCardless en QBO) era uno cualquiera en la vista y aquí es
-- fijo: el cobrado, y si no, el de gc_id mayor. Comparadas en producción el
-- 08/11: las mismas 1.661 filas de la lista salvo esos empates, y las mismas 24
-- de «Lo que tienes que hacer».
--   · conta_lista_clientes(p_cuenta)  ⇔ conta_consulta_cliente_empresa
--   · conta_lista_que_hacer(p_cuenta) ⇔ conta_consulta_que_hacer
-- Las vistas se quedan como están (las lee la versión publicada del front y
-- conta_lectura); el front nuevo lee las funciones.
--
-- No toca datos. No lee ni escribe en GoCardless ni en el CRM. Nada en el
-- camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261108T2209_g04_lista_rapida.down.sql

create or replace function public.conta_lista_clientes(p_cuenta uuid)
returns table (
  cuenta_id uuid, cliente_id uuid, empresa_id uuid, empresa text, cliente text, nif text, situacion text, crm text, tipo_ficha text,
  ficha_en_el_crm text, leido_del_crm timestamptz, telefonos jsonb, correos jsonb, forma_de_cobro text, cliente_en_gocardless text, mandato text,
  gocardless_al_mes numeric, suscripciones_activas bigint, proximo_cobro_fecha date, ultimo_cobro_fecha date, ultimo_cargo_estado text,
  pendientes bigint, trabajadores text[])
language sql stable security definer set search_path = public as $$
  with permiso as (
    -- La única comprobación: si quien llama no es de la cuenta, «cuenta» sale vacía y no hay ninguna fila.
    select p_cuenta as cuenta where public.belongs_to_account(p_cuenta)
  ), vinculo as (
    select c.account_id, c.party_id, c.emisor_segun_crm as company_id from public.conta_gestoria_cliente c
     where c.account_id = (select cuenta from permiso) and c.emisor_segun_crm is not null
    union select l.account_id, l.party_id, l.company_id from public.conta_linea l where l.account_id = (select cuenta from permiso)
    union select x.account_id, x.party_id, x.company_id from public.conta_cliente_paquete x where x.account_id = (select cuenta from permiso)
    union select k.account_id, k.party_id, k.company_id from public.conta_cobro_cliente k where k.account_id = (select cuenta from permiso)
    union select g.account_id, g.party_id, g.company_id from public.conta_gc_cliente g where g.account_id = (select cuenta from permiso) and g.party_id is not null
  ), fila as (
    select c.account_id, c.party_id, v.company_id
      from public.conta_gestoria_cliente c join vinculo v on v.party_id = c.party_id and v.account_id = c.account_id
     where c.account_id = (select cuenta from permiso)
    union all
    select c.account_id, c.party_id, null::uuid from public.conta_gestoria_cliente c
     where c.account_id = (select cuenta from permiso)
       and not exists (select 1 from vinculo v where v.party_id = c.party_id and v.account_id = c.account_id)
  ), mandato as (
    select distinct on (m.company_id, m.gc_cliente_id) m.company_id, m.gc_cliente_id, m.estado from public.conta_gc_mandato m
     where m.account_id = (select cuenta from permiso)
     order by m.company_id, m.gc_cliente_id, m.creado desc nulls last
  ), suscripciones as (
    select s.company_id, s.gc_cliente_id, sum(s.al_mes) as al_mes, count(*) as activas, min(s.proximo_cobro_fecha) as proximo_cobro_fecha
      from public.conta_gc_suscripcion s
     where s.account_id = (select cuenta from permiso) and s.estado = 'active'
     group by s.company_id, s.gc_cliente_id
  ), cargo as (
    select m.company_id, m.gc_cliente_id, b.fecha, b.estado, b.gc_id
      from public.conta_gc_cobro b join public.conta_gc_mandato m on m.company_id = b.company_id and m.gc_id = b.mandato_gc_id
     where b.account_id = (select cuenta from permiso) and m.account_id = (select cuenta from permiso)
  ), ultimo_cobro as (
    select distinct on (k.company_id, k.gc_cliente_id) k.company_id, k.gc_cliente_id, k.fecha from cargo k
     where k.estado in ('paid_out', 'confirmed') order by k.company_id, k.gc_cliente_id, k.fecha desc
  ), ultimo_cargo as (
    -- Dos cargos del mismo día (en QBO, 10 clientes de GoCardless): la vista elegía uno cualquiera. Aquí, fijo: el cobrado, y si no, el gc_id mayor.
    select distinct on (k.company_id, k.gc_cliente_id) k.company_id, k.gc_cliente_id, k.estado from cargo k
     order by k.company_id, k.gc_cliente_id, k.fecha desc, (k.estado in ('paid_out', 'confirmed')) desc, k.gc_id desc
  ), diferencias as (
    select d.party_id, d.company_id, count(*) as n from public.conta_gestoria_diferencia d
     where d.account_id = (select cuenta from permiso) and d.vigente
     group by d.party_id, d.company_id
  ), trabajadores as (
    select l.party_id, l.company_id, array_agg(distinct l.empleado_nombre) as nombres from public.conta_linea l
     where l.account_id = (select cuenta from permiso) and l.empleado_nombre is not null
       and (l.hasta is null or l.hasta >= date_trunc('month', current_date)::date)
     group by l.party_id, l.company_id
  )
  select f.account_id, f.party_id, f.company_id, coalesce(e.trade_name, e.legal_name), p.name, p.tax_id, c.situacion, c.crm, c.tipo_ficha,
         c.id_externo, c.leido_at, c.ficha -> 'telefonos', c.ficha -> 'correos', cc.forma_cobro, cc.gc_cliente_id, md.estado,
         su.al_mes, coalesce(su.activas, 0), su.proximo_cobro_fecha, uc.fecha, ug.estado,
         coalesce(dn.n, 0) + coalesce(de.n, 0), t.nombres
    from fila f
    join public.conta_gestoria_cliente c on c.party_id = f.party_id and c.account_id = f.account_id
    join public.party p on p.id = f.party_id and p.account_id = f.account_id
    left join public.company e on e.id = f.company_id and e.account_id = f.account_id
    left join public.conta_cobro_cliente cc on cc.party_id = f.party_id and cc.company_id = f.company_id and cc.account_id = f.account_id
    left join mandato md on md.company_id = f.company_id and md.gc_cliente_id = cc.gc_cliente_id
    left join suscripciones su on su.company_id = f.company_id and su.gc_cliente_id = cc.gc_cliente_id
    left join ultimo_cobro uc on uc.company_id = f.company_id and uc.gc_cliente_id = cc.gc_cliente_id
    left join ultimo_cargo ug on ug.company_id = f.company_id and ug.gc_cliente_id = cc.gc_cliente_id
    left join diferencias dn on dn.party_id = f.party_id and dn.company_id is null
    left join diferencias de on de.party_id = f.party_id and de.company_id = f.company_id
    left join trabajadores t on t.party_id = f.party_id and t.company_id = f.company_id
   where p.archived_at is null
$$;

create or replace function public.conta_lista_que_hacer(p_cuenta uuid)
returns table (cuenta_id uuid, empresa_id uuid, tipo text, n bigint, euros numeric)
language sql stable security definer set search_path = public as $$
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
    select m.account_id, m.company_id, count(*) as n,
           sum((select sum(s.al_mes) from public.conta_gc_suscripcion s where s.company_id = m.company_id and s.mandato_gc_id = m.gc_id and s.estado = 'active')) as eur
      from public.conta_gc_mandato m
     where m.account_id = (select cuenta from permiso) and m.estado in ('pending_customer_approval', 'pending_submission', 'submitted')
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
$$;

revoke all on function public.conta_lista_clientes(uuid) from public, anon;
revoke all on function public.conta_lista_que_hacer(uuid) from public, anon;
grant execute on function public.conta_lista_clientes(uuid) to authenticated, service_role;
grant execute on function public.conta_lista_que_hacer(uuid) to authenticated, service_role;

comment on function public.conta_lista_clientes(uuid) is
  'G04 · La lista de Clientes: lo mismo que conta_consulta_cliente_empresa, columna a columna. SECURITY DEFINER con una sola comprobación de la cuenta (belongs_to_account) y cada tabla filtrada por ella: con la RLS fila a fila, la vista tardaba 5 s en QBO (0,24 ms por fila leída).';
comment on function public.conta_lista_que_hacer(uuid) is
  'G04 · «Lo que tienes que hacer»: lo mismo que conta_consulta_que_hacer. SECURITY DEFINER con una sola comprobación de la cuenta, como conta_lista_clientes.';
