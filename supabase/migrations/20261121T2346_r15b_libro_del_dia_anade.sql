-- supabase/migrations/20261121T2346_r15b_libro_del_dia_anade.sql
--
-- R15b · El día del TPV en el libro de IVA, como manda la ley (RIVA art. 63.4 y 63.6). 1 de 3: lo que
-- solo AÑADE (una tabla y funciones nuevas); no cambia nada de lo que existe. El cambio (validar el día
-- reparte su libro; el 303 lleva la R5 a la [14] y la [15]) va en la 2347, y rehacer los días ya
-- contabilizados, en la 2350.
-- El ASIENTO del día no cambia (una 477 por tipo; un asiento validado no se toca y va encadenado por su
-- huella): lo que se reparte es su LIBRO DE IVA (Julio, 21/11):
--   · una fila por serie (contador del TPV) y tipo, con su primer y su último número, «Ventas a
--     consumidor final» (F4, o F2 si es un solo ticket). El ticket cambiado por una factura con NIF va
--     dentro, a 0 con su número (R12);
--   · cada factura con NIF en su fila (F1), con el NIF y el nombre de su cliente;
--   · cada devolución (factura del TPV en negativo) en su fila, R5, con su número.
-- La base y la cuota de cada tipo NO cambian: solo se reparten en más filas (si no dan lo mismo al
-- céntimo, para). Lo que había se guarda en conta_tpv_libro_antes, para volver atrás exacto.
--
--   1. conta_tpv_libro_antes (tabla nueva): la fila del libro de cada tipo, como era.
--   2. _conta_tpv_libro_grupos(día): las filas que tocan, sin escribir nada.
--   3. _conta_tpv_libro_repartir(día, asiento, origen) y _conta_tpv_libro_juntar(asiento).
--   4. conta_tpv_dia_libro(día): las filas del libro de un día, para su ficha (o las que tendrá, si aún
--      no está contabilizado).
--   5. conta_tpv_emitidas_libro(empresa, desde, hasta): «Facturas emitidas» con las filas del libro de
--      cada día contabilizado.
--   6. conta_347_ventas_por_cliente(empresa, año): lo emitido a cada NIF en el año, del libro (por
--      trimestre). Preparada para el 347, que aún no existe en Sumied.
-- Todo vale para cualquier TPV: nada de aquí es de Revo.
-- Se puede pasar dos veces (if not exists, create or replace).
-- Vuelta atrás: supabase/vuelta-atras/20261121T2346_r15b_libro_del_dia_anade.down.sql

-- 1 · Lo que había ---------------------------------------------------------------------------
create table if not exists public.conta_tpv_libro_antes (
  vat_book_entry_id uuid primary key references public.vat_book_entry(id) on delete cascade,
  account_id        uuid not null references public.accounts(id) on delete cascade,
  company_id        uuid not null references public.company(id) on delete cascade,
  entry_id          uuid not null,
  fila              jsonb not null,
  -- «al validar» (un día nuevo) o «rehecho» (un día que ya estaba contabilizado, tanda 2350): la vuelta atrás de la 2350 junta solo los suyos.
  origen            text not null default 'al validar' check (origen in ('al validar', 'rehecho')),
  created_at        timestamptz not null default now()
);
comment on table public.conta_tpv_libro_antes is
  'R15b. La fila del libro de IVA de cada tipo de un día del TPV, como era antes de repartirla por serie, factura con NIF y devolución. Para volver atrás exacto (_conta_tpv_libro_juntar).';
create index if not exists idx_conta_tpv_libro_antes_asiento on public.conta_tpv_libro_antes (entry_id);
alter table public.conta_tpv_libro_antes enable row level security;
drop policy if exists conta_tpv_libro_antes_leer on public.conta_tpv_libro_antes;
create policy conta_tpv_libro_antes_leer on public.conta_tpv_libro_antes for select to authenticated using (public.belongs_to_account(account_id));
revoke all on table public.conta_tpv_libro_antes from anon, authenticated;
grant select on table public.conta_tpv_libro_antes to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then grant select on table public.conta_tpv_libro_antes to conta_lectura; end if;
end $$;

