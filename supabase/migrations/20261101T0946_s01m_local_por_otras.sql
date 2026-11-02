-- supabase/migrations/20261101T0946_s01m_local_por_otras.sql
-- cambia: public._conta_local_de_texto · prueba: supabase/staging/sql/20261101_s01m_direcciones_prueba.sql
--
-- S01m · El local de un texto (la tienda de una liquidación, la factura de
-- comisión) se busca también por sus otras direcciones (0945): un local casa si
-- casa su dirección O una de las otras. Lo demás, igual que en el S01i (0050):
-- primero lo de antes del paréntesis y luego el texto entero; con dos locales,
-- ninguno. Misma firma: create or replace (regla 2).

select public._respaldar_funcion('public._conta_local_de_texto(uuid,text[])', '20261101T0946_s01m_local_por_otras');

create or replace function public._conta_local_de_texto(p_account uuid, p_textos text[])
returns uuid language plpgsql stable set search_path to 'public' as $$
declare t text; p text; v_n int; v_id uuid;
begin
  foreach t in array coalesce(p_textos, '{}'::text[]) loop
    continue when t is null or btrim(t) = '';
    foreach p in array array[regexp_replace(t, '\(.*$', ''), t] loop
      select count(distinct l.id), min(l.id::text)::uuid into v_n, v_id from public.locations l
       where l.account_id = p_account
         and ((l.address is not null and public._conta_dir_coincide(p, l.address))
              or exists (select 1 from public.location_address_alias a
                          where a.location_id = l.id and a.account_id = p_account and public._conta_dir_coincide(p, a.address)));
      if v_n = 1 then return v_id; end if;
      if v_n > 1 then return null; end if;
    end loop;
  end loop;
  return null;
end $$;
