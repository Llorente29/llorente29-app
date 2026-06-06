-- Aplicada: 2026-06-07
-- Policies de Storage para bucket menu-photos.
-- Clona el patron probado de receipt-uploads (carpeta = account_id en foldername[1]).
-- Escritura: admin/manager de la cuenta. Lectura: belongs_to_account (+ bucket publico).

create policy "menu_photos_insert"
on storage.objects for insert to public
with check (
  bucket_id = 'menu-photos'
  and current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)
);

create policy "menu_photos_update"
on storage.objects for update to public
using (
  bucket_id = 'menu-photos'
  and current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)
);

create policy "menu_photos_delete"
on storage.objects for delete to public
using (
  bucket_id = 'menu-photos'
  and current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)
);

create policy "menu_photos_select"
on storage.objects for select to public
using (
  bucket_id = 'menu-photos'
  and belongs_to_account(((storage.foldername(name))[1])::uuid)
);
