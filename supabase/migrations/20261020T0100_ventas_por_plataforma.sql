-- ============================================================================
-- C04b · Respuesta 5 · LA REGLA DE VENTAS DEFINITIVA (Julio, 13/10)
-- ----------------------------------------------------------------------------
-- cambia: public.conta_dias_por_asentar · prueba: supabase/staging/sql/20261020_ventas_por_plataforma_prueba.sql
-- cambia: public._journal_entry_proponer · prueba: supabase/staging/sql/20261020_ventas_por_plataforma_prueba.sql
-- cambia: public.conta_proponer_dias · prueba: supabase/staging/sql/20261020_ventas_por_plataforma_prueba.sql
-- cambia: public.journal_entry_descartar · prueba: supabase/staging/sql/20261020_ventas_por_plataforma_prueba.sql
--
-- La regla (respuesta 5, las cuatro de Julio):
--   · Uber Eats y Just Eat: UN asiento por plataforma, local y día.
--   · Glovo: UN asiento por marca, plataforma, local y día.
--   · La venta bruta, a la subcuenta de la marca (7000000x); el reembolso al
--     cliente, aparte, a la suya (7080000x). Nada de 70000000 para Glovo.
--   · El IVA, a la 477 del tipo (47700010), no a 47700000.
--
-- Lo que hace este fichero (solo AÑADE, salvo las cuatro de arriba, que se
-- reemplazan con la misma firma):
--   1. conta_ventas_canal: qué canales van por marca, por empresa. Sin fila, el
--      canal va en un asiento (Uber, Just Eat, la sala). Que una empresa tenga
--      filas es lo que dice que usa la regla nueva.
--   2. conta_ventas_marca: la subcuenta de ventas y la de reembolsos de cada
--      marca, por empresa. La que falte va a la general y la propuesta lo dice
--      («Mira esto», Duda): no se esconde.
--   3. sales_day_summary: unit_key, channel_id y brand_id (admiten nulos).
--      unit_key nulo = un resumen del día entero (la regla de antes).
--   4. conta_unidad_ventas: la clave de la unidad de un pedido (canal, o
--      canal:marca). La misma que claveDeUnidad del núcleo.
--   5. conta_propuesta_ventas_unidad: la propuesta de UNA unidad (espejo de
--      ventasDelDia con `unidad`), y conta_propuestas_ventas_dia, todas las del
--      día y el local. Solo leen. conta_propuesta_ventas_dia (la de antes) no
--      se toca: la sigue usando la comparación de paridad con el núcleo.
--   6. conta_dias_por_asentar: un día está asentado cuando cada unidad de sus
--      pedidos tiene asiento vivo (o el día entero lo tiene a la antigua).
--   7. _journal_entry_proponer: con unit_key, la clave es día:local:unidad;
--      sin ella, como antes, pero en una empresa con la regla nueva se NIEGA
--      (con su porqué, regla 8): así el front de antes no puede colar un
--      asiento del día entero al lado de los de cada plataforma.
--   8. conta_proponer_dias: propone cada unidad; en el registro del día queda
--      lo peor que pasó y el porqué de cada unidad.
--   9. journal_entry_descartar: el descarte de una unidad no descarta el día.
--
-- El índice único del resumen (un resumen por día y local) no deja dos
-- unidades el mismo día: se cambia en la 0110, que pide «autorizo». Hasta
-- entonces esta no propone nada nuevo para nadie: ninguna empresa tiene filas
-- en conta_ventas_canal (las de Foodint las pone la 0120).
--
-- PARA si alguna de las cuatro que cambian no es la medida en producción el
-- 13/10 (md5 de prosrc, solo lectura).
-- Vuelta atrás: supabase/vuelta-atras/20261020T0100_ventas_por_plataforma.down.sql
-- ============================================================================

create table if not exists public._backup_ventas_por_plataforma (
  funcion   text primary key,
  prosrc    text not null,
  md5       text not null,
  saved_at  timestamptz not null default now()
);
alter table public._backup_ventas_por_plataforma enable row level security;
revoke all on table public._backup_ventas_por_plataforma from anon, authenticated;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure::text f, md5(p.prosrc) m from pg_proc p
            where p.oid in ('public.conta_dias_por_asentar(uuid,date,date)'::regprocedure,
                            'public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)'::regprocedure,
                            'public.conta_proponer_dias(uuid,timestamptz,text)'::regprocedure,
                            'public.journal_entry_descartar(uuid,text,text)'::regprocedure) loop
    if r.m not in ('a0744c920f5c6a02795a51f121b08c8f', 'c7ff774380321a47fbfe312e5311f78f', 'c7b96fb80e8f5678afcb4c82c599a3a1', '99aab762ab3369fcf2531375ab2a4790') then
      raise exception '% no es la medida el 13/10 (md5 %): alguien la ha cambiado; no se toca.', r.f, r.m;
    end if;
  end loop;
  insert into public._backup_ventas_por_plataforma (funcion, prosrc, md5)
  select p.oid::regprocedure::text, p.prosrc, md5(p.prosrc) from pg_proc p
   where p.oid in ('public.conta_dias_por_asentar(uuid,date,date)'::regprocedure,
                   'public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)'::regprocedure,
                   'public.conta_proponer_dias(uuid,timestamptz,text)'::regprocedure,
                   'public.journal_entry_descartar(uuid,text,text)'::regprocedure)
  on conflict (funcion) do nothing;
end $$;

