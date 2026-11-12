-- supabase/migrations/20261109T1530_gd_banco_demo.sql
--
-- GD · El banco de Gestoría Demo, S.L. termina como la cuenta de abono del
-- sandbox (Julio, nº32 c). La lectura de GoCardless compara las dos últimas
-- cifras de la cuenta donde abona GoCardless con los bancos del emisor en
-- Sumied; el sandbox abona en una cuenta que termina en «56» y el banco de
-- mentira de la demo terminaba en «01»: salía en naranja «GoCardless abona en
-- una cuenta … que termina en 56, y ninguna cuenta del emisor en Sumied termina
-- así».
--
--   demo_gestoria_banco_sembrar(cuenta): SOLO cuentas de demostración y SOLO la
--   plataforma. El banco por defecto de la sociedad pasa a un IBAN de mentira
--   del banco 9999 que termina en 56 (ES74 9999 0001 48 0000000156, con sus
--   controles bien hechos: se ve inventado, T11). Repetible. «Volver a empezar»
--   la llama con las otras siembras. La próxima lectura de GoCardless (la de la
--   noche o la de un aviso) ya lo da por bueno.
--
-- Después la llama para «Gestoría Demo». Solo toca la cuenta demo (regla 9).
-- Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261109T1530_gd_banco_demo.down.sql

create or replace function public.demo_gestoria_banco_sembrar(p_cuenta uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_soc uuid; v_n int;
begin
  if not exists (select 1 from public.accounts where id = p_cuenta and is_demo is true) then
    raise exception 'GD: % no es una cuenta de demostración: no se siembra nada.', p_cuenta using errcode = '42501';
  end if;
  select id into v_soc from public.company where account_id = p_cuenta and sector = 'gestoria' and entity_kind = 'company' order by created_at, id limit 1;
  if v_soc is null then return jsonb_build_object('frase', 'La cuenta demo no tiene una sociedad de Gestoría: no se toca el banco.'); end if;
  update public.treasury_account set iban = 'ES7499990001480000000156'
   where account_id = p_cuenta and company_id = v_soc and kind = 'bank' and is_default and iban is distinct from 'ES7499990001480000000156';
  get diagnostics v_n = row_count;
  return jsonb_build_object('frase', case when v_n > 0 then 'El banco de la sociedad demo termina ahora en 56, como la cuenta de abono del sandbox.'
                                          else 'El banco de la sociedad demo ya terminaba en 56.' end);
end $$;
comment on function public.demo_gestoria_banco_sembrar(uuid) is
  'GD · Deja el banco de la sociedad de una cuenta demo de Gestoría con un IBAN de mentira que termina como la cuenta de abono del sandbox de GoCardless (56). Solo cuentas demo; solo la plataforma.';
revoke all on function public.demo_gestoria_banco_sembrar(uuid) from public, anon, authenticated;
grant execute on function public.demo_gestoria_banco_sembrar(uuid) to service_role;

do $$
declare v jsonb;
begin
  if not exists (select 1 from public.accounts where id = 'de000000-0000-4000-8000-0000000000a0' and is_demo) then
    raise notice 'GD: no está «Gestoría Demo»: no se toca el banco.';
    return;
  end if;
  v := public.demo_gestoria_banco_sembrar('de000000-0000-4000-8000-0000000000a0');
  raise notice 'GD: %', v->>'frase';
end $$;
