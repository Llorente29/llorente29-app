-- supabase/migrations/20261118T0745_x07_por_salir_asientos.sql
-- cambia: public.conta_erp10_por_salir(uuid,date) · prueba: supabase/staging/sql/20261118_x07_asientos_a_erp10_prueba.sql
--
-- X07 · conta_erp10_por_salir, para que los asientos salgan (encargo X07, 18/11).
-- Misma firma: create or replace, no una sobrecarga (regla 2). Lo demás, igual que en
-- 20261117T2230_x05_por_salir_emitidas.sql. Los asientos sin libro de I.V.A. ya
-- salían como clase «asiento» (la pantalla los contaba con «Todavía no sale por
-- aquí»); lo que cambia es lo que lleva I.V.A. y no es una factura:
--
--   1. Un asiento con anotación en el libro de I.V.A. que no es de recibidas ni de
--      expedidas (el libro de no sujetas) se tomaba por «recibida», por descarte.
--      Pasa a «asiento», y no sale: «Lleva I.V.A. y no es una factura: métela a mano
--      en ERP10 para que entre en su libro.» Si saliera como asiento, el libro de
--      I.V.A. de ERP10 quedaría incompleto.
--   2. Lo mismo para un asiento sin libro pero con un apunte de I.V.A. (con tipo o con
--      libro en la línea), que no debería existir: si existe, no sale.
-- Medido en staging (PR del X07): hoy no hay ninguno de los dos; los 33 asientos sin
-- I.V.A. que pasan a salir no cambian de clase ni de «sale».
--
-- Antes de cambiarla se guarda la de producción, byte a byte (_respaldar_funcion);
-- la vuelta atrás (supabase/vuelta-atras/20261118T0745_x07_por_salir_asientos.down.sql)
-- la restaura de ahí, comprobando la huella.

select public._respaldar_funcion('public.conta_erp10_por_salir(uuid,date)', '20261118T0745_x07_por_salir_asientos');

