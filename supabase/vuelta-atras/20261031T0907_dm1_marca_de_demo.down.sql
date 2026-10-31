-- supabase/vuelta-atras/20261031T0907_dm1_marca_de_demo.down.sql
-- Vuelta atrás de la 0907 (DM1 · PR 2a): fuera el disparador, la puerta y la
-- marca. Solo si ninguna cuenta es de demo: si alguna lo es, quitar la marca
-- dejaría una demo mandando cosas fuera, y para.
do $$
begin
  if exists (select 1 from public.accounts where is_demo) then
    raise exception 'Vuelta atrás de la 0907 PARADA: hay cuentas marcadas de demo. Quita antes la marca a mano.';
  end if;
end $$;
drop trigger if exists accounts_is_demo_solo_plataforma on public.accounts;
drop function if exists public._accounts_is_demo_solo_plataforma();
drop function if exists public.cuenta_puede_salir(uuid);
alter table public.accounts drop column if exists is_demo;
