-- supabase/vuelta-atras/20261113T1511_s01p_foodint_ocho_por_aclarar.down.sql
--
-- S01p·20 · 1 · la vuelta atrás de la 1511: fuera las filas «por aclarar» de los 8 correos de Just Eat
-- de Foodint (y su actividad). Solo las de esos 8 correos y sin fichero ni enlace: las que crea la 1511.
-- Los correos y su registro de entrada no se tocan. En staging no hay ninguna: no hace nada.

delete from public.document_activity
 where inbox_id in (
   select d.id from public.document_inbox d
    where d.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and d.file_path is null and d.link_url is null
      and d.email_id in ('36ccc167-ad37-44d1-97fa-37af5473b673', '855e42e1-a7dd-4f9d-aa3f-ace64f0219b9', '95d4117e-1938-4d84-9eef-63e386a7b0d8',
                         'a5364aee-8f47-41a2-bd34-e05fc211a93b', '398151b2-ac78-4f70-a9e5-620fcaab9649', '6026529c-f1f4-46e5-91c5-1383674e3b6c',
                         'f9bc4e4d-95df-4115-92fe-c5e128a2d61f', 'e4e99e89-d808-434c-81ed-cdb996c1b4e8'));
delete from public.document_inbox d
 where d.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and d.file_path is null and d.link_url is null
   and d.email_id in ('36ccc167-ad37-44d1-97fa-37af5473b673', '855e42e1-a7dd-4f9d-aa3f-ace64f0219b9', '95d4117e-1938-4d84-9eef-63e386a7b0d8',
                      'a5364aee-8f47-41a2-bd34-e05fc211a93b', '398151b2-ac78-4f70-a9e5-620fcaab9649', '6026529c-f1f4-46e5-91c5-1383674e3b6c',
                      'f9bc4e4d-95df-4115-92fe-c5e128a2d61f', 'e4e99e89-d808-434c-81ed-cdb996c1b4e8');
