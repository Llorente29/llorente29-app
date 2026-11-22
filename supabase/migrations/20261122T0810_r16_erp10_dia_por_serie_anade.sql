-- supabase/migrations/20261122T0810_r16_erp10_dia_por_serie_anade.sql
--
-- R16 · El día del TPV sale a ERP10 como su libro de IVA: una expedida por serie, una por
-- cada factura con NIF (a su cliente) y una por cada devolución (en negativo, con su número;
-- Julio, 22/11: ERP10 no admite rectificativas al importar). Solo AÑADE funciones nuevas: no
-- cambia conta_erp10_dias_tpv_por_salir ni nada de lo que existe. El reparto del fichero lo
-- hace supabase/functions/_shared/erp10Ficheros.ts con lo que da esta.
--
--   1. _conta_tpv_cliente_cuenta(empresa, NIF, nombre, quién): la 430 del cliente con ese NIF
--      en la empresa. Si no tiene ficha en Sumied, se crea (tercero, cliente y su 430, la
--      siguiente libre, como el R14 con los proveedores).
--   2. conta_erp10_clientes_tpv(empresa, mes): para los días del TPV del mes, la 430 de cada
--      cliente con NIF de su libro de IVA, creando los que falten. Devuelve cada cliente con su
--      cuenta y si es nuevo («se dice»). La llama la salida a ERP10 antes de leer los días.
--   3. conta_erp10_dias_tpv_libro(empresa, mes): las filas del libro de IVA de cada día del TPV
--      del mes (las del R15b), con la 430 del cliente de cada factura con NIF; y esas 430, con
--      su NIF y su nombre, para «Primero, las fichas nuevas». Solo lee.
-- Todo vale para cualquier TPV: nada de aquí es de Revo.
-- Se puede pasar dos veces (create or replace).
-- Vuelta atrás: supabase/vuelta-atras/20261122T0810_r16_erp10_dia_por_serie_anade.down.sql

