-- docs/conta/staging/03_almacenamiento.sql
--
-- Almacenamiento de staging-conta: los 17 buckets de producción (solo su
-- configuración; VACÍOS, ni un archivo) y las 35 políticas de storage.objects.
-- Generado desde producción el 01/10/2026 con:
--   buckets  → format() sobre storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
--   políticas → format() sobre pg_policies where schemaname = 'storage'
-- Las políticas usan funciones de public (belongs_to_account,
-- current_user_is_admin_or_manager_of, current_user_is_employee,
-- current_user_is_admin), que ya existen en la rama tras la copia del esquema.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
('account-logos','account-logos',true,2097152,'{image/png,image/jpeg,image/webp}'::text[]),
('appcc-photos','appcc-photos',false,5242880,'{image/jpeg,image/png,image/webp}'::text[]),
('apps','apps',true,209715200,null),
('brand-logos','brand-logos',true,2097152,'{image/png,image/jpeg,image/webp}'::text[]),
('compliance-docs','compliance-docs',false,null,null),
('connector-logos','connector-logos',true,null,null),
('course-certificates','course-certificates',false,null,null),
('course-section-images','course-section-images',false,null,null),
('course-signatures','course-signatures',false,null,null),
('delivery-proof','delivery-proof',true,null,null),
('employee-documents','employee-documents',true,5242880,'{application/pdf,image/jpeg,image/png,image/webp}'::text[]),
('l3-muestras','l3-muestras',false,10485760,'{image/jpeg,image/png}'::text[]),
('menu-photos','menu-photos',true,null,null),
('order-evidence','order-evidence',false,10485760,'{image/jpeg,image/webp}'::text[]),
('receipt-uploads','receipt-uploads',false,10485760,'{image/jpeg,image/png,image/webp,application/pdf}'::text[]),
('recipe-uploads','recipe-uploads',false,null,null),
('social-media','social-media',true,10485760,'{image/jpeg,image/png}'::text[])
on conflict (id) do nothing;

CREATE POLICY account_logos_delete ON storage.objects AS PERMISSIVE FOR DELETE TO public USING (((bucket_id = 'account-logos'::text) AND current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)));
CREATE POLICY account_logos_insert ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK (((bucket_id = 'account-logos'::text) AND current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)));
CREATE POLICY account_logos_select ON storage.objects AS PERMISSIVE FOR SELECT TO public USING (((bucket_id = 'account-logos'::text) AND belongs_to_account(((storage.foldername(name))[1])::uuid)));
CREATE POLICY account_logos_update ON storage.objects AS PERMISSIVE FOR UPDATE TO public USING (((bucket_id = 'account-logos'::text) AND current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)));
CREATE POLICY anon_all_employee_documents ON storage.objects AS PERMISSIVE FOR ALL TO public USING ((bucket_id = 'employee-documents'::text)) WITH CHECK ((bucket_id = 'employee-documents'::text));
CREATE POLICY authenticated_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING ((bucket_id = 'appcc-photos'::text));
CREATE POLICY authenticated_read ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING ((bucket_id = 'appcc-photos'::text));
CREATE POLICY authenticated_upload ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'appcc-photos'::text));
CREATE POLICY brand_logos_delete ON storage.objects AS PERMISSIVE FOR DELETE TO public USING (((bucket_id = 'brand-logos'::text) AND current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)));
CREATE POLICY brand_logos_insert ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK (((bucket_id = 'brand-logos'::text) AND current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)));
CREATE POLICY brand_logos_select ON storage.objects AS PERMISSIVE FOR SELECT TO public USING (((bucket_id = 'brand-logos'::text) AND belongs_to_account(((storage.foldername(name))[1])::uuid)));
CREATE POLICY brand_logos_update ON storage.objects AS PERMISSIVE FOR UPDATE TO public USING (((bucket_id = 'brand-logos'::text) AND current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)));
CREATE POLICY compliance_docs_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'compliance-docs'::text) AND current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)));
CREATE POLICY compliance_docs_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'compliance-docs'::text) AND current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)));
CREATE POLICY compliance_docs_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'compliance-docs'::text) AND belongs_to_account(((storage.foldername(name))[1])::uuid)));
CREATE POLICY compliance_docs_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'compliance-docs'::text) AND current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)));
CREATE POLICY course_certificates_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'course-certificates'::text) AND (current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid) OR current_user_is_employee(((storage.foldername(name))[2])::uuid, ((storage.foldername(name))[1])::uuid))));
CREATE POLICY course_certificates_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'course-certificates'::text) AND (current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid) OR current_user_is_employee(((storage.foldername(name))[2])::uuid, ((storage.foldername(name))[1])::uuid))));
CREATE POLICY course_section_images_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'course-section-images'::text) AND
CASE
    WHEN ((storage.foldername(name))[1] = '_global'::text) THEN current_user_is_admin()
    ELSE current_user_is_admin_or_manager_of((NULLIF((storage.foldername(name))[1], ''::text))::uuid)
