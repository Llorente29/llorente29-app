-- supabase/migrations/20261025T1912_v02d_avisos.sql
--
-- V02d · QUE LOS AVISOS DIGAN LA VERDAD (paso 2 del encargo, 25/10). De los 17
-- avisos que Foodint veía el 25/10, 5 eran falsos, y 3 de los verdaderos
-- estaban mal contados (docs/conta/v02/avisos-foodint-20261025.md). Se
-- arreglan las causas, no los casos:
--
--   1. LOS ABONOS NO SON LA FACTURA DEL MES. Un importe negativo (los tres CN de
--      Tspoonlab del 30/09, el «-ANUL» de Last) ya no cuenta como llegada, ni
--      para aprender el ritmo. → _conta_puerta_llegadas y
--      conta_puerta_fuentes_proponer (cambian en caliente, misma firma).
--   2. UN EXTRACTO CUBRE LAS FECHAS DE SU PERIODO, no el día en que se subió.
--      Las fuentes del banco devuelven qué periodos cubren sus extractos
--      («cubre»), y la conexión, hasta su última sincronización. →
--      _conta_puerta_cubre (nueva) y conta_puerta_fuentes.
--   3. EL RITMO SE APRENDE POR DÍAS, NO POR FACTURAS. Diez facturas el mismo
--      día son una llegada. «El 15 y a fin de mes» es quincenal (Glovo, Just
--      Eat). Una vez al mes, aunque baile entre el 3 y el 6, es mensual
--      (Cloudtown), y a fin de mes, el 31 (Nobleza Vacuna). Casi cada semana el
--      mismo día es semanal (Portier). Lo demás, «varias al mes» cada tantos
--      días como hay entre llegadas, no 10 fijos. → conta_puerta_fuentes_proponer.
--      Lo ya apuntado que NADIE ha tocado se vuelve a aprender solo al abrir
--      Documentos (conta_puerta_al_dia, nueva); lo que tocó una persona no se pisa.
--   4. LO DE ANTES DEL CORTE ES DE DIEZ. La empresa no pide periodos anteriores
--      a su fecha de corte (bank_settings.cutover_date, Foodint 01/10/2026):
--      conta_puerta_fuentes la devuelve («corte») y el front no espera nada
--      de antes.
--
-- Y lo que la pantalla nueva (tableros 22, 23 y 24) necesita de la base:
--   5. DE QUÉ FAMILIA ES CADA FUENTE, para los grupos de «Qué esperas cada mes»
--      y las dos columnas de Documentos: alquiler (621), luz, agua y teléfono
--      (628), plataforma (el NIF de un canal de venta, o sus liquidaciones),
--      gestoría (nóminas), banco, o proveedor. El correo al que se le puede
--      pedir (su contacto de Facturación; la gestoría de las nóminas), y el
--      canal de la plataforma, para juntar en una fila la liquidación y su
--      factura de comisiones. → conta_puerta_fuentes.
--   6. «YA LO TENGO»: la persona dice que algo esperado ya lo tiene y deja de
--      avisar. Tabla conta_puerta_recibido (nueva, vacía) y
--      conta_puerta_ya_lo_tengo; cuenta como llegada.
--
-- No toca datos: ninguna fila existente cambia. Lo aprendido de antes se
-- vuelve a aprender desde la pantalla, por la función, cuando alguien abre
-- Documentos. No está en el camino del pedido.
--
-- cambia: public._conta_puerta_llegadas · prueba: supabase/staging/sql/20261025_v02d_avisos_prueba.sql
-- cambia: public.conta_puerta_fuentes · prueba: supabase/staging/sql/20261025_v02d_avisos_prueba.sql
-- cambia: public.conta_puerta_fuentes_proponer · prueba: supabase/staging/sql/20261025_v02d_avisos_prueba.sql
--
-- Vuelta atrás: supabase/vuelta-atras/20261025T1912_v02d_avisos.down.sql

-- 6 · «Ya lo tengo» ---------------------------------------------------------
create table if not exists public.conta_puerta_recibido (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  company_id uuid not null,
  expected_id uuid not null,
  dia date not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  created_by_name text,
  unique (expected_id, dia)
);
alter table public.conta_puerta_recibido drop constraint if exists conta_puerta_recibido_expected_id_fkey;
alter table public.conta_puerta_recibido add constraint conta_puerta_recibido_expected_id_fkey
  foreign key (expected_id) references public.supplier_expected_invoice(id) on delete cascade not valid;
