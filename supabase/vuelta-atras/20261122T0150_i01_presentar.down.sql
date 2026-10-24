-- supabase/vuelta-atras/20261122T0150_i01_presentar.down.sql
--
-- Vuelta atrás de 20261122T0150_i01_presentar. Solo quita funciones. ANTES,
-- conta-hacienda tiene que dejar de estar desplegada (las llama).
-- PARA, sin tocar nada, si ya hay una declaración presentada o revisada: sin
-- estas funciones no se podría seguir con ella.

do $$
declare n bigint;
begin
  if to_regclass('public.tax_return') is not null then
    execute $q$select count(*) from public.tax_return where status not in ('pending', 'draft', 'not_required')$q$ into n;
    if n > 0 then
      raise exception 'I01a 0150 vuelta atrás: hay % declaraciones revisadas o presentadas. No se toca nada.', n;
    end if;
  end if;
end $$;

drop function if exists public.conta_impuesto_justificante_guardar(uuid, text, text, bigint);
drop function if exists public.conta_impuesto_hacienda_apunte(uuid, uuid, text, text, text[], text, jsonb);
drop function if exists public.conta_impuesto_fuera(uuid, uuid, text, boolean, text, timestamptz, uuid);
drop function if exists public.conta_impuesto_presentada(uuid, uuid, uuid, text, text, text, timestamptz, jsonb);
drop function if exists public.conta_impuesto_303_preparar(uuid, uuid, uuid);
drop function if exists public.conta_impuesto_aviso_aceptar(uuid, text);
drop function if exists public.conta_impuesto_revisar(uuid);
drop function if exists public.conta_impuesto_nombre_de(uuid);
drop function if exists public.conta_impuesto_gestiona(uuid, uuid);
