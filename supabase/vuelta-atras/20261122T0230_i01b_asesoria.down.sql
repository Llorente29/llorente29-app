-- supabase/vuelta-atras/20261122T0230_i01b_asesoria.down.sql
--
-- Vuelta atrás de 20261122T0230_i01b_asesoria. ANTES, el front y conta-asesoria
-- tienen que volver a los de antes del I01b. PARA, sin tocar nada, si ya hay
-- alguna invitación: es el registro de quién dio permiso a qué asesoría, y no
-- se borra. Las asesorías ya vinculadas (company_tax_presenter) se quedan.

do $$
declare n int;
begin
  if to_regclass('public.tax_advisor_invitation') is not null then
    execute 'select count(*) from public.tax_advisor_invitation' into n;
    if n > 0 then
      raise exception 'I01b 0230 vuelta atrás: hay % invitaciones a asesorías (el registro de quién dio permiso). No se toca nada.', n;
    end if;
  end if;
end $$;

drop function if exists public.conta_asesoria_de_empresa(uuid);
drop function if exists public.conta_asesoria_pendientes();
drop function if exists public.conta_asesoria_aprobar(uuid, uuid, uuid);
drop function if exists public.conta_asesoria_aceptar(text, uuid);
drop function if exists public.conta_asesoria_cuenta_de(text);
drop function if exists public.conta_asesoria_ver(text);
drop function if exists public.conta_asesoria_cancelar(uuid);
drop function if exists public.conta_asesoria_invitar(uuid, uuid, text, text, text, text);
drop function if exists public.conta_asesoria_vincular(public.tax_advisor_invitation, uuid);
drop function if exists public.conta_asesoria_caducar(uuid);
drop table if exists public.tax_advisor_invitation;
