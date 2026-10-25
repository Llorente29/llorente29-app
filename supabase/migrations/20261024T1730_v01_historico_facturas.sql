-- supabase/migrations/20261024T1730_v01_historico_facturas.sql
--
-- V01 · El histórico de Ventas: su factura, para lo que ya está en el libro
-- y no la tenía (Julio, 24/10: sí a las tres). Va DESPUÉS de la tanda del
-- #321 (claude/v01-cierres): usa su conta_venta_pdf_guardar, que deja el PDF
-- junto al asiento.
--
--   1. LOS CIERRES DE OCTUBRE (85 en producción el 24/10, Foodint): cierres
--      del día validados, con su PDF y ya en Diez, sin número en el libro. Su
--      factura resumen lleva EL NÚMERO QUE YA TIENEN EN DIEZ Y EN SU PDF
--      (external_send.ext_invoice_number: UBR-FLO-20261003, GLV-CAM-…-2…),
--      no uno nuevo de la serie del canal; ese número va también al libro de
--      expedidas. Su PDF es el de siempre (pdf_path a su resumen_ventas).
--      Los 12 anulados no entran: su cierre ya apunta al asiento rehecho
--      (el «-2» del número), que es uno de los 85.
--   2. LOS TRAÍDOS DE DIEZ sin NIF (1.196 en producción, ene–sep): asientos
--      migrated del libro de expedidas, a consumidor final, de las
--      plataformas. Su factura con SU número de Diez (el que ya lleva el
--      libro), una línea por tipo de IVA del asiento. El libro NO se toca
--      (siguen como F1: respuesta 3). Su PDF lo hace el navegador después
--      («Hacer los PDF que faltan», en Ventas › Facturas), desde el asiento.
--
-- Nada se envía a Diez: los dos grupos ya están allí.
--
-- La factura: emitida, origen «Cierre del día», con el número de Diez en
-- number_text. Como el número de Diez no es un entero de una serie, cada
-- grupo va en su serie (los cierres en la de su prefijo, UBR-FLO, GLV-CAM…;
-- los traídos en DIEZ) con number correlativo por año en orden de fecha, y el
-- contador de esas series queda en su último número (nadie emite en ellas).
-- Sin huella encadenada: no se emitieron en Sumied.
--
-- Lo que la medida del 24/10 encontró y aquí no se esconde (regla 7):
--   · 6 números de Diez repetidos entre los traídos (resúmenes mensuales de
--     Uber con el nombre de la marca cortado a 30 letras, importes distintos):
--     cada uno lleva su factura, con el mismo número de Diez.
--   · 1 traído es una devolución (GLV655836-20260913, −3,90 €, a la 708): su
--     factura va en negativo, como su asiento.
--   · Los traídos no llevan el tipo de IVA enlazado en sus líneas (los 1.196
--     al 10 %): se toma el tipo global con ese porcentaje.
--
-- TOCA DATOS QUE EXISTEN (el número del libro de los cierres): pide «autorizo».
-- COPIA PREVIA: _copia_v01_historico_libro (cada anotación del libro con su
-- número de antes) y _v01_historico_facturas (las facturas que crea, para
-- deshacerlas).
-- sin hueco: no retira ni rehace asientos ni resúmenes del día.
-- Vuelta atrás: supabase/vuelta-atras/20261024T1730_v01_historico_facturas.down.sql

create table if not exists public._copia_v01_historico_libro (
  vat_book_entry_id uuid primary key,
  entry_id          uuid not null,
  numero_antes      text,
  copiado_at        timestamptz not null default now()
);
create table if not exists public._v01_historico_facturas (
  invoice_id  uuid primary key,
  entry_id    uuid not null unique,
  grupo       text not null check (grupo in ('cierre', 'traida')),
  creado_at   timestamptz not null default now()
);
create table if not exists public._v01_historico_contadores (
  company_id   uuid not null,
  series_code  text not null,
  fiscal_year  integer not null,
  primary key (company_id, series_code, fiscal_year)
);
alter table public._copia_v01_historico_libro enable row level security;
alter table public._v01_historico_facturas enable row level security;
alter table public._v01_historico_contadores enable row level security;
revoke all on table public._copia_v01_historico_libro, public._v01_historico_facturas, public._v01_historico_contadores from anon, authenticated;

