-- Vuelta atrás de 20261021T0220 (D01): las entradas.
-- PARA si ya hay correos registrados (es el rastro de lo que llegó).
do $$ begin
  if exists (select 1 from public.inbound_email_log) then
    raise exception 'Vuelta atrás D01 0220: hay % correo(s) en el registro de entrada; no se quita nada.', (select count(*) from public.inbound_email_log);
  end if;
end $$;
drop function if exists public.conta_proveedor_desde_factura(uuid, text);
drop function if exists public.conta_factura_desde_lectura(uuid, uuid);
drop function if exists public.conta_subida_registrar(uuid, text, text, text, integer, text, text);
drop function if exists public.conta_entrada_llegada(jsonb);
drop function if exists public.conta_entrada_correo(jsonb);
drop function if exists public.conta_entrada_destino(text, text);
drop table if exists public.inbound_email_log;
