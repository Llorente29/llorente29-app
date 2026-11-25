-- supabase/vuelta-atras/20261125T1840_q10_cegid_leer.down.sql
--
-- Vuelta atrás de la 1840 (Q10 · leer la facturación de Cegid): quita las tres tablas de lo leído y el conector, si
-- ninguna cuenta lo ha conectado todavía (si alguna lo ha hecho, el conector se queda y lo dice: sus claves están en
-- el Vault y quitarlo las dejaría huérfanas).

drop table if exists public.conta_cegid_factura;
drop table if exists public.conta_cegid_concepto;
drop table if exists public.conta_cegid_cliente;
do $conector$
begin
  if exists (select 1 from public.account_connector ac join public.connector c on c.id = ac.connector_id where c.code = 'diezrec') then
    raise notice 'Q10 · 1840 vuelta atrás: el conector «diezrec» ya tiene conexiones; se queda.';
  else
    delete from public.connector where code = 'diezrec';
  end if;
end $conector$;
