-- Vuelta atrás de supabase/migrations/20261102T1310_b01o_casar_sin_anuladas.sql
-- El núcleo de casar, del respaldo que guardó la 1310 (byte a byte), y fuera el
-- disparador y su función.
drop trigger if exists tg_factura_anulada_descasa on public.supplier_invoice;
drop function if exists public._tg_factura_anulada_descasa();
select public._restaurar_funcion('public._bank_casar_nucleo(uuid,jsonb,text,text,jsonb,text,uuid)', '20261102T1310_b01o_casar_sin_anuladas');
revoke all on function public._bank_casar_nucleo(uuid, jsonb, text, text, jsonb, text, uuid) from public, anon, authenticated, service_role;