-- 2 · Las filas que tocan --------------------------------------------------------------------
create or replace function public._conta_tpv_libro_grupos(p_dia uuid)
returns table (orden int, clase text, tipo numeric, contador text, desde text, hasta text, docs int, base numeric, cuota numeric, nif text, nombre text)
language sql stable security definer set search_path = public as $function$
  with doc as (
    select d.*, case when d.total < 0 then 'r5' when nullif(btrim(coalesce(d.cliente_nif, '')), '') is not null then 'nif' else 'serie' end as clase
      from public.conta_tpv_documento d where d.dia_id = p_dia
  ), rango as (
    select d.contador, min(d.numero) as desde, max(d.numero) as hasta from doc d group by d.contador
  ), imp as (
    select d.id, d.numero, d.contador, d.clase, d.cliente_nif, d.cliente_nombre, i.tipo, i.base as ib, i.cuota as iq
      from doc d join public.conta_tpv_impuesto i on i.documento_id = d.id
  )
  select 1, 'serie', i.tipo, i.contador, r.desde::text, case when r.hasta <> r.desde then r.hasta::text end,
         count(distinct i.id)::int, round(sum(i.ib), 2), round(sum(i.iq), 2), null::text, 'VENTAS A CONSUMIDOR FINAL'
    from imp i join rango r on r.contador is not distinct from i.contador
   where i.clase = 'serie'
   group by i.tipo, i.contador, r.desde, r.hasta
  union all
  select case when i.clase = 'nif' then 2 else 3 end, i.clase, i.tipo, i.contador, i.numero::text, null::text, 1, round(sum(i.ib), 2), round(sum(i.iq), 2),
         nullif(btrim(coalesce(i.cliente_nif, '')), ''),
         coalesce(nullif(btrim(coalesce(i.cliente_nombre, '')), ''), case when i.clase = 'r5' then 'VENTAS A CONSUMIDOR FINAL' end)
    from imp i
   where i.clase in ('nif', 'r5')
   group by i.clase, i.tipo, i.contador, i.numero, i.cliente_nif, i.cliente_nombre
  order by 1, 4, 3, 5
$function$;
comment on function public._conta_tpv_libro_grupos(uuid) is
  'R15b: las filas del libro de IVA de un día del TPV: una por serie y tipo (con su rango), una por factura con NIF y tipo, una por devolución (R5) y tipo. Solo lee.';
revoke all on function public._conta_tpv_libro_grupos(uuid) from public, anon, authenticated;

