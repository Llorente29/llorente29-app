-- 20260630T2230_set_account_shop_logo.sql
--
-- El logo del hub vive en accounts.shop_logo_url, pero las políticas de accounts
-- solo permiten escribir a admins de plataforma (accounts_write_admin), así que
-- un usuario normal de la cuenta no puede actualizarlo → el UPDATE directo se
-- descartaba en silencio por RLS. RPC acotada SECURITY DEFINER que toca SOLO
-- shop_logo_url validando pertenencia (no abre la tabla accounts).

create or replace function public.set_account_shop_logo(p_account_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not belongs_to_account(p_account_id) then
    raise exception 'set_account_shop_logo: sin acceso a esta cuenta';
  end if;
  update accounts set shop_logo_url = p_url where id = p_account_id;
end;
$$;

grant execute on function public.set_account_shop_logo(uuid, text) to authenticated;
