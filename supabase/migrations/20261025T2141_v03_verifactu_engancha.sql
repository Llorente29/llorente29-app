-- supabase/migrations/20261025T2141_v03_verifactu_engancha.sql
--
-- V03 · Verifactu · E1 · EL ENGANCHE con la factura emitida. CAMBIA en
-- caliente: un disparador nuevo en customer_invoice. Va después de la 2140, que
-- crea todo lo que usa. No toca datos ni ninguna función de la V01: la emisión
-- (conta_venta_emitir) sigue siendo la misma.
--
-- Cuando una factura pasa de borrador a emitida:
--   · con Verifactu apagado en su empresa (lo de partida, y lo de todas hoy),
--     no hace nada;
--   · si es la resumen de un cierre del día, tampoco (respuesta 1 de Julio, 25/10);
--   · si no, comprueba lo que Hacienda rechazaría (verifactu_comprobar): si falta
--     algo, la emisión entera se deshace —número incluido, sin hueco— y dice qué
--     falta en palabras de la calle; si está todo, escribe su registro de alta,
--     encadenado con el cerrojo de su NIF, y lo deja en la cola.
--
-- Las traídas de Diez y los cierres entran ya emitidos (insert, no update): este
-- disparador no los ve. Salen «No se envía».
--
-- cambia: public.customer_invoice · prueba: supabase/staging/sql/20261025_v03_verifactu_prueba.sql

create or replace function public._verifactu_al_emitir()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'borrador' and new.status = 'emitida' then
    perform public._verifactu_alta_de_factura(new.id, new.issued_by_name);
  end if;
  return null;
end $$;
revoke all on function public._verifactu_al_emitir() from public, anon, authenticated;

drop trigger if exists customer_invoice_verifactu on public.customer_invoice;
create trigger customer_invoice_verifactu after update of status on public.customer_invoice
  for each row when (old.status = 'borrador' and new.status = 'emitida')
  execute function public._verifactu_al_emitir();