END));
CREATE POLICY course_section_images_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'course-section-images'::text) AND
CASE
    WHEN ((storage.foldername(name))[1] = '_global'::text) THEN current_user_is_admin()
    ELSE current_user_is_admin_or_manager_of((NULLIF((storage.foldername(name))[1], ''::text))::uuid)
END));
CREATE POLICY course_section_images_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'course-section-images'::text) AND
CASE
    WHEN ((storage.foldername(name))[1] = '_global'::text) THEN true
    ELSE belongs_to_account((NULLIF((storage.foldername(name))[1], ''::text))::uuid)
END));
CREATE POLICY course_signatures_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'course-signatures'::text) AND current_user_is_employee(((storage.foldername(name))[2])::uuid, ((storage.foldername(name))[1])::uuid)));
CREATE POLICY course_signatures_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'course-signatures'::text) AND (current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid) OR current_user_is_employee(((storage.foldername(name))[2])::uuid, ((storage.foldername(name))[1])::uuid))));
CREATE POLICY menu_photos_delete ON storage.objects AS PERMISSIVE FOR DELETE TO public USING (((bucket_id = 'menu-photos'::text) AND current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)));
CREATE POLICY menu_photos_insert ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK (((bucket_id = 'menu-photos'::text) AND current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)));
CREATE POLICY menu_photos_select ON storage.objects AS PERMISSIVE FOR SELECT TO public USING (((bucket_id = 'menu-photos'::text) AND belongs_to_account(((storage.foldername(name))[1])::uuid)));
CREATE POLICY menu_photos_update ON storage.objects AS PERMISSIVE FOR UPDATE TO public USING (((bucket_id = 'menu-photos'::text) AND current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)));
CREATE POLICY receipt_uploads_delete ON storage.objects AS PERMISSIVE FOR DELETE TO public USING (((bucket_id = 'receipt-uploads'::text) AND current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)));
CREATE POLICY receipt_uploads_insert ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK (((bucket_id = 'receipt-uploads'::text) AND belongs_to_account(((storage.foldername(name))[1])::uuid)));
CREATE POLICY receipt_uploads_select ON storage.objects AS PERMISSIVE FOR SELECT TO public USING (((bucket_id = 'receipt-uploads'::text) AND belongs_to_account(((storage.foldername(name))[1])::uuid)));
CREATE POLICY receipt_uploads_update ON storage.objects AS PERMISSIVE FOR UPDATE TO public USING (((bucket_id = 'receipt-uploads'::text) AND current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)));
CREATE POLICY recipe_uploads_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'recipe-uploads'::text) AND current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)));
CREATE POLICY recipe_uploads_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'recipe-uploads'::text) AND current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)));
CREATE POLICY recipe_uploads_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'recipe-uploads'::text) AND belongs_to_account(((storage.foldername(name))[1])::uuid)));
CREATE POLICY recipe_uploads_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'recipe-uploads'::text) AND current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)));
