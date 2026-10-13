-- ============================================================================
-- C04b · Respuesta 5 · SE REHACEN LOS PROPUESTOS DE VENTAS CON LA REGLA NUEVA
-- ----------------------------------------------------------------------------
-- Los asientos de ventas del día de la regla de antes (uno por día y local,
-- unit_key nulo) que siguen «propuesto», en las empresas que usan la regla
-- por plataforma (Foodint desde la 0120), se retiran: se borra el asiento (sus
-- líneas van con él) y su resumen, y queda copia de los dos en
-- _retirado_ventas_por_plataforma. Ni validados ni borradores: esos no se
-- tocan nunca, y si alguno de los elegidos no es «propuesto» sin número, PARA.
--
-- SIN descarte, a propósito (como la 0130 del cierre del día): un descarte
-- deja el día fuera para siempre. Aquí el día se vuelve a proponer, por
-- unidad, en la siguiente pasada del cierre del día (cada hora, a los 7
-- minutos): mismos días, mismos locales y mismos pedidos, un asiento por
-- plataforma (Glovo, por marca). Sin duplicar: lo retirado ya no está, y la
-- clave de cada unidad es única (0110).
--
-- En producción el 13/10 son 24 (del 01/10 al 12/10, Alcalá y Carabanchel;
-- el informe R5 decía 22 y el cierre propuso dos más el 12/10). La migración
-- no los nombra: los encuentra por la regla, y el parte dice cuántos fueron.
-- Borra datos: pide «autorizo».
-- Vuelta atrás: supabase/vuelta-atras/20261020T0130_ventas_por_plataforma_rehacer.down.sql
-- (no devuelve los asientos de antes: con la regla nueva se proponen por unidad).
-- ============================================================================

create table if not exists public._retirado_ventas_por_plataforma (
  entry_id     uuid primary key,
  company_id   uuid not null,
  location_id  uuid,
  sales_day    date not null,
  created_at   timestamptz not null,
  asiento      jsonb not null,
  resumen      jsonb not null,
  lineas       jsonb not null,
  retirado_at  timestamptz not null default now()
);
alter table public._retirado_ventas_por_plataforma enable row level security;
revoke all on table public._retirado_ventas_por_plataforma from anon, authenticated;

-- La selección, en una función de solo lectura: la usan esta migración y la
-- prueba de staging, para que lo que se prueba sea lo que se aplica.
create or replace function public.conta_propuestos_dia_entero(p_company uuid default null)
returns table (entry_id uuid, summary_id uuid, company_id uuid, location_id uuid, sales_day date, created_at timestamptz, status text, number int)
language sql stable
set search_path = public
as $$
  select e.id, d.id, e.company_id, d.location_id, d.sales_day, e.created_at, e.status, e.number
    from public.journal_entry e
    join public.sales_day_summary d on d.entry_id = e.id
   where e.source_type = 'sales_day'
     and e.status = 'propuesto'
     and d.unit_key is null
     and (p_company is null or e.company_id = p_company)
     and exists (select 1 from public.conta_ventas_canal v where v.company_id = e.company_id)
$$;
comment on function public.conta_propuestos_dia_entero(uuid) is
  'C04b R5: los asientos de ventas propuestos a la antigua (día entero) en empresas que ya usan la regla por plataforma. Solo lee.';
revoke execute on function public.conta_propuestos_dia_entero(uuid) from public, anon, authenticated;

do $$
declare
  v_n   int;
  v_mal int;
  v_ids text;
begin
  create temp table _a_rehacer on commit drop as
  select x.entry_id as id, x.summary_id, x.company_id, x.location_id, x.sales_day, x.created_at, x.status, x.number
    from public.conta_propuestos_dia_entero() x;

  select count(*), count(*) filter (where status <> 'propuesto' or number is not null), string_agg(sales_day || ' ' || coalesce(location_id::text, '—'), ', ' order by sales_day, location_id)
    into v_n, v_mal, v_ids from _a_rehacer;
  if v_mal > 0 then
    raise exception 'Rehacer las ventas por plataforma: % no son «propuesto» sin número; no se toca nada.', v_mal;
  end if;
  raise notice 'Rehacer las ventas por plataforma: % asiento(s) del día entero: %', v_n, coalesce(v_ids, 'ninguno');

  insert into public._retirado_ventas_por_plataforma (entry_id, company_id, location_id, sales_day, created_at, asiento, resumen, lineas)
  select r.id, r.company_id, r.location_id, r.sales_day, r.created_at,
         (select to_jsonb(e) from public.journal_entry e where e.id = r.id),
         (select to_jsonb(d) from public.sales_day_summary d where d.id = r.summary_id),
         coalesce((select jsonb_agg(to_jsonb(l) order by l.position) from public.journal_line l where l.entry_id = r.id), '[]')
    from _a_rehacer r
  on conflict (entry_id) do nothing;

  delete from public.journal_entry e using _a_rehacer r where e.id = r.id;
  delete from public.sales_day_summary d using _a_rehacer r where d.id = r.summary_id and d.entry_id is null;

  if exists (select 1 from public.journal_entry e join _a_rehacer r on r.id = e.id)
     or exists (select 1 from public.sales_day_summary d join _a_rehacer r on r.summary_id = d.id) then
    raise exception 'Rehacer las ventas por plataforma: alguno sigue ahí.';
  end if;
end $$;
