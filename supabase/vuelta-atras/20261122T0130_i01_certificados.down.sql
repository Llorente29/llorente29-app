-- supabase/vuelta-atras/20261122T0130_i01_certificados.down.sql
--
-- Vuelta atrás de 20261122T0130_i01_certificados: quita el token de un solo uso
-- y las funciones del almacén. ANTES, conta-certificado tiene que dejar de
-- estar desplegada (las llama).
-- PARA, sin tocar nada, si hay algún certificado guardado: su secreto quedaría
-- en el Vault sin nadie que lo quite. Se quita antes con «Quitar ahora».

do $$
declare n bigint;
begin
  if to_regclass('public.tax_certificate') is not null then
    execute $q$select count(*) from public.tax_certificate where status <> 'removed'$q$ into n;
    if n > 0 then
      raise exception 'I01a 0130 vuelta atrás: hay % certificados guardados (su secreto está en el Vault). Quítalos antes con «Quitar ahora». No se toca nada.', n;
    end if;
  end if;
end $$;

drop function if exists public.conta_cert_permiso(uuid, uuid, text);
drop function if exists public.conta_cert_quitar(uuid);
drop function if exists public.conta_cert_uso_terminar(uuid, text, text, text);
drop function if exists public.conta_cert_abrir(uuid, uuid);
drop function if exists public.conta_cert_confirmar(uuid, text, uuid, uuid);
drop function if exists public.conta_cert_guardar(uuid, uuid, jsonb, text);
drop function if exists public.conta_cert_nombre(uuid, uuid);
drop function if exists public.conta_cert_puede_usar(uuid, uuid);
drop function if exists public.conta_cert_es_admin(uuid, uuid);
drop function if exists public.conta_cert_custodia(text);
drop function if exists public.conta_cert_cuenta_vault();
drop table if exists public.tax_certificate_confirmation;
