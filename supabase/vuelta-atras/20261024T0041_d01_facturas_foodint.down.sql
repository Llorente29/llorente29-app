-- supabase/vuelta-atras/20261024T0041_d01_facturas_foodint.down.sql
--
-- Deshace la 0110 del 19: quita la dirección de facturas de Foodint y el
-- remitente de los justificantes. Freno: si a la dirección ya le ha llegado
-- algún correo (registro de entrada o bandeja), no se toca nada y lo dice: lo
-- que llegó se quedaría sin su dirección. Entonces se apaga a mano, no se borra.
-- Con d01_facturas.* (solo la prueba de staging) se le dice otra cuenta,
-- empresa y dirección, como a la 0110; en una base con cuentas de producción,
-- con esos ajustes puestos, para.

do $$
declare
  acc constant uuid := coalesce(nullif(current_setting('d01_facturas.cuenta', true), ''), '51ad1792-6629-4ef7-833a-b57b09a86710')::uuid;
  emp constant uuid := coalesce(nullif(current_setting('d01_facturas.empresa', true), ''), '658728c0-fcd7-46ef-a860-d4e5e6eb21d9')::uuid;
  lp  constant text := coalesce(nullif(current_setting('d01_facturas.direccion', true), ''), 'facturas-foodint');
  remitente constant text := 'efb721fef32c202a4279b3b73b3111296e5359cf133edcc22ac383e6b2b2f2c8';
  n int;
begin
  if coalesce(current_setting('d01_facturas.cuenta', true), '') <> ''
     and exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'VUELTA ATRÁS 0110 (facturas de Foodint) PARADA: d01_facturas.* es solo para la prueba de staging, y esta base tiene cuentas de producción.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.inbound_email_log where lower(to_address) = lp || '@entrada.folvy.app')
     or exists (select 1 from public.document_inbox where account_id = acc and lower(email_to) = lp || '@entrada.folvy.app') then
    raise exception 'VUELTA ATRÁS 0110 (facturas de Foodint) PARADA: a %@entrada.folvy.app ya le han llegado correos. No se toca nada: se apaga, no se borra.', lp using errcode = 'P0001';
  end if;
  delete from public.company_inbound_sender where account_id = acc and company_id = emp and sender_sha256 = remitente;
  delete from public.company_inbound_address where account_id = acc and company_id = emp and kind = 'facturas' and local_part = lp;
  get diagnostics n = row_count;
  if n > 1 then raise exception 'VUELTA ATRÁS 0110: se iban a quitar % direcciones. Se deshace todo.', n using errcode = 'P0001'; end if;
end $$;
