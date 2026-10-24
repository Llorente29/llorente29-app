-- supabase/migrations/20261121T0120_s01_logo_empresa.sql
--
-- S01 · El logo de cada empresa, en la cabecera del esqueleto con el selector
-- de empresa (inventario del paso 1, §4.3, aprobado por Julio). SOLO AÑADE: una
-- columna que admite nulos, un bucket nuevo y sus políticas. No toca ninguna
-- fila ni ninguna función que exista.
--
--   1. company.logo_path: la ruta del logo en el bucket (nula = sin logo). Por
--      empresa y no el accounts.logo_url que ya existe, porque en la cabecera
--      el logo va con el selector de empresa y una cuenta puede tener muchas
--      (un asesor). Sin logo de empresa se usa el de la cuenta; sin ninguno, la
--      inicial.
--   2. El bucket company-logos: PRIVADO (se leen con URL firmada), imágenes de
--      hasta 1 MB (png, jpeg, webp; sin svg: no se sirve nada que pueda llevar
--      código). Ruta: <account_id>/<company_id>/<huella>.<ext>.
--   3. Sus políticas, como las de banco-tickets: lee quien es de la cuenta (la
--      primera carpeta); sube, cambia y borra el administrador o el gestor de
--      esa cuenta.
--
-- Vuelta atrás: supabase/vuelta-atras/20261121T0120_s01_logo_empresa.down.sql.
-- Prueba (rollback): supabase/staging/sql/20261121_s01_logo_empresa_prueba.sql.

alter table public.company add column if not exists logo_path text;
comment on column public.company.logo_path is
  'S01 (17/10): ruta del logo de la empresa en el bucket company-logos (<account_id>/<company_id>/<huella>.<ext>). Nula = sin logo: la cabecera usa el de la cuenta o la inicial.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-logos', 'company-logos', false, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'company_logos_select') then
    create policy company_logos_select on storage.objects for select to authenticated
      using (bucket_id = 'company-logos'
             and (storage.foldername(name))[1] = any (select a::text from unnest(public.current_user_account_ids()) a));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'company_logos_insert') then
    create policy company_logos_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'company-logos'
                  and exists (select 1 from unnest(public.current_user_account_ids()) a
                               where a::text = (storage.foldername(name))[1] and public.current_user_is_admin_or_manager_of(a)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'company_logos_update') then
    create policy company_logos_update on storage.objects for update to authenticated
      using (bucket_id = 'company-logos'
             and exists (select 1 from unnest(public.current_user_account_ids()) a
                          where a::text = (storage.foldername(name))[1] and public.current_user_is_admin_or_manager_of(a)))
      with check (bucket_id = 'company-logos'
                  and exists (select 1 from unnest(public.current_user_account_ids()) a
                               where a::text = (storage.foldername(name))[1] and public.current_user_is_admin_or_manager_of(a)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'company_logos_delete') then
    create policy company_logos_delete on storage.objects for delete to authenticated
      using (bucket_id = 'company-logos'
             and exists (select 1 from unnest(public.current_user_account_ids()) a
                          where a::text = (storage.foldername(name))[1] and public.current_user_is_admin_or_manager_of(a)));
  end if;
end $$;
