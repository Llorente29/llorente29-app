-- supabase/migrations/20261121T1120_r14_proveedor_solo_al_leer.sql
-- cambia: public.supplier_invoice · prueba: supabase/staging/sql/20261121_r14_proveedor_solo_prueba.sql
--
-- R14 · El proveedor nuevo se da de alta solo. 2 de 3: lo que CAMBIA EN CALIENTE. Va
-- detrás de la 1110 (usa _conta_proveedor_solo).
--
--   7. Un disparador en supplier_invoice: al leerla (insert) o al cambiar su lectura, si no
--      tiene proveedor, Sumied lo busca o lo da de alta (_conta_proveedor_solo). DIFERIDO,
--      como el del E04 (e04_pasar_sola, que va antes por su nombre): actúa al confirmar,
--      con la factura ya en la sociedad que le toca. Nunca para la lectura: si algo falla,
--      la factura se queda sin proveedor, como hoy, y el fallo queda escrito.
-- Se puede pasar dos veces.
-- Vuelta atrás: supabase/vuelta-atras/20261121T1120_r14_proveedor_solo_al_leer.down.sql

create or replace function public.tg_r14_proveedor_solo()
returns trigger language plpgsql security definer set search_path = public as $function$
begin
  if new.supplier_id is null and coalesce(new.reading, '{}'::jsonb) ? 'factura' then
    begin
      perform public._conta_proveedor_solo(new.id, 'al_leer');
    exception when others then
      raise warning 'R14 · el proveedor de la factura % no se ha podido dar de alta: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end $function$;
comment on function public.tg_r14_proveedor_solo() is 'R14: al leer una recibida sin proveedor (o cambiar su lectura), Sumied lo busca o lo da de alta (_conta_proveedor_solo). Diferido: al confirmar. Nunca para la lectura.';
revoke all on function public.tg_r14_proveedor_solo() from public, anon, authenticated;

drop trigger if exists r14_proveedor_solo on public.supplier_invoice;
create constraint trigger r14_proveedor_solo after insert or update of reading on public.supplier_invoice
  deferrable initially deferred for each row execute function public.tg_r14_proveedor_solo();