-- ── 1 y 2 · La regla, por empresa ──────────────────────────────────────────
create table if not exists public.conta_ventas_canal (
  company_id  uuid not null references public.company(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  channel_id  uuid not null references public.sales_channel(id) on delete cascade,
  por_marca   boolean not null,
  created_at  timestamptz not null default now(),
  created_by_name text,
  primary key (company_id, channel_id)
);
comment on table public.conta_ventas_canal is
  'C04b R5: cómo asienta las ventas cada canal en una empresa. por_marca = un asiento por marca, local y día (Glovo); si no, uno por canal, local y día. Que la empresa tenga filas aquí es lo que dice que usa la regla por plataforma.';

create table if not exists public.conta_ventas_marca (
  company_id          uuid not null references public.company(id) on delete cascade,
  account_id          uuid not null references public.accounts(id) on delete cascade,
  brand_id            uuid not null references public.brand(id) on delete cascade,
  papel               text not null check (papel in ('ventas', 'devoluciones')),
  company_account_id  uuid not null references public.company_account(id) on delete restrict,
  created_at          timestamptz not null default now(),
  created_by_name     text,
  primary key (company_id, brand_id, papel)
);
comment on table public.conta_ventas_marca is
  'C04b R5: la subcuenta de ventas (7000000x) y la de reembolsos (7080000x) de cada marca propia, por empresa.';

alter table public.conta_ventas_canal enable row level security;
alter table public.conta_ventas_marca enable row level security;
drop policy if exists conta_ventas_canal_select on public.conta_ventas_canal;
create policy conta_ventas_canal_select on public.conta_ventas_canal for select to authenticated
  using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists conta_ventas_marca_select on public.conta_ventas_marca;
create policy conta_ventas_marca_select on public.conta_ventas_marca for select to authenticated
  using (account_id = any ((select public.current_user_account_ids())::uuid[]));
-- Sin políticas de escritura: las escribe una migración (0120) hasta que haya pantalla.
revoke all on table public.conta_ventas_canal from anon;
revoke all on table public.conta_ventas_marca from anon;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise notice 'conta_lectura no existe aquí (staging): no se da nada.';
    return;
  end if;
  -- Para cuando el agente del Libro mire unidad a unidad (ahora mira el día).
  grant select on table public.conta_ventas_canal, public.conta_ventas_marca to conta_lectura;
end $$;

-- ── 3 · La unidad del resumen ──────────────────────────────────────────────
alter table public.sales_day_summary add column if not exists unit_key text;
alter table public.sales_day_summary add column if not exists channel_id uuid;
alter table public.sales_day_summary add column if not exists brand_id uuid;
comment on column public.sales_day_summary.unit_key is
  'C04b R5: la unidad del asiento dentro del día y el local: el canal, o canal:marca (claveDeUnidad del núcleo). Nulo = el día entero (la regla de antes).';

-- ── 4 · La clave de la unidad de un pedido ─────────────────────────────────
create or replace function public.conta_unidad_ventas(p_company uuid, p_canal uuid, p_marca uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(p_canal::text, 'sin-canal')
      || case when p_marca is not null and exists (select 1 from public.conta_ventas_canal v
                                                    where v.company_id = p_company and v.channel_id = p_canal and v.por_marca)
              then ':' || p_marca::text else '' end
$$;
revoke all on function public.conta_unidad_ventas(uuid, uuid, uuid) from public, anon, authenticated;

-- ── 5 · La propuesta de una unidad ─────────────────────────────────────────
-- Espejo de ventasDelDia con `unidad` (asientosPropuestos.ts): la misma regla
-- que conta_propuesta_ventas_dia, con los pedidos y reembolsos de la unidad,
-- la subcuenta de cada marca y la marca escrita en la línea.
create or replace function public.conta_propuesta_ventas_unidad(p_company uuid, p_location uuid, p_dia date, p_canal uuid, p_marca uuid)
returns jsonb language sql stable security definer set search_path = public as $$
with
emp as (
  select c.id, c.account_id, t.sales_tax_rate_code from public.company c
    left join public.company_tax_profile t on t.company_id = c.id
   where c.id = p_company
),
tipo as (
  select r.id, r.rate, public.conta_numero_texto(r.rate) as txt from public.tax_rate r, emp
   where r.code = emp.sales_tax_rate_code and r.tax_system = 'iva' and r.valid_to is null
     and (r.is_system or r.account_id = emp.account_id)
   order by r.is_system, r.id limit 1
),
hoja as (
  select a.template_code, min(a.code) as code from public.company_account a
   where a.company_id = p_company and a.kind = 'template' and a.status is distinct from 'cerrada' and a.template_code in ('700', '708')
   group by 1
),
cta as (
  select (select code from hoja where template_code = '700') as ventas,
         coalesce((select code from hoja where template_code = '708'), (select code from hoja where template_code = '700')) as devoluciones,
         (select a.code from public.company_account_link k join public.company_account a on a.id = k.company_account_id, tipo
           where k.company_id = p_company and k.entity = 'tax_rate' and k.entity_id = tipo.id::text and k.role = 'repercutido'
           order by a.code limit 1) as iva477
),
marca_cta as (
  select m.brand_id, m.papel, a.code from public.conta_ventas_marca m join public.company_account a on a.id = m.company_account_id
   where m.company_id = p_company and a.status is distinct from 'cerrada'
),
canal as (
  select ch.id, ch.name,
         (select a.code from public.party_role pr
            join public.company_account_link k on k.company_id = p_company and k.entity = 'customer' and k.entity_id = pr.party_id::text and k.role = 'principal'
            join public.company_account a on a.id = k.company_account_id
           where pr.account_id = ch.account_id and pr.role = 'platform' and pr.channel_id = ch.id
           order by pr.party_id, a.code limit 1) as cuenta
    from public.sales_channel ch, emp where ch.account_id = emp.account_id
),
nombre_canal as (select case when p_canal is null then 'sin canal' else coalesce((select name from canal where id = p_canal), 'un canal') end as n),
marca_nombre as (select b.id, b.name from public.brand b, emp where b.account_id = emp.account_id),
loc as (select coalesce((select l.name from public.locations l, emp where l.id = p_location and l.account_id = emp.account_id), 'local') as nombre),
ped as (
  select x.* from public.conta_pedidos_del_dia(p_company, p_location, p_dia) with ordinality as x(id, codigo, canal_id, marca_id, propia, estado, total, base, cuota, tipos, ord)
   where x.canal_id is not distinct from p_canal and (p_marca is null or x.marca_id = p_marca)
),
fila as (
  select p.*,
         (p.base is not null and p.cuota is not null and round(p.base * 100) + round(p.cuota * 100) = round(p.total * 100)) as trae,
         exists (select 1 from unnest(p.tipos) t where t <> tipo.rate) as otro,
         round(p.total * 100) as c_total,
         case when p.base is not null and p.cuota is not null and round(p.base * 100) + round(p.cuota * 100) = round(p.total * 100)
              then round(p.base * 100)
              else sign(p.total) * round(abs(round(p.total * 100)) * 100 / (100 + tipo.rate)) end as c_base
    from ped p, tipo where p.propia and p.estado = 'closed'
),
fila2 as (
  select f.*, case when f.trae then round(f.cuota * 100) else f.c_total - f.c_base end as c_cuota from fila f
),
dev as (
  select o.*, round(o.importe * 100) as c_imp,
         sign(o.importe) * round(abs(round(o.importe * 100)) * 100 / (100 + tipo.rate)) as c_base
    from public.conta_devoluciones_del_dia(p_company, p_location, p_dia) with ordinality as o(pedido_id, codigo, canal_id, marca_id, propia, importe, ord), tipo
   where o.propia and o.canal_id is not distinct from p_canal and (p_marca is null or o.marca_id = p_marca)
),
dev2 as (select d.*, d.c_imp - d.c_base as c_cuota, coalesce(d.codigo, d.pedido_id::text) as ref from dev d),
tot as (
  select count(*) as n, coalesce(sum(c_total), 0) as c_total, coalesce(sum(c_base), 0) as c_base, coalesce(sum(c_cuota), 0) as c_cuota,
         bool_or(not trae) as calculada, count(*) filter (where otro) as otro
    from fila2
),
por_marca as (select marca_id, sum(c_base) as c, min(ord) as o from fila2 group by marca_id),
sin_cuenta as (
  select nombre_canal.n as nombre from nombre_canal
   where ((select count(*) from fila2) > 0 or (select count(*) from dev2) > 0)
     and (p_canal is null or (select cuenta from canal where canal.id = p_canal) is null)
),
sin_subcuenta as (  -- marcas sin su 7000000x o su 7080000x, en orden de aparición y sin repetir
  select coalesce((select name from marca_nombre where id = z.marca_id), case when z.marca_id is null then 'sin marca' else 'una marca' end) as nombre, min(z.o) as o
    from (select pm.marca_id, pm.o from por_marca pm
           where pm.marca_id is null or not exists (select 1 from marca_cta mc where mc.brand_id = pm.marca_id and mc.papel = 'ventas')
          union all
          select d.marca_id, 100000000 + d.ord from dev2 d
           where d.marca_id is null or not exists (select 1 from marca_cta mc where mc.brand_id = d.marca_id and mc.papel = 'devoluciones')) z
   group by 1
),
cnt as (
  select (select count(*) from ped where not propia and estado = 'closed') as cedidas,
         (select coalesce(sum(round(total * 100)), 0) from ped where not propia and estado = 'closed') as c_cedidas,
         (select count(*) from ped where estado = 'cancelled') as cancelados,
         (select count(*) from ped where estado = 'open' and propia) as abiertos,
         (select count(*) from dev2) as devs,
         (select coalesce(sum(c_imp), 0) from dev2) as c_devs
),
lineas as (
  select jsonb_agg(l.j order by l.k1, l.k2, l.k3) as j from (
    select 1 as k1, 0 as k2, 0 as k3, jsonb_build_object('cuenta', (select cuenta from canal where canal.id = p_canal), 'debe', round(tot.c_total / 100, 2), 'haber', 0,
             'concepto', 'Cobra ' || nombre_canal.n,
             'local_id', p_location, 'comun', false, 'marca_id', null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null) as j
      from tot, nombre_canal where tot.n > 0
    union all
    select 2, pm.o, 0, jsonb_build_object('cuenta', coalesce((select code from marca_cta mc where mc.brand_id = pm.marca_id and mc.papel = 'ventas'), cta.ventas),
             'debe', 0, 'haber', round(pm.c / 100, 2),
             'concepto', 'Ventas ' || coalesce((select name from marca_nombre where id = pm.marca_id), case when pm.marca_id is null then 'sin marca' else 'una marca' end),
             'local_id', p_location, 'comun', false, 'marca_id', pm.marca_id, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null)
      from por_marca pm, cta
    union all
    select 3, 0, 0, jsonb_build_object('cuenta', cta.iva477, 'debe', 0, 'haber', round(tot.c_cuota / 100, 2), 'concepto', 'IVA repercutido ' || tipo.txt || ' %',
             'local_id', p_location, 'comun', false, 'marca_id', null, 'tercero_id', null, 'documento', null,
             'iva', jsonb_build_object('tipo_id', tipo.id, 'base', round(tot.c_base / 100, 2), 'libro', 'issued', 'deducible', null, 'facturas', tot.n), 'retencion', null)
      from tot, cta, tipo where tot.n > 0
    union all
    select 4, d.ord, 1, jsonb_build_object('cuenta', coalesce((select code from marca_cta mc where mc.brand_id = d.marca_id and mc.papel = 'devoluciones'), cta.devoluciones),
             'debe', round(d.c_base / 100, 2), 'haber', 0,
             'concepto', 'Reembolso al cliente · ' || coalesce((select name from marca_nombre where id = d.marca_id), case when d.marca_id is null then 'sin marca' else 'una marca' end)
                         || ' · pedido ' || coalesce(d.ref, 'sin código'),
             'local_id', p_location, 'comun', false, 'marca_id', d.marca_id, 'tercero_id', null, 'documento', d.ref, 'iva', null, 'retencion', null)
      from dev2 d, cta
    union all
    select 4, d.ord, 2, jsonb_build_object('cuenta', cta.iva477, 'debe', round(d.c_cuota / 100, 2), 'haber', 0, 'concepto', trim('IVA del reembolso ' || coalesce(d.ref, '')),
             'local_id', p_location, 'comun', false, 'marca_id', null, 'tercero_id', null, 'documento', d.ref,
             'iva', jsonb_build_object('tipo_id', tipo.id, 'base', round(d.c_base / 100, 2), 'libro', 'issued', 'deducible', null, 'facturas', 1), 'retencion', null)
      from dev2 d, cta, tipo
    union all
    select 4, d.ord, 3, jsonb_build_object('cuenta', (select cuenta from canal where canal.id = p_canal), 'debe', 0, 'haber', round(d.c_imp / 100, 2),
             'concepto', 'Devuelve ' || nombre_canal.n,
             'local_id', p_location, 'comun', false, 'marca_id', null, 'tercero_id', null, 'documento', d.ref, 'iva', null, 'retencion', null)
      from dev2 d, nombre_canal
  ) l
),
razones as (
  select jsonb_agg(r.j order by r.k) as j from (
    select 1 as k, jsonb_build_object('decision', tot.n || ' ticket' || case when tot.n = 1 then '' else 's' end || ' de tus marcas, ' || public.conta_euros_exactos(round(tot.c_total / 100, 2)),
             'porque', 'una factura simplificada por pedido, anotadas juntas en un asiento resumen del día con base y cuota por tipo',
             'cita', 'Código de Comercio, art. 28.2; RD 1624/1992 (Reglamento del IVA), art. 63.4') as j from tot
    union all
    select 2, jsonb_build_object('decision', 'IVA al ' || tipo.txt || ' %', 'porque', 'reparto de comida = servicio de restauración: criterio de tu empresa',
             'cita', 'Ley 37/1992, art. 91.Uno.2.2.º') from tipo
    union all
    select 3, jsonb_build_object('decision', cnt.devs || ' devolución' || case when cnt.devs = 1 then '' else 'es' end || ' de ' || public.conta_euros_exactos(round(cnt.c_devs / 100, 2)),
             'porque', 'la plataforma devolvió al cliente después de la venta: menos venta y menos IVA, contra lo que cobra la plataforma, el día en que se produce',
             'cita', 'Ley 37/1992, art. 80.Dos') from cnt where cnt.devs > 0
    union all
    select 4, jsonb_build_object('decision', 'Base calculada',
             'porque', 'algún pedido no trae la base imponible: la calculo del total al ' || tipo.txt || ' % (el tipo de tus ventas); no la invento, la deduzco y lo digo')
      from tot, tipo where tot.calculada
    union all
    select 5, jsonb_build_object('decision', 'Fuera: ' || cnt.cedidas || ' pedidos de marcas cedidas (' || public.conta_euros_exactos(round(cnt.c_cedidas / 100, 2)) || ')',
             'porque', 'son ventas del socio y su IVA es del socio: entran solo en su liquidación mensual, que comparas con estos tickets',
             'cita', 'Ley 37/1992, art. 11.Dos.15.º') from cnt where cnt.cedidas > 0
    union all
    select 6, jsonb_build_object('decision', 'Fuera: ' || cnt.cancelados || ' cancelado' || case when cnt.cancelados = 1 then '' else 's' end,
             'porque', 'cancelado antes de entregar no es venta') from cnt where cnt.cancelados > 0
    union all  -- los avisos van detrás, como «Mira esto», en el orden del núcleo: otro tipo y después la subcuenta
    select 7, jsonb_build_object('decision', 'Mira esto',
             'porque', tot.otro || ' pedido' || case when tot.otro = 1 then ' trae' else 's traen' end || ' en sus líneas un tipo distinto del ' || tipo.txt || ' %: mira cuáles antes de validar.')
      from tot, tipo where tot.otro > 0
    union all
    select 8, jsonb_build_object('decision', 'Mira esto',
             'porque', (select string_agg(nombre, ', ' order by o) from sin_subcuenta)
                       || case when (select count(*) from sin_subcuenta) = 1 then ' no tiene' else ' no tienen' end
                       || ' su subcuenta de ventas o de reembolsos: va a la general (' || cta.ventas || ' / ' || cta.devoluciones || '). Enlázala antes de validar.')
      from cta where exists (select 1 from sin_subcuenta)
  ) r
),
resumen as (
  select jsonb_build_object(
    'location_id', p_location, 'sales_day', p_dia,
    'unit_key', coalesce(p_canal::text, 'sin-canal') || coalesce(':' || p_marca::text, ''), 'channel_id', p_canal, 'brand_id', p_marca,
    'tickets_count', tot.n, 'total', round(tot.c_total / 100, 2),
    'by_rate', jsonb_build_array(jsonb_build_object('tax_rate_id', tipo.id, 'rate', public.conta_numero_texto(tipo.rate)::numeric, 'base', round(tot.c_base / 100, 2), 'cuota', round(tot.c_cuota / 100, 2), 'calculated', coalesce(tot.calculada, false))),
    'by_channel', case when tot.n > 0 then jsonb_build_array(jsonb_build_object('channel_id', p_canal, 'total', round(tot.c_total / 100, 2))) else '[]'::jsonb end,
    'by_brand', coalesce((select jsonb_agg(jsonb_build_object('brand_id', marca_id, 'base', round(c / 100, 2)) order by o) from por_marca), '[]'),
    'detail_hash', encode(sha256(convert_to(
        coalesce((select string_agg(id::text, '|' order by id::text collate "C") from fila2), '') || '#' || tot.c_total::bigint::text, 'UTF8')), 'hex'),
    'sale_ids', coalesce((select jsonb_agg(id order by id::text collate "C") from fila2), '[]'),
    'base_calculated', coalesce(tot.calculada, false)) as j
  from tot left join tipo on true
)
select case
  when (select id from tipo) is null or cta.iva477 is null or cta.ventas is null then
    jsonb_build_object('sin_propuesta', 'Falta el IVA de tus ventas (Tu empresa) o su 477, o la 700 en el plan.')
  when tot.n = 0 and cnt.devs = 0 then
    jsonb_build_object('sin_propuesta', case when cnt.cedidas > 0 then 'Ese día solo hubo ventas de marcas cedidas: van en la liquidación del socio.' else 'Ese día no hubo ventas de tus marcas.' end)
  when cnt.abiertos > 0 then
    jsonb_build_object('sin_propuesta', 'El cierre del día aún no ha pasado por este día: ' || cnt.abiertos || ' pedido' || case when cnt.abiertos = 1 then '' else 's' end
      || ' de tus marcas ' || case when cnt.abiertos = 1 then 'sigue abierto' else 'siguen abiertos' end || '. Pasa cada hora a los 7 minutos; vuelve a proponer después.')
  when exists (select 1 from sin_cuenta) then
    jsonb_build_object('sin_propuesta', 'No sé a qué cuenta va lo que cobra ' || (select nombre from sin_cuenta)
      || ': enlaza su 430 en su ficha (Clientes y proveedores › Plataformas).')
  when tot.n > 0 and abs(tot.c_cuota - sign(tot.c_base) * round(abs(tot.c_base * (select rate from tipo)) / 100)) > floor(0.55 * tot.n + 0.5) then
    jsonb_build_object('sin_propuesta', 'La cuota de los tickets (' || public.conta_euros_exactos(round(tot.c_cuota / 100, 2)) || ') se aleja de la base × '
      || (select txt from tipo) || ' % más de medio céntimo por ticket: hay pedidos con otro tipo.')
  else jsonb_build_object(
    'entrada', jsonb_build_object(
      'series', 1, 'fecha', p_dia,
      'concepto', 'Ventas ' || nombre_canal.n || coalesce(' · ' || (select name from marca_nombre where id = p_marca), '') || ' · ' || loc.nombre,
      'source_type', 'sales_day', 'source_id', null,
      'confianza', case when tot.otro > 0 or exists (select 1 from sin_subcuenta) then 'duda' when tot.calculada then 'probable' else 'seguro' end,
      'porque', tot.n || ' tickets de tus marcas en ' || nombre_canal.n || ' cuadran con lo que cobra, al céntimo'
                || case when tot.calculada then '; base calculada al ' || (select txt from tipo) || ' %' else '' end || '.',
      'razones', razones.j, 'party_id', null, 'documento', null),
    'lineas', lineas.j,
    'resumen', resumen.j)
  end
from tot, cnt, cta, loc, lineas, razones, resumen, nombre_canal
$$;
comment on function public.conta_propuesta_ventas_unidad(uuid, uuid, date, uuid, uuid) is
  'C04b R5: la propuesta del asiento de ventas de una unidad (canal, o canal y marca) de un día y un local (espejo de ventasDelDia con unidad), o {sin_propuesta: por qué}. Solo lee.';
revoke all on function public.conta_propuesta_ventas_unidad(uuid, uuid, date, uuid, uuid) from public, anon, authenticated;

-- Las unidades de un día y un local, en el orden de sus pedidos y después de
-- sus reembolsos (unidadesDelDia del núcleo), cada una con su propuesta.
create or replace function public.conta_propuestas_ventas_dia(p_company uuid, p_location uuid, p_dia date)
returns jsonb language sql stable security definer set search_path = public as $$
  with u as (
    select x.canal_id, case when exists (select 1 from public.conta_ventas_canal v where v.company_id = p_company and v.channel_id = x.canal_id and v.por_marca)
                            then x.marca_id end as marca_id, x.o
      from (select p.canal_id, p.marca_id, p.ord as o
              from public.conta_pedidos_del_dia(p_company, p_location, p_dia) with ordinality as p(id, codigo, canal_id, marca_id, propia, estado, total, base, cuota, tipos, ord)
             where p.propia and p.estado = 'closed'
            union all
            select d.canal_id, d.marca_id, 100000000 + d.ord
              from public.conta_devoluciones_del_dia(p_company, p_location, p_dia) with ordinality as d(pedido_id, codigo, canal_id, marca_id, propia, importe, ord)
             where d.propia) x
  ), u2 as (select canal_id, marca_id, min(o) as o from u group by 1, 2)
  select coalesce(jsonb_agg(jsonb_build_object(
           'unit_key', coalesce(u2.canal_id::text, 'sin-canal') || coalesce(':' || u2.marca_id::text, ''),
           'channel_id', u2.canal_id, 'brand_id', u2.marca_id,
           'propuesta', public.conta_propuesta_ventas_unidad(p_company, p_location, p_dia, u2.canal_id, u2.marca_id)) order by u2.o), '[]'::jsonb)
    from u2
$$;
comment on function public.conta_propuestas_ventas_dia(uuid, uuid, date) is
  'C04b R5: las propuestas de ventas de un día y un local, una por unidad (canal, o canal y marca). Solo lee.';
revoke all on function public.conta_propuestas_ventas_dia(uuid, uuid, date) from public, anon, authenticated;

-- ── 6 · Qué días faltan por asentar ────────────────────────────────────────
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
     -- El día entero, asentado a la antigua (unit_key nulo)…
     and not exists (select 1 from public.sales_day_summary d join public.journal_entry e on e.id = d.entry_id
                      where d.company_id = p_company and d.location_id = s.location_id and d.sales_day = (s.sold_at at time zone 'Europe/Madrid')::date
                        and d.unit_key is null and e.status in ('propuesto', 'borrador', 'validado'))
     -- …o la unidad de este pedido, con la regla por plataforma (C04b R5).
     and not exists (select 1 from public.sales_day_summary d join public.journal_entry e on e.id = d.entry_id
                      where d.company_id = p_company and d.location_id = s.location_id and d.sales_day = (s.sold_at at time zone 'Europe/Madrid')::date
                        and d.unit_key = public.conta_unidad_ventas(p_company, s.channel_id, s.brand_id)
                        and e.status in ('propuesto', 'borrador', 'validado'))
     and not exists (select 1 from public.journal_dismissal x
                      where x.company_id = p_company and x.source_type = 'sales_day'
                        and x.source_key in (s.location_id || ':' || (s.sold_at at time zone 'Europe/Madrid')::date,
                                             s.location_id || ':' || (s.sold_at at time zone 'Europe/Madrid')::date || ':' || public.conta_unidad_ventas(p_company, s.channel_id, s.brand_id)))
   group by 1, 2
   order by 2, 1
$$;

-- ── 7 · Proponer, con la unidad ────────────────────────────────────────────
-- Lo vigente (20261018T0100, §3), con unit_key: la clave del descarte y del
-- resumen es día:local:unidad; el cerrojo, del día y el local.
create or replace function public._journal_entry_proponer(p_company uuid, p_entry jsonb, p_lines jsonb, p_summary jsonb, p_quien_nombre text, p_quien uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid; v_fecha date := (p_entry->>'fecha')::date; v_tipo text := p_entry->>'source_type';
  v_origen uuid := nullif(p_entry->>'source_id', '')::uuid; v_clave text; v_y uuid; v_id uuid; v_l jsonb; v_pos int := 0;
  v_cta uuid; v_resumen uuid; v_existente uuid;
  v_unidad text := nullif(p_summary->>'unit_key', ''); v_dia_clave text;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then
    raise exception 'La empresa % no existe.', p_company using errcode = '23514';
  end if;
  if v_tipo = 'sales_day' then
    v_dia_clave := (p_summary->>'location_id') || ':' || (p_summary->>'sales_day');
    v_clave := v_dia_clave || coalesce(':' || v_unidad, '');
    -- El botón y el cierre del día pueden llegar a la vez al mismo día: el
    -- cerrojo es del día y el local, también con unidades (C04b R5), para que
    -- un asiento del día entero y uno de una unidad no se crucen.
    perform pg_advisory_xact_lock(hashtextextended('sales_day:' || p_company::text || ':' || v_dia_clave, 0));
    -- C04b R5: con la regla por plataforma, el día entero ya no se propone.
    -- Lo dice (regla 8) en vez de dejar un asiento al lado de los de cada
    -- plataforma: así el front de antes no puede duplicar.
    if v_unidad is null and exists (select 1 from public.conta_ventas_canal v where v.company_id = p_company) then
      raise exception 'Las ventas se asientan ahora por plataforma (y Glovo por marca), y las propone el cierre del día cada hora. Recarga la página.' using errcode = '23514';
    end if;
  else
    v_clave := v_origen::text;
  end if;
  if v_clave is not null and exists (select 1 from public.journal_dismissal d where d.company_id = p_company and d.source_type = v_tipo
                                        and d.source_key in (v_clave, coalesce(v_dia_clave, v_clave))) then
    return jsonb_build_object('descartada', true);
  end if;

  if v_tipo = 'sales_day' then
    -- Un día ya asentado entero (a la antigua) no se vuelve a asentar por unidades.
    if v_unidad is not null then
      select s.entry_id into v_existente from public.sales_day_summary s join public.journal_entry e on e.id = s.entry_id
       where s.company_id = p_company and s.location_id = (p_summary->>'location_id')::uuid and s.sales_day = (p_summary->>'sales_day')::date
         and s.unit_key is null and e.status in ('propuesto', 'borrador', 'validado');
      if v_existente is not null then return jsonb_build_object('id', v_existente, 'existente', true); end if;
    end if;
    select s.id, s.entry_id into v_resumen, v_existente from public.sales_day_summary s
     where s.company_id = p_company and s.location_id = (p_summary->>'location_id')::uuid and s.sales_day = (p_summary->>'sales_day')::date
       and s.unit_key is not distinct from v_unidad;
    if v_existente is not null and exists (select 1 from public.journal_entry e where e.id = v_existente and e.status in ('propuesto', 'borrador', 'validado')) then
      return jsonb_build_object('id', v_existente, 'existente', true);
    end if;
    if v_resumen is null then
      insert into public.sales_day_summary (account_id, company_id, location_id, sales_day, unit_key, channel_id, brand_id, tickets_count, total, by_rate, by_channel, by_brand,
                                            first_invoice, last_invoice, detail_hash, sale_ids, base_calculated, created_by)
      values (v_cuenta, p_company, (p_summary->>'location_id')::uuid, (p_summary->>'sales_day')::date,
              v_unidad, nullif(p_summary->>'channel_id', '')::uuid, nullif(p_summary->>'brand_id', '')::uuid, (p_summary->>'tickets_count')::int,
              (p_summary->>'total')::numeric, coalesce(p_summary->'by_rate', '[]'), coalesce(p_summary->'by_channel', '[]'), coalesce(p_summary->'by_brand', '[]'),
              p_summary->>'first_invoice', p_summary->>'last_invoice', p_summary->>'detail_hash',
              coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_summary->'sale_ids') x), '{}'),
              coalesce((p_summary->>'base_calculated')::boolean, false), p_quien)
      returning id into v_resumen;
    else
      -- Un resumen sin asiento vivo (el del 09/10 de Carabanchel, de antes del
      -- cierre del día) se rehace entero con el día de ahora: no se duplica.
      update public.sales_day_summary set tickets_count = (p_summary->>'tickets_count')::int, total = (p_summary->>'total')::numeric,
             by_rate = coalesce(p_summary->'by_rate', '[]'), by_channel = coalesce(p_summary->'by_channel', '[]'), by_brand = coalesce(p_summary->'by_brand', '[]'),
             detail_hash = p_summary->>'detail_hash',
             sale_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_summary->'sale_ids') x), '{}'),
             base_calculated = coalesce((p_summary->>'base_calculated')::boolean, false), entry_id = null
       where id = v_resumen;
    end if;
    v_origen := v_resumen;
  elsif v_origen is not null then
    select id into v_existente from public.journal_entry
     where company_id = p_company and source_type = v_tipo and source_id = v_origen and status in ('propuesto', 'borrador', 'validado');
    if v_existente is not null then return jsonb_build_object('id', v_existente, 'existente', true); end if;
  end if;

  select id into v_y from public.fiscal_year where company_id = p_company and v_fecha between starts_on and ends_on;
  if v_y is null then raise exception 'No hay ejercicio para el %.', to_char(v_fecha, 'DD/MM/YYYY') using errcode = '23514'; end if;

  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status,
                                    confidence, reason, reasons, party_id, document_ref, document_date, created_by, created_by_name)
  values (v_cuenta, p_company, v_y, (p_entry->>'series')::smallint, v_fecha, p_entry->>'concepto', v_tipo, v_origen, 'propuesto',
          p_entry->>'confianza', p_entry->>'porque', coalesce(p_entry->'razones', '[]'), nullif(p_entry->>'party_id', '')::uuid,
          p_entry->>'documento', nullif(p_entry->>'fecha_documento', '')::date, p_quien, coalesce(p_quien_nombre, 'Folvy'))
  returning id into v_id;

  for v_l in select * from jsonb_array_elements(p_lines) loop
    v_pos := v_pos + 1;
    select id into v_cta from public.company_account where company_id = p_company and code = v_l->>'cuenta';
    if v_cta is null then raise exception 'La cuenta % no está en el plan de la empresa.', v_l->>'cuenta' using errcode = '23514'; end if;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept, location_id, is_common,
                                     brand_id, party_id, document_ref, tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents,
                                     withholding_rate_id, withholding_base, withholding_model)
    values (v_cuenta, p_company, v_id, v_pos, v_cta, coalesce((v_l->>'debe')::numeric, 0), coalesce((v_l->>'haber')::numeric, 0), v_l->>'concepto',
            nullif(v_l->>'local_id', '')::uuid, coalesce((v_l->>'comun')::boolean, false), nullif(v_l->>'marca_id', '')::uuid,
            nullif(v_l->>'tercero_id', '')::uuid, v_l->>'documento',
            nullif(v_l->'iva'->>'tipo_id', '')::uuid, (v_l->'iva'->>'base')::numeric, v_l->'iva'->>'libro', v_l->'iva'->>'deducible',
            coalesce((v_l->'iva'->>'facturas')::int, 1),
            nullif(v_l->'retencion'->>'tipo_id', '')::uuid, (v_l->'retencion'->>'base')::numeric, v_l->'retencion'->>'modelo');
  end loop;
  if v_resumen is not null then update public.sales_day_summary set entry_id = v_id where id = v_resumen; end if;
  return jsonb_build_object('id', v_id, 'existente', false);
