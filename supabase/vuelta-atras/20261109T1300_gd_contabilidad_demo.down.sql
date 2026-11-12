-- supabase/vuelta-atras/20261109T1300_gd_contabilidad_demo.down.sql
--
-- Vuelta atrás de la 1300: deja las dos empresas de «Gestoría Demo» como las
-- dejó la 0110 (sin plan, sin actividad, sin ejercicio, sin serie, sin modelos
-- y sin los ajustes de cobro del G05) y quita la función. Solo esa cuenta, y
-- solo si es de demostración. No hay asientos que quitar: la siembra no hace.

do $$
declare c constant uuid := 'de000000-0000-4000-8000-0000000000a0';
begin
  if exists (select 1 from public.accounts where id = c and is_demo is true) then
    delete from public.company_account_link where account_id = c;
    delete from public.company_account_log where account_id = c;
    delete from public.company_account where account_id = c;
    delete from public.invoice_series where account_id = c and code = '1';
    delete from public.fiscal_year where account_id = c and code = '2026';
    delete from public.company_activity where account_id = c;
    delete from public.company_person where account_id = c;
    update public.company_tax_profile set tax_forms = '{}' where account_id = c;
    update public.conta_gestoria_ajustes set codigo_cliente_modo = null, serie_cobro = null, cuenta_banco = null, cuenta_ingresos = null,
           cuenta_iva = null, cuenta_plataforma = null where account_id = c;
    update public.company set legal_form_code = null, incorporated_on = null, registry_name = null, registry_volume = null, registry_folio = null,
           registry_sheet = null, registry_entry = null, phone = null, email = null, dehu_email = null
     where account_id = c and id = 'de000000-0000-4000-8000-0000000000a9';
  end if;
end $$;
drop function if exists public.demo_gestoria_contabilidad_sembrar(uuid);
