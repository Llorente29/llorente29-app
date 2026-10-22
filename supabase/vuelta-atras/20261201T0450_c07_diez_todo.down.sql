-- supabase/vuelta-atras/20261201T0450_c07_diez_todo.down.sql
--
-- Vuelta atrás de la 0450 (C07 · todo asiento de Sumied a Diez). Devuelve
-- conta_resumen_ventas y conta_recibida_envio a su cuerpo de producción byte a
-- byte (md5 62ba30b9… y e3c57e29…), quita el cron, las funciones nuevas, el
-- interruptor y las dos columnas.
--
-- Para, sin tocar nada, si ya hay asientos generales en Diez (envíos kind
-- 'asiento' enviados o enlazados): quitar el registro dejaría a Diez con
-- asientos que Sumied ya no sabe que mandó.

do $$
begin
  if exists (select 1 from public.external_send where kind = 'asiento' and status in ('enviado', 'enlazado')) then
    raise exception 'Hay asientos generales ya en Diez: la vuelta atrás de la 0450 no se aplica sola (se perdería qué se mandó). Míralo antes.';
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from cron.job where jobname = 'conta-diez-despertar') then
    perform cron.unschedule('conta-diez-despertar');
  end if;
end $$;

drop function if exists public.conta_diez_despertar();
drop function if exists public.conta_diez_envio_poner(uuid, boolean, text);
drop function if exists public.conta_diez_reclamar(integer);
drop function if exists public.conta_diez_por_enviar(integer);
drop function if exists public.conta_asiento_envio(uuid);

create or replace function public.conta_resumen_ventas(p_entry uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_e public.journal_entry;
  v_d public.sales_day_summary;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null or not public.belongs_to_account(v_e.account_id) then
    raise exception 'Ese asiento no está.' using errcode = 'P0002';
  end if;
  select * into v_d from public.sales_day_summary
   where entry_id = v_e.id and account_id = v_e.account_id and company_id = v_e.company_id;
  if v_d.id is null or v_d.channel_id is null then
    raise exception 'Ese asiento no es de las ventas de una plataforma: no lleva resumen de ventas.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'id', v_e.id, 'account_id', v_e.account_id, 'company_id', v_e.company_id,
    'estado', v_e.status, 'serie', v_e.series, 'numero', v_e.number,
    'fecha', v_d.sales_day, 'validado_en', v_e.validated_at,
    'empresa', (select jsonb_build_object('nombre', c.legal_name, 'nif', c.tax_id)
                  from public.company c where c.id = v_e.company_id and c.account_id = v_e.account_id),
    'local', (select jsonb_build_object('id', l.id, 'nombre', l.name)
                from public.locations l where l.id = v_d.location_id and l.account_id = v_e.account_id),
    'canal', (select jsonb_build_object('id', ch.id, 'slug', ch.slug, 'nombre', ch.name)
                from public.sales_channel ch where ch.id = v_d.channel_id and ch.account_id = v_e.account_id),
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'hora', to_char(s.sold_at at time zone 'Europe/Madrid', 'HH24:MI'),
               'codigo', coalesce(s.platform_order_code, left(s.id::text, 8)),
               'marca', b.name, 'total', s.total, 'base', s.taxable_base, 'cuota', s.tax,
               -- C06b (16/10): el descuento y el envío, y qué se hizo con el envío (conta_cargos_de_pedidos).
               'descuento', coalesce(c.descuento, 0), 'envio', coalesce(c.envio, 0), 'clase', coalesce(c.clase, 'ninguno')) order by s.sold_at, s.id)
        from public.sale s left join public.brand b on b.id = s.brand_id and b.account_id = s.account_id
        left join public.conta_cargos_de_pedidos(v_e.account_id, v_d.sale_ids) c on c.id = s.id
       where s.id = any (v_d.sale_ids) and s.account_id = v_e.account_id), '[]'::jsonb),
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'cuenta', a.code, 'debe', l.debit, 'haber', l.credit, 'marca', b.name,
               'tipoIva', t.rate, 'documento', l.document_ref,
               -- C06b (16/10): si la línea es la de promociones o la de envíos de su plataforma.
               'papel', (select v.papel from public.conta_ventas_canal_cuenta v
                          where v.company_id = v_e.company_id and v.channel_id = v_d.channel_id and v.company_account_id = a.id)) order by l.position)
        from public.journal_line l
        join public.company_account a on a.id = l.company_account_id and a.company_id = v_e.company_id
        left join public.brand b on b.id = l.brand_id and b.account_id = v_e.account_id
        left join public.tax_rate t on t.id = l.tax_rate_id
       where l.entry_id = v_e.id and l.account_id = v_e.account_id), '[]'::jsonb),
    'documento', (
      select jsonb_build_object('id', x.id, 'ruta', x.storage_path, 'nombre', x.file_name, 'sha256', x.sha256,
                                'bytes', x.size_bytes, 'creado_en', x.created_at, 'creado_por', x.created_by_name)
        from public.journal_entry_document x
       where x.entry_id = v_e.id and x.account_id = v_e.account_id and x.kind = 'resumen_ventas'));