-- 3 · Repartir y juntar ----------------------------------------------------------------------
create or replace function public._conta_tpv_libro_repartir(p_dia uuid, p_entry uuid, p_origen text default 'al validar')
returns integer language plpgsql volatile security definer set search_path = public as $function$
declare v_row public.vat_book_entry; g record; v_n int := 0; v_primero boolean; v_b bigint; v_q bigint; v_cambio jsonb;
begin
  if p_dia is null or p_entry is null then return 0; end if;
  -- Ya repartido (o vuelto a pasar): nada.
  if exists (select 1 from public.conta_tpv_libro_antes a where a.entry_id = p_entry) then return 0; end if;
  for v_row in
    select * from public.vat_book_entry where entry_id = p_entry and book = 'issued' and line_id is not null order by tax_rate, id
  loop
    -- Regla 31: lo repartido da, al céntimo, la base y la cuota de su tipo.
    select coalesce(sum(round(x.base * 100)), 0), coalesce(sum(round(x.cuota * 100)), 0) into v_b, v_q
      from public._conta_tpv_libro_grupos(p_dia) x where x.tipo = v_row.tax_rate;
    if v_b <> round(v_row.tax_base * 100) or v_q <> round(v_row.tax_amount * 100) then
      raise exception 'El libro del % al % %% no se reparte: sus facturas dan % de base y % de IVA, y el libro tiene % y %.',
        to_char(v_row.issue_date, 'DD/MM/YYYY'), public.conta_numero_texto(v_row.tax_rate),
        public.conta_euros_exactos(v_b / 100.0), public.conta_euros_exactos(v_q / 100.0),
        public.conta_euros_exactos(v_row.tax_base), public.conta_euros_exactos(v_row.tax_amount) using errcode = '23514';
    end if;
    insert into public.conta_tpv_libro_antes (vat_book_entry_id, account_id, company_id, entry_id, fila, origen)
    values (v_row.id, v_row.account_id, v_row.company_id, p_entry, to_jsonb(v_row), coalesce(p_origen, 'al validar'));
    v_primero := true;
    for g in select * from public._conta_tpv_libro_grupos(p_dia) x where x.tipo = v_row.tax_rate order by x.orden, x.contador, x.desde loop
      v_cambio := jsonb_build_object(
        'invoice_type', case g.clase when 'nif' then 'F1' when 'r5' then 'R5' else case when g.docs > 1 then 'F4' else 'F2' end end,
        'series', g.contador, 'number', g.desde, 'number_to', g.hasta, 'documents_count', greatest(g.docs, 1),
        'counterpart_tax_id', g.nif, 'counterpart_name', g.nombre, 'counterpart_id_type', null, 'counterpart_country', null, 'party_id', null,
        'tax_base', g.base, 'tax_amount', g.cuota, 'total', g.base + g.cuota, 'updated_at', now(), 'updated_by_name', 'R15b · el libro del día');
      if v_primero then
        update public.vat_book_entry v set
          invoice_type = n.invoice_type, series = n.series, number = n.number, number_to = n.number_to, documents_count = n.documents_count,
          counterpart_tax_id = n.counterpart_tax_id, counterpart_name = n.counterpart_name, counterpart_id_type = n.counterpart_id_type,
          counterpart_country = n.counterpart_country, party_id = n.party_id, tax_base = n.tax_base, tax_amount = n.tax_amount, total = n.total,
          updated_at = n.updated_at, updated_by_name = n.updated_by_name
          from jsonb_populate_record(null::public.vat_book_entry, to_jsonb(v_row) || v_cambio) n
         where v.id = v_row.id;
        v_primero := false;
      else
        insert into public.vat_book_entry
        select (jsonb_populate_record(null::public.vat_book_entry, to_jsonb(v_row) || v_cambio
                  || jsonb_build_object('id', gen_random_uuid(), 'line_id', null, 'created_at', now()))).*;
      end if;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end $function$;
comment on function public._conta_tpv_libro_repartir(uuid, uuid, text) is
  'R15b: reparte el libro de IVA de un día del TPV por serie, factura con NIF y devolución (R5), sin tocar su asiento. Si no da la misma base y cuota por tipo, para. Guarda lo de antes en conta_tpv_libro_antes. Se puede pasar dos veces.';
revoke all on function public._conta_tpv_libro_repartir(uuid, uuid, text) from public, anon, authenticated;

create or replace function public._conta_tpv_libro_juntar(p_entry uuid)
returns integer language plpgsql volatile security definer set search_path = public as $function$
declare a record; v_n int := 0;
begin
  if not exists (select 1 from public.conta_tpv_libro_antes where entry_id = p_entry) then return 0; end if;
  delete from public.vat_book_entry where entry_id = p_entry and book = 'issued' and line_id is null;
  for a in select x.vat_book_entry_id, (jsonb_populate_record(null::public.vat_book_entry, x.fila)).* from public.conta_tpv_libro_antes x where x.entry_id = p_entry loop
    update public.vat_book_entry v set
      invoice_type = a.invoice_type, series = a.series, number = a.number, number_to = a.number_to, documents_count = a.documents_count,
      counterpart_tax_id = a.counterpart_tax_id, counterpart_name = a.counterpart_name, counterpart_id_type = a.counterpart_id_type,
      counterpart_country = a.counterpart_country, party_id = a.party_id, tax_base = a.tax_base, tax_amount = a.tax_amount, total = a.total,
      updated_at = a.updated_at, updated_by_name = a.updated_by_name
     where v.id = a.vat_book_entry_id;
    v_n := v_n + 1;
  end loop;
  delete from public.conta_tpv_libro_antes where entry_id = p_entry;
  return v_n;
