-- supabase/vuelta-atras/20261110T1345_gp_portal_demo_empresa.down.sql
--
-- GP · La vuelta atrás de la 1345: conta_portal_demo_preparar y conta_portal_cuenta
-- como estaban (restauradas de su respaldo), y fuera lo que sembró en la cuenta de
-- la demo: el enlace de Talleres Ruiz a su empresa, el acceso de Lucía Pardo, la
-- conversación y la empresa de Talleres Ruiz entera (la cuenta demo …b1: sus
-- nóminas, sus trabajadores, sus impuestos y su sociedad; lo demás cae con ella).
-- El contacto de la gestoría se queda (es inventado y no se sabe el de antes).
-- Los PDF de la demo que se hubieran hecho en el almacén se quedan: nadie los lee.
-- sin prueba con datos: la prueba de staging (20261110_gp_portal_demo_empresa_prueba.sql) la pasa en ROLLBACK y comprueba que no queda nada de eso.

select public._restaurar_funcion('public.conta_portal_cuenta(uuid)', '20261110T1345_gp_portal_demo_empresa');
select public._restaurar_funcion('public.conta_portal_demo_preparar(uuid)', '20261110T1345_gp_portal_demo_empresa');

update public.conta_gestoria_cliente set cuenta_propia_account_id = null
 where cuenta_propia_account_id = 'de000000-0000-4000-8000-0000000000b1'
   and account_id in (select id from public.accounts where is_demo is true);
delete from public.conta_portal_acceso
 where lower(correo) = 'administracion@talleresruiz.example' and invitado_por_name = 'Preparación de la demo' and user_id is null
   and account_id in (select id from public.accounts where is_demo is true);
delete from public.conta_portal_mensaje
 where account_id in (select id from public.accounts where is_demo is true)
   and texto in ('Hola, Tomás. Ya está hecha el alta del trabajador nuevo. ¿Tiene jornada completa o parcial? Lo necesito para su nómina.',
                 'Completa, 40 horas a la semana. El contrato firmado te lo paso mañana.',
                 'Perfecto, recibido. Su primera nómina sale con la del mes que viene.');

-- La empresa de Talleres Ruiz: solo si es la cuenta demo que creó la 1345. Se vacía
-- tabla a tabla (todas las que tienen account_id, por pasadas, como «Volver a
-- empezar»: algunas, como employees, no tienen clave ajena y no caerían con la
-- cuenta), y después la cuenta.
do $$
declare v_t text; v_n bigint; v_pasada bigint; v_tablas text[]; v_mal jsonb := '{}'::jsonb;
begin
  if not exists (select 1 from public.accounts where id = 'de000000-0000-4000-8000-0000000000b1' and is_demo is true and slug = 'talleres-ruiz-demo') then
    return;
  end if;
  delete from public.documents d using public.employees e where e.id = d.employee_id and e.account_id = 'de000000-0000-4000-8000-0000000000b1';
  select array_agg(c.table_name::text order by c.table_name) into v_tablas
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
   where c.table_schema = 'public' and c.column_name = 'account_id' and c.table_name <> 'accounts';
  for i in 1..8 loop
    v_pasada := 0;
    foreach v_t in array v_tablas loop
      begin
        execute format('delete from public.%I where account_id = $1', v_t) using 'de000000-0000-4000-8000-0000000000b1'::uuid;
        get diagnostics v_n = row_count; v_pasada := v_pasada + v_n; v_mal := v_mal - v_t;
      exception when others then v_mal := jsonb_set(v_mal, array[v_t], to_jsonb(sqlerrm));
      end;
    end loop;
    exit when v_pasada = 0;
  end loop;
  delete from public.accounts where id = 'de000000-0000-4000-8000-0000000000b1';
  if v_mal <> '{}'::jsonb then raise notice 'GP-1345 · vuelta atrás: no se dejaron vaciar %', v_mal; end if;
end $$;