-- 1 · La 430 del cliente de una factura con NIF ------------------------------------------------
create or replace function public._conta_tpv_cliente_cuenta(p_company uuid, p_nif text, p_nombre text, p_quien text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare v_acc uuid; v_nif text := upper(regexp_replace(coalesce(p_nif, ''), '[^0-9A-Za-z]', '', 'g')); v_party uuid; v_code text; v_nombre text;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or v_nif = '' then return null; end if;
  -- El cliente con ese NIF en la cuenta que ya tiene su 430 en esta empresa.
  select a.code, p.id into v_code, v_party
    from public.party p
    join public.company_account_link k on k.entity = 'customer' and k.entity_id = p.id::text and k.role = 'principal' and k.company_id = p_company and k.account_id = v_acc
    join public.company_account a on a.id = k.company_account_id and a.company_id = p_company and a.status is distinct from 'cerrada'
   where p.account_id = v_acc and upper(regexp_replace(coalesce(p.tax_id, ''), '[^0-9A-Za-z]', '', 'g')) = v_nif and p.archived_at is null
   order by p.created_at limit 1;
  if v_code is not null then return jsonb_build_object('codigo', v_code, 'nuevo', false, 'party_id', v_party); end if;
  -- El tercero con ese NIF (sin 430 en esta empresa) o uno nuevo, como cliente.
  v_nombre := coalesce(nullif(btrim(coalesce(p_nombre, '')), ''), 'Cliente ' || v_nif);
  select p.id into v_party from public.party p
   where p.account_id = v_acc and upper(regexp_replace(coalesce(p.tax_id, ''), '[^0-9A-Za-z]', '', 'g')) = v_nif and p.archived_at is null
   order by p.created_at limit 1;
  if v_party is null then
    insert into public.party (account_id, name, tax_id, source, created_by_name) values (v_acc, v_nombre, v_nif, 'manual', coalesce(p_quien, 'Sumied (R16)'))
    returning id into v_party;
  end if;
  if not exists (select 1 from public.party_role where party_id = v_party and role = 'customer') then
    insert into public.party_role (account_id, party_id, role) values (v_acc, v_party, 'customer');
  end if;
  if not exists (select 1 from public.customer_fiscal where party_id = v_party) then
    insert into public.customer_fiscal (party_id, account_id, legal_name) values (v_party, v_acc, v_nombre);
  end if;
  v_code := (public.company_account_add(p_company, '4300', v_nombre, null, 'customer', v_party::text, coalesce(p_quien, 'Sumied (R16)'), 'manual')) ->> 'code';
  return jsonb_build_object('codigo', v_code, 'nuevo', true, 'party_id', v_party);
end $function$;
comment on function public._conta_tpv_cliente_cuenta(uuid, text, text, text) is
  'R16: la 430 del cliente con ese NIF en la empresa; si no tiene ficha en Sumied, la crea (tercero, cliente y su 430, la siguiente libre). Para la salida a ERP10 de las facturas con NIF de los días del TPV.';
revoke all on function public._conta_tpv_cliente_cuenta(uuid, text, text, text) from public, anon, authenticated;

-- 2 · Los clientes con NIF de los días del mes, con su 430 -------------------------------------
create or replace function public.conta_erp10_clientes_tpv(p_company uuid, p_mes date, p_quien_nombre text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare v_c public.company; f record; v_r jsonb := '[]'::jsonb; x jsonb;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null or (auth.uid() is not null and not public.belongs_to_account(v_c.account_id)) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if p_mes is null then raise exception 'Falta el mes.' using errcode = '22023'; end if;
  for f in
    select distinct on (upper(regexp_replace(v.counterpart_tax_id, '[^0-9A-Za-z]', '', 'g')))
           v.counterpart_tax_id as nif, v.counterpart_name as nombre
      from public.conta_tpv_dia d
      join public.vat_book_entry v on v.entry_id = d.entry_id and v.account_id = d.account_id and v.book = 'issued' and v.voided_at is null
     where d.company_id = p_company and d.account_id = v_c.account_id and d.estado = 'contabilizado'
       and d.dia >= date_trunc('month', p_mes)::date and d.dia < (date_trunc('month', p_mes) + interval '1 month')::date
       and v.invoice_type = 'F1' and nullif(btrim(coalesce(v.counterpart_tax_id, '')), '') is not null
     order by upper(regexp_replace(v.counterpart_tax_id, '[^0-9A-Za-z]', '', 'g')), d.dia
  loop
    x := public._conta_tpv_cliente_cuenta(p_company, f.nif, f.nombre, p_quien_nombre);
    if x is not null then v_r := v_r || jsonb_build_object('nif', f.nif, 'nombre', f.nombre, 'codigo', x ->> 'codigo', 'nuevo', (x ->> 'nuevo')::boolean); end if;
  end loop;
  return v_r;
end $function$;
comment on function public.conta_erp10_clientes_tpv(uuid, date, text) is
  'R16: la 430 de cada cliente con NIF de los días del TPV del mes (de su libro de IVA, R15b), creando los que no tienen ficha en Sumied. Dice cuáles son nuevos. La llama la salida a ERP10 antes de leer los días.';
revoke all on function public.conta_erp10_clientes_tpv(uuid, date, text) from public, anon;
grant execute on function public.conta_erp10_clientes_tpv(uuid, date, text) to authenticated, service_role;

-- 3 · El libro de cada día del mes, para el fichero de ERP10 ------------------------------------
create or replace function public.conta_erp10_dias_tpv_libro(p_company uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare v_c public.company; v_r jsonb;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null or (auth.uid() is not null and not public.belongs_to_account(v_c.account_id)) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if p_mes is null then raise exception 'Falta el mes.' using errcode = '22023'; end if;
  with d as (
    select t.entry_id from public.conta_tpv_dia t
     where t.company_id = p_company and t.account_id = v_c.account_id and t.estado = 'contabilizado' and t.entry_id is not null
       and t.dia >= date_trunc('month', p_mes)::date and t.dia < (date_trunc('month', p_mes) + interval '1 month')::date
  ), l as (
    select v.entry_id, v.invoice_type, v.series, v.number, v.number_to, v.documents_count, v.counterpart_tax_id, v.counterpart_name,
           v.tax_rate, v.tax_base, v.tax_amount, v.total,
           (select a.code from public.party p
              join public.company_account_link k on k.entity = 'customer' and k.entity_id = p.id::text and k.role = 'principal'
                                                 and k.company_id = p_company and k.account_id = v_c.account_id
              join public.company_account a on a.id = k.company_account_id and a.status is distinct from 'cerrada'
             where p.account_id = v_c.account_id and v.invoice_type = 'F1'
               and upper(regexp_replace(coalesce(p.tax_id, ''), '[^0-9A-Za-z]', '', 'g')) = upper(regexp_replace(coalesce(v.counterpart_tax_id, ''), '[^0-9A-Za-z]', '', 'g'))
               and nullif(btrim(coalesce(v.counterpart_tax_id, '')), '') is not null and p.archived_at is null
             order by p.created_at limit 1) as cliente
      from d join public.vat_book_entry v on v.entry_id = d.entry_id and v.account_id = v_c.account_id and v.book = 'issued' and v.voided_at is null
  )
  select jsonb_build_object(
    'dias', coalesce((select jsonb_object_agg(e, filas) from (
        select l.entry_id::text as e, jsonb_agg(jsonb_build_object(
          'tipo', l.invoice_type, 'serie', l.series, 'numero', l.number, 'hasta', l.number_to, 'documentos', l.documents_count,
          'nif', l.counterpart_tax_id, 'nombre', l.counterpart_name, 'pct', l.tax_rate, 'base', l.tax_base, 'cuota', l.tax_amount, 'total', l.total,
          'cliente', l.cliente) order by case when l.invoice_type in ('F4', 'F2') then 1 when l.invoice_type = 'F1' then 2 else 3 end, l.series, l.number, l.tax_rate) as filas
          from l group by l.entry_id) z), '{}'::jsonb),
    'cuentas', coalesce((select jsonb_agg(distinct jsonb_build_object('codigo', a.code, 'plantilla', a.template_code, 'nombre', a.name, 'nif', l.counterpart_tax_id, 'gastoHabitual', null))
        from l join public.company_account a on a.company_id = p_company and a.account_id = v_c.account_id and a.code = l.cliente
       where l.cliente is not null), '[]'::jsonb)
  ) into v_r;
  return v_r;
end $function$;
comment on function public.conta_erp10_dias_tpv_libro(uuid, date) is
  'R16: las filas del libro de IVA de cada día del TPV del mes (por serie, facturas con NIF y devoluciones, R15b), con la 430 del cliente de cada factura con NIF; y esas 430 con su NIF y nombre, para las fichas nuevas de ERP10. Solo lee.';
revoke all on function public.conta_erp10_dias_tpv_libro(uuid, date) from public, anon;
grant execute on function public.conta_erp10_dias_tpv_libro(uuid, date) to authenticated, service_role;
