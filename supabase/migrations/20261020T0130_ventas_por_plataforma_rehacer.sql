-- ============================================================================
-- C04b · Respuesta 5 · SE REHACEN LOS PROPUESTOS DE VENTAS CON LA REGLA NUEVA
-- ----------------------------------------------------------------------------
-- Los asientos de ventas del día de la regla de antes (uno por día y local,
-- unit_key nulo) que siguen «propuesto», en las empresas que usan la regla
-- por plataforma (Foodint desde la 0120), se retiran: se borra el asiento (sus
-- líneas van con él) y su resumen, y queda copia de los dos en
-- _copia_ventas_dia_entero. Ni validados ni borradores: esos no se
-- tocan nunca, y si alguno de los elegidos no es «propuesto» sin número, PARA.
--
-- SIN HUECO (R9, Julio, 13/10): en la MISMA transacción se retira, se
-- propone por unidad (conta_proponer_dias, la del cierre del día) y se
-- comprueba. Cada local×día retirado tiene que quedar con sus asientos por
-- unidad (ningún pedido suyo por asentar) y con el MISMO cobro (las 430, debe
-- menos haber) que el asiento retirado, al céntimo. Si uno no, RAISE: no se
-- aplica nada, ni la retirada. Ningún otro proceso tapa nada más tarde: el
-- 13/10 la versión anterior retiraba y esperaba al cierre de los :07, y la
-- comprobación de después vio el hueco (22 días×local sin asiento).
--
-- LO QUE NO SE PUEDE REHACER NO SE RETIRA: un resumen del día entero sin sus
-- pedidos (sale_ids vacío) no tiene de dónde sacar las unidades; retirarlo
-- sería borrar sin reponer. Se queda como está y el aviso lo dice. (Staging,
-- 13/10: la semilla del C04 tiene uno así, 212 tickets sin lista, y la 0130
-- paró con «0 unidades, 0 pedidos por asentar». En producción, 0 de los 24.)
--
-- SIN descarte, a propósito (como la 0130 del cierre del día): un descarte
-- deja el día fuera para siempre. Sin duplicar: lo retirado ya no está, y la
-- clave de cada unidad es única (0110).
--
-- En producción el 13/10 son 24 (del 01/10 al 12/10, Alcalá y Carabanchel).
-- La migración no los nombra: los encuentra por la regla, y el parte dice
-- cuántos fueron, cuántos asientos por unidad salen y el cobro de cada día.
-- LA COPIA VA EN UNA TABLA PROPIA, _copia_ventas_dia_entero (R11, 13/10). La
-- de la primera versión, _retirado_ventas_por_plataforma, existe ya en
-- producción: la creó el real de las 07:52 y su vuelta atrás la dejó, a
-- propósito, con los 24 retirados de entonces. Esta 0130 no la toca: es el
-- rastro de aquel real. Con la misma tabla, todo lo que creaba este fichero ya
-- existía sin historial y el analizador lo paraba («parece aplicado»), con
-- razón.
-- Borra datos: pide «autorizo».
-- Vuelta atrás: supabase/vuelta-atras/20261020T0130_ventas_por_plataforma_rehacer.down.sql
-- (devuelve los asientos de antes desde la copia, sin esperar al cierre).
-- ============================================================================