-- La selección, de solo lectura: la usan esta migración, su cuenta y la prueba.
create or replace function public.conta_v01_historico_cierres()
returns table (entry_id uuid, company_id uuid, account_id uuid, numero text, serie text, fecha date)
language sql stable set search_path = public as $$
  select e.id, e.company_id, e.account_id, x.ext_invoice_number,
         regexp_replace(x.ext_invoice_number, '-[0-9]{8}(-[0-9]+)?$', ''), s.sales_day
    from public.journal_entry e
    join public.sales_day_summary s on s.entry_id = e.id and s.company_id = e.company_id and s.unit_key is not null and s.channel_id is not null
    join lateral (select x.ext_invoice_number from public.external_send x
                   where x.entry_id = e.id and x.account_id = e.account_id and x.status in ('enviado', 'enlazado') and x.ext_invoice_number is not null
                   order by x.created_at desc limit 1) x on true
   where e.source_type = 'sales_day' and e.status = 'validado'
     and not exists (select 1 from public.customer_invoice ci where ci.entry_id = e.id)
     and exists (select 1 from public.vat_book_entry v where v.entry_id = e.id and v.book = 'issued' and v.number is null)
$$;
revoke execute on function public.conta_v01_historico_cierres() from public, anon, authenticated;

create or replace function public.conta_v01_historico_traidos()
returns table (entry_id uuid, company_id uuid, account_id uuid, numero text, serie text, fecha date)
language sql stable set search_path = public as $$
  select e.id, e.company_id, e.account_id, v.number, 'DIEZ'::text, e.entry_date
    from public.journal_entry e
    join public.vat_book_entry v on v.entry_id = e.id and v.book = 'issued'
   where e.source_type = 'migrated' and e.status = 'validado'
     and v.counterpart_tax_id is null and v.number is not null
     and not exists (select 1 from public.customer_invoice ci where ci.entry_id = e.id)
     -- Una factura por asiento: solo los de UNA anotación en el libro (los 1.196, el 24/10).
     and (select count(*) from public.vat_book_entry v2 where v2.entry_id = e.id and v2.book = 'issued') = 1
$$;
revoke execute on function public.conta_v01_historico_traidos() from public, anon, authenticated;