alter table public.conta_puerta_recibido validate constraint conta_puerta_recibido_expected_id_fkey;
alter table public.conta_puerta_recibido drop constraint if exists conta_puerta_recibido_company_id_fkey;
alter table public.conta_puerta_recibido add constraint conta_puerta_recibido_company_id_fkey
  foreign key (company_id) references public.company(id) on delete cascade not valid;
alter table public.conta_puerta_recibido validate constraint conta_puerta_recibido_company_id_fkey;
alter table public.conta_puerta_recibido drop constraint if exists conta_puerta_recibido_account_id_fkey;
alter table public.conta_puerta_recibido add constraint conta_puerta_recibido_account_id_fkey
  foreign key (account_id) references public.accounts(id) not valid;
alter table public.conta_puerta_recibido validate constraint conta_puerta_recibido_account_id_fkey;
comment on table public.conta_puerta_recibido is
  'V02d · «Ya lo tengo»: la persona dice que lo esperado de una fuente para ese día ya lo tiene (cuenta como llegada y deja de avisar). Se escribe solo por conta_puerta_ya_lo_tengo.';
alter table public.conta_puerta_recibido enable row level security;
drop policy if exists conta_puerta_recibido_leer on public.conta_puerta_recibido;
create policy conta_puerta_recibido_leer on public.conta_puerta_recibido for select to authenticated using (public.belongs_to_account(account_id));
revoke all on public.conta_puerta_recibido from anon, authenticated;
grant select on public.conta_puerta_recibido to authenticated;

-- 1 · Las llegadas, sin abonos (y con «Ya lo tengo») -------------------------
-- La de la 1212 con tres cambios: el importe de la factura o del apunte del
-- libro tiene que ser positivo, y cuenta lo apuntado con «Ya lo tengo».
create or replace function public._conta_puerta_llegadas(p_x public.supplier_expected_invoice)
returns date[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct d order by d), '{}'::date[]) from (
    -- De un proveedor: sus facturas (las de Sumied y las del libro de recibidas, también las traídas de Diez). Los abonos no.
    select i.invoice_date d from public.supplier_invoice i
     where i.account_id = p_x.account_id and i.status <> 'anulada' and i.invoice_date >= current_date - 150
       and coalesce(i.grand_total, 0) >= 0
       and (i.supplier_id = p_x.supplier_id
            or i.supplier_id in (select s.id from public.supplier s where s.account_id = p_x.account_id
                                    and s.tax_id = any (array(select jsonb_array_elements_text(coalesce(p_x.match->'nifs', '[]'::jsonb)))))
            or (p_x.match ? 'numero_prefijo' and i.invoice_number like (p_x.match->>'numero_prefijo') || '%'))
    union
    select v.issue_date from public.vat_book_entry v
     where v.account_id = p_x.account_id and v.company_id = p_x.company_id and v.book = 'received' and v.voided_at is null and v.issue_date >= current_date - 150
       and coalesce(v.total, 0) >= 0
       and (v.counterpart_tax_id in (select s.tax_id from public.supplier s where s.id = p_x.supplier_id)
            or v.counterpart_tax_id = any (array(select jsonb_array_elements_text(coalesce(p_x.match->'nifs', '[]'::jsonb))))
            or (p_x.match ? 'numero_prefijo' and v.number like (p_x.match->>'numero_prefijo') || '%'))
    -- Riders: la quincena de Catcher subida.
    union
    select b.period_to from public.supplier_batch b
     where p_x.kind = 'riders' and b.account_id = p_x.account_id and b.company_id = p_x.company_id and b.provider = 'catcher' and b.period_to >= current_date - 150
    -- Intermediario: sus liquidaciones (el fin de su periodo).
    union
    select coalesce(c.period_to, c.settlement_date) from public.channel_settlement c
     where p_x.kind = 'intermediario' and c.account_id = p_x.account_id and c.channel_id::text = p_x.match->>'canal'
       and coalesce(c.period_to, c.settlement_date) >= current_date - 150
    -- Banco: el día en que se subió el extracto, o la última sincronización (lo que cubren va en _conta_puerta_cubre).
    union
    select s.imported_at::date from public.bank_statement s
     where p_x.kind = 'banco' and s.account_id = p_x.account_id and s.company_id = p_x.company_id
       and (p_x.match->>'tesoreria' is null or s.treasury_account_id::text = p_x.match->>'tesoreria') and s.imported_at >= current_date - 150
    union
    select l.last_sync_at::date from public.bank_aggregator_link l
     where p_x.kind = 'banco' and l.account_id = p_x.account_id and l.company_id = p_x.company_id and l.last_sync_at is not null
       and (p_x.match->>'tesoreria' is null or l.treasury_account_id::text = p_x.match->>'tesoreria')
    -- Nóminas: el día en que llegaron.
    union
    select n.created_at::date from public.payroll_inbox n
     where p_x.kind = 'nominas' and n.account_id = p_x.account_id and n.created_at >= current_date - 150
    -- Lo que llegó por la puerta y se enganchó a esta fuente.
    union
    select coalesce(d.email_received_at, d.created_at)::date from public.document_inbox d
     where d.expected_id = p_x.id and d.status <> 'descartado'
    -- «Ya lo tengo».
    union
    select r.dia from public.conta_puerta_recibido r where r.expected_id = p_x.id
  ) x where d is not null
