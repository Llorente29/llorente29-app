-- ENCARGO CODE (14/08) "claves de Supply" — separar show_inventory (que hoy
-- no gatea nada: Supply/Kitchen se ven por requiredRole, no por permiso,
-- ver RECON en la rama feat/f0-supply-permisos-granulares) en columnas
-- granulares reales de manager_permissions. show_costes es la sensible:
-- costes, escandallos y márgenes.
alter table manager_permissions
  add column show_recepcion boolean not null default false,
  add column show_pedidos boolean not null default false,
  add column show_proveedores boolean not null default false,
  add column show_inventarios boolean not null default false,
  add column show_costes boolean not null default false;

-- Backward-compat: quien hoy tenga show_inventory=true recibe las 5 nuevas
-- en true, para no perder acceso que ya tenía. Hoy solo hay 1 fila real en
-- manager_permissions (huérfana de una cuenta de pruebas), así que este
-- backfill no cambia nada observable en producción — es la lógica correcta
-- para cuando haya filas reales.
update manager_permissions
set show_recepcion = show_inventory,
    show_pedidos = show_inventory,
    show_proveedores = show_inventory,
    show_inventarios = show_inventory,
    show_costes = show_inventory;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'manager_permissions'
    and column_name in ('show_recepcion','show_pedidos','show_proveedores','show_inventarios','show_costes');
  if v_count <> 5 then
    raise exception 'faltan columnas nuevas en manager_permissions: % de 5', v_count;
  end if;
end $$;