end $function$;
comment on function public._conta_tpv_libro_juntar(uuid) is
  'R15b: vuelve el libro de IVA de un día del TPV a como era antes de repartirlo (una fila por tipo), con lo guardado en conta_tpv_libro_antes.';
revoke all on function public._conta_tpv_libro_juntar(uuid) from public, anon, authenticated;

-- 4 · El libro de un día, para su ficha --------------------------------------------------------
create or replace function public.conta_tpv_dia_libro(p_dia uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare v_d public.conta_tpv_dia; v_r jsonb;
begin
  select * into v_d from public.conta_tpv_dia where id = p_dia;
  if v_d.id is null or not (coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(v_d.account_id)) then
    raise exception 'Ese día no está.' using errcode = 'P0002';
  end if;
  if v_d.entry_id is not null and exists (select 1 from public.vat_book_entry where entry_id = v_d.entry_id and book = 'issued') then
    select jsonb_build_object('en_libro', true, 'repartido', exists (select 1 from public.conta_tpv_libro_antes a where a.entry_id = v_d.entry_id),
             'filas', coalesce(jsonb_agg(jsonb_build_object(
               'tipo_factura', v.invoice_type, 'serie', v.series, 'numero', v.number, 'hasta', v.number_to, 'documentos', v.documents_count,
               'nif', v.counterpart_tax_id, 'nombre', v.counterpart_name, 'tipo', v.tax_rate, 'base', v.tax_base, 'cuota', v.tax_amount, 'total', v.total)
               order by case when v.invoice_type in ('F4', 'F2') then 1 when v.invoice_type = 'F1' then 2 else 3 end, v.series, v.number, v.tax_rate), '[]'::jsonb))
      into v_r
      from public.vat_book_entry v where v.entry_id = v_d.entry_id and v.book = 'issued' and v.voided_at is null;
  else
    select jsonb_build_object('en_libro', false, 'repartido', false,
             'filas', coalesce(jsonb_agg(jsonb_build_object(
               'tipo_factura', case g.clase when 'nif' then 'F1' when 'r5' then 'R5' else case when g.docs > 1 then 'F4' else 'F2' end end,
               'serie', g.contador, 'numero', g.desde, 'hasta', g.hasta, 'documentos', g.docs, 'nif', g.nif, 'nombre', g.nombre,
               'tipo', g.tipo, 'base', g.base, 'cuota', g.cuota, 'total', g.base + g.cuota)
               order by g.orden, g.contador, g.desde, g.tipo), '[]'::jsonb))
      into v_r
      from public._conta_tpv_libro_grupos(p_dia) g;
  end if;
  return v_r;
end $function$;
comment on function public.conta_tpv_dia_libro(uuid) is
  'R15b: las filas del libro de IVA de un día del TPV (las de verdad si está contabilizado; si no, las que tendrá): por serie, factura con NIF y devolución (R5). Solo lee.';
revoke all on function public.conta_tpv_dia_libro(uuid) from public, anon;
grant execute on function public.conta_tpv_dia_libro(uuid) to authenticated, service_role;

-- 5 · «Facturas emitidas», con las filas del libro --------------------------------------------
create or replace function public.conta_tpv_emitidas_libro(p_company uuid, p_desde date default null, p_hasta date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare v_acc uuid; v_r jsonb;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(v_acc)) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  with d as (
    select t.* from public.conta_tpv_dia t
     where t.company_id = p_company and t.account_id = v_acc and t.estado = 'contabilizado' and t.entry_id is not null
       and (p_desde is null or t.dia >= p_desde) and (p_hasta is null or t.dia <= p_hasta)
  ), f as (
    -- Una factura (o una serie) con varios tipos va en una fila: se suman sus tipos.
    select d.id as dia_id, d.dia, d.programa, d.entry_id, v.invoice_type, v.series, v.number, v.number_to,
           max(v.documents_count) as documentos, v.counterpart_tax_id as nif, v.counterpart_name as nombre,
           sum(v.tax_base) as base, sum(v.tax_amount) as cuota, sum(v.total) as total
      from d join public.vat_book_entry v on v.entry_id = d.entry_id and v.book = 'issued' and v.voided_at is null and v.account_id = v_acc
     group by d.id, d.dia, d.programa, d.entry_id, v.invoice_type, v.series, v.number, v.number_to, v.counterpart_tax_id, v.counterpart_name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'clase', case when f.invoice_type = 'F1' then 'nif' when f.invoice_type like 'R%' then 'r5' else 'serie' end,
           'dia_id', f.dia_id, 'dia', f.dia, 'programa_nombre', case f.programa when 'revo' then 'Revo' else f.programa end,
           'tipo_factura', f.invoice_type, 'serie', f.series, 'numero', f.number, 'hasta', f.number_to, 'documentos', f.documentos,
           'nif', f.nif, 'nombre', f.nombre, 'base', f.base, 'cuota', f.cuota, 'total', f.total, 'asiento_id', f.entry_id,
           'pdf', case when f.invoice_type in ('F4', 'F2') then (select j.storage_path from public.journal_entry_document j
                       where j.entry_id = f.entry_id and j.kind = 'resumen_ventas' order by j.created_at desc limit 1) end)
           order by f.dia desc, case when f.invoice_type in ('F4', 'F2') then 1 when f.invoice_type = 'F1' then 2 else 3 end, f.series, f.number), '[]'::jsonb)
    into v_r from f;
  return v_r;
