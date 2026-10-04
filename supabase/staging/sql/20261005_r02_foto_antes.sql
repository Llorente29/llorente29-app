-- ============================================================================
-- SOLO STAGING-CONTA · R02 · LA FOTO DE ANTES (prueba de 0 diferencias, 1/2)
-- ----------------------------------------------------------------------------
-- Respuesta 1, punto 1: «el resultado de la resolución antes y después es
-- idéntico para todas las marcas y plataformas». Aquí se mide el ANTES, con
-- las funciones de hoy de verdad (no con una fórmula que las imita: regla 10).
--
-- CÓMO SE MIDE, la misma vara antes y después (regla 31)
-- Para cada marca × canal de reparto × local de staging, y para cada entrada
-- (HubRise y Last), con y sin dirección, se SIMULA un pedido que entra:
--   1. se inserta una venta con el service_type con el que la manda hoy la
--      entrada: HubRise = lo que dice channel_delivery_policy para (cuenta,
--      canal, tipo de marca), o platform si no hay fila (resolveDeliveryServiceType
--      del hubrise-webhook); Last = lo que diga Last (se prueban los dos);
--   2. pasa por los disparadores de la base (el de entrada lo corrige);
--   3. se pregunta a resolve_dispatch.
-- «Quién reparte» = `own` si queda own_delivery y resolve_dispatch da
-- transportista; `own_sin_dir` si queda own_delivery sin dirección (hoy rojo,
-- con el R02 ámbar: la misma decisión, otra pintura); `platform` en otro caso.
-- La venta se deshace (sub-bloque con excepción): no queda ninguna.
--
-- Deja la foto en r02_prueba.foto (momento = 'antes'). La foto de después y la
-- comparación están en 20261005_r02_prueba_cero_diferencias.sql.
-- ============================================================================

create schema if not exists r02_prueba;

create table if not exists r02_prueba.foto (
  momento      text not null,
  account_id   uuid not null,
  brand_id     uuid not null,
  marca        text not null,
  canal        text not null,
  location_id  uuid not null,
  entrada      text not null,   -- hubrise | lastapp
  st_entrada   text not null,   -- el service_type con el que lo manda la entrada
  con_dir      boolean not null,
  st_final     text,            -- el que queda tras los disparadores
  carrier      text,
  reason       text,
  quien        text not null,
  primary key (momento, brand_id, canal, location_id, entrada, st_entrada, con_dir)
);

-- Una simulación: inserta, lee, pregunta y lo deshace todo.
create or replace function r02_prueba.simular(
  p_account uuid, p_brand uuid, p_channel uuid, p_location uuid,
  p_entrada text, p_st text, p_con_dir boolean
)
returns table (st_final text, carrier text, reason text)
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
  v_st text; v_carrier text; v_reason text;
begin
  begin
    insert into public.sale (id, account_id, location_id, brand_id, channel_id, source, sold_at, total,
                             status, order_status, service_type, delivery_address, raw_tab)
    values (v_id, p_account, p_location, p_brand, p_channel, p_entrada, now(), 10,
            'open', 'new', p_st,
            case when p_con_dir then 'Calle de Prueba 1, 28000 Madrid' end,
            '{"service_type":"delivery"}');
    select s.service_type into v_st from public.sale s where s.id = v_id;
    select d.carrier, d.reason into v_carrier, v_reason from public.resolve_dispatch(v_id) d;
    raise exception 'r02_deshacer';
  exception when raise_exception then
    if sqlerrm <> 'r02_deshacer' then raise; end if;
  end;
  return query select v_st, v_carrier, v_reason;
end;
$$;

delete from r02_prueba.foto where momento = 'antes';

with celdas as (
  select b.account_id, b.id as brand_id, b.name as marca, coalesce(b.ownership_type, 'own') as tipo,
         sc.id as channel_id, sc.slug as canal, l.id as location_id
    from public.brand b
    join public.sales_channel sc on sc.account_id = b.account_id and sc.channel_type = 'delivery'
                                and coalesce(btrim(sc.slug), '') <> ''
    join public.locations l on l.account_id = b.account_id
),
casos as (
  -- HubRise: lo que manda hoy el webhook.
  select c.*, 'hubrise'::text as entrada,
         coalesce((select pol.service_type from public.channel_delivery_policy pol
                    where pol.account_id = c.account_id and pol.channel_slug = c.canal
                      and pol.ownership_type = c.tipo and pol.location_id is null),
                  'platform_delivery') as st_entrada
    from celdas c
  union all
  -- Last: decide Last; se prueban las dos.
  select c.*, 'lastapp', st from celdas c cross join (values ('own_delivery'), ('platform_delivery')) v(st)
)
insert into r02_prueba.foto
select 'antes', k.account_id, k.brand_id, k.marca, k.canal, k.location_id, k.entrada, k.st_entrada, d.con_dir,
       s.st_final, s.carrier, s.reason,
       case when s.st_final = 'own_delivery' and s.carrier is not null then 'own'
            when s.st_final = 'own_delivery' and not d.con_dir then 'own_sin_dir'
            else 'platform' end
  from casos k
 cross join (values (true), (false)) d(con_dir)
 cross join lateral r02_prueba.simular(k.account_id, k.brand_id, k.channel_id, k.location_id,
                                       k.entrada, k.st_entrada, d.con_dir) s;

select count(*) as casos_medidos,
       count(*) filter (where quien = 'own') as own,
       count(*) filter (where quien = 'own_sin_dir') as own_sin_dir,
       count(*) filter (where quien = 'platform') as platform
  from r02_prueba.foto where momento = 'antes';

select l.name as local, f.marca, f.canal, f.entrada, f.st_entrada, f.con_dir, f.quien, coalesce(f.reason, '—') as motivo
  from r02_prueba.foto f
  join public.locations l on l.id = f.location_id
 where f.momento = 'antes'
 order by l.name, f.marca, f.canal, f.entrada, f.st_entrada, f.con_dir;
