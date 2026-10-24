-- supabase/vuelta-atras/20261122T0170_s01d_banco_nuevo.down.sql
--
-- Vuelta atrás de 20261122T0170_s01d_banco_nuevo: quita la función.
-- Lo que la función ya hizo se queda, por diseño: los bancos dados de alta y
-- sus subcuentas 572 son datos de la empresa (y pueden tener apuntes). No se
-- borran: se dice cuántos hay, y se siguen trabajando como cualquier otro banco.

do $$
declare n bigint;
begin
  select count(*) into n from public.company_account a
   where a.template_code = '572' and a.source = 'manual' and a.name like 'Bancos · %'
     and exists (select 1 from public.company_account_link l where l.company_account_id = a.id and l.entity = 'bank_account' and l.source = 'manual');
  if n > 0 then
    raise notice 'S01d 0170 vuelta atrás: % subcuentas 572 de bancos dados de alta con ella se quedan (son datos de la empresa).', n;
  end if;
end $$;

drop function if exists public.bank_cuenta_nueva(uuid, text, text, text, uuid, boolean, text);
