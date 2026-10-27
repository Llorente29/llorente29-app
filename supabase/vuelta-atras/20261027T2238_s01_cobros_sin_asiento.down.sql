-- supabase/vuelta-atras/20261027T2238_s01_cobros_sin_asiento.down.sql
--
-- Vuelta atrás de la 2238: deja los datos EXACTAMENTE como estaban, desde su
-- copia previa (conta_s01_cobros_antes), sin now() ni reglas:
--   · borra los asientos que creó (siguen propuestos: si alguno ya está
--     validado, PARA, porque ya está en el libro y se decide antes);
--   · devuelve a cada cobro el asiento que tenía (ninguno);
--   · borra las cuentas de pasarela que creó (su enlace, su cuenta de
--     tesorería y su subcuenta del plan);
--   · borra la copia.
-- Sin copia, para sin tocar nada. Va ANTES de las vueltas atrás de la 2031 y la 2030.

do $$ begin
  if to_regclass('public.conta_s01_cobros_antes') is null then
    raise exception 'S01 2238 · vuelta atrás: no está la copia previa (conta_s01_cobros_antes). No toco nada.';
  end if;
  if exists (select 1 from public.journal_entry j join public.conta_s01_cobros_antes c on c.tabla = 'journal_entry' and c.id = j.id
              where j.status not in ('propuesto', 'borrador')) then
    raise exception 'S01 2238 · vuelta atrás: algún asiento de cobro que creó ya está validado o anulado. Se decide antes; no toco nada.';
  end if;
end $$;

delete from public.journal_entry where id in (select id from public.conta_s01_cobros_antes where tabla = 'journal_entry');
update public.customer_invoice_payment p set entry_id = c.antes
  from public.conta_s01_cobros_antes c where c.tabla = 'customer_invoice_payment' and c.id = p.id;
delete from public.conta_pasarela_cuenta where treasury_account_id in (select id from public.conta_s01_cobros_antes where tabla = 'conta_pasarela_cuenta');
delete from public.company_account_link where entity = 'bank_account'
   and entity_id in (select id::text from public.conta_s01_cobros_antes where tabla = 'conta_pasarela_cuenta');
delete from public.treasury_account where id in (select id from public.conta_s01_cobros_antes where tabla = 'conta_pasarela_cuenta');
delete from public.company_account where id in (select antes from public.conta_s01_cobros_antes where tabla = 'conta_pasarela_cuenta');
drop table public.conta_s01_cobros_antes;
