-- supabase/migrations/20261116T1850_e01_direcciones_sumied.sql
--
-- E01 · Las direcciones de los clientes de Sumied, en @entrada.sumied.com.
-- Cada empresa cuyo dominio es entrada.sumied.com (la regla de la 1840,
-- _conta_dominio_entrada) y tiene una dirección en entrada.folvy.app recibe la
-- MISMA (misma clase, mismo nombre, misma empresa y cuenta) en
-- entrada.sumied.com, encendida. La de entrada.folvy.app no se toca: sigue
-- encendida (lo que alguien mande a mano no se pierde) y ya no se enseña.
-- Medido en producción (solo lectura) el 16/11: son las 3 de Piri Piri
-- (facturas-piripiri-espana, facturas-frango-takeaway y
-- facturas-piripiri-prosperidad), cuyas sociedades lleva un despacho de marca
-- Sumied con permiso vivo. Las 2 de Foodint (cuenta Folvy, sin despacho) se
-- quedan fuera por la regla, y además se comprueba.
-- Solo añade filas; si ya están, no hace nada (se puede pasar dos veces).
-- Vuelta atrás: supabase/vuelta-atras/20261116T1850_e01_direcciones_sumied.down.sql

insert into public.company_inbound_address (account_id, company_id, kind, local_part, domain, active, created_by_name)
select f.account_id, f.company_id, f.kind, f.local_part, 'entrada.sumied.com', true, 'Tanda E01 · entrada.sumied.com'
  from public.company_inbound_address f
 where lower(f.domain) = 'entrada.folvy.app'
   and public._conta_dominio_entrada(f.company_id) = 'entrada.sumied.com'
   and not exists (select 1 from public.company_inbound_address x
                    where (x.company_id = f.company_id and x.kind = f.kind and lower(x.domain) = 'entrada.sumied.com')
                       or (lower(x.local_part) = lower(f.local_part) and lower(x.domain) = 'entrada.sumied.com'));

-- Foodint (cuenta Folvy, sin despacho) no puede tener ninguna en entrada.sumied.com.
do $$ begin
  if exists (select 1 from public.company_inbound_address
              where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and lower(domain) <> 'entrada.folvy.app') then
    raise exception 'E01 · 1850: Foodint tiene una dirección fuera de entrada.folvy.app. No se toca nada.';
  end if;
end $$;
