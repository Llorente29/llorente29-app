-- supabase/migrations/20261028T1440_w10_project_url.sql
--
-- W10 · Staging no llama a producción (28/10/2026). Primera de dos: SOLO AÑADE.
--
-- La dirección del propio proyecto sale del Vault (project_url), como ya hacía
-- la purga de capturas del C9. Julio la creó a mano en los dos proyectos el
-- 28/10 (14:02 y 14:03), cada uno apuntando a sí mismo, y la comprobó. Ninguna
-- migración la escribe: llevaría la dirección de un proyecto en el repositorio,
-- que es justo lo que el W10 quita.
--
--   · public._project_url(): la dirección, sin barra final. Si falta, o no
--     tiene forma de https://<ref>.supabase.co, falla en voz alta.
--   · public._project_url_si_hay(): lo mismo, pero NULL si falta. Para los dos
--     disparadores de sale, que están en el camino del pedido: un pedido no se
--     puede quedar sin guardar porque falte un ajuste.
--   · public._aviso_falta_en_vault(que, venta): lo que hacen esos dos
--     disparadores cuando falta algo del Vault: no llaman a nadie y lo dejan
--     dicho en system_alert (regla 8: callar no es una opción). Si ni el aviso
--     se puede guardar, un warning, y el pedido sigue.
--
-- Nadie de fuera las llama: las 23 que las usan son SECURITY DEFINER.
-- Vuelta atrás: supabase/vuelta-atras/20261028T1440_w10_project_url.down.sql

create or replace function public._project_url_si_hay()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select rtrim(s.decrypted_secret, '/')
    from vault.decrypted_secrets s
   where s.name = 'project_url'
     and s.decrypted_secret ~ '^https://[a-z0-9]+\.supabase\.co/?$'
   limit 1
$$;

create or replace function public._project_url()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v text := public._project_url_si_hay();
begin
  if v is null then
    raise exception 'Falta project_url en el Vault de este proyecto (o no tiene forma de https://<ref>.supabase.co). Se crea a mano: Supabase → Project Settings → Vault.';
  end if;
  return v;
end $$;

create or replace function public._aviso_falta_en_vault(p_que text, p_venta uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public._queue_system_alert(
      'vault',
      'Sin llamar a ' || p_que || ': falta un ajuste en el Vault',
      format('El pedido %s no ha llamado a %s porque falta project_url (o su secreto) en el Vault de este proyecto. El pedido se ha guardado; la llamada no ha salido.', p_venta, p_que),
      'vault-' || p_que
    );
  exception when others then
    raise warning '_aviso_falta_en_vault: no se pudo avisar de % (venta %): %', p_que, p_venta, sqlerrm;
  end;
end $$;

revoke all on function public._project_url_si_hay() from public, anon, authenticated;
revoke all on function public._project_url() from public, anon, authenticated;
revoke all on function public._aviso_falta_en_vault(text, uuid) from public, anon, authenticated;