$$;
revoke all on function public._conta_puerta_llegadas(public.supplier_expected_invoice) from public, anon, authenticated;

-- 2 · Lo que cubren los extractos de una cuenta del banco ---------------------
-- [[desde, hasta], …] de sus extractos de los últimos 150 días, y la conexión
-- (si la hay) desde su corte hasta la última sincronización.
create or replace function public._conta_puerta_cubre(p_x public.supplier_expected_invoice)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_array(desde, hasta) order by hasta), '[]'::jsonb) from (
    select s.period_from desde, s.period_to hasta from public.bank_statement s
     where p_x.kind = 'banco' and s.account_id = p_x.account_id and s.company_id = p_x.company_id
       and (p_x.match->>'tesoreria' is null or s.treasury_account_id::text = p_x.match->>'tesoreria')
       and s.period_from is not null and s.period_to is not null and s.period_to >= current_date - 150
    union
    select coalesce((select b.cutover_date from public.bank_settings b where b.company_id = p_x.company_id), current_date - 150), l.last_sync_at::date
      from public.bank_aggregator_link l
     where p_x.kind = 'banco' and l.account_id = p_x.account_id and l.company_id = p_x.company_id and l.last_sync_at is not null
       and (p_x.match->>'tesoreria' is null or l.treasury_account_id::text = p_x.match->>'tesoreria')
  ) x
$$;
revoke all on function public._conta_puerta_cubre(public.supplier_expected_invoice) from public, anon, authenticated;

