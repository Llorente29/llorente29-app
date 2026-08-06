-- 20260806T1200_compliance_docs_storage_policies.sql
-- Aplicada: 2026-08-06 por MCP (apply_migration). Verificada (4 políticas).
-- Políticas de storage.objects del bucket privado compliance-docs.
-- Calcadas de receipt-uploads: scope por cuenta vía la 1ª carpeta del path
-- (storage.foldername(name)[1] = account_id). INSERT/UPDATE/DELETE endurecidos a
-- admin/manager (decisión de Julio: suben manager y admin); SELECT = miembro.
-- Path: {account_id}/{doc_family}/{uuid}.{ext}

create policy compliance_docs_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'compliance-docs'
              and current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid));

create policy compliance_docs_select on storage.objects
  for select to authenticated
  using (bucket_id = 'compliance-docs'
         and belongs_to_account(((storage.foldername(name))[1])::uuid));

create policy compliance_docs_update on storage.objects
  for update to authenticated
  using (bucket_id = 'compliance-docs'
         and current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid));

create policy compliance_docs_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'compliance-docs'
         and current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid));

do $$ begin
  if (select count(*) from pg_policies
        where schemaname='storage' and tablename='objects'
          and policyname like 'compliance_docs_%') <> 4
  then raise exception 'compliance_docs_storage_policies: no quedaron las 4 políticas'; end if;
end $$;
