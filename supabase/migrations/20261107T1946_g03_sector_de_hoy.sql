-- supabase/migrations/20261107T1946_g03_sector_de_hoy.sql
--
-- G03 · DATOS: el sector de las empresas que ya existen. CAMBIA DATOS de una
-- tabla que existe: va con «autorizo» (su nombre entero). Necesita la 1945.
--
-- Por CUENTA (regla 9: por account_id, nunca por nombre), con lo que dijo
-- Julio el 07/11:
--   · Asesoría QBO (f4e8032d…): sus 2 empresas, gestoría;
--   · Casa Lola (623d946a…): su empresa, hostelería (hoy, sin decir);
--   · el resto: hostelería donde is_hospitality es sí, general donde no o nula.
-- Medido en producción el 07/11 (solo lectura, todas las cuentas): 7 empresas,
-- 4 con is_hospitality sí (Foodint 1, Piri Piri 3), 2 no (QBO) y 1 nula (Casa
-- Lola). Queda: 4 + 1 de hostelería, 2 de gestoría, 0 general.
--
-- Solo las que aún no tienen sector: lo que alguien ya puso no se toca. PARA
-- sin escribir si una de esas dos cuentas no tiene las empresas medidas. En
-- otra base (staging), si las cuentas no están, solo vale la regla del resto.
-- Con el disparador de la 1945, is_hospitality sigue al sector: solo cambia
-- la de Casa Lola (de nula a sí).
-- Vuelta atrás: supabase/vuelta-atras/20261107T1946_g03_sector_de_hoy.down.sql

do $$
declare n_qbo int; n_lola int; n_gen int; n_hos int; n_ges int;
begin
  select count(*) into n_qbo from public.company where account_id = 'f4e8032d-510a-4e57-914c-4b67732d8655';
  select count(*) into n_lola from public.company where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331';
  if n_qbo not in (0, 2) then
    raise exception 'G03 sector: la cuenta Asesoría QBO tiene % empresa(s), se midieron 2. No se pone nada.', n_qbo;
  end if;
  if n_lola not in (0, 1) then
    raise exception 'G03 sector: la cuenta Casa Lola tiene % empresa(s), se midió 1. No se pone nada.', n_lola;
  end if;

  update public.company set sector = 'gestoria'
   where account_id = 'f4e8032d-510a-4e57-914c-4b67732d8655' and sector is null;
  update public.company set sector = 'hosteleria'
   where account_id = '623d946a-a0ce-4f34-8c00-9761dfed8331' and sector is null;
  update public.company set sector = case when is_hospitality then 'hosteleria' else 'general' end
   where sector is null;

  if exists (select 1 from public.company where sector is null) then
    raise exception 'G03 sector: quedan empresas sin sector.';
  end if;
  if exists (select 1 from public.company where (sector = 'hosteleria') is distinct from coalesce(is_hospitality, false)) then
    raise exception 'G03 sector: hay empresas cuyo sector no cuadra con is_hospitality.';
  end if;
  select count(*) filter (where sector = 'general'), count(*) filter (where sector = 'hosteleria'), count(*) filter (where sector = 'gestoria')
    into n_gen, n_hos, n_ges from public.company;
  raise notice 'G03 sector: % general, % hostelería, % gestoría (todas las cuentas).', n_gen, n_hos, n_ges;
end $$;
