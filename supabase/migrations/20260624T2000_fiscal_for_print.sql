-- Datos fiscales para la factura simplificada (ticket de bolsa).
-- Devuelve razón social, CIF, dirección formateada y el número de factura.
-- Número: el de la plataforma/POS (raw_tab.bills[0].number, p.ej. LS1-5992) —
-- provisional hasta numeración propia VeriFactu (frente fiscal aparte).
CREATE OR REPLACE FUNCTION public.fiscal_for_print(p_device_token text, p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
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
$func$;
