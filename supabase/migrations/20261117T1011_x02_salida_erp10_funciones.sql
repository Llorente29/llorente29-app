-- supabase/migrations/20261117T1011_x02_salida_erp10_funciones.sql
--
-- X02 · LA BASE DE LA SALIDA A ERP10: las funciones (encargo X01·1, 17/11).
-- Sin pantalla todavía (la hace el 1B): los textos ya van como los leerá un
-- administrativo, sin códigos ni nombres de tabla.
--
-- SOLO AÑADE: cinco funciones nuevas. No toca nada de Diez ni ninguna función
-- que exista. Nada en el camino del pedido.
--
--   1. conta_erp10_subcuenta(codigo, plantilla, largo): el código de Sumied en
--      ERP10, rellenando con ceros por el medio (decisión 3). Nulo si no cabe.
--   2. conta_erp10_salida_poner(empresa, encender, codigo, largo, desde, quien):
--      enciende o apaga. Solo un administrador; no se enciende con el envío a
--      Diez encendido (decisión 2). Devuelve cómo ha quedado.
--   3. conta_erp10_por_salir(empresa, mes): lo que saldría, una partida por
--      asiento con su clase (decisión 5), sus avisos y si sale; y las cuentas
--      nuevas con su código en ERP10. Solo lee.
--   4. conta_erp10_cambiadas(empresa): lo que salió y cuyo asiento está ahora
--      anulado (decisión 7). Solo lee.
--   5. conta_erp10_lote_apuntar(empresa, mes, ficheros, partidas, quien): apunta
--      un lote en una transacción; para sin apuntar nada si una partida ya salió,
--      no es de la empresa o no está en lo que sale.
--
-- Qué sale (conta_erp10_por_salir):
--   · lo validado de la empresa con fecha desde «desde» hasta el último día del
--     mes, que no haya salido ya (sin partida viva). Lo de meses anteriores que
--     se validó tarde sale también, marcado «de otro mes»: nada se queda atrás;
--   · nunca lo traído de otro programa (lo que vino de ERP10 no vuelve): ni
--     migrated, opening, closing o template, ni un asiento con external_program o
--     import_run_id, ni una factura con source/origin «traida», ni un asiento con
--     anotaciones del libro traídas (import_run_id, N02 · #701);
--   · nunca un contraasiento (reversal): la anulación de lo que ya salió va a
--     «cambiadas», para corregirla a mano en ERP10 (decisión 7); y si lo anulado
--     no salió, no sale ninguno de los dos.
--
-- Clase (decisión 5): con alguna anotación viva del libro de IVA es factura;
-- sin ninguna, asiento. Recibida si alguna es de recibidas o de bienes de
-- inversión (también la inversión del sujeto pasivo, que lleva las dos);
-- emitida si es de expedidas; si solo es «no sujeta», por su origen.
--
-- Avisos («Qué mirar»; la que lleva uno de los marcados con * no sale):
--   · sin PDF (sale igual);
--   · * es una factura (por su origen) y no tiene registro de IVA;
--   · * el IVA del asiento no es el de sus anotaciones del libro;
--   · * cae en un trimestre de IVA ya presentado;
--   · * lleva más de 4 cuentas de base (las ventas por marca, 700000xx, cuentan
--     como una: decisión 6);
--   · * usa una cuenta que no cabe en ERP10 o que choca con otra al convertirla;
--   · * su número de factura y NIF ya están en otra que sale o ya salió.
--
-- Vuelta atrás: supabase/vuelta-atras/20261117T1011_x02_salida_erp10_funciones.down.sql

-- 1 · El código en ERP10 ---------------------------------------------------------------------
create or replace function public.conta_erp10_subcuenta(p_codigo text, p_plantilla text, p_largo integer)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare v_resto text;
begin
  if p_codigo is null or p_plantilla is null or p_largo is null or p_codigo !~ '^[0-9]+$' or left(p_codigo, length(p_plantilla)) <> p_plantilla then
    return null;
  end if;
  if length(p_codigo) = p_largo then return p_codigo; end if;
  -- Lo que va detrás de la plantilla, sin sus ceros de delante, y relleno por el medio.
  v_resto := ltrim(substr(p_codigo, length(p_plantilla) + 1), '0');
  if length(p_plantilla) + length(v_resto) > p_largo then return null; end if;
  return p_plantilla || lpad(v_resto, p_largo - length(p_plantilla), '0');
end $$;
comment on function public.conta_erp10_subcuenta(text, text, integer) is
  'X02 · El código de una subcuenta de Sumied en ERP10: igual si tiene ese largo; si no, la plantilla y lo de detrás sin sus ceros, rellenando con ceros por el medio. Nulo si no cabe.';
grant execute on function public.conta_erp10_subcuenta(text, text, integer) to authenticated, service_role;

-- 2 · Encender y apagar ----------------------------------------------------------------------
create or replace function public.conta_erp10_salida_poner(
  p_company uuid, p_encender boolean, p_codigo text default null, p_largo integer default null,
  p_desde date default null, p_quien_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.company;
  v_z public.conta_erp10_salida_empresa;
  v_quien text;
  v_codigo text;
  v_largo integer;
  v_desde date;
  v_lotes integer;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null or not public.belongs_to_account(v_c.account_id) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if not public.current_user_is_admin_of(v_c.account_id) then
    raise exception 'Solo un administrador de la cuenta enciende o apaga la salida a ERP10.' using errcode = '42501';
  end if;
  if p_encender is null then raise exception 'Hay que decir si se enciende o se apaga.' using errcode = '22023'; end if;

  select * into v_z from public.conta_erp10_salida_empresa where company_id = v_c.id for update;
  v_codigo := coalesce(nullif(btrim(p_codigo), ''), v_z.codigo_erp10);
  v_largo := coalesce(p_largo, v_z.largo_subcuenta);
  v_desde := coalesce(p_desde, v_z.desde, public.conta_dia_de_inicio(v_c.id), date_trunc('month', current_date)::date);

  if p_encender then
    if exists (select 1 from public.conta_diez_envio_empresa d where d.company_id = v_c.id and d.enviar) then
      raise exception 'Esta empresa ya envía a Diez. Apaga ese envío antes de encender la salida a ERP10.' using errcode = '23514';
    end if;
    if v_codigo is null then
      raise exception 'Falta el código de la empresa en ERP10.' using errcode = '22023';
    end if;
    if v_codigo !~ '^[A-Za-z0-9]{1,10}$' then
      raise exception 'El código de la empresa en ERP10 son letras y números, como mucho 10 («%» no vale).', v_codigo using errcode = '22023';
    end if;
    if v_largo is null then
      raise exception 'Falta cuántas cifras tiene la subcuenta en ERP10.' using errcode = '22023';
    end if;
    if v_largo not between 6 and 12 then
      raise exception 'La subcuenta de ERP10 tiene entre 6 y 12 cifras (has puesto %).', v_largo using errcode = '22023';
    end if;
  end if;

  -- Lo que ya salió se hizo con ese código y ese largo: no se cambian.
  select count(*) into v_lotes from public.conta_erp10_salida_lote l where l.company_id = v_c.id;
  if v_lotes > 0 and v_z.company_id is not null then
    if v_largo is distinct from v_z.largo_subcuenta::integer then
      raise exception 'Ya han salido cuentas con % cifras: el largo de la subcuenta no se puede cambiar.', v_z.largo_subcuenta using errcode = '23514';
    end if;
    if v_codigo is distinct from v_z.codigo_erp10 then
      raise exception 'Ya ha salido algo con el código de empresa %: no se puede cambiar.', v_z.codigo_erp10 using errcode = '23514';
    end if;
  end if;

  v_quien := nullif(btrim(coalesce(p_quien_nombre, public.conta_nombre_actor(), '')), '');
  if v_z.company_id is null then
    if not p_encender then
      return jsonb_build_object('encendida', false, 'codigo', null, 'largo', null, 'desde', null,
        'texto', 'Apagada: no sale nada a ERP10.');
    end if;
    insert into public.conta_erp10_salida_empresa (company_id, account_id, encendida, codigo_erp10, largo_subcuenta, desde, cambiado_por, cambiado_por_nombre)
    values (v_c.id, v_c.account_id, true, v_codigo, v_largo, v_desde, auth.uid(), v_quien)
    returning * into v_z;
  elsif v_z.encendida is distinct from p_encender or v_z.codigo_erp10 is distinct from v_codigo
     or v_z.largo_subcuenta is distinct from v_largo::smallint or v_z.desde is distinct from v_desde then
    update public.conta_erp10_salida_empresa
       set encendida = p_encender, codigo_erp10 = v_codigo, largo_subcuenta = v_largo, desde = v_desde,
           cambiado_por = auth.uid(), cambiado_por_nombre = v_quien, cambiado_en = now()
     where company_id = v_c.id
    returning * into v_z;
  end if;

  return jsonb_build_object('encendida', v_z.encendida, 'codigo', v_z.codigo_erp10, 'largo', v_z.largo_subcuenta, 'desde', v_z.desde,
    'texto', case when v_z.encendida
      then format('Encendida: sale a ERP10 lo validado desde el %s, con el código de empresa %s y subcuentas de %s cifras.',
                  to_char(v_z.desde, 'DD/MM/YYYY'), v_z.codigo_erp10, v_z.largo_subcuenta)
      else 'Apagada: no sale nada a ERP10. Lo que ya salió queda apuntado.' end);
end $$;
comment on function public.conta_erp10_salida_poner(uuid, boolean, text, integer, date, text) is
  'X02 · Enciende o apaga la salida a ERP10 de una empresa. Solo un administrador; no con el envío a Diez encendido; con el código de la empresa en ERP10 y el largo de su subcuenta (6 a 12), que no cambian después del primer lote. «desde», si no se dice, el día de inicio de la empresa.';
revoke all on function public.conta_erp10_salida_poner(uuid, boolean, text, integer, date, text) from public, anon;
grant execute on function public.conta_erp10_salida_poner(uuid, boolean, text, integer, date, text) to authenticated, service_role;

-- 3 · Lo que saldría ---------------------------------------------------------------------------
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
       and not exists (select 1 from public.customer_invoice ci where ci.entry_id = e.id and ci.company_id = e.company_id and ci.origin = 'traida')
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
           sum(case when ca.code like '477%' then l.credit - l.debit else 0 end) as rep,
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
                else 'recibida' end as clase,
           exists (select 1 from public.journal_entry_document d where d.entry_id = b.id and d.account_id = v_c.account_id) as tiene_pdf,
           array_remove(array[
             case when lb.entry_id is null and b.source_type in ('supplier_invoice', 'customer_invoice', 'sales_day')
                  then 'Es una factura y no tiene su registro de IVA: no sale hasta que lo tenga.' end,
             case when lb.entry_id is not null and (coalesce(li.sop, 0) <> coalesce(lb.cuota_sop, 0) or coalesce(li.rep, 0) <> coalesce(lb.cuota_rep, 0))
                  then format('El IVA del asiento (%s €) no es el de su registro de IVA (%s €): no sale.',
                              to_char(coalesce(li.sop, 0) + coalesce(li.rep, 0), 'FM999G999G990D00'),
                              to_char(coalesce(lb.cuota_sop, 0) + coalesce(lb.cuota_rep, 0), 'FM999G999G990D00')) end,
             case when lb.entry_id is not null and public.conta_iva_presentado(v_c.id, b.entry_date) is not null
                  then 'Cae en un trimestre de IVA ya presentado: no sale.' end,
             case when lb.entry_id is not null and li.cuentas_base > 4
                  then format('Reparte la base en %s cuentas y ERP10 admite 4: no sale.', li.cuentas_base) end,
             case when m.entry_id is not null
                  then format('Usa la cuenta %s, que no se puede pasar a ERP10: no sale.', m.cuentas) end,
             case when r.entry_id is not null
                  then 'Su número de factura y NIF ya están en otra que sale o ya salió: no sale.' end
           ], null) as bloquean,
           (lb.entry_id is not null and not exists (select 1 from public.journal_entry_document d where d.entry_id = b.id and d.account_id = v_c.account_id)) as sin_pdf
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
  'X02 · Lo que saldría a ERP10 hasta ese mes (lo de antes que no salió, marcado «de otro mes»): una partida por asiento con su clase, avisos y si sale; las cuentas nuevas con su código en ERP10; y el resumen del paso 1. Solo lee.';
revoke all on function public.conta_erp10_por_salir(uuid, date) from public, anon;
grant execute on function public.conta_erp10_por_salir(uuid, date) to authenticated, service_role;

-- 4 · Lo que salió y ha cambiado -------------------------------------------------------------
create or replace function public.conta_erp10_cambiadas(p_company uuid)
returns table (partida_id uuid, lote_id uuid, mes date, salio_en timestamptz, entry_id uuid, clase text,
               serie smallint, numero integer, fecha date, concepto text, importe numeric,
               anulado_en timestamptz, motivo text, contraasiento_id uuid, huella text, que_hacer text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_c public.company;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.belongs_to_account(v_c.account_id) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  return query
  select p.id, p.lote_id, l.mes, l.creado_en, e.id, p.clase, e.series, e.number, e.entry_date, e.concept,
         (select sum(jl.debit) from public.journal_line jl where jl.entry_id = e.id and jl.account_id = e.account_id),
         e.voided_at, e.void_reason, e.voided_by_entry_id, p.huella,
         case p.clase when 'asiento' then 'Salió a ERP10 y en Sumied está anulado: anúlalo a mano en ERP10. No se vuelve a mandar.'
              else 'Salió a ERP10 y en Sumied está anulada: corrígela a mano en ERP10. No se vuelve a mandar.' end
    from public.conta_erp10_salida_partida p
    join public.conta_erp10_salida_lote l on l.id = p.lote_id
    join public.journal_entry e on e.id = p.entry_id and e.account_id = p.account_id
   where p.company_id = v_c.id and p.account_id = v_c.account_id and p.estado = 'salida'
     and e.status = 'anulado'
   order by e.voided_at, e.entry_date, e.series, e.number;
end $$;
comment on function public.conta_erp10_cambiadas(uuid) is
  'X02 · Lo que salió a ERP10 y cuyo asiento está ahora anulado en Sumied: va a la hoja aparte para corregirlo a mano en ERP10 (no se vuelve a mandar). La otra mitad de «ha cambiado», la huella de la fila, la compara el navegador. Solo lee.';
revoke all on function public.conta_erp10_cambiadas(uuid) from public, anon;
grant execute on function public.conta_erp10_cambiadas(uuid) to authenticated, service_role;

-- 5 · Apuntar un lote ----------------------------------------------------------------------------
create or replace function public.conta_erp10_lote_apuntar(
  p_company uuid, p_mes date, p_ficheros jsonb, p_partidas jsonb, p_quien_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.company;
  v_ini date := date_trunc('month', p_mes)::date;
  v_ps jsonb;
  v_quien text;
  v_lote uuid;
  x jsonb;
  v_p jsonb;
  v_id uuid;
  v_n_rec int := 0; v_n_emi int := 0; v_n_asi int := 0; v_n_cue int := 0;
  v_vistas uuid[] := '{}';
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null or not public.belongs_to_account(v_c.account_id) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if not public.current_user_is_admin_of(v_c.account_id) then
    raise exception 'Solo un administrador de la cuenta saca los ficheros para ERP10.' using errcode = '42501';
  end if;
  if p_mes is null then raise exception 'Falta el mes.' using errcode = '22023'; end if;
  -- Dos a la vez en la misma empresa, una detrás de otra.
  perform pg_advisory_xact_lock(hashtextextended('conta_erp10_lote:' || v_c.id, 0));

  if p_ficheros is null or jsonb_typeof(p_ficheros) <> 'array' or jsonb_array_length(p_ficheros) = 0 then
    raise exception 'Faltan los ficheros que han salido.' using errcode = '22023';
  end if;
  for x in select * from jsonb_array_elements(p_ficheros) loop
    if jsonb_typeof(x) <> 'object' or coalesce(btrim(x ->> 'nombre'), '') = '' or coalesce(btrim(x ->> 'huella'), '') = ''
       or coalesce(x ->> 'filas', '') !~ '^[0-9]+$' then
      raise exception 'Cada fichero lleva su nombre, cuántas filas tiene y su huella.' using errcode = '22023';
    end if;
  end loop;
  if p_partidas is null or jsonb_typeof(p_partidas) <> 'array' or jsonb_array_length(p_partidas) = 0 then
    raise exception 'No hay nada que apuntar: el lote no lleva ninguna partida.' using errcode = '22023';
  end if;

  -- Lo que sale ahora, con las mismas reglas que enseña la pantalla.
  v_ps := public.conta_erp10_por_salir(v_c.id, v_ini);

  for x in select * from jsonb_array_elements(p_partidas) loop
    if jsonb_typeof(x) <> 'object' or coalesce(x ->> 'entry_id', '') !~ '^[0-9a-fA-F-]{36}$' or coalesce(btrim(x ->> 'huella'), '') = ''
       or coalesce(x ->> 'clase', '') not in ('recibida', 'emitida', 'asiento') then
      raise exception 'Cada partida lleva su asiento, su clase (recibida, emitida o asiento) y su huella.' using errcode = '22023';
    end if;
    v_id := (x ->> 'entry_id')::uuid;
    if v_id = any (v_vistas) then
      raise exception 'Un mismo asiento viene dos veces en el lote: no se apunta nada.' using errcode = '23505';
    end if;
    v_vistas := v_vistas || v_id;
    if not exists (select 1 from public.journal_entry e where e.id = v_id and e.company_id = v_c.id and e.account_id = v_c.account_id) then
      raise exception 'Un asiento del lote no es de esta empresa: no se apunta nada.' using errcode = '23514';
    end if;
    if exists (select 1 from public.conta_erp10_salida_partida p where p.entry_id = v_id and p.estado = 'salida') then
      raise exception 'El asiento %/% ya salió a ERP10: no se apunta nada.',
        (select series from public.journal_entry where id = v_id), (select number from public.journal_entry where id = v_id) using errcode = '23505';
    end if;
    select p into v_p from jsonb_array_elements(v_ps -> 'partidas') p where p ->> 'entry_id' = v_id::text;
    if v_p is null then
      raise exception 'El asiento %/% no está en lo que sale este mes: no se apunta nada.',
        (select series from public.journal_entry where id = v_id), (select number from public.journal_entry where id = v_id) using errcode = '23514';
    end if;
    if not (v_p ->> 'sale')::boolean then
      raise exception 'El asiento %/% no puede salir (%): no se apunta nada.', v_p ->> 'serie', v_p ->> 'numero', v_p -> 'avisos' ->> 0 using errcode = '23514';
    end if;
    if v_p ->> 'clase' <> x ->> 'clase' then
      raise exception 'El asiento %/% sale como «%», no como «%»: no se apunta nada.', v_p ->> 'serie', v_p ->> 'numero', v_p ->> 'clase', x ->> 'clase' using errcode = '23514';
    end if;
  end loop;

  v_quien := nullif(btrim(coalesce(p_quien_nombre, public.conta_nombre_actor(), '')), '');
  insert into public.conta_erp10_salida_lote (account_id, company_id, mes, ficheros, creado_por, creado_por_nombre)
  values (v_c.account_id, v_c.id, v_ini, p_ficheros, auth.uid(), v_quien)
  returning id into v_lote;

  -- Si otra pestaña ha apuntado lo mismo a la vez, el índice único lo para (y no queda nada: es una sola transacción).
  begin
    for x in select * from jsonb_array_elements(p_partidas) loop
      insert into public.conta_erp10_salida_partida (account_id, company_id, lote_id, entry_id, clase, huella)
      values (v_c.account_id, v_c.id, v_lote, (x ->> 'entry_id')::uuid, x ->> 'clase', btrim(x ->> 'huella'));
      case x ->> 'clase' when 'recibida' then v_n_rec := v_n_rec + 1; when 'emitida' then v_n_emi := v_n_emi + 1; else v_n_asi := v_n_asi + 1; end case;
    end loop;
  exception when unique_violation then
    raise exception 'Algo de este lote ya salió a ERP10 (otra pestaña u otro clic a la vez): no se apunta nada.' using errcode = '23505';
  end;

  -- Las cuentas nuevas que usan estas partidas (las que caben: las otras ya pararon arriba).
  insert into public.conta_erp10_subcuenta_salida (account_id, company_id, lote_id, company_account_id, codigo, codigo_erp10, nombre)
  select v_c.account_id, v_c.id, v_lote, (c ->> 'company_account_id')::uuid, c ->> 'codigo', c ->> 'codigo_erp10', c ->> 'nombre'
    from jsonb_array_elements(v_ps -> 'cuentas_nuevas') c
   where (c ->> 'cabe')::boolean
     and exists (select 1 from public.journal_line l
                  where l.company_account_id = (c ->> 'company_account_id')::uuid and l.account_id = v_c.account_id
                    and l.entry_id = any (v_vistas));
  get diagnostics v_n_cue = row_count;

  update public.conta_erp10_salida_lote set recibidas = v_n_rec, emitidas = v_n_emi, asientos = v_n_asi, cuentas_nuevas = v_n_cue
   where id = v_lote;

  return jsonb_build_object('lote', v_lote, 'mes', v_ini, 'recibidas', v_n_rec, 'emitidas', v_n_emi, 'asientos', v_n_asi,
    'cuentas_nuevas', v_n_cue, 'ficheros', jsonb_array_length(p_ficheros), 'quien', v_quien,
    'texto', format('Apuntado lo que sale de %s: %s %s, %s %s, %s %s y %s %s.',
      to_char(v_ini, 'MM/YYYY'),
      v_n_rec, case v_n_rec when 1 then 'factura recibida' else 'facturas recibidas' end,
      v_n_emi, case v_n_emi when 1 then 'factura emitida' else 'facturas emitidas' end,
      v_n_asi, case v_n_asi when 1 then 'asiento' else 'asientos' end,
      v_n_cue, case v_n_cue when 1 then 'cuenta nueva' else 'cuentas nuevas' end));
end $$;
comment on function public.conta_erp10_lote_apuntar(uuid, date, jsonb, jsonb, text) is
  'X02 · Apunta lo que ha salido a ERP10, en una transacción: el lote con sus ficheros, cada partida con su huella y las cuentas nuevas que usan. Para sin apuntar nada si una partida ya salió, no es de la empresa, no está en lo que sale o no sale como esa clase. Solo un administrador.';
revoke all on function public.conta_erp10_lote_apuntar(uuid, date, jsonb, jsonb, text) from public, anon;
grant execute on function public.conta_erp10_lote_apuntar(uuid, date, jsonb, jsonb, text) to authenticated, service_role;
