-- supabase/vuelta-atras/20261110T1345_gp_portal_demo_empresa.down.sql
--
-- GP · La vuelta atrás de la 1345: conta_portal_demo_preparar y conta_portal_cuenta
-- como estaban (restauradas de su respaldo), y fuera lo que sembró en la cuenta de
-- la gestoría: el enlace de Talleres Ruiz a su empresa, el acceso de Lucía Pardo y
-- la conversación. La empresa de Talleres Ruiz (otra cuenta demo, sin uso fuera del
-- portal de la demo) y el contacto de la gestoría se quedan: no molestan y la
-- siguiente preparación los vuelve a usar.
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
