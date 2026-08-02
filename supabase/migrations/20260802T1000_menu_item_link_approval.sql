-- Trazabilidad ítem↔escandallo: aprobación explícita del enlace.
-- Campo nuevo, separado de menu_item.needs_review (que ~15 funciones usan con
-- otro significado: "hay coste", no "el enlace es correcto").
-- Aplicar por SQL Editor a mano (sin begin/commit; el editor los descarta).
-- Verificar las 2 columnas con una query independiente después de aplicar.

alter table public.menu_item
  add column if not exists link_approved_at timestamptz,
  add column if not exists link_approved_by uuid references auth.users(id);

-- Guard: aborta si las columnas no quedaron (el editor se traga statements sueltos).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'menu_item' and column_name = 'link_approved_at'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: menu_item.link_approved_at no existe';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'menu_item' and column_name = 'link_approved_by'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: menu_item.link_approved_by no existe';
  end if;
end $$;
