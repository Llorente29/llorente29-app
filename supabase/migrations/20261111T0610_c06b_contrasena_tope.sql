-- ============================================================================
-- C06b · «HE OLVIDADO LA CONTRASEÑA» CON TOPE: 5 por hora por correo y 20 por
-- hora por conexión
-- ----------------------------------------------------------------------------
-- Respuesta 6 de Julio, tarea 3. conta-contrasena es pública (verify_jwt =
-- false). Hasta ahora el único freno era uno por minuto por correo
-- (recovery_sent_at). Ahora, además:
--   · por correo: como mucho 5 peticiones en la última hora;
--   · por conexión (la IP de quien llama): como mucho 20 en la última hora.
-- Pasado el tope NO se manda el correo, y la respuesta es la misma: el mismo
-- 200, el mismo cuerpo y el mismo camino (una sola llamada a esta función y,
-- si toca, el envío en segundo plano). Nada dice que se ha cortado.
--
-- Lo que se guarda: la HUELLA (sha256) del correo y de la conexión, nunca el
-- correo ni la IP en claro, y solo un día (cada llamada borra lo de más de 24 h).
--
-- Solo AÑADE: una tabla y una función nuevas. conta_contrasena_de_marca se
-- queda como está (la función desplegada hoy la usa; la nueva función de la
-- edge function deja de llamarla).
--
-- Vuelta atrás: supabase/vuelta-atras/20261111T0610_c06b_contrasena_tope.down.sql
-- ============================================================================

create table if not exists public.conta_contrasena_intento (
  id bigint generated always as identity primary key,
  correo_huella text not null,
  conexion_huella text,
  marca text not null,
  pedido_en timestamptz not null default now()
);
comment on table public.conta_contrasena_intento is
  'C06b · Cada petición de «He olvidado la contraseña» de una marca (conta-contrasena): huellas sha256 del correo y de la conexión, para el tope de 5 por hora por correo y 20 por hora por conexión. Un día de vida.';
create index if not exists conta_contrasena_intento_correo on public.conta_contrasena_intento (correo_huella, pedido_en);
create index if not exists conta_contrasena_intento_conexion on public.conta_contrasena_intento (conexion_huella, pedido_en);
alter table public.conta_contrasena_intento enable row level security;
revoke all on table public.conta_contrasena_intento from public, anon, authenticated;

create or replace function public.conta_contrasena_pedir(p_correo text, p_marca text, p_conexion text)
returns table (user_id uuid, se_puede boolean)
language plpgsql security definer set search_path = public, auth, extensions
as $$
declare
  v_correo text := lower(trim(p_correo));
  v_hc text := encode(extensions.digest(v_correo, 'sha256'), 'hex');
  v_hx text := case when nullif(trim(p_conexion), '') is null then null else encode(extensions.digest(trim(p_conexion), 'sha256'), 'hex') end;
  v_por_correo int; v_por_conexion int;
begin
  delete from public.conta_contrasena_intento where pedido_en < now() - interval '24 hours';
  insert into public.conta_contrasena_intento (correo_huella, conexion_huella, marca) values (v_hc, v_hx, p_marca);
  -- Contando esta: la 6.ª del correo o la 21.ª de la conexión ya no manda nada.
  select count(*) into v_por_correo from public.conta_contrasena_intento where correo_huella = v_hc and pedido_en > now() - interval '1 hour';
  select count(*) into v_por_conexion from public.conta_contrasena_intento where v_hx is not null and conexion_huella = v_hx and pedido_en > now() - interval '1 hour';
  return query
    select u.id,
           (u.recovery_sent_at is null or u.recovery_sent_at < now() - interval '60 seconds') and v_por_correo <= 5 and v_por_conexion <= 20
      from auth.users u
     where lower(u.email) = v_correo
       and exists (select 1 from public.user_profiles p join public.accounts a on a.id = p.account_id
                    where p.user_id = u.id and p.active and a.product_brand = p_marca and a.deleted_at is null)
     limit 1;
end $$;
revoke all on function public.conta_contrasena_pedir(text, text, text) from public, anon, authenticated;
grant execute on function public.conta_contrasena_pedir(text, text, text) to service_role;
comment on function public.conta_contrasena_pedir(text, text, text) is
  'C06b · Apunta la petición (huellas) y dice si se manda: persona activa de una cuenta de esa marca, un minuto desde la última recuperación, ≤ 5 en la hora por correo y ≤ 20 por conexión. Solo service_role (edge function conta-contrasena).';
