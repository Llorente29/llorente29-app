-- supabase/vuelta-atras/20261123T0100_p01_despacho.down.sql
--
-- Vuelta atrás de 20261123T0100_p01_despacho. ANTES, el front tiene que volver
-- al de antes del P01 (sin «Impuestos de tus clientes» ni «Soy una asesoría»).
-- PARA, sin tocar nada, si alguna cuenta ya dice que es asesoría o ya hay
-- responsables puestos: es trabajo de alguien y no se borra a ciegas. Los
-- permisos de las empresas a sus asesorías (company_tax_presenter) no son de
-- esta migración y se quedan.

do $$
declare n int; m int;
begin
  if to_regclass('public.tax_client_assignee') is not null then
    execute 'select count(*) from public.tax_client_assignee' into n;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'accounts' and column_name = 'tax_advisor_since') then
    execute 'select count(*) from public.accounts where tax_advisor_since is not null' into m;
  end if;
  if coalesce(n, 0) > 0 or coalesce(m, 0) > 0 then
    raise exception 'P01 0100 vuelta atrás: hay % responsables puestos y % cuentas que dicen ser asesoría. No se toca nada.', coalesce(n, 0), coalesce(m, 0);
  end if;
end $$;

drop function if exists public.conta_despacho_trimestre(uuid, int, text, date);
drop function if exists public.conta_despacho_responsable_poner(uuid, uuid, uuid);
drop function if exists public.conta_despacho_equipo(uuid);
drop function if exists public.conta_impuesto_nombre_de_en(uuid, uuid);
drop function if exists public.conta_despacho_correo_poner(uuid, text);
drop function if exists public.conta_despacho_marcar(uuid, boolean);
drop function if exists public.conta_despacho_soy(uuid);
drop function if exists public.conta_despacho_clientes(uuid);
drop table if exists public.tax_client_assignee;
alter table public.accounts drop column if exists tax_advisor_by;
alter table public.accounts drop column if exists tax_advisor_since;
