-- ENCARGO CODE (14/08) "claves de Supply" — correción de alcance tras
-- respuesta de Julio: (1) Facturas necesita clave propia (show_facturas),
-- no se decidió en 20260814T1500; (2) show_costes NO entra en el backfill
-- de compatibilidad — nace en false para todos, mismo criterio que
-- show_salaries. La migración anterior lo puso a true por alcance
-- incompleto; se corrige aquí, en migración NUEVA (no se edita la aplicada).
alter table manager_permissions
  add column show_facturas boolean not null default false;

update manager_permissions
set show_facturas = show_inventory;

update manager_permissions
set show_costes = false;

do $$
declare
  v_count integer;
  v_costes_true integer;
begin
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'manager_permissions'
    and column_name = 'show_facturas';
  if v_count <> 1 then
    raise exception 'falta la columna show_facturas en manager_permissions';
  end if;

  select count(*) into v_costes_true from manager_permissions where show_costes = true;
  if v_costes_true <> 0 then
    raise exception 'show_costes sigue en true en % filas tras la corrección', v_costes_true;
  end if;
end $$;