end $function$;
comment on function public.conta_tpv_emitidas_libro(uuid, date, date) is
  'R15b: los días del TPV contabilizados, con las filas de su libro de IVA (por serie, facturas con NIF y devoluciones R5; los tipos de una misma factura, juntos). Para «Facturas emitidas». Solo lee.';
revoke all on function public.conta_tpv_emitidas_libro(uuid, date, date) from public, anon;
grant execute on function public.conta_tpv_emitidas_libro(uuid, date, date) to authenticated, service_role;

-- 6 · Preparada para el 347 --------------------------------------------------------------------
create or replace function public.conta_347_ventas_por_cliente(p_company uuid, p_anio int)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare v_acc uuid; v_r jsonb;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(v_acc)) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  with v as (
    select v.counterpart_tax_id as nif, v.counterpart_name as nombre, v.total, v.issue_date, v.number
      from public.vat_book_entry v
     where v.account_id = v_acc and v.company_id = p_company and v.book = 'issued' and v.voided_at is null
       and nullif(btrim(coalesce(v.counterpart_tax_id, '')), '') is not null
       and v.issue_date >= make_date(p_anio, 1, 1) and v.issue_date < make_date(p_anio + 1, 1, 1)
  )
  select coalesce(jsonb_agg(x order by (x->>'total')::numeric desc), '[]'::jsonb) into v_r from (
    select jsonb_build_object('nif', nif, 'nombre', max(nombre), 'facturas', count(distinct number), 'total', sum(total),
             't1', coalesce(sum(total) filter (where extract(quarter from issue_date) = 1), 0),
             't2', coalesce(sum(total) filter (where extract(quarter from issue_date) = 2), 0),
             't3', coalesce(sum(total) filter (where extract(quarter from issue_date) = 3), 0),
             't4', coalesce(sum(total) filter (where extract(quarter from issue_date) = 4), 0)) as x
      from v group by nif
  ) z;
  return v_r;
end $function$;
comment on function public.conta_347_ventas_por_cliente(uuid, integer) is
  'R15b: lo emitido a cada NIF en el año, del libro de IVA (total con IVA, y por trimestre). Preparada para el 347 (que todavía no existe en Sumied): el umbral de 3.005,06 € y las exclusiones las pondrá él. Solo lee.';
revoke all on function public.conta_347_ventas_por_cliente(uuid, integer) from public, anon;
grant execute on function public.conta_347_ventas_por_cliente(uuid, integer) to authenticated, service_role;
