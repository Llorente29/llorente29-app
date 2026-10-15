-- supabase/vuelta-atras/20261113T0100_d01_liquidaciones_correo.down.sql
-- Deshace la 0100 de las liquidaciones por correo (D01), en orden inverso.

-- Freno: con alguna liquidación leída de un correo, o alguna dirección de
-- liquidaciones, no se borra nada (se perderían sus tiendas, sus columnas y el
-- enlace con su factura de comisión). Para y lo dice.
do $$
declare n int; d int; f int;
begin
  if to_regclass('public.platform_store') is null then return; end if;
  select count(*) into n from public.channel_settlement where source like 'correo\_%';
  select count(*) into d from public.company_inbound_address where kind <> 'facturas';
  select count(*) into f from public.supplier_invoice where source = 'liquidacion';
  if n > 0 or d > 0 or f > 0 then
    raise exception 'VUELTA ATRÁS 0100 (liquidaciones) PARADA: hay % liquidación(es) leída(s) de correos, % dirección(es) de liquidaciones y % factura(s) de comisión. Deshacerla las dejaría sin tienda ni origen: no se toca nada. Hay que decidir antes qué se hace con ellas.', n, d, f
      using errcode = 'P0001';
  end if;
end $$;

-- 6 · conta_recibida_envio vuelve a la de la 0110 de E05.
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
  select * into v_s from public.supplier where id = v_i.supplier_id and account_id = v_e.account_id;

  return jsonb_build_object(
    'id', v_e.id, 'account_id', v_e.account_id, 'company_id', v_e.company_id, 'estado', v_e.status, 'fecha', v_e.entry_date,
    'factura', jsonb_build_object('numero', v_i.invoice_number, 'fecha', coalesce(v_i.invoice_date, v_e.document_date, v_e.entry_date)),
    -- E05: si la factura lleva su emisor (los riders y flotas de Catcher, en el
    -- proveedor genérico «Riders»), es el emisor el que va a Diez.
    'proveedor', jsonb_build_object('nombre', coalesce(nullif(trim(v_i.issuer_name), ''), nullif(trim(v_s.legal_name), ''), v_s.name),
                                    'nif', coalesce(nullif(trim(v_i.issuer_tax_id), ''), nullif(trim(v_s.tax_id), ''))),
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object('cuenta', a.code, 'debe', l.debit, 'haber', l.credit,
                                          'tipoIva', t.rate, 'baseIva', l.tax_base) order by l.position)
        from public.journal_line l
        join public.company_account a on a.id = l.company_account_id and a.company_id = v_e.company_id
        left join public.tax_rate t on t.id = l.tax_rate_id
       where l.entry_id = v_e.id), '[]'::jsonb),
    'documento', (select jsonb_build_object('id', d.id, 'ruta', d.storage_path, 'nombre', d.file_name, 'sha256', d.sha256)
                    from public.journal_entry_document d where d.entry_id = v_e.id and d.kind = 'factura_recibida'));
end $$;
comment on function public.conta_recibida_envio(uuid) is
  'D01 · Lo que el envío a Diez (serie 2) lee de una factura recibida: asiento, líneas con tipo y base del IVA, factura, proveedor y su documento. Solo para los de la cuenta.';
revoke all on function public.conta_recibida_envio(uuid) from public, anon;
grant execute on function public.conta_recibida_envio(uuid) to authenticated;

drop function if exists public.conta_liquidacion_registrar(uuid, jsonb, text);
drop function if exists public.conta_liquidacion_factura_proponer(uuid, text);
alter table public.party_role drop column if exists ads_account_code;
alter table public.party_role drop column if exists commission_account_code;
alter table public.supplier_invoice_line drop column if exists expense_account_code;
alter table public.supplier_invoice drop column if exists brand_id;
alter table public.supplier_invoice drop constraint if exists supplier_invoice_source_check;
alter table public.supplier_invoice add constraint supplier_invoice_source_check check (source in ('manual', 'ocr', 'lote'));

drop index if exists public.channel_settlement_tienda_idx;
alter table public.channel_settlement drop column if exists commission_invoice_id;
alter table public.channel_settlement drop column if exists inbound_email_id;
alter table public.channel_settlement drop column if exists store_id;
alter table public.channel_settlement drop column if exists adjustments;
alter table public.channel_settlement drop column if exists chargebacks;
alter table public.channel_settlement drop column if exists item_promotions;
alter table public.channel_settlement drop column if exists ads_spend;
alter table public.channel_settlement drop column if exists promo_charges;
alter table public.channel_settlement drop column if exists other_earnings;

drop function if exists public.conta_tienda_plataforma_asignar(uuid, uuid, uuid, uuid, text);
drop table if exists public.platform_store;

drop function if exists public.conta_direccion_entrada(uuid, text, text);
create or replace function public.conta_entrada_destino(p_local_part text, p_domain text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('company_id', a.company_id, 'account_id', a.account_id, 'activa', a.active)
    from public.company_inbound_address a
   where lower(a.local_part) = lower(p_local_part) and lower(a.domain) = lower(p_domain) and a.kind = 'facturas'
$$;
revoke all on function public.conta_entrada_destino(text, text) from public, anon, authenticated;
grant execute on function public.conta_entrada_destino(text, text) to service_role;

alter table public.inbound_email_log drop constraint if exists inbound_email_log_outcome_check;
alter table public.inbound_email_log add constraint inbound_email_log_outcome_check
  check (outcome in ('recibido', 'sin_facturas', 'sin_destino', 'apagada', 'error'));
comment on table public.company_inbound_address is
  'D01 · La dirección propia de facturas de cada empresa (facturas-<empresa>@entrada.folvy.app), a la que se reenvían las facturas desde cualquier buzón. Nace apagada: se enciende cuando el dominio está dado de alta en Resend.';
alter table public.company_inbound_address drop constraint if exists company_inbound_address_local_part_check;
alter table public.company_inbound_address add constraint company_inbound_address_local_part_check check (local_part ~ '^facturas-[a-z0-9][a-z0-9-]{1,40}$');
alter table public.company_inbound_address drop constraint if exists company_inbound_address_kind_check;
alter table public.company_inbound_address add constraint company_inbound_address_kind_check check (kind = 'facturas');
