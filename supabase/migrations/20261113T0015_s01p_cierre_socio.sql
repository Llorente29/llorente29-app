-- supabase/migrations/20261113T0015_s01p_cierre_socio.sql
--
-- S01p·18 · punto 4 (Julio, 12/11). El correo «Cierre del mes de …» del socio
-- de marca trae cinco PDF (AutoFactura, Factura, Resumen de Transacción, Resumen
-- de ventas y Relación Compras y Ventas) y entraba en Compras como facturas:
-- medido el 12/11 en Foodint, los cierres de septiembre y octubre dejaron ocho
-- facturas (las ocho descartadas a mano, ninguna con asiento) y dos lecturas en
-- error. Desde esta tanda, conta-facturas-entrada (_shared/facturasEntrada.ts)
-- los guarda en la bandeja como «liquidación», sin leerlos como facturas, y
-- esperan en Ventas › Liquidaciones › Socios de marca, donde se leen con el
-- lector de su liquidación y su local (se pregunta: sus PDF traen la dirección
-- fiscal de la empresa, no la del local).
--
-- Aquí solo se AÑADE:
--   · document_inbox.licensed_settlement_id (admite nulos): la liquidación con la
--     que quedan los PDF de un cierre. Mientras es nulo, el cierre «espera».
--   · compras_cierre_socio_usado(liq, email_id): al guardar la liquidación leída
--     desde el correo, sus PDF quedan con ella (y dejan de esperar). Responde
--     cuántos, para decirlo en pantalla (regla 8).
--
-- Nada en el camino del pedido. No mueve ninguna fila.

alter table public.document_inbox add column if not exists licensed_settlement_id uuid
  references public.licensed_settlement (id) on delete set null;
comment on column public.document_inbox.licensed_settlement_id is
  'S01p·18 · 4 · La liquidación del socio con la que quedan los PDF de su cierre del mes (llegados por correo). Nulo: el cierre espera en Ventas › Liquidaciones › Socios de marca.';

create or replace function public.compras_cierre_socio_usado(p_liq uuid, p_email_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l licensed_settlement; v_n int;
begin
  select * into l from licensed_settlement where id = p_liq;
  if l.id is null then raise exception 'Esa liquidación no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(l.account_id) then
    raise exception 'No puedes guardar liquidaciones en esta cuenta.' using errcode = '42501';
  end if;
  if coalesce(trim(p_email_id), '') = '' then raise exception 'Falta el correo del cierre.' using errcode = '22023'; end if;
  update public.document_inbox d set licensed_settlement_id = l.id, updated_at = now()
   where d.account_id = l.account_id and d.company_id is not distinct from l.company_id
     and d.email_id = p_email_id and d.doc_kind = 'liquidacion' and d.licensed_settlement_id is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('pdf', v_n,
    'texto', case when v_n = 0 then 'Los PDF del correo ya estaban con una liquidación.'
                  when v_n = 1 then 'El PDF del correo queda con esta liquidación.'
                  else format('Los %s PDF del correo quedan con esta liquidación.', v_n) end);
end $$;
revoke all on function public.compras_cierre_socio_usado(uuid, text) from public, anon;
grant execute on function public.compras_cierre_socio_usado(uuid, text) to authenticated;
