-- supabase/migrations/20261119T0551_x08_dias_tpv_por_salir.sql
--
-- X08 · Los días del TPV que salen a ERP10, con lo que necesita su fichero (encargo X08 y
-- respuestas X08 · 3 y X08 · 4, 19/11). SOLO AÑADE: una función nueva, que solo lee. No
-- cambia ninguna otra.
--
-- conta_erp10_dias_tpv_por_salir(empresa, mes): de cada día de ventas que sale ese mes
-- (los de conta_erp10_por_salir de clase «emitida», origen «sales_day», que salen):
--   · de dónde viene (un día de Revo, conta_tpv_dia; o del TPV de Folvy,
--     sales_day_summary), su local, y su rango de facturas: el primer número, el último
--     y cuántas (Revo: primer_numero, ultimo_numero y documentos, y cuántos contadores
--     del TPV lleva el día; Folvy: first_invoice, last_invoice y tickets_count, que hoy
--     casi nunca tiene);
--   · cada apunte de su asiento validado, con su cuenta, su plantilla, su nombre, su
--     debe y su haber, y el tipo y la base del I.V.A. si los lleva: lo que Sumied tiene
--     en su diario para ese día, que es lo que sale (respuesta X08 · 4);
--   · la cuenta «Clientes de contado» de la sociedad: las 430 cuyo nombre dice «contado»
--     (en la 430, no en la 4311 «efectos comerciales descontados»), todas, para que la
--     pantalla diga si falta o si hay más de una;
--   · y, de cada cuenta que usan, lo que lleva su fila de subcuentas (con las ya salidas).
-- Lo que no puede salir (sin rango, dos contadores, sin «Clientes de contado»…) lo decide
-- y lo dice la pantalla (src/modules/conta/erp10/ficheros.ts, prepararDiasTpv).
--
-- Prueba: supabase/staging/sql/20261119_x08_dias_tpv_a_erp10_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261119T0551_x08_dias_tpv_por_salir.down.sql

