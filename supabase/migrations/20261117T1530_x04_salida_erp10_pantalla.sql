-- supabase/migrations/20261117T1530_x04_salida_erp10_pantalla.sql
--
-- X04 · Lo que la pantalla «Salida a ERP10» necesita de la base (encargo X04,
-- 17/11). SOLO AÑADE: una columna que admite nulos y dos funciones nuevas. No
-- cambia ninguna función de la X02 (regla 2: conta_erp10_salida_poner sigue con
-- su firma) ni nada de Diez. Nada en el camino del pedido.
--
--   1. conta_erp10_salida_empresa.carpeta_pdf: en qué carpeta del ordenador de
--      ERP10 se dejan los PDF (la ruta que va en «Ruta documento»). Nulo: la de
--      siempre, C:\Sumied\<código>\ (la pone la pantalla).
--   2. conta_erp10_salida_carpeta(empresa, carpeta, quien): la pone o la quita.
--      Solo un administrador, y con la salida ya configurada.
--   3. conta_erp10_recibidas_por_salir(empresa, mes): de cada factura recibida
--      que sale ese mes (las que conta_erp10_por_salir da como «recibida» y que
--      salen), lo que necesita prepararRecibidas (src/modules/conta/erp10/
--      ficheros.ts): fecha, factura, proveedor, líneas con su plantilla, tipo y
--      base del IVA, deducible, recargo y modelo de retención; la operación ya
--      decidida (inversión del sujeto pasivo; intracomunitaria de bienes si
--      alguna cuenta de gasto es del grupo 60, si no, de servicios; si no,
--      interior); y su PDF con su ruta en el almacén. Y, de cada cuenta que usan,
--      lo que lleva su fila de subcuentas (NIF y cuenta de gasto habitual si es
--      de un proveedor), con las ya salidas para ver las que chocan. Solo lee.
--
-- Vuelta atrás: supabase/vuelta-atras/20261117T1530_x04_salida_erp10_pantalla.down.sql

alter table public.conta_erp10_salida_empresa add column if not exists carpeta_pdf text;
comment on column public.conta_erp10_salida_empresa.carpeta_pdf is
  'X04 · La carpeta del ordenador de ERP10 donde se descomprimen los PDF (va en «Ruta documento» de cada factura). Nulo: C:\Sumied\<código>\. Se pone con conta_erp10_salida_carpeta.';

