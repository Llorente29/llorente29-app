-- supabase/vuelta-atras/20261025T2140_v03_verifactu_motor.down.sql
-- Vuelta atrás de la 2140: quita el motor entero. Para si ya hay registros de
-- Verifactu en REAL: esos no se pueden borrar (son lo que se envió a Hacienda).
do $$
begin
  if exists (select 1 from pg_class where oid = to_regclass('public.verifactu_registro'))
     and exists (select 1 from public.verifactu_registro where entorno = 'real') then
    raise exception 'Hay registros de Verifactu en real: no se deshace la 2140.' using errcode = '23514';
  end if;
end $$;
drop view if exists public.verifactu_atascados;
drop view if exists public.verifactu_factura_estado;
drop function if exists public.verifactu_cola_fallo(uuid, text);
drop function if exists public.verifactu_cola_respuesta(uuid, jsonb);
drop function if exists public.verifactu_cola_tomar(text, integer);
drop function if exists public.verifactu_operacion_poner(uuid, text, text, text, text);
drop function if exists public.verifactu_modo(uuid, text, text, text, text);
drop function if exists public.verifactu_simplificada(uuid, jsonb, text);
drop function if exists public._verifactu_anular(uuid, text);
drop function if exists public._verifactu_alta_de_factura(uuid, text);
drop function if exists public._verifactu_registrar(jsonb);
drop function if exists public.verifactu_comprobar(uuid);
drop function if exists public._verifactu_desglose(uuid);
drop table if exists public.verifactu_flujo;
drop table if exists public.verifactu_envio;
drop trigger if exists verifactu_registro_inalterable on public.verifactu_registro;
drop table if exists public.verifactu_registro;
drop function if exists public._verifactu_registro_inalterable();
drop table if exists public.verifactu_cadena;
drop table if exists public.verifactu_operacion;
drop table if exists public.verifactu_empresa;
drop function if exists public._verifactu_es_ue(text);
drop function if exists public._verifactu_nif_iva_ue_valido(text, text);
drop function if exists public._verifactu_nif_es_valido(text);
drop function if exists public.verifactu_url_qr(text, text, text, date, numeric);
drop function if exists public._verifactu_url_codificar(text);
drop function if exists public._verifactu_cadena_anulacion(text, text, text, text, text);
drop function if exists public._verifactu_cadena_alta(text, text, text, text, text, text, text, text);
drop function if exists public._verifactu_sha256(text);
drop function if exists public._verifactu_fecha_hora_huso(timestamptz);
drop function if exists public._verifactu_importe(numeric);
drop function if exists public._verifactu_fecha(date);