end $$;
revoke all on function public._journal_entry_proponer(uuid, jsonb, jsonb, jsonb, text, uuid) from public, anon, authenticated;

-- ── 8 · El cierre del día propone cada unidad ──────────────────────────────
-- Lo vigente (20261018T0100, §5); sin filas en conta_ventas_canal hace
-- exactamente lo de antes.
create or replace function public.conta_proponer_dias(p_company uuid, p_ahora timestamptz default now(), p_quien text default 'Folvy (cierre del día)')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid; v_hasta date; y record; d record; v_p jsonb; v_r jsonb; v_res text; v_porque text; v_entry uuid;
  v_u jsonb; v_ures text; v_nuevo boolean; v_porques text[]; v_canal text; v_asientos int := 0; v_dia_asientos int;
  v_n jsonb := jsonb_build_object('propuestos', 0, 'ya_estaban', 0, 'descartados', 0, 'sin_propuesta', 0, 'fallos', 0);
  v_fallos text[] := '{}'; v_preguntar text[] := '{}';
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'Proponer: la empresa % no existe.', p_company; end if;
  v_hasta := public.conta_ultimo_dia_cerrado(p_company, p_ahora);

  for y in select f.* from public.fiscal_year f where f.company_id = p_company and f.status = 'open' and f.starts_on <= v_hasta order by f.starts_on loop
    if y.imported_until is null
       and exists (select 1 from public.sale s where s.account_id = v_cuenta and s.sold_at < (y.starts_on::timestamp at time zone 'Europe/Madrid'))
       and not exists (select 1 from public.journal_entry e where e.company_id = p_company and e.fiscal_year_id = y.id) then
      v_preguntar := v_preguntar || y.code::text;
      continue;
    end if;
    for d in
      select x.location_id, x.dia from public.conta_dias_por_asentar(p_company, greatest(y.starts_on, coalesce(y.imported_until + 1, y.starts_on)), least(v_hasta, y.ends_on)) x
       where not exists (select 1 from public.fiscal_period_lock k where k.company_id = p_company and k.month = date_trunc('month', x.dia)::date and k.reopened_at is null)
       order by x.dia, x.location_id
    loop
      v_entry := null; v_porque := null; v_dia_asientos := 0;
      begin
        v_nuevo := exists (select 1 from public.conta_ventas_canal v where v.company_id = p_company);
        if not v_nuevo then
          -- La regla de antes: el día entero en un asiento.
          v_p := public.conta_propuesta_ventas_dia(p_company, d.location_id, d.dia);
          if v_p is null then
            raise exception 'la propuesta del día ha salido vacía (ni asiento ni porqué)';
          elsif v_p ? 'sin_propuesta' then
            v_res := 'sin_propuesta'; v_porque := v_p->>'sin_propuesta';
          else
            v_r := public._journal_entry_proponer(p_company, v_p->'entrada', v_p->'lineas', v_p->'resumen', p_quien, null);
            v_res := case when (v_r->>'descartada')::boolean then 'descartado' when (v_r->>'existente')::boolean then 'ya_estaba' else 'propuesto' end;
            v_entry := nullif(v_r->>'id', '')::uuid;
          end if;
        else
          -- C04b R5: una propuesta por unidad. En el registro del día queda lo
          -- peor que pasó (sin propuesta > propuesto > ya estaba > descartado;
          -- un fallo salta al «exception» de abajo) y el porqué de cada unidad
          -- que no se propuso.
          v_res := null; v_porques := '{}';
          v_p := public.conta_propuestas_ventas_dia(p_company, d.location_id, d.dia);
          if v_p is null or jsonb_array_length(v_p) = 0 then
            raise exception 'el día no tiene ninguna unidad que proponer (ni asiento ni porqué)';
          end if;
          for v_u in select * from jsonb_array_elements(v_p) loop
            v_canal := coalesce((select ch.name from public.sales_channel ch where ch.id = nullif(v_u->>'channel_id', '')::uuid and ch.account_id = v_cuenta), 'sin canal')
                       || coalesce(' · ' || (select b.name from public.brand b where b.id = nullif(v_u->>'brand_id', '')::uuid and b.account_id = v_cuenta), '');
            if v_u->'propuesta' is null or jsonb_typeof(v_u->'propuesta') <> 'object' then
              raise exception '%: la propuesta ha salido vacía (ni asiento ni porqué)', v_canal;
            elsif v_u->'propuesta' ? 'sin_propuesta' then
              v_ures := 'sin_propuesta'; v_porques := v_porques || (v_canal || ': ' || (v_u->'propuesta'->>'sin_propuesta'));
            else
              v_r := public._journal_entry_proponer(p_company, v_u->'propuesta'->'entrada', v_u->'propuesta'->'lineas', v_u->'propuesta'->'resumen', p_quien, null);
              v_ures := case when (v_r->>'descartada')::boolean then 'descartado' when (v_r->>'existente')::boolean then 'ya_estaba' else 'propuesto' end;
              if v_ures = 'propuesto' then
                v_dia_asientos := v_dia_asientos + 1;
                if v_entry is null then v_entry := nullif(v_r->>'id', '')::uuid; end if;
              end if;
            end if;
            v_res := case when v_res is null then v_ures
                          when 'sin_propuesta' in (v_res, v_ures) then 'sin_propuesta'
                          when 'propuesto' in (v_res, v_ures) then 'propuesto'
                          when 'ya_estaba' in (v_res, v_ures) then 'ya_estaba'
                          else 'descartado' end;
          end loop;
          v_porque := nullif(array_to_string(v_porques, ' · '), '');
        end if;
      exception when others then
        v_res := 'fallo'; v_porque := format('%s (%s)', sqlerrm, sqlstate);
        v_fallos := v_fallos || format('%s %s: %s', d.dia, d.location_id, sqlerrm);
      end;
      -- Lo de un día que falla se deshace entero: sus asientos no cuentan.
      if v_res <> 'fallo' then v_asientos := v_asientos + v_dia_asientos; end if;
      insert into public.sales_day_proposal_log as g (account_id, company_id, location_id, sales_day, result, reason, entry_id)
      values (v_cuenta, p_company, d.location_id, d.dia, v_res, v_porque, v_entry)
      on conflict (company_id, location_id, sales_day) do update
        set result = excluded.result, reason = excluded.reason, entry_id = excluded.entry_id, attempts = g.attempts + 1, last_at = now();
      v_n := jsonb_set(v_n, array[case v_res when 'propuesto' then 'propuestos' when 'ya_estaba' then 'ya_estaban' when 'descartado' then 'descartados'
                                              when 'sin_propuesta' then 'sin_propuesta' else 'fallos' end],
                       to_jsonb((v_n->>case v_res when 'propuesto' then 'propuestos' when 'ya_estaba' then 'ya_estaban' when 'descartado' then 'descartados'
                                                  when 'sin_propuesta' then 'sin_propuesta' else 'fallos' end)::int + 1));
    end loop;
  end loop;
  -- C04b R5: los contadores son de días; asientos_por_unidad, de asientos (un día da varios).
  return v_n || jsonb_build_object('company_id', p_company, 'hasta', v_hasta, 'errores', to_jsonb(v_fallos), 'preguntar_ejercicio', to_jsonb(v_preguntar),
                                   'asientos_por_unidad', v_asientos);