-- 2 · La carpeta de los PDF ---------------------------------------------------------------------
create or replace function public.conta_erp10_salida_carpeta(p_company uuid, p_carpeta text, p_quien_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.company;
  v_z public.conta_erp10_salida_empresa;
  v_carpeta text := nullif(btrim(coalesce(p_carpeta, '')), '');
  v_quien text;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null or not public.belongs_to_account(v_c.account_id) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if not public.current_user_is_admin_of(v_c.account_id) then
    raise exception 'Solo un administrador de la cuenta cambia la salida a ERP10.' using errcode = '42501';
  end if;
  select * into v_z from public.conta_erp10_salida_empresa where company_id = v_c.id for update;
  if v_z.company_id is null then
    raise exception 'Primero enciende la salida a ERP10 con el código de la empresa.' using errcode = '23514';
  end if;
  if v_carpeta is not null and (length(v_carpeta) > 200 or v_carpeta ~ '[[:cntrl:]<>"|?*]') then
    raise exception 'Esa carpeta no vale: como mucho 200 caracteres y sin < > " | ? *.' using errcode = '22023';
  end if;
  if v_z.carpeta_pdf is distinct from v_carpeta then
    v_quien := nullif(btrim(coalesce(p_quien_nombre, public.conta_nombre_actor(), '')), '');
    update public.conta_erp10_salida_empresa
       set carpeta_pdf = v_carpeta, cambiado_por = auth.uid(), cambiado_por_nombre = v_quien, cambiado_en = now()
     where company_id = v_c.id
    returning * into v_z;
  end if;
  return jsonb_build_object('carpeta', v_z.carpeta_pdf,
    'texto', case when v_z.carpeta_pdf is null
      then format('Los PDF irán a la carpeta de siempre, C:\Sumied\%s\.', v_z.codigo_erp10)
      else format('Los PDF irán a la carpeta %s.', v_z.carpeta_pdf) end);
end $$;
comment on function public.conta_erp10_salida_carpeta(uuid, text, text) is
  'X04 · Pone (o quita, con nulo o vacío) la carpeta del ordenador de ERP10 donde se descomprimen los PDF de la salida. Solo un administrador y con la salida ya configurada. Devuelve cómo ha quedado.';
revoke all on function public.conta_erp10_salida_carpeta(uuid, text, text) from public, anon;
grant execute on function public.conta_erp10_salida_carpeta(uuid, text, text) to authenticated, service_role;

-- 3 · Las recibidas que salen, con lo que necesita su fila -----------------------------------------
create or replace function public.conta_erp10_recibidas_por_salir(p_company uuid, p_mes date)
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
  -- Las mismas reglas que enseña la pantalla: solo las recibidas que salen.
  v_ps := public.conta_erp10_por_salir(v_c.id, p_mes);
  select coalesce(array_agg((p ->> 'entry_id')::uuid), '{}') into v_ids
    from jsonb_array_elements(v_ps -> 'partidas') p
   where p ->> 'clase' = 'recibida' and (p ->> 'sale')::boolean;

  with e as (
    select e.* from public.journal_entry e
     where e.id = any (v_ids) and e.company_id = v_c.id and e.account_id = v_c.account_id
  ),
  si as (
    select distinct on (e.id) e.id as entry_id, i.invoice_number, i.invoice_date, i.issuer_name, i.issuer_tax_id, s.legal_name, s.name as s_name, s.tax_id
      from e
      join public.supplier_invoice i on i.account_id = e.account_id
                                    and ((e.source_type = 'supplier_invoice' and i.id = e.source_id) or i.journal_entry_id = e.id)
      left join public.supplier s on s.id = i.supplier_id and s.account_id = e.account_id
     order by e.id, (i.id = e.source_id) desc
  ),
  libro as (
    select v.entry_id, min(v.number) as numero, min(v.issue_date) as fecha, min(v.counterpart_tax_id) as nif, min(v.counterpart_name) as nombre
      from public.vat_book_entry v join e on e.id = v.entry_id
     where v.account_id = v_c.account_id and v.voided_at is null and v.book in ('received', 'investment')
     group by v.entry_id
  ),
  lineas as (
    select l.entry_id, l.position, a.code, a.template_code, l.debit, l.credit, t.rate, t.treatment, l.tax_base, l.vat_deductible, l.withholding_model,
           (select v.surcharge_rate from public.vat_book_entry v
             where v.line_id = l.id and v.account_id = l.account_id and v.voided_at is null and coalesce(v.surcharge_amount, 0) <> 0 limit 1) as recargo
      from public.journal_line l
      join e on e.id = l.entry_id
      join public.company_account a on a.id = l.company_account_id and a.account_id = l.account_id
      left join public.tax_rate t on t.id = l.tax_rate_id
     where l.account_id = v_c.account_id
  ),
  doc as (
    select distinct on (d.entry_id) d.entry_id, d.storage_path, d.file_name
      from public.journal_entry_document d join e on e.id = d.entry_id
     where d.account_id = v_c.account_id
     order by d.entry_id, (d.kind = 'factura_recibida') desc, d.created_at desc
  ),
  cuentas as (
    select distinct a.id, a.code, a.template_code, a.name
      from lineas l join public.company_account a on a.company_id = v_c.id and a.account_id = v_c.account_id and a.code = l.code
  ),
  terceros as (
    -- La ficha del proveedor enlazado a la cuenta: su NIF y su cuenta de gasto habitual.
    select distinct on (c.id) c.id, s.tax_id, coalesce(nullif(btrim(s.legal_name), ''), s.name) as nombre_fiscal,
           (select g.code from public.company_account_link kg join public.company_account g on g.id = kg.company_account_id
             where kg.company_id = v_c.id and kg.account_id = v_c.account_id and kg.entity = 'supplier'
               and kg.entity_id = k.entity_id and kg.role = 'gasto' order by kg.created_at limit 1) as gasto
      from cuentas c
      join public.company_account_link k on k.company_account_id = c.id and k.company_id = v_c.id and k.account_id = v_c.account_id
                                        and k.entity = 'supplier' and k.role = 'principal'
      join public.supplier s on s.id::text = k.entity_id and s.account_id = v_c.account_id
     order by c.id, k.created_at
  )
  select jsonb_build_object(
    'mes', v_ps -> 'mes', 'codigo', v_ps -> 'codigo', 'largo', v_ps -> 'largo',
    'recibidas', coalesce((select jsonb_agg(jsonb_build_object(
        'entryId', e.id, 'fecha', e.entry_date,
        'factura', jsonb_build_object('numero', coalesce(nullif(btrim(si.invoice_number), ''), lb.numero, e.document_ref),
                                      'fecha', coalesce(si.invoice_date, lb.fecha, e.document_date, e.entry_date)),
        'proveedor', jsonb_build_object(
            'nombre', coalesce(nullif(btrim(si.issuer_name), ''), nullif(btrim(si.legal_name), ''), si.s_name, lb.nombre, e.concept),
            'nif', coalesce(nullif(btrim(si.issuer_tax_id), ''), nullif(btrim(si.tax_id), ''), lb.nif)),
        'operacion', case
            when exists (select 1 from lineas l where l.entry_id = e.id and l.treatment = 'reverse_charge') then 'isp'
            when exists (select 1 from lineas l where l.entry_id = e.id and l.treatment = 'intra_eu') then
              case when exists (select 1 from lineas l where l.entry_id = e.id and l.code like '60%') then 'intra_bienes' else 'intra_servicios' end
            else 'interior' end,
        'lineas', (select jsonb_agg(jsonb_build_object('cuenta', l.code, 'plantilla', l.template_code, 'debe', l.debit, 'haber', l.credit,
                      'tipoIva', l.rate, 'baseIva', l.tax_base, 'deducible', l.vat_deductible, 'recargo', l.recargo, 'modeloRetencion', l.withholding_model)
                      order by l.position) from lineas l where l.entry_id = e.id),
        'tienePdf', d.entry_id is not null,
        'pdf', case when d.entry_id is null then null else jsonb_build_object('ruta', d.storage_path, 'nombre', d.file_name) end)
        order by e.entry_date, e.series, e.number)
      from e left join si on si.entry_id = e.id left join libro lb on lb.entry_id = e.id left join doc d on d.entry_id = e.id), '[]'::jsonb),
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object('codigo', c.code, 'plantilla', c.template_code, 'nombre', c.name,
        'nif', t.tax_id, 'gastoHabitual', t.gasto) order by c.code)
      from cuentas c left join terceros t on t.id = c.id), '[]'::jsonb),
    'yaSalidas', coalesce((select jsonb_object_agg(s.codigo_erp10, s.codigo)
      from public.conta_erp10_subcuenta_salida s where s.company_id = v_c.id and s.account_id = v_c.account_id), '{}'::jsonb)
  ) into v_r;
  return v_r;
end $$;
comment on function public.conta_erp10_recibidas_por_salir(uuid, date) is
  'X04 · De cada factura recibida que sale a ERP10 ese mes (las de conta_erp10_por_salir que salen), lo que necesita su fila: fecha, factura, proveedor, líneas (plantilla, IVA, deducible, recargo, retención), la operación ya decidida y su PDF; las cuentas que usan con el NIF y la cuenta de gasto habitual de su proveedor; y las ya salidas. Solo lee.';
revoke all on function public.conta_erp10_recibidas_por_salir(uuid, date) from public, anon;
grant execute on function public.conta_erp10_recibidas_por_salir(uuid, date) to authenticated, service_role;