-- 4 y 5 · Las fuentes: su corte, lo que cubren, su familia, su correo y su canal
create or replace function public.conta_puerta_fuentes(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid := public._conta_puerta_cuenta(p_company);
begin
  return jsonb_build_object(
    'ajustes', coalesce((select jsonb_build_object('lo_que_falta', a.lo_que_falta, 'margen', a.margen_dias) from public.conta_puerta_ajustes a where a.company_id = p_company),
                        jsonb_build_object('lo_que_falta', true, 'margen', 5)),
    -- La fecha de corte: lo de antes lo lleva el programa de antes, y no se pide.
    'corte', (select b.cutover_date from public.bank_settings b where b.company_id = p_company),
    -- Los locales de la empresa, para elegir el de cada fuente (con uno solo, no se pide nada).
    'locales', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'nombre', l.name, 'direccion', l.address, 'activo', l.active) order by l.name)
                           from public.location_company lc join public.locations l on l.id = lc.location_id
                          where lc.company_id = p_company and lc.account_id = v_acc), '[]'::jsonb),
    'fuentes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'clave', x.source_key, 'tipo', x.kind, 'nombre', coalesce(x.label, s.name, 'Sin nombre'), 'grupo', x.group_label,
        'proveedor_id', x.supplier_id, 'cadencia', x.cadence, 'dia', x.typical_day, 'dia_semana', x.weekday, 'cada', x.gap_days,
        'margen', x.margin_days, 'activa', x.active, 'origen', x.source, 'cubierta', x.covered_by_recurring_id is not null,
        -- Si una persona la ha tocado (entonces no se vuelve a aprender sola).
        'tocada', x.source <> 'aprendido' or x.updated_by_name is not null,
        'local', (select jsonb_build_object('id', l.id, 'nombre', l.name, 'direccion', l.address) from public.locations l where l.id = x.location_id),
        'llegadas', to_jsonb(public._conta_puerta_llegadas(x)),
        'cubre', public._conta_puerta_cubre(x),
        'familia', case
            when x.kind = 'alquiler' then 'alquiler'
            when x.kind in ('intermediario', 'riders') or cn.canal_id is not null then 'plataforma'
            when x.kind = 'nominas' then 'gestoria'
            when x.kind = 'banco' then 'banco'
            when exists (select 1 from public.vat_book_entry v join public.journal_line jl on jl.entry_id = v.entry_id
                           join public.company_account a on a.id = jl.company_account_id
                          where v.account_id = v_acc and v.company_id = p_company and v.book = 'received' and v.voided_at is null
                            and v.counterpart_tax_id = coalesce(s.tax_id, x.match->'nifs'->>0) and a.code like '628%') then 'suministro'
            else 'proveedor' end,
        -- El canal de venta (la plataforma) de unas liquidaciones o de su factura de comisiones.
        'canal', case when cn.canal_id is not null then jsonb_build_object('id', cn.canal_id, 'nombre', cn.canal_nombre) end,
        -- A quién se le puede pedir: su contacto de Facturación (o el primero con correo); la gestoría, las nóminas.
        'correo', case when x.kind = 'nominas' then (select nullif(btrim(p.source_email), '') from public.payroll_settings p where p.account_id = v_acc)
                       else (select c.email from public.supplier_contact c
                              where c.supplier_id = x.supplier_id and c.account_id = v_acc and nullif(btrim(c.email), '') is not null
                              order by (c.role = 'billing') desc, (c.role = 'admin') desc, c.is_primary desc nulls last, c.created_at limit 1) end,
        'pedida', (select jsonb_build_object('periodo', r.period, 'estado', r.status, 'a', r.to_email) from public.supplier_invoice_request r
                    where r.expected_id = x.id or (x.supplier_id is not null and r.supplier_id = x.supplier_id)
                    order by r.created_at desc limit 1))
      order by x.group_label nulls last, coalesce(x.label, s.name))
      from public.supplier_expected_invoice x
      left join public.supplier s on s.id = x.supplier_id
      left join lateral (
        select ch.id canal_id, ch.name canal_nombre from public.sales_channel ch
         where ch.account_id = v_acc
           and (ch.id::text = x.match->>'canal'
                or exists (select 1 from public.channel_settlement c join public.party pa on pa.id = c.party_id
                            where c.account_id = v_acc and c.channel_id = ch.id
                              and pa.tax_id = coalesce(s.tax_id, x.match->'nifs'->>0)))
         limit 1) cn on true
     where x.company_id = p_company and x.account_id = v_acc), '[]'::jsonb));
end $$;
revoke all on function public.conta_puerta_fuentes(uuid) from public, anon;
grant execute on function public.conta_puerta_fuentes(uuid) to authenticated;