end $$;
comment on function public.conta_proponer_dias(uuid, timestamptz, text) is
  'Cierre del día 2 + C04b R5: propone las ventas de los días cerrados y abiertos que no tienen asiento vivo (por unidad: plataforma, o plataforma y marca, si la empresa usa la regla por plataforma), y apunta en sales_day_proposal_log lo que pasó con cada día y local.';
revoke all on function public.conta_proponer_dias(uuid, timestamptz, text) from public, anon, authenticated;

-- ── 9 · Descartar una unidad no descarta el día ────────────────────────────
create or replace function public.journal_entry_descartar(p_entry uuid, p_motivo text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_e public.journal_entry; v_clave text;
begin
  select * into v_e from public.journal_entry where id = p_entry for update;
  if v_e.id is null then raise exception 'Ese asiento no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_e.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta descarta propuestas.' using errcode = '42501';
  end if;
  if v_e.status not in ('propuesto', 'borrador') then raise exception 'Solo se descarta una propuesta o un borrador; lo validado se anula.' using errcode = '23514'; end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then raise exception 'Para descartar hay que decir por qué.' using errcode = '23514'; end if;
  if v_e.source_type = 'sales_day' then
    -- C04b R5: el de una unidad descarta esa unidad, no el día entero.
    select s.location_id || ':' || s.sales_day || coalesce(':' || s.unit_key, '') into v_clave from public.sales_day_summary s where s.id = v_e.source_id;
  else
    v_clave := v_e.source_id::text;
  end if;
  if v_clave is not null then
    insert into public.journal_dismissal (account_id, company_id, source_type, source_key, reason, created_by, created_by_name)
    values (v_e.account_id, v_e.company_id, v_e.source_type, v_clave, trim(p_motivo), auth.uid(), coalesce(p_quien_nombre, public.conta_nombre_actor()))
    on conflict (company_id, source_type, source_key) do update set reason = excluded.reason;
  end if;
  delete from public.journal_entry where id = p_entry;
  return jsonb_build_object('descartado', p_entry, 'clave', v_clave);
end $$;
revoke all on function public.journal_entry_descartar(uuid, text, text) from public, anon;
grant execute on function public.journal_entry_descartar(uuid, text, text) to authenticated;
