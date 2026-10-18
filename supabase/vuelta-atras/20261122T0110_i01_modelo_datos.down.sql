-- supabase/vuelta-atras/20261122T0110_i01_modelo_datos.down.sql
--
-- Vuelta atrás de 20261122T0110_i01_modelo_datos. ANTES, las de la 0150 a la
-- 0120 y el front de antes del I01a (el alta del I01a guarda sus respuestas
-- aquí).
-- company_tax_profile.tax_forms se queda como está: es la copia de
-- tax_obligation, así que la lista de modelos de cada empresa no se pierde.
-- Se quita el disparador que la traduce.
-- PARA, sin tocar nada, si hay algo que haya decidido o dicho una persona:
-- respuestas del alta (company_tax_facts), modelos añadidos o quitados a mano,
-- declaraciones, certificados o una asesoría con consentimiento. Lo que puso la
-- migración o una regla se puede quitar: sale otra vez de tax_forms.

do $$
declare v text;
begin
  if to_regclass('public.tax_obligation') is not null then
    execute $q$select concat_ws(', ',
        nullif((select count(*) from public.company_tax_facts)::text || ' respuestas del alta', '0 respuestas del alta'),
        nullif((select count(*) from public.tax_obligation where origin <> 'rule' or decided_by is not null)::text || ' modelos decididos por una persona', '0 modelos decididos por una persona'),
        nullif((select count(*) from public.tax_return)::text || ' declaraciones', '0 declaraciones'),
        nullif((select count(*) from public.tax_certificate)::text || ' certificados', '0 certificados'),
        nullif((select count(*) from public.company_tax_presenter)::text || ' presentadores', '0 presentadores'))$q$ into v;
    if v <> '' then
      raise exception 'I01a 0110 vuelta atrás: hay %, y se perdería. No se toca nada.', v;
    end if;
  end if;
end $$;

drop trigger if exists company_tax_profile_tax_forms on public.company_tax_profile;
drop view if exists public.company_tax_forms;
drop table if exists public.tax_certificate_use;
drop table if exists public.tax_certificate_grant;
drop table if exists public.tax_return_line;
drop table if exists public.tax_return_check;
drop table if exists public.tax_return_box;
drop table if exists public.tax_return_event;
drop table if exists public.tax_return;
drop table if exists public.company_tax_presenter;
drop table if exists public.tax_certificate;
drop table if exists public.tax_obligation;
drop table if exists public.company_tax_facts;
drop function if exists public.conta_impuesto_presentador_retirar(uuid);
drop function if exists public.conta_impuesto_presentador_poner(uuid, text, uuid, text);
drop function if exists public.conta_impuesto_datos_del_alta(uuid, jsonb);
drop function if exists public.conta_impuesto_dato_poner(uuid, text, jsonb, text);
drop function if exists public.conta_impuesto_espejo_tax_forms();
drop function if exists public.conta_impuesto_desde_tax_forms();
drop function if exists public.conta_impuesto_cadencia_de(uuid, text);
drop function if exists public.conta_impuesto_estado();
drop function if exists public.conta_impuesto_estado_antes();
drop function if exists public.conta_impuesto_estado_texto(text);
drop function if exists public.conta_impuesto_estado_vale(text, text);
drop function if exists public.conta_impuesto_puede_gestionar(uuid);
drop function if exists public.conta_impuesto_puede_ver(uuid);
drop function if exists public.conta_impuesto_quien();
