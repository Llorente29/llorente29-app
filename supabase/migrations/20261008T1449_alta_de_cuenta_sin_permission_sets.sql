-- 08/10/2026 · APLICADA en producción a las 14:49 (schema_migrations 20261008124905).
--
-- create_account_tx seguía leyendo permission_sets y escribiendo en
-- permission_set_assignments, tablas retiradas el 14/08
-- (20260814T1400_f0_a1_drop_permission_sets). Desde ese día no se podía dar de
-- alta una cuenta: «relation "permission_sets" does not exist». Salió al crear
-- la cuenta de demostración. El rol admin del perfil basta.
--
-- Cirugía sobre la definición viva, con guarda de «aparece exactamente una vez».
-- Ensayada antes en transacción revertida ejecutando el alta entera.
-- En banda: no la llama ningún cron ni disparador (0 y 0, medido) y es un
-- create or replace de función, sin cierre sobre tablas.
--
-- DEUDA que queda: delete_account_tx y replicate_system_permission_sets siguen
-- citando esas tablas.
do $mig$
declare
  v_def text;
  v_new text;
  p1 text := '\s*SELECT id INTO v_gerente_total_id\s+FROM permission_sets WHERE name = ''gerente_total'' AND is_system = true AND account_id IS NULL LIMIT 1;\s+IF v_gerente_total_id IS NULL THEN\s+RAISE EXCEPTION ''No existe el permission_set global gerente_total'';\s+END IF;';
  p2 text := '\s*INSERT INTO permission_set_assignments \(user_profile_id, permission_set_id, assigned_by\)\s+VALUES \(v_user_profile_id, v_gerente_total_id, p_created_by\);';
  n1 int; n2 int;
begin
  select pg_get_functiondef(p.oid) into strict v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_account_tx';

  select count(*) into n1 from regexp_matches(v_def, p1, 'g');
  select count(*) into n2 from regexp_matches(v_def, p2, 'g');
  if n1 <> 1 or n2 <> 1 then
    raise exception 'create_account_tx: fragmentos esperados 1 y 1, encontrados % y %', n1, n2;
  end if;

  v_new := regexp_replace(v_def, p1, E'\n');
  v_new := regexp_replace(v_new, p2, E'\n  -- (08/10/2026) permission_sets se retiró el 14/08: el rol admin del perfil basta.');

  if v_new ~* 'permission_set_assignments|FROM permission_sets' then
    raise exception 'create_account_tx: sigue citando permission_sets tras el parche';
  end if;

  execute v_new;
end
$mig$;
