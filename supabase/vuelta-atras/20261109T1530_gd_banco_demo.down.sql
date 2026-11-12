-- supabase/vuelta-atras/20261109T1530_gd_banco_demo.down.sql
--
-- Vuelta atrás de la 1530: el banco de Gestoría Demo, S.L. vuelve al IBAN de
-- mentira que le puso la 0110 (termina en 01) y se quita la función.

update public.treasury_account set iban = 'ES4299990001490000000101'
 where account_id = 'de000000-0000-4000-8000-0000000000a0' and company_id = 'de000000-0000-4000-8000-0000000000a9'
   and kind = 'bank' and is_default and iban = 'ES7499990001480000000156'
   and exists (select 1 from public.accounts where id = 'de000000-0000-4000-8000-0000000000a0' and is_demo is true);
drop function if exists public.demo_gestoria_banco_sembrar(uuid);