-- 3 · Aprender el ritmo por días, no por facturas -----------------------------
-- La de la 1212, con los proveedores aprendidos de sus DÍAS con factura (sin
-- abonos). Lo demás (riders, intermediarios, banco y nóminas), igual.
create or replace function public.conta_puerta_fuentes_proponer(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid := public._conta_puerta_cuenta(p_company); v_desde date := (date_trunc('month', current_date) - interval '9 months')::date;
begin
  return coalesce((select jsonb_agg(x order by x->>'tipo', x->>'nombre') from (
    -- Proveedores con un ritmo (sin los riders, que van juntos).
    select jsonb_build_object(
      'clave', 'nif:' || r.nif, 'tipo', case when r.alquiler then 'alquiler' else 'proveedor' end,
      'nombre', r.nombre, 'proveedor_id', r.supplier_id, 'nifs', jsonb_build_array(r.nif),
      -- El local que llevaban sus facturas (el más repetido), si la empresa tiene
      -- más de uno: la persona lo confirma o lo cambia en «Qué esperas cada mes».
      'local_id', case when (select count(*) from public.location_company lc where lc.company_id = p_company and lc.account_id = v_acc) > 1 then
                    (select mode() within group (order by i.location_id) from public.supplier_invoice i
                      where i.account_id = v_acc and i.supplier_id = r.supplier_id and i.status <> 'anulada'
                        and i.location_id in (select lc.location_id from public.location_company lc where lc.company_id = p_company and lc.account_id = v_acc)) end,
      'cadencia', r.cadencia,
      'dia', case r.cadencia when 'mensual' then case when r.dia_mediano >= 28 then 31 else r.dia_mediano end when 'quincenal' then 0 end,
      'dia_semana', case when r.cadencia = 'semanal' then r.dia_semana end,
      'cada', case when r.cadencia = 'varias' then r.cada end,
      'meses', r.meses, 'dias_por_mes', r.dias_por_mes) as x
      from (
        select d.*,
               case
                 -- El 15 y a fin de mes (el día 15 o el último del mes, en 7 de cada 10 días con factura).
                 when d.dias_por_mes >= 1.5 and d.quincena >= 0.7 then 'quincenal'
                 -- Una vez al mes, o todos los días de cada mes juntos en una semana.
                 when d.dias_por_mes <= 1.3 or d.juntos >= 0.8 then 'mensual'
                 -- Casi cada semana, y casi siempre el mismo día.
                 when d.dias_por_mes >= 3 and d.mismo_dia >= 0.5 then 'semanal'
                 else 'varias' end cadencia
          from (
            select f.nif, f.nombre, f.supplier_id, f.alquiler, f.meses,
                   round(f.dias::numeric / nullif(f.meses, 0), 1) dias_por_mes,
                   f.dia_mediano, f.dia_semana, f.quincena, f.juntos, f.mismo_dia,
                   greatest(7, least(45, f.hueco)) cada
              from (
                select dd.nif, max(dd.nombre) nombre, max(dd.supplier_id::text)::uuid supplier_id, bool_or(dd.alquiler) alquiler,
                       count(distinct date_trunc('month', dd.d)) meses, count(*) dias, max(dd.d) ultima,
                       percentile_disc(0.5) within group (order by extract(day from dd.d)::int) dia_mediano,
                       mode() within group (order by extract(isodow from dd.d)::int) dia_semana,
                       avg(case when extract(day from dd.d) = 15 or dd.d = (date_trunc('month', dd.d) + interval '1 month - 1 day')::date then 1 else 0 end) quincena,
                       -- Qué parte de los meses tiene todos sus días con factura en 7 días o menos.
                       (select avg(case when m.dmax - m.dmin <= 7 then 1 else 0 end) from (
                          select max(extract(day from z.d)) dmax, min(extract(day from z.d)) dmin from unnest(array_agg(dd.d)) z(d) group by date_trunc('month', z.d)) m) juntos,
                       -- Qué parte de los días cae en el día de la semana más repetido.
                       (select max(w.c)::numeric / sum(w.c) from (select count(*) c from unnest(array_agg(dd.d)) z(d) group by extract(isodow from z.d)) w) mismo_dia,
                       -- Días entre dos llegadas seguidas, el mediano.
                       (select percentile_disc(0.5) within group (order by g.h) from (
                          select z.d - lag(z.d) over (order by z.d) h from unnest(array_agg(dd.d)) z(d)) g where g.h is not null) hueco
                  from (
                    -- Un día con factura (sin abonos) por proveedor: diez facturas el mismo día son una llegada.
                    select v.counterpart_tax_id nif, max(v.counterpart_name) nombre, v.issue_date d,
                           (select s.id from public.supplier s where s.account_id = v_acc and s.tax_id = v.counterpart_tax_id order by s.created_at limit 1) supplier_id,
                           -- Un alquiler: su gasto va a la 621 (arrendamientos), según su asiento.
                           bool_or(exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id
                                            where l.entry_id = v.entry_id and a.code like '621%')) alquiler
                      from public.vat_book_entry v
                     where v.account_id = v_acc and v.company_id = p_company and v.book = 'received' and v.voided_at is null
                       and v.issue_date >= v_desde and coalesce(v.counterpart_tax_id, '') <> '' and coalesce(v.number, '') not like 'ES I%'
                       and coalesce(v.total, 0) > 0
                     group by v.counterpart_tax_id, v.issue_date
                  ) dd
                 group by dd.nif
              ) f
             where f.meses >= 6 and f.ultima >= (date_trunc('month', current_date) - interval '2 months')::date
          ) d
      ) r
    union all
    -- Los riders: una sola fuente, quincenal.
    select jsonb_build_object('clave', 'riders', 'tipo', 'riders', 'nombre', 'Riders de Catcher', 'cadencia', 'quincenal',
                              'numero_prefijo', 'ES I', 'facturas', count(*), 'personas', count(distinct v.counterpart_tax_id))
      from public.vat_book_entry v
     where v.account_id = v_acc and v.company_id = p_company and v.book = 'received' and v.voided_at is null
       and v.issue_date >= v_desde and v.number like 'ES I%'
    having count(*) > 0
    union all
    -- Intermediarios con liquidaciones en los últimos 4 meses.
    select jsonb_build_object('clave', 'canal:' || c.channel_id, 'tipo', 'intermediario', 'nombre', coalesce(ch.name, 'Intermediario') || ' · liquidaciones',
                              'canal', c.channel_id,
                              -- El ritmo de su ÚLTIMO periodo, no el más repetido: el histórico importado
                              -- (mensual, una fila por tienda) pesaba más que los resúmenes semanales de
                              -- Uber que entran desde el 11/10 (medido el 25/10). Empate el mismo día: el más fino.
                              'cadencia', (array_agg(case when c.period_grain in ('week', 'weeks', 'semana') then 'semanal' when c.period_grain = 'quincena' then 'quincenal' else 'mensual' end
                                                     order by coalesce(c.period_to, c.settlement_date) desc,
                                                              case when c.period_grain in ('week', 'weeks', 'semana') then 0 when c.period_grain = 'quincena' then 1 else 2 end))[1],
                              -- El día de la semana en que acaba su último periodo (Uber: el domingo) y, si es semanal, 1 día de margen (Julio, 25/10).
                              'dia_semana', (array_agg(case when c.period_grain in ('week', 'weeks', 'semana') then extract(isodow from coalesce(c.period_to, c.settlement_date))::int end
                                                       order by coalesce(c.period_to, c.settlement_date) desc,
                                                                case when c.period_grain in ('week', 'weeks', 'semana') then 0 when c.period_grain = 'quincena' then 1 else 2 end))[1],
                              'margen', (array_agg(case when c.period_grain in ('week', 'weeks', 'semana') then 1 end
                                                   order by coalesce(c.period_to, c.settlement_date) desc,
                                                            case when c.period_grain in ('week', 'weeks', 'semana') then 0 when c.period_grain = 'quincena' then 1 else 2 end))[1],
                              'liquidaciones', count(*))
      from public.channel_settlement c left join public.sales_channel ch on ch.id = c.channel_id and ch.account_id = c.account_id
     where c.account_id = v_acc and coalesce(c.is_reference, false) = false and coalesce(c.period_to, c.settlement_date) >= current_date - 120
     group by c.channel_id, ch.name
    union all
    -- El banco: cada cuenta con extractos o conexión.
    select jsonb_build_object('clave', 'banco:' || t.id, 'tipo', 'banco', 'nombre', 'Extracto · ' || coalesce(t.short_name, t.name, 'banco'),
                              'tesoreria', t.id, 'cadencia', 'semanal')
      from public.treasury_account t
     where t.company_id = p_company and t.account_id = v_acc and t.is_active
       and (exists (select 1 from public.bank_statement s where s.treasury_account_id = t.id)
            or exists (select 1 from public.bank_aggregator_link l where l.treasury_account_id = t.id))
    union all
    -- Las nóminas, si la cuenta las recibe (Laboral).
    select jsonb_build_object('clave', 'nominas', 'tipo', 'nominas', 'nombre', 'Nóminas' || coalesce(' · ' || p.gestoria_name, ''),
                              'cadencia', 'mensual', 'dia', 5)
      from public.payroll_settings p where p.account_id = v_acc
  ) z), '[]'::jsonb);
