-- supabase/vuelta-atras/20261026T2309_v04_tique_serie_y_quien_factura.down.sql
--
-- Vuelta atrás de 20261026T2309_v04_tique_serie_y_quien_factura: fiscal_for_print
-- vuelve a ser la de 20260720T1200 (el texto exacto: su huella vuelve a ser la
-- de antes), y se quitan las funciones y las tablas de la serie.
-- OJO: quitar ticket_invoice borra los números dados. Si la serie ya ha
-- numerado tiques de verdad, esto no se lanza sin decidirlo antes: esos
-- números están en tiques que tienen los clientes.

create or replace function public.fiscal_for_print(p_device_token text, p_sale_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_device  kds_device;
  v_acc     uuid;
  v_a       accounts%ROWTYPE;
  v_raw     jsonb;
  v_num     text;
  v_addr    text;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then raise exception 'fiscal_for_print: token no válido'; end if;
  v_acc := v_device.account_id;

  select * into v_a from accounts where id = v_acc;

  select safe_jsonb(raw_tab) into v_raw from sale where id = p_sale_id and account_id = v_acc;
  v_num := coalesce(v_raw->'bills'->0->>'number', v_raw->>'number');

  -- Dirección desde billing_address jsonb {street, postalCode, city, province}
  v_addr := nullif(btrim(concat_ws(', ',
              nullif(v_a.billing_address->>'street',''),
              nullif(concat_ws(' ', v_a.billing_address->>'postalCode', v_a.billing_address->>'city'), ''),
              nullif(v_a.billing_address->>'province',''))), '');

  return jsonb_build_object(
    'legalName', coalesce(v_a.legal_name, v_a.name),
    'taxId', v_a.cif,
    'address', v_addr,
    'ticketNumber', v_num
  );
end;
$function$;
grant execute on function public.fiscal_for_print(text, uuid) to anon;

drop function if exists public.ticket_invoice_code_set(uuid, text, text);
drop function if exists public.ticket_invoice_ajustes(uuid);
drop function if exists public.fiscal_for_preview(uuid);
drop function if exists public._ticket_quien_factura(uuid, uuid);
drop function if exists public._ticket_codigo_propuesto(text, text);
drop function if exists public._ticket_invoice_number(uuid, uuid, uuid, text, text, text, timestamptz);
drop function if exists public._ticket_invoice_text(text, integer, text, integer);
drop table if exists public.ticket_invoice;
drop table if exists public.ticket_invoice_series;
drop table if exists public.location_invoice_code;