create table if not exists public._copia_ventas_dia_entero (
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
alter table public._copia_ventas_dia_entero enable row level security;
revoke all on table public._copia_ventas_dia_entero from anon, authenticated;

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
     and cardinality(d.sale_ids) > 0
     and (p_company is null or e.company_id = p_company)
     and exists (select 1 from public.conta_ventas_canal v where v.company_id = e.company_id)
$$;
comment on function public.conta_propuestos_dia_entero(uuid) is
  'C04b R5: los asientos de ventas propuestos a la antigua (día entero) en empresas que ya usan la regla por plataforma. Solo lee.';
revoke execute on function public.conta_propuestos_dia_entero(uuid) from public, anon, authenticated;

do $$
declare
  v_n     int;
  v_mal   int;
  v_ids   text;
  v_emp   record;
  v_p     jsonb;
  v_falta text;
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
  select string_agg(format('%s %s (%s tickets)', d.sales_day, d.location_id, d.tickets_count), ', ' order by d.sales_day, d.location_id)
    into v_falta
    from public.journal_entry e join public.sales_day_summary d on d.entry_id = e.id
   where e.source_type = 'sales_day' and e.status = 'propuesto' and d.unit_key is null and cardinality(d.sale_ids) = 0
     and exists (select 1 from public.conta_ventas_canal v where v.company_id = e.company_id);
  if v_falta is not null then
    raise notice 'Rehacer las ventas por plataforma: NO se retiran, porque su resumen no tiene sus pedidos y no se pueden rehacer: %', v_falta;
    v_falta := null;
  end if;
  if v_n = 0 then return; end if;

  -- El cobro de cada local×día, ANTES: las 430 del asiento del día entero.
  create temp table _cobro_antes on commit drop as
  select r.company_id, r.location_id, r.sales_day,
         coalesce(sum(l.debit - l.credit) filter (where a.code like '430%'), 0) as cobro
    from _a_rehacer r
    left join public.journal_line l on l.entry_id = r.id
    left join public.company_account a on a.id = l.company_account_id
   group by 1, 2, 3;

  insert into public._copia_ventas_dia_entero (entry_id, company_id, location_id, sales_day, created_at, asiento, resumen, lineas)
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

  -- Proponer por unidad, AHORA: lo mismo que haría el cierre del día a los :07.
  for v_emp in select distinct company_id from _a_rehacer order by 1 loop
    v_p := public.conta_proponer_dias(v_emp.company_id, now());
    raise notice 'Rehacer las ventas por plataforma: empresa %, propuesta por unidad: %', v_emp.company_id, v_p - 'company_id';
  end loop;

  -- Comprobar cada local×día retirado: sus unidades, ningún pedido por asentar
  -- y el mismo cobro, al céntimo.
  with despues as (
    select c.company_id, c.location_id, c.sales_day, c.cobro as antes,
           (select count(*) from public.sales_day_summary d join public.journal_entry j on j.id = d.entry_id
             where d.company_id = c.company_id and d.location_id = c.location_id and d.sales_day = c.sales_day
               and d.unit_key is not null and j.status in ('propuesto', 'borrador', 'validado')) as unidades,
           (select coalesce(sum(l.debit - l.credit), 0)
              from public.sales_day_summary d join public.journal_entry j on j.id = d.entry_id
              join public.journal_line l on l.entry_id = j.id join public.company_account a on a.id = l.company_account_id
             where d.company_id = c.company_id and d.location_id = c.location_id and d.sales_day = c.sales_day
               and d.unit_key is not null and j.status in ('propuesto', 'borrador', 'validado') and a.code like '430%') as cobro,
           (select x.pedidos from public.conta_dias_por_asentar(c.company_id, c.sales_day, c.sales_day) x where x.location_id = c.location_id) as por_asentar,
           (select g.reason from public.sales_day_proposal_log g
             where g.company_id = c.company_id and g.location_id = c.location_id and g.sales_day = c.sales_day) as porque
      from _cobro_antes c
  )
  select string_agg(format('%s %s: %s unidad(es), cobro %s antes y %s ahora, %s pedido(s) por asentar%s',
                           sales_day, location_id, unidades, antes, cobro, coalesce(por_asentar, 0),
                           coalesce(' — ' || porque, '')), ' · ' order by sales_day, location_id)
    into v_falta
    from despues
   where unidades = 0 or cobro <> antes or coalesce(por_asentar, 0) > 0;
  if v_falta is not null then
    raise exception 'Rehacer las ventas por plataforma: no todos los días retirados quedan asentados por unidad con el mismo cobro; no se aplica nada. %', v_falta;
  end if;
  select string_agg(format('%s %s: %s unidad(es)', c.sales_day, c.location_id,
                           (select count(*) from public.sales_day_summary d where d.company_id = c.company_id and d.location_id = c.location_id and d.sales_day = c.sales_day and d.unit_key is not null)),
                    ' · ' order by c.sales_day, c.location_id)
    into v_ids from _cobro_antes c;
  raise notice 'Rehacer las ventas por plataforma: los % día(s) retirados, asentados por unidad con el mismo cobro: %', v_n, v_ids;
end $$;
