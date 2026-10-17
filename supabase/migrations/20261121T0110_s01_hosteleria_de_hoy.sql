-- supabase/migrations/20261121T0110_s01_hosteleria_de_hoy.sql
--
-- S01 · DATOS: la marca de hostelería (company.is_hospitality, de la 0100) de
-- las empresas que ya existen. CAMBIA DATOS de una tabla que existe: va con
-- «autorizo» (su nombre entero).
--
-- La regla, igual en las dos bases: una empresa es de hostelería si su CUENTA
-- es de una actividad de hostelería (accounts.business_type: dark_kitchen,
-- bar, restaurante, cafeteria u hotel); si no (otro, otra_actividad), no. Cada
-- empresa con la actividad de SU cuenta (regla 9: por account_id, nunca por
-- nombre). Desde aquí la marca es de la empresa y la cambia la persona en
-- Ajustes; esta regla solo vale para poner las de hoy.
--
-- Medido en producción el 17/10 (solo lectura, tabla entera): UNA empresa,
-- Foodint (658728c0…, cuenta 51ad1792…, dark_kitchen) → hostelería. En
-- staging-conta: A (Taberna, 2 empresas) y B (Cocina) restaurante → sí; las
-- cuentas solas y la de Diez, otra_actividad → no.
--
-- Solo las que aún no tienen marca (nula): si alguien ya la puso, no se toca.
-- PARA sin escribir si la tabla trae una empresa de una cuenta que no existe.
-- Vuelta atrás: supabase/vuelta-atras/20261121T0110_s01_hosteleria_de_hoy.down.sql

do $$
declare n_si int; n_no int; n_huerfana int;
begin
  select count(*) into n_huerfana from public.company c where not exists (select 1 from public.accounts a where a.id = c.account_id);
  if n_huerfana > 0 then
    raise exception 'S01 hostelería: % empresa(s) de una cuenta que no existe; no se marca nada.', n_huerfana;
  end if;

  update public.company c
     set is_hospitality = (a.business_type in ('dark_kitchen', 'bar', 'restaurante', 'cafeteria', 'hotel'))
    from public.accounts a
   where a.id = c.account_id and c.is_hospitality is null;

  select count(*) filter (where is_hospitality), count(*) filter (where not is_hospitality) into n_si, n_no from public.company;
  raise notice 'S01 hostelería: % empresa(s) de hostelería y % que no.', n_si, n_no;
end $$;