create or replace function public.conta_erp10_dias_tpv_por_salir(p_company uuid, p_mes date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c public.company;
  v_ps jsonb;
  v_ids uuid[];
  v_r jsonb;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.belongs_to_account(v_c.account_id) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  -- Las mismas reglas que enseña la pantalla: solo los días que salen.
  v_ps := public.conta_erp10_por_salir(v_c.id, p_mes);
  select coalesce(array_agg((p ->> 'entry_id')::uuid), '{}') into v_ids
    from jsonb_array_elements(v_ps -> 'partidas') p
   where p ->> 'clase' = 'emitida' and p ->> 'origen' = 'sales_day' and (p ->> 'sale')::boolean;

  with e as (
    select e.* from public.journal_entry e
     where e.id = any (v_ids) and e.company_id = v_c.id and e.account_id = v_c.account_id
  ),
  revo as (
    select d.entry_id, d.programa, d.primer_numero::text as primero, d.ultimo_numero::text as ultimo, d.documentos as facturas,
           (select count(distinct o.contador) from public.conta_tpv_documento o where o.dia_id = d.id)::int as contadores
      from public.conta_tpv_dia d join e on e.id = d.entry_id
     where d.company_id = v_c.id and d.account_id = v_c.account_id
  ),
  folvy as (
    select distinct on (s.entry_id) s.entry_id, s.location_id, o.name as local, s.first_invoice as primero, s.last_invoice as ultimo,
           s.tickets_count as facturas, s.unit_key,
           (select count(*) from public.sales_day_summary z where z.entry_id = s.entry_id)::int as resumenes
      from public.sales_day_summary s join e on e.id = s.entry_id
      left join public.locations o on o.id = s.location_id
     where s.company_id = v_c.id and s.account_id = v_c.account_id
     order by s.entry_id, s.sales_day, s.id
  ),
  lineas as (
    select l.entry_id, l.position, a.id as cuenta_id, a.code, a.template_code, a.name, l.debit, l.credit,
           t.rate as tipo_iva, l.tax_base as base_iva, l.vat_book
      from public.journal_line l
      join e on e.id = l.entry_id
      join public.company_account a on a.id = l.company_account_id and a.account_id = l.account_id
      left join public.tax_rate t on t.id = l.tax_rate_id
     where l.account_id = v_c.account_id
  ),
  contado as (
    select a.id, a.code, a.template_code, a.name from public.company_account a
     where a.company_id = v_c.id and a.account_id = v_c.account_id and a.code like '430%'
       and (a.name ilike '%contado%' or a.plain_name ilike '%contado%') and a.status is distinct from 'cerrada'
  ),
  cuentas as (
    select distinct l.cuenta_id as id, l.code, l.template_code, l.name from lineas l
    union
    select c.id, c.code, c.template_code, c.name from contado c
  ),
  terceros as (
    select distinct on (c.id) c.id,
           coalesce((select s.tax_id from public.supplier s where s.id::text = k.entity_id and s.account_id = v_c.account_id and k.entity = 'supplier'),
                    (select p.tax_id from public.party p where p.id::text = k.entity_id and p.account_id = v_c.account_id and k.entity = 'customer')) as nif
      from cuentas c
      join public.company_account_link k on k.company_account_id = c.id and k.company_id = v_c.id and k.account_id = v_c.account_id
                                        and k.entity in ('supplier', 'customer') and k.role = 'principal'
     order by c.id, k.created_at
  )
  select jsonb_build_object(
    'mes', v_ps -> 'mes', 'codigo', v_ps -> 'codigo', 'largo', v_ps -> 'largo',
    'dias', coalesce((select jsonb_agg(jsonb_build_object(
        'entryId', e.id, 'serie', e.series, 'numero', e.number, 'fecha', e.entry_date, 'concepto', e.concept,
        'origen', case when r.entry_id is not null then 'revo' when f.entry_id is not null then 'folvy' end,
        'local', coalesce(f.local, case r.programa when 'revo' then 'Revo' else r.programa end),
        'localId', f.location_id,
        'primero', coalesce(r.primero, f.primero), 'ultimo', coalesce(r.ultimo, f.ultimo), 'facturas', coalesce(r.facturas, f.facturas),
        'contadores', r.contadores, 'unidad', f.unit_key, 'resumenes', f.resumenes,
        'lineas', (select jsonb_agg(jsonb_build_object('cuenta', l.code, 'plantilla', l.template_code, 'nombre', l.name,
                      'debe', l.debit, 'haber', l.credit, 'tipoIva', l.tipo_iva, 'baseIva', l.base_iva, 'libro', l.vat_book) order by l.position)
                     from lineas l where l.entry_id = e.id))
        order by e.entry_date, e.series, e.number)
      from e left join revo r on r.entry_id = e.id left join folvy f on f.entry_id = e.id), '[]'::jsonb),
    'contado', coalesce((select jsonb_agg(jsonb_build_object('codigo', c.code, 'plantilla', c.template_code, 'nombre', c.name) order by c.code)
      from contado c), '[]'::jsonb),
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object('codigo', c.code, 'plantilla', c.template_code, 'nombre', c.name,
        'nif', t.nif, 'gastoHabitual', null) order by c.code)
      from cuentas c left join terceros t on t.id = c.id), '[]'::jsonb),
    'yaSalidas', coalesce((select jsonb_object_agg(s.codigo_erp10, s.codigo)
      from public.conta_erp10_subcuenta_salida s where s.company_id = v_c.id and s.account_id = v_c.account_id), '{}'::jsonb)
  ) into v_r;
  return v_r;
end $$;
comment on function public.conta_erp10_dias_tpv_por_salir(uuid, date) is
  'X08 · De cada día de ventas que sale a ERP10 ese mes (los de conta_erp10_por_salir de clase «emitida» y origen «sales_day» que salen): de dónde viene (Revo o el TPV de Folvy), su local, su rango de facturas (primero, último, cuántas) y sus contadores, cada apunte de su asiento con su cuenta, plantilla, nombre, debe, haber y su I.V.A.; las cuentas «Clientes de contado» (430 que dicen «contado»); las cuentas que usan con su NIF; y las ya salidas. Solo lee.';
revoke all on function public.conta_erp10_dias_tpv_por_salir(uuid, date) from public, anon;
grant execute on function public.conta_erp10_dias_tpv_por_salir(uuid, date) to authenticated, service_role;
