-- supabase/migrations/20261126T0320_i01f_recibida_envio_tratamiento.sql
-- cambia: public.conta_recibida_envio · prueba: supabase/staging/sql/20261126_i01f_recibida_envio_prueba.sql
--
-- I01f · ENVIAR A DIEZ LAS RECIBIDAS AUTOLIQUIDADAS (Julio, 20/10).
--
-- Diez guarda una autoliquidada con otro TipoFactura que una recibida normal
-- (medido en la C0009, solo leyendo, el 20/10: run 140 de diez-prueba-c0009):
-- 7 la intracomunitaria (Trypleez, Anthropic, HubRise) y 6 la inversión del
-- sujeto pasivo de fuera de la UE (Vercel, Supabase); las 2.836 normales, 1.
-- Para mandarla bien, el envío tiene que saber cómo va el IVA de cada línea y
-- de dónde es el proveedor. Hoy conta_recibida_envio solo da el porcentaje.
--
-- Lo que cambia (misma firma, mismo contrato; solo AÑADE dos claves):
--   · cada línea lleva «tratamiento»: tax_rate.treatment (taxed, intra_eu,
--     reverse_charge…; null sin tipo);
--   · el proveedor lleva «pais»: supplier.country_code (que no admite nulos;
--     si viniera vacío, ES).
-- El cuerpo es el de producción (md5 6e5ed258, de 20261113T0100, medido el
-- 20/10) con esas dos claves. La vuelta atrás lo devuelve byte a byte.
--
-- Nada del camino del pedido: la llama solo conta-diez-enviar, al enviar una
-- recibida validada.

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
comment on function public.conta_recibida_envio(uuid) is
  'D01 · Lo que el envío a Diez (serie 2) lee de una factura recibida: asiento, líneas con tipo, base y tratamiento del IVA (I01f), factura, proveedor con su país (I01f) y su documento. Solo para los de la cuenta. La de comisión de una liquidación, solo con número.';
revoke all on function public.conta_recibida_envio(uuid) from public, anon;
grant execute on function public.conta_recibida_envio(uuid) to authenticated;