-- La factura de UN asiento, ya numerada. Crea la factura en borrador con sus
-- líneas (una por tipo de IVA del libro de su asiento, a su cuenta 70x) y la
-- deja emitida, con las cifras del libro.
create or replace function public._conta_v01_historico_factura(p_entry uuid, p_grupo text, p_serie text, p_numero integer, p_texto text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_e public.journal_entry; v_id uuid; v_cta uuid; v_local uuid; v_canal text; v_nombre text; v_doc public.journal_entry_document;
  v_base numeric; v_iva numeric; v_pos int := 0; r record;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null or v_e.status <> 'validado' then raise exception 'HISTÓRICO: el asiento % no está validado.', p_entry; end if;
  if exists (select 1 from public.customer_invoice where entry_id = p_entry) then raise exception 'HISTÓRICO: el asiento % ya tiene factura.', p_entry; end if;
  -- La cuenta de ventas: la 70x con más importe del asiento (al haber, o al debe en una devolución).
  select l.company_account_id into v_cta from public.journal_line l join public.company_account a on a.id = l.company_account_id
   where l.entry_id = p_entry and a.code like '70%' order by abs(l.credit - l.debit) desc, l.position limit 1;
  if v_cta is null then raise exception 'HISTÓRICO: el asiento % no tiene cuenta 70x.', p_entry; end if;
  select l.location_id into v_local from public.journal_line l where l.entry_id = p_entry and l.location_id is not null order by l.position limit 1;
  if p_grupo = 'cierre' then
    select ch.name, s.location_id into v_canal, v_local from public.sales_day_summary s left join public.sales_channel ch on ch.id = s.channel_id and ch.account_id = s.account_id where s.entry_id = p_entry;
    v_nombre := 'Ventas del día · ' || coalesce(v_canal, 'canal');
    select * into v_doc from public.journal_entry_document where entry_id = p_entry and kind = 'resumen_ventas';
  else
    select coalesce(nullif(btrim(counterpart_name), ''), 'Ventas a consumidor final') into v_nombre from public.vat_book_entry where entry_id = p_entry and book = 'issued' limit 1;
  end if;

  insert into public.customer_invoice (account_id, company_id, status, doc_type, origin, series_code, fiscal_year, number, number_text, issue_date, due_date,
                                       customer, location_id, notes, created_by_name)
  values (v_e.account_id, v_e.company_id, 'borrador', 'factura', 'cierre_dia', p_serie, extract(year from v_e.entry_date)::int, p_numero, p_texto, v_e.entry_date, v_e.entry_date,
          jsonb_build_object('nombre', v_nombre, 'consumidor_final', true), v_local,
          case p_grupo when 'cierre' then 'Factura resumen del cierre del día, con su número de Diez (histórico, V01).'
                       else 'Traída de Diez: su número es el de Diez (histórico, V01).' end,
          'Histórico (V01)')
  returning id into v_id;

  -- Las líneas, del libro de expedidas del asiento (base y cuota por tipo).
  for r in
    select coalesce(jl.tax_rate_id, (select t.id from public.tax_rate t where t.company_id is null and t.treatment = 'taxed' and t.rate = v.tax_rate order by t.code limit 1)) as tipo,
           v.tax_rate as pct, sum(v.tax_base) as base, sum(v.tax_amount) as cuota
      from public.vat_book_entry v left join public.journal_line jl on jl.id = v.line_id
     where v.entry_id = p_entry and v.book = 'issued'
     group by 1, 2 order by 2 desc
  loop
    if r.tipo is null then raise exception 'HISTÓRICO: el asiento % tiene IVA al % %% sin tipo que lo nombre.', p_entry, r.pct; end if;
    v_pos := v_pos + 1;
    insert into public.customer_invoice_line (account_id, company_id, invoice_id, position, concept, quantity, unit_price, discount_pct, tax_rate_id, tax_pct, revenue_account_id, amount)
    values (v_e.account_id, v_e.company_id, v_id, v_pos,
            case p_grupo when 'cierre' then format('Ventas del día al %s %%', to_char(r.pct, 'FM990D##')) else format('Ventas a consumidor final al %s %%', to_char(r.pct, 'FM990D##')) end,
            1, r.base, 0, r.tipo, r.pct, v_cta, r.base);
  end loop;
  if v_pos = 0 then raise exception 'HISTÓRICO: el asiento % no tiene anotaciones en el libro de expedidas.', p_entry; end if;
  select sum(tax_base), sum(tax_amount) into v_base, v_iva from public.vat_book_entry where entry_id = p_entry and book = 'issued';

  update public.customer_invoice set status = 'emitida', base = v_base, tax = v_iva, total = v_base + v_iva, entry_id = p_entry,
         pdf_path = v_doc.storage_path, pdf_sha256 = v_doc.sha256, pdf_bytes = v_doc.size_bytes,
         issued_at = coalesce(v_e.validated_at, now()), issued_by_name = 'Histórico (V01)'
   where id = v_id;
  insert into public.customer_invoice_event (account_id, company_id, invoice_id, kind, text, detail, by_name)
  values (v_e.account_id, v_e.company_id, v_id, 'emitida',
          case p_grupo when 'cierre' then format('Factura resumen %s del cierre ya validado (asiento nº %s), con su número de Diez y su PDF de siempre. Ya estaba en Diez: no se envía.', p_texto, v_e.number)
                       else format('Factura %s traída de Diez (asiento nº %s). Ya estaba en Diez: no se envía. Su PDF se hace desde el asiento.', p_texto, v_e.number) end,
          jsonb_build_object('asiento', p_entry, 'historico', p_grupo), 'Histórico (V01)');
  insert into public._v01_historico_facturas (invoice_id, entry_id, grupo) values (v_id, p_entry, p_grupo);
  return v_id;
end $$;
revoke execute on function public._conta_v01_historico_factura(uuid, text, text, integer, text) from public, anon, authenticated;

-- Lo que se aplica, en una sola transacción, con sus comprobaciones al céntimo.
do $$
declare
  r record; n_cierres int := 0; n_traidos int := 0; v_libro numeric; v_facturas numeric;
begin
  -- 1 · Los cierres: la copia del libro, su factura y su número en el libro.
  insert into public._copia_v01_historico_libro (vat_book_entry_id, entry_id, numero_antes)
  select v.id, v.entry_id, v.number from public.vat_book_entry v join public.conta_v01_historico_cierres() c on c.entry_id = v.entry_id
   where v.book = 'issued'
  on conflict (vat_book_entry_id) do nothing;
  for r in
    select c.*, row_number() over (partition by c.company_id, c.serie, extract(year from c.fecha) order by c.fecha, c.numero) as n
      from public.conta_v01_historico_cierres() c
  loop
    perform public._conta_v01_historico_factura(r.entry_id, 'cierre', r.serie,
      coalesce((select last_number from public.customer_invoice_counter k where k.company_id = r.company_id and k.series_code = r.serie and k.fiscal_year = extract(year from r.fecha)), 0) + r.n::int,
      r.numero);
    update public.vat_book_entry set number = r.numero, updated_at = now(), updated_by_name = 'Histórico (V01)' where entry_id = r.entry_id and book = 'issued';
    n_cierres := n_cierres + 1;
  end loop;

  -- 2 · Los traídos: su factura; el libro, como está.
  for r in
    select t.*, row_number() over (partition by t.company_id, extract(year from t.fecha) order by t.fecha, t.numero, t.entry_id) as n
      from public.conta_v01_historico_traidos() t
  loop
    perform public._conta_v01_historico_factura(r.entry_id, 'traida', r.serie,
      coalesce((select last_number from public.customer_invoice_counter k where k.company_id = r.company_id and k.series_code = r.serie and k.fiscal_year = extract(year from r.fecha)), 0) + r.n::int,
      r.numero);
    n_traidos := n_traidos + 1;
  end loop;

  -- 3 · El contador de cada serie que se ha usado, en su último número.
  insert into public._v01_historico_contadores (company_id, series_code, fiscal_year)
  select distinct ci.company_id, ci.series_code, ci.fiscal_year from public.customer_invoice ci join public._v01_historico_facturas h on h.invoice_id = ci.id
   where not exists (select 1 from public.customer_invoice_counter k where k.company_id = ci.company_id and k.series_code = ci.series_code and k.fiscal_year = ci.fiscal_year)
  on conflict do nothing;
  insert into public.customer_invoice_counter (company_id, account_id, series_code, fiscal_year, last_number)
  select ci.company_id, ci.account_id, ci.series_code, ci.fiscal_year, max(ci.number) from public.customer_invoice ci join public._v01_historico_facturas h on h.invoice_id = ci.id
   group by 1, 2, 3, 4
  on conflict (company_id, series_code, fiscal_year) do update set last_number = greatest(public.customer_invoice_counter.last_number, excluded.last_number);

  -- 4 · Comprobaciones: nada queda fuera y las cifras son las del libro, al céntimo.
  if exists (select 1 from public.conta_v01_historico_cierres()) or exists (select 1 from public.conta_v01_historico_traidos()) then
    raise exception 'HISTÓRICO: después de aplicar sigue habiendo asientos sin su factura.';
  end if;
  select coalesce(sum(v.total), 0) into v_libro from public.vat_book_entry v join public._v01_historico_facturas h on h.entry_id = v.entry_id where v.book = 'issued';
  select coalesce(sum(ci.total), 0) into v_facturas from public.customer_invoice ci join public._v01_historico_facturas h on h.invoice_id = ci.id;
  if v_libro <> v_facturas then raise exception 'HISTÓRICO: las facturas suman % y el libro %: no cuadra.', v_facturas, v_libro; end if;
  if exists (select 1 from public.customer_invoice ci join public._v01_historico_facturas h on h.invoice_id = ci.id
              where ci.total <> (select sum(l.amount) from public.customer_invoice_line l where l.invoice_id = ci.id) + ci.tax) then
    raise exception 'HISTÓRICO: alguna factura no suma sus líneas más su IVA.';
  end if;
  if exists (select 1 from public.vat_book_entry v join public._v01_historico_facturas h on h.entry_id = v.entry_id and h.grupo = 'cierre'
              join public.customer_invoice ci on ci.id = h.invoice_id where v.book = 'issued' and v.number is distinct from ci.number_text) then
    raise exception 'HISTÓRICO: algún cierre no lleva en el libro el número de su factura.';
  end if;
  raise notice 'HISTÓRICO: % facturas de cierres (con su número de Diez en el libro) y % de traídos; % € en total, igual que el libro.', n_cierres, n_traidos, v_facturas;
end $$;