create or replace function public.conta_erp10_por_salir(p_company uuid, p_mes date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c public.company;
  v_z public.conta_erp10_salida_empresa;
  v_ini date := date_trunc('month', p_mes)::date;
  v_fin date := (date_trunc('month', p_mes) + interval '1 month')::date;
  v_r jsonb;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.belongs_to_account(v_c.account_id) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if p_mes is null then raise exception 'Falta el mes.' using errcode = '22023'; end if;
  select * into v_z from public.conta_erp10_salida_empresa where company_id = v_c.id;
  if v_z.company_id is null or not v_z.encendida then
    raise exception 'La salida a ERP10 no está encendida en esta empresa.' using errcode = '23514';
  end if;

  with base as (
    select e.id, e.series, e.number, e.entry_date, e.concept, e.source_type
      from public.journal_entry e
     where e.company_id = v_c.id and e.account_id = v_c.account_id
       and e.status = 'validado'
       and e.entry_date >= v_z.desde and e.entry_date < v_fin
       and e.source_type not in ('migrated', 'opening', 'closing', 'template', 'reversal')
       and e.external_program is null and e.import_run_id is null
       and not exists (select 1 from public.conta_erp10_salida_partida p where p.entry_id = e.id and p.estado = 'salida')
       and not exists (select 1 from public.vat_book_entry v where v.entry_id = e.id and v.account_id = e.account_id and v.import_run_id is not null)
       and not exists (select 1 from public.supplier_invoice si where si.journal_entry_id = e.id and si.account_id = e.account_id and si.source = 'traida')
       and not exists (select 1 from public.customer_invoice ci where ci.entry_id = e.id and ci.company_id = e.company_id
                          and (ci.origin = 'traida' or ci.import_run_id is not null))
  ),
  libro as (
    select v.entry_id,
           bool_or(v.book in ('received', 'investment')) as rec,
           bool_or(v.book = 'issued') as emi,
           sum(v.tax_base) as base_iva,
           sum(case when v.book in ('received', 'investment') then coalesce(v.deductible_amount, v.tax_amount) else 0 end) as cuota_sop,
           sum(case when v.book = 'issued' then v.tax_amount + coalesce(v.surcharge_amount, 0) else 0 end) as cuota_rep,
           min(v.number) as numero, min(v.counterpart_tax_id) as nif, min(v.counterpart_name) as nombre
      from public.vat_book_entry v
      join base b on b.id = v.entry_id
     where v.account_id = v_c.account_id and v.company_id = v_c.id and v.voided_at is null
     group by v.entry_id
  ),
  lineas as (
    select l.entry_id,
           sum(l.debit) as importe,
           sum(case when ca.code like '472%' then l.debit - l.credit else 0 end) as sop,
           -- X04a: solo la 477 con libro de expedidas. La autorrepercusión de una inversión del sujeto pasivo
           -- o de una intracomunitaria va a la 477 sin tipo ni libro, y no es IVA repercutido de una factura.
           sum(case when ca.code like '477%' and l.vat_book = 'issued' then l.credit - l.debit else 0 end) as rep,
           count(distinct case when ca.code ~ '^700000[0-9]{2}$' then '70000000' else ca.code end)
             filter (where ca.code ~ '^[67]') as cuentas_base
      from public.journal_line l
      join base b on b.id = l.entry_id
      join public.company_account ca on ca.id = l.company_account_id and ca.account_id = l.account_id
     where l.account_id = v_c.account_id and l.company_id = v_c.id
     group by l.entry_id
  ),
  usadas as (
    select distinct l.entry_id, ca.id as cuenta_id
      from public.journal_line l
      join base b on b.id = l.entry_id
      join public.company_account ca on ca.id = l.company_account_id and ca.account_id = l.account_id
     where l.account_id = v_c.account_id and l.company_id = v_c.id
  ),
  conv as (
    select ca.id, ca.code, ca.name, public.conta_erp10_subcuenta(ca.code, ca.template_code, v_z.largo_subcuenta) as erp,
           exists (select 1 from public.conta_erp10_subcuenta_salida s where s.company_id = v_c.id and s.company_account_id = ca.id) as ya
      from public.company_account ca
     where ca.account_id = v_c.account_id and ca.company_id = v_c.id
       and ca.id in (select cuenta_id from usadas)
  ),
  conv2 as (
    select c.*,
           (c.erp is not null and not c.ya and (
              (select count(*) from conv o where o.erp = c.erp) > 1
              or exists (select 1 from public.conta_erp10_subcuenta_salida s
                          where s.company_id = v_c.id and s.codigo_erp10 = c.erp and s.company_account_id <> c.id))) as choca
      from conv c
  ),
  malas as (
    select u.entry_id, string_agg(c.code, ', ' order by c.code) as cuentas
      from usadas u join conv2 c on c.id = u.cuenta_id
     where not c.ya and (c.erp is null or c.choca)
     group by u.entry_id
  ),
  facturas_vivas as (
    -- Para «repetida»: el número y el NIF de cada factura que sale ahora o ya salió.
    select v.entry_id, v.book in ('received', 'investment') as rec,
           upper(regexp_replace(coalesce(v.number, ''), '[^A-Za-z0-9]', '', 'g')) as num,
           upper(coalesce(v.counterpart_tax_id, '')) as nif
      from public.vat_book_entry v
     where v.account_id = v_c.account_id and v.company_id = v_c.id and v.voided_at is null
       and coalesce(v.number, '') <> ''
       and (v.entry_id in (select id from base)
            or exists (select 1 from public.conta_erp10_salida_partida p where p.entry_id = v.entry_id and p.estado = 'salida'))
  ),
  repetidas as (
    select distinct a.entry_id
      from facturas_vivas a
      join facturas_vivas b on b.entry_id <> a.entry_id and b.rec = a.rec and b.num = a.num and b.nif = a.nif
     where a.entry_id in (select id from base)
  ),
  partidas as (
    select b.*, li.importe, li.cuentas_base, li.sop, li.rep, lb.base_iva, lb.cuota_sop, lb.cuota_rep, lb.numero as numero_factura, lb.nif, lb.nombre,
           case when lb.entry_id is null then 'asiento'
                when lb.rec then 'recibida'
                when lb.emi then 'emitida'
                when b.source_type in ('customer_invoice', 'sales_day') then 'emitida'
                -- X07: con libro de I.V.A. que no es de recibidas ni de expedidas: asiento, que no sale (abajo).
                else 'asiento' end as clase,
           (exists (select 1 from public.journal_entry_document d where d.entry_id = b.id and d.account_id = v_c.account_id)
            or exists (select 1 from public.customer_invoice ci where ci.entry_id = b.id and ci.account_id = v_c.account_id and ci.pdf_path is not null)) as tiene_pdf,
           array_remove(array[
             -- X07: lo que lleva I.V.A. y no es una factura no sale como asiento (dejaría incompleto el libro de ERP10).
             case when (lb.entry_id is not null and not lb.rec and not lb.emi and b.source_type not in ('customer_invoice', 'sales_day'))
                       or (lb.entry_id is null and exists (select 1 from public.journal_line jl where jl.entry_id = b.id and jl.account_id = v_c.account_id
                                                            and (jl.vat_book is not null or jl.tax_rate_id is not null)))
                  then 'Lleva I.V.A. y no es una factura: métela a mano en ERP10 para que entre en su libro.' end,
             case when lb.entry_id is null and b.source_type in ('supplier_invoice', 'customer_invoice', 'sales_day')
                  then 'Es una factura y no tiene su registro de IVA: no sale hasta que lo tenga.' end,
             case when lb.entry_id is not null and (coalesce(li.sop, 0) <> coalesce(lb.cuota_sop, 0) or coalesce(li.rep, 0) <> coalesce(lb.cuota_rep, 0))
                  then format('El IVA del asiento (%s €) no es el de su registro de IVA (%s €): no sale.',
                              translate(to_char(coalesce(li.sop, 0) + coalesce(li.rep, 0), 'FM999,999,990.00'), ',.', '.,'),
                              translate(to_char(coalesce(lb.cuota_sop, 0) + coalesce(lb.cuota_rep, 0), 'FM999,999,990.00'), ',.', '.,')) end,
             case when lb.entry_id is not null and public.conta_iva_presentado(v_c.id, b.entry_date) is not null
                  then 'Cae en un trimestre de IVA ya presentado: no sale.' end,
             case when lb.entry_id is not null and lb.rec and li.cuentas_base > 2
                  then format('Esta factura reparte el gasto en %s cuentas y ERP10 admite 2 al importar. Métela a mano en ERP10.', li.cuentas_base)
                  when lb.entry_id is not null and not lb.rec and li.cuentas_base > 4
                  then format('Esta factura reparte el ingreso en %s cuentas y ERP10 admite 4 al importar. Métela a mano en ERP10.', li.cuentas_base) end,
             case when m.entry_id is not null
                  then format('Usa la cuenta %s, que no se puede pasar a ERP10: no sale.', m.cuentas) end,
             case when r.entry_id is not null
                  then 'Su número de factura y NIF ya están en otra que sale o ya salió: no sale.' end
           ], null) as bloquean,
           (lb.entry_id is not null and not exists (select 1 from public.journal_entry_document d where d.entry_id = b.id and d.account_id = v_c.account_id)
            and not exists (select 1 from public.customer_invoice ci where ci.entry_id = b.id and ci.account_id = v_c.account_id and ci.pdf_path is not null)) as sin_pdf
      from base b
      left join libro lb on lb.entry_id = b.id
      left join lineas li on li.entry_id = b.id
      left join malas m on m.entry_id = b.id
      left join repetidas r on r.entry_id = b.id
  )
  select jsonb_build_object(
    'mes', v_ini, 'desde', v_z.desde, 'codigo', v_z.codigo_erp10, 'largo', v_z.largo_subcuenta,
    'partidas', coalesce((select jsonb_agg(jsonb_build_object(
        'entry_id', p.id, 'serie', p.series, 'numero', p.number, 'fecha', p.entry_date, 'concepto', p.concept,
        'origen', p.source_type, 'clase', p.clase, 'importe', p.importe,
        'base_iva', p.base_iva, 'numero_factura', p.numero_factura, 'nif', p.nif, 'tercero', p.nombre,
        'cuentas_base', p.cuentas_base, 'tiene_pdf', p.tiene_pdf, 'de_otro_mes', p.entry_date < v_ini,
        'sale', cardinality(p.bloquean) = 0,
        'avisos', to_jsonb(p.bloquean || case when p.sin_pdf then array['No tiene su PDF en Sumied: sale igual, y el PDF se pone después.'] else array[]::text[] end))
        order by p.entry_date, p.series, p.number, p.id) from partidas p), '[]'::jsonb),
    'cuentas_nuevas', coalesce((select jsonb_agg(jsonb_build_object(
        'company_account_id', c.id, 'codigo', c.code, 'nombre', c.name, 'codigo_erp10', case when c.choca then null else c.erp end,
        'cabe', c.erp is not null and not c.choca,
        'aviso', case when c.erp is null then format('La cuenta %s no cabe en ERP10, que usa %s cifras.', c.code, v_z.largo_subcuenta)
                      when c.choca then format('La cuenta %s quedaría en ERP10 como %s, igual que otra.', c.code, c.erp) end)
        order by c.code) from conv2 c where not c.ya), '[]'::jsonb),
    'resumen', (select jsonb_build_object(
        'recibidas', count(*) filter (where p.clase = 'recibida' and cardinality(p.bloquean) = 0),
        'recibidas_importe', coalesce(sum(p.importe) filter (where p.clase = 'recibida' and cardinality(p.bloquean) = 0), 0),
        'emitidas', count(*) filter (where p.clase = 'emitida' and cardinality(p.bloquean) = 0),
        'emitidas_importe', coalesce(sum(p.importe) filter (where p.clase = 'emitida' and cardinality(p.bloquean) = 0), 0),
        'asientos', count(*) filter (where p.clase = 'asiento' and cardinality(p.bloquean) = 0),
        'asientos_importe', coalesce(sum(p.importe) filter (where p.clase = 'asiento' and cardinality(p.bloquean) = 0), 0),
        'no_salen', count(*) filter (where cardinality(p.bloquean) > 0),
        'pdf', count(*) filter (where p.clase <> 'asiento' and p.tiene_pdf and cardinality(p.bloquean) = 0),
        'sin_pdf', count(*) filter (where p.sin_pdf and cardinality(p.bloquean) = 0),
        'de_otro_mes', count(*) filter (where p.entry_date < v_ini),
        'cuentas_nuevas', (select count(*) from conv2 c where not c.ya and c.erp is not null and not c.choca),
        'cuentas_que_no_caben', (select count(*) from conv2 c where not c.ya and (c.erp is null or c.choca)))
      from partidas p)
  ) into v_r;
  return v_r;
end $$;
comment on function public.conta_erp10_por_salir(uuid, date) is
  'X02 (X04a, X05, X07) · Lo que saldría a ERP10 hasta ese mes (lo de antes que no salió, marcado «de otro mes»): una partida por asiento con su clase, avisos y si sale; las cuentas nuevas con su código en ERP10; y el resumen del paso 1. Solo lee.';
revoke all on function public.conta_erp10_por_salir(uuid, date) from public, anon;
grant execute on function public.conta_erp10_por_salir(uuid, date) to authenticated, service_role;
