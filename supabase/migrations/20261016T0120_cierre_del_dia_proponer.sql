-- ============================================================================
-- El día se cierra a las 6:00 — 3 · NO SE PROPONE UN DÍA SIN CERRAR (regla 2)
-- ----------------------------------------------------------------------------
-- cambia: public.conta_dias_por_asentar · prueba: supabase/staging/sql/20261016_cierre_del_dia_prueba.sql
-- cambia: public.conta_pedidos_del_dia · prueba: supabase/staging/sql/20261016_cierre_del_dia_prueba.sql
--
-- 1. conta_dias_por_asentar ya no devuelve un día que no ha llegado a su hora
--    de cierre: añade «sold_at < conta_cerrado_hasta(p_company)». El 09/10 a
--    las 17:15 de Madrid se propuso el asiento de ese mismo día en
--    Carabanchel (b4eb11ca, se retira en la 0130) con la cena por servir.
-- 2. conta_pedidos_del_dia dice «unconfirmed» del pedido cerrado como no
--    confirmado, en vez de «cancelled»: no es lo mismo que una anulación y la
--    pantalla lo enseña aparte («3 pedidos no confirmados · 71,70 € · no
--    están en estas ventas»). El front de antes no conoce «unconfirmed» y lo
--    deja fuera de todo, que es lo correcto (no es venta).
-- Mismas firmas y mismo resultado para todo lo demás. Ninguna de las dos está
-- en el camino del pedido (solo leen, y solo las llama contabilidad).
-- PARA si alguna no es la medida el 09/10 (md5, igual en producción y staging).
--
-- Vuelta atrás: supabase/vuelta-atras/20261016T0120_cierre_del_dia_proponer.down.sql
-- ============================================================================

create table if not exists public._backup_cierre_del_dia_proponer (
  funcion   text primary key,
  prosrc    text not null,
  md5       text not null,
  saved_at  timestamptz not null default now()
);
alter table public._backup_cierre_del_dia_proponer enable row level security;
revoke all on table public._backup_cierre_del_dia_proponer from anon, authenticated;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure::text f, md5(p.prosrc) m from pg_proc p
            where p.oid in ('public.conta_dias_por_asentar(uuid,date,date)'::regprocedure, 'public.conta_pedidos_del_dia(uuid,uuid,date)'::regprocedure) loop
    if r.m not in ('87ec3f1d01604aba8e0477a869814bc5', 'a4f6598329b5f746f813e7f5a43eb143') then
      raise exception '% no es la medida el 09/10 (md5 %): alguien la ha cambiado; no se toca.', r.f, r.m;
    end if;
  end loop;
  -- La copia, para que la vuelta atrás deje el texto de antes byte a byte.
  insert into public._backup_cierre_del_dia_proponer (funcion, prosrc, md5)
  select p.oid::regprocedure::text, p.prosrc, md5(p.prosrc) from pg_proc p
   where p.oid in ('public.conta_dias_por_asentar(uuid,date,date)'::regprocedure, 'public.conta_pedidos_del_dia(uuid,uuid,date)'::regprocedure)
  on conflict (funcion) do nothing;
end $$;

create or replace function public.conta_dias_por_asentar(p_company uuid, p_desde date, p_hasta date)
returns table (location_id uuid, dia date, pedidos bigint)
language sql stable
set search_path = public
as $$
  select s.location_id, (s.sold_at at time zone 'Europe/Madrid')::date, count(*)
    from public.sale s
    join public.company c on c.id = p_company and c.account_id = s.account_id
    left join public.brand b on b.id = s.brand_id
   where s.is_active and s.status = 'closed' and coalesce(b.ownership_type, 'own') = 'own' and s.location_id is not null
     and s.sold_at >= (p_desde::timestamp at time zone 'Europe/Madrid') and s.sold_at < ((p_hasta + 1)::timestamp at time zone 'Europe/Madrid')
     -- Cierre del día: solo días que ya han llegado a su hora de cierre.
     and s.sold_at < (select public.conta_cerrado_hasta(p_company))
     and not exists (select 1 from public.sales_day_summary d join public.journal_entry e on e.id = d.entry_id
                      where d.company_id = p_company and d.location_id = s.location_id and d.sales_day = (s.sold_at at time zone 'Europe/Madrid')::date
                        and e.status in ('propuesto', 'borrador', 'validado'))
     and not exists (select 1 from public.journal_dismissal x
                      where x.company_id = p_company and x.source_type = 'sales_day'
                        and x.source_key = s.location_id || ':' || (s.sold_at at time zone 'Europe/Madrid')::date)
   group by 1, 2
   order by 2, 1
$$;

create or replace function public.conta_pedidos_del_dia(p_company uuid, p_location uuid, p_dia date)
returns table (id uuid, codigo text, canal_id uuid, marca_id uuid, propia boolean, estado text, total numeric, base numeric, cuota numeric, tipos numeric[])
language sql stable
set search_path = public
as $$
  select s.id, coalesce(s.platform_order_code, s.pos_short_code, s.external_ref), s.channel_id, s.brand_id,
         coalesce(b.ownership_type, 'own') = 'own',
         -- Cierre del día: el no confirmado no es una anulación; se dice aparte.
         case when s.status = 'cancelled' and s.unconfirmed_at is not null then 'unconfirmed' else s.status end,
         s.total, s.taxable_base, s.tax,
         coalesce((select array_agg(distinct (it->>'tax_rate')::numeric)
                     from jsonb_array_elements(case when jsonb_typeof(public.conta_json_seguro(s.raw_tab)->'items') = 'array'
                                                    then public.conta_json_seguro(s.raw_tab)->'items' else '[]'::jsonb end) it
                    where it->>'tax_rate' ~ '^[0-9]+(\.[0-9]+)?$'), '{}')
    from public.sale s
    join public.company c on c.id = p_company and c.account_id = s.account_id
    left join public.brand b on b.id = s.brand_id
   where s.location_id = p_location and s.is_active
     and s.sold_at >= (p_dia::timestamp at time zone 'Europe/Madrid') and s.sold_at < ((p_dia + 1)::timestamp at time zone 'Europe/Madrid')
     and s.status in ('closed', 'cancelled', 'open')
$$;
