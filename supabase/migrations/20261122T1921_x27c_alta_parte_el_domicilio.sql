-- supabase/migrations/20261122T1921_x27c_alta_parte_el_domicilio.sql
-- cambia: public.supplier · prueba: supabase/staging/sql/20261122_x27c_domicilio_prueba.sql
--
-- X27c · Al dar de alta un proveedor, su domicilio partido (respuesta X27 · 1, punto 5: la ficha de un proveedor dado
-- de alta solo traía la población dentro del domicilio y la provincia vacía). Disparador antes de insertar en
-- supplier: con domicilio y sin población, se parte con _x27c_partir_domicilio (1920) y se llena lo VACÍO (código
-- postal, población, provincia; la calle se queda solo con su parte); con código postal y sin provincia, la de su
-- código. Vale para todas las altas (la automática al leer una factura, R14/X24; la de la pantalla; las importaciones).
-- Lo que ya está guardado no se toca (solo al insertar): la cuenta de la tanda dice cuántos hay así.
-- Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261122T1921_x27c_alta_parte_el_domicilio.down.sql

create or replace function public.tg_x27c_alta_parte_el_domicilio()
returns trigger language plpgsql set search_path = public as $$
declare v jsonb;
begin
  if new.fiscal_street is not null and new.fiscal_city is null then
    v := public._x27c_partir_domicilio(new.fiscal_street);
    if v->>'ciudad' is not null then
      new.fiscal_street := coalesce(v->>'calle', new.fiscal_street);
      new.fiscal_city := v->>'ciudad';
      if new.fiscal_postal_code is null then new.fiscal_postal_code := v->>'cp'; end if;
      if new.fiscal_province is null then new.fiscal_province := v->>'provincia'; end if;
    end if;
  end if;
  if new.fiscal_province is null and new.fiscal_postal_code is not null and coalesce(new.country_code, 'ES') = 'ES' then
    new.fiscal_province := public._x27c_provincia_de_cp(new.fiscal_postal_code);
  end if;
  return new;
end $$;
comment on function public.tg_x27c_alta_parte_el_domicilio() is
  'X27c · Al dar de alta un proveedor, su domicilio partido: la población, el código postal y la provincia que vienen dentro del domicilio, y la provincia de su código postal. Solo lo vacío.';
revoke all on function public.tg_x27c_alta_parte_el_domicilio() from public, anon, authenticated;
drop trigger if exists x27c_alta_parte_el_domicilio on public.supplier;
create trigger x27c_alta_parte_el_domicilio before insert on public.supplier
  for each row execute function public.tg_x27c_alta_parte_el_domicilio();
