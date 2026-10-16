-- supabase/vuelta-atras/20261116T0110_c06b_promociones_envios_datos.down.sql
--
-- Vuelta atrás de 20261116T0110_c06b_promociones_envios_datos: quita los 6
-- enlaces de Foodint en conta_ventas_canal_cuenta y las 4 subcuentas que creó
-- (70009001–70009003 y 70500001). Anclado por cuenta y empresa (regla 9).
-- Si alguna subcuenta ya tiene apuntes, PARA sin tocar nada: un asiento con
-- ella no se queda sin su cuenta (se anula antes, o la vuelta atrás no va).

do $$
declare
  v_cuenta  constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_empresa constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_mal text; n int;
begin
  if not exists (select 1 from public.company where id = v_empresa and account_id = v_cuenta) then
    raise notice 'Vuelta atrás C06b 0110: esta base no tiene Foodint; no se hace nada.';
    return;
  end if;
  select string_agg(distinct a.code, ', ') into v_mal from public.journal_line l join public.company_account a on a.id = l.company_account_id
   where l.account_id = v_cuenta and a.account_id = v_cuenta and a.company_id = v_empresa and a.code in ('70009001', '70009002', '70009003', '70500001');
  if v_mal is not null then
    raise exception 'Vuelta atrás C06b 0110: % ya tienen apuntes. No se toca nada.', v_mal;
  end if;
  delete from public.conta_ventas_canal_cuenta where account_id = v_cuenta and company_id = v_empresa;
  get diagnostics n = row_count;
  raise notice 'Vuelta atrás C06b 0110: % enlaces fuera.', n;
  delete from public.company_account
   where account_id = v_cuenta and company_id = v_empresa and code in ('70009001', '70009002', '70009003', '70500001') and kind = 'own';
  get diagnostics n = row_count;
  raise notice 'Vuelta atrás C06b 0110: % subcuentas fuera.', n;
end $$;
