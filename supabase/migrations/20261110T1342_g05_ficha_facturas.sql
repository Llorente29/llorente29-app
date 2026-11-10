-- supabase/migrations/20261110T1342_g05_ficha_facturas.sql
--
-- G05 · nº 84 · LA FACTURA DE CADA COBRO, EN LA PESTAÑA «COBROS» DE LA FICHA. Hasta
-- hoy cada fila decía «Sin factura en Sumied», también la de un cobro con su
-- factura emitida (Talleres Ruiz, la 2026/1/154; Cuatro Patas, la 2026/1/162).
--
-- Solo añade:
--   conta_ficha_facturas(cuenta, cliente): por cada cobro de GoCardless de un
--   recibo de Sumied del cliente (conta_recibo.gc_cobro_id), el recibo, su mes,
--   su estado y su factura (id y número), si la tiene. Un cobro que no salió de
--   un recibo de Sumied no sale: la ficha lo dice «Sin factura en Sumied».
-- Como conta_pantalla_ficha: SECURITY DEFINER, el permiso de la cuenta mirado una
-- vez (belongs_to_account) y cada tabla filtrada por ella; de otra cuenta, nada.
-- conta_pantalla_ficha se queda como está.
-- No toca datos. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261110T1342_g05_ficha_facturas.down.sql

create or replace function public.conta_ficha_facturas(p_cuenta uuid, p_cliente uuid)
returns table (empresa_id uuid, cobro_gc_id text, recibo_id uuid, mes text, recibo_estado text, factura_id uuid, factura text)
language sql stable security definer set search_path = public as $$
  with permiso as (
    select p_cuenta as cuenta where public.belongs_to_account(p_cuenta)
  )
  select r.company_id, r.gc_cobro_id, r.id, r.mes, r.estado, i.id, i.number_text
    from public.conta_recibo r
    left join public.customer_invoice i on i.id = r.invoice_id and i.account_id = r.account_id
   where r.account_id = (select cuenta from permiso) and r.party_id = p_cliente and r.gc_cobro_id is not null
$$;
revoke all on function public.conta_ficha_facturas(uuid, uuid) from public, anon;
grant execute on function public.conta_ficha_facturas(uuid, uuid) to authenticated, service_role;

comment on function public.conta_ficha_facturas(uuid, uuid) is
  'G05 · nº 84 · La factura de cada cobro de GoCardless de un cliente (por su recibo de Sumied), para la pestaña «Cobros» de la ficha. De quien es de la cuenta.';