end $$;

create or replace function public.conta_recibida_envio(p_entry uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_e public.journal_entry;
  v_i public.supplier_invoice;
  v_s public.supplier;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null or not public.belongs_to_account(v_e.account_id) then
    raise exception 'Ese asiento no está.' using errcode = 'P0002';
  end if;
  if v_e.source_type <> 'supplier_invoice' then
    raise exception 'Ese asiento no es de una factura recibida.' using errcode = '22023';
  end if;
  select * into v_i from public.supplier_invoice where id = v_e.source_id and account_id = v_e.account_id;
  if v_i.id is null then raise exception 'La factura de ese asiento no está.' using errcode = 'P0002'; end if;
  if v_i.source = 'liquidacion' and nullif(btrim(v_i.invoice_number), '') is null then
    raise exception 'La factura de comisión no tiene número: no va a Diez hasta tenerlo.' using errcode = '22023';
  end if;
  select * into v_s from public.supplier where id = v_i.supplier_id and account_id = v_e.account_id;

  return jsonb_build_object(
    'id', v_e.id, 'account_id', v_e.account_id, 'company_id', v_e.company_id, 'estado', v_e.status, 'fecha', v_e.entry_date,
    'factura', jsonb_build_object('numero', v_i.invoice_number, 'fecha', coalesce(v_i.invoice_date, v_e.document_date, v_e.entry_date)),
    -- E05: si la factura lleva su emisor (los riders y flotas de Catcher, en el
    -- proveedor genérico «Riders»), es el emisor el que va a Diez.
    'proveedor', jsonb_build_object('nombre', coalesce(nullif(trim(v_i.issuer_name), ''), nullif(trim(v_s.legal_name), ''), v_s.name),
                                    'nif', coalesce(nullif(trim(v_i.issuer_tax_id), ''), nullif(trim(v_s.tax_id), '')),
                                    -- I01f: su país (de la ficha; sin él, España), para saber si su
                                    -- inversión del sujeto pasivo es de fuera de la UE o nacional.
                                    'pais', coalesce(nullif(upper(btrim(v_s.country_code)), ''), 'ES')),
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object('cuenta', a.code, 'debe', l.debit, 'haber', l.credit,
                                          'tipoIva', t.rate, 'baseIva', l.tax_base,
                                          -- I01f: cómo va el IVA de la línea (taxed, intra_eu, reverse_charge…).
                                          'tratamiento', t.treatment) order by l.position)
        from public.journal_line l
        join public.company_account a on a.id = l.company_account_id and a.company_id = v_e.company_id
        left join public.tax_rate t on t.id = l.tax_rate_id
       where l.entry_id = v_e.id), '[]'::jsonb),
    'documento', (select jsonb_build_object('id', d.id, 'ruta', d.storage_path, 'nombre', d.file_name, 'sha256', d.sha256)
                    from public.journal_entry_document d where d.entry_id = v_e.id and d.kind = 'factura_recibida'));
end $$;

delete from public.external_send where kind = 'asiento' and status in ('pendiente', 'rechazado');
alter table public.conta_diez_autorizo drop column if exists incluye_asientos;
alter table public.external_send drop column if exists next_try_at;
drop table if exists public.conta_diez_envio_empresa;