end $$;
revoke all on function public.conta_puerta_fuentes_proponer(uuid) from public, anon;
grant execute on function public.conta_puerta_fuentes_proponer(uuid) to authenticated;

-- 3b · Lo aprendido, al día ------------------------------------------------------
-- Al abrir Documentos (un administrador o un encargado): lo que se propone hoy
-- y no estaba apuntado, se apunta; lo apuntado que NADIE ha tocado (aprendido y
-- sin updated_by_name) toma el ritmo que se aprende hoy; y de proveedores y
-- alquileres sin tocar, lo que lleva tres periodos sin llegar se apaga solo
-- («sin facturas desde…»), y se vuelve a encender si llega algo. Lo que tocó una
-- persona no se pisa. Devuelve cuántas de cada cosa.
create or replace function public.conta_puerta_al_dia(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid := public._conta_puerta_cuenta(p_company);
  v_p jsonb;
  v_x public.supplier_expected_invoice;
  v_nuevas int := 0; v_reaprendidas int := 0; v_dormidas int := 0; v_despiertas int := 0;
  v_ultima date; v_periodo int; v_dormida boolean;
begin
  if not public.current_user_is_admin_or_manager_of(v_acc) then
    return jsonb_build_object('nuevas', 0, 'reaprendidas', 0, 'dormidas', 0, 'despiertas', 0, 'solo_lectura', true);
  end if;
  for v_p in select jsonb_array_elements(public.conta_puerta_fuentes_proponer(p_company)) loop
    select * into v_x from public.supplier_expected_invoice where company_id = p_company and account_id = v_acc and source_key = v_p->>'clave';
    if v_x.id is null then
      perform public.conta_puerta_fuente_guardar(p_company, v_p, null);
      v_nuevas := v_nuevas + 1;
    elsif v_x.source = 'aprendido' and v_x.updated_by_name is null
          and (v_x.cadence is distinct from coalesce(v_p->>'cadencia', 'mensual')
               or v_x.typical_day is distinct from nullif(v_p->>'dia', '')::smallint
               or v_x.weekday is distinct from nullif(v_p->>'dia_semana', '')::smallint
               or v_x.gap_days is distinct from nullif(v_p->>'cada', '')::smallint) then
      update public.supplier_expected_invoice set
        cadence = coalesce(v_p->>'cadencia', 'mensual'), typical_day = nullif(v_p->>'dia', '')::smallint,
        weekday = nullif(v_p->>'dia_semana', '')::smallint, gap_days = nullif(v_p->>'cada', '')::smallint,
        margin_days = case when v_p ? 'margen' then nullif(v_p->>'margen', '')::smallint else margin_days end,
        updated_at = now()
       where id = v_x.id;
      v_reaprendidas := v_reaprendidas + 1;
    end if;
  end loop;
  -- Proveedores y alquileres sin tocar: tres periodos sin llegar, apagado; si llega algo, encendido.
  for v_x in select * from public.supplier_expected_invoice
              where company_id = p_company and account_id = v_acc and source = 'aprendido' and updated_by_name is null
                and kind in ('proveedor', 'alquiler') loop
    select max(d) into v_ultima from unnest(public._conta_puerta_llegadas(v_x)) d;
    v_periodo := case v_x.cadence when 'mensual' then 31 when 'quincenal' then 16 when 'semanal' then 7 else coalesce(v_x.gap_days, 10) end;
    v_dormida := v_ultima is null or v_ultima < current_date - (3 * v_periodo + coalesce(v_x.margin_days, 5));
    if v_dormida and v_x.active then
      update public.supplier_expected_invoice set active = false, updated_at = now() where id = v_x.id;
      v_dormidas := v_dormidas + 1;
    elsif not v_dormida and not v_x.active then
      update public.supplier_expected_invoice set active = true, updated_at = now() where id = v_x.id;
      v_despiertas := v_despiertas + 1;
    end if;
  end loop;
  return jsonb_build_object('nuevas', v_nuevas, 'reaprendidas', v_reaprendidas, 'dormidas', v_dormidas, 'despiertas', v_despiertas);
end $$;
revoke all on function public.conta_puerta_al_dia(uuid) from public, anon;
grant execute on function public.conta_puerta_al_dia(uuid) to authenticated;

-- 6b · «Ya lo tengo» ---------------------------------------------------------------
create or replace function public.conta_puerta_ya_lo_tengo(p_expected uuid, p_dia date, p_quien_nombre text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_x public.supplier_expected_invoice; v_id uuid;
begin
  select * into v_x from public.supplier_expected_invoice where id = p_expected;
  if v_x.id is null or not public.current_user_is_admin_or_manager_of(v_x.account_id) then
    raise exception 'Solo un administrador o un encargado dice que algo ya lo tiene.' using errcode = '42501';
  end if;
  if p_dia is null then raise exception 'Falta de qué día es.' using errcode = '22023'; end if;
  insert into public.conta_puerta_recibido (account_id, company_id, expected_id, dia, created_by_name)
  values (v_x.account_id, v_x.company_id, v_x.id, p_dia, p_quien_nombre)
  on conflict (expected_id, dia) do nothing
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'ya_estaba', v_id is null);
end $$;
revoke all on function public.conta_puerta_ya_lo_tengo(uuid, date, text) from public, anon;
grant execute on function public.conta_puerta_ya_lo_tengo(uuid, date, text) to authenticated;
