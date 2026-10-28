-- supabase/migrations/20261028T1304_s01b_ficha_desde_factura.sql
--
-- S01b · Dar de alta al proveedor desde la propia factura, y que la ficha se
-- rellene sola (Julio, 28/10). Solo añade:
--
--   1. supplier.data_from_invoice: de qué factura sale cada dato que la ficha
--      tomó de una factura («de la factura R0672»), por campo:
--        { "<campo>": { "factura": "R0672", "facturaId": "…", "fecha": "2026-10-28", "quien": "Julio" } }
--      con <campo> uno de nif, nombreFiscal, direccion, web, iban. El correo y
--      el teléfono van en sus contactos (supplier_contact), y su nota lo dice.
--      La escribe el navegador al validar (lo vacío) o al pulsar «¿la
--      actualizo?», y conta_proveedor_iban_de_factura (abajo).
--   2. conta_proveedor_iban_de_factura(proveedor, factura): «Guardar este
--      IBAN» en Revisar factura. A un proveedor SIN IBAN, el que trae SU
--      factura, comprobado (módulo 97, que no sea de una cuenta vuestra) y con
--      quién, cuándo y de qué factura. Nunca a uno que ya tiene otro: eso se
--      decide en la factura («Es el nuevo IBAN», supplier_invoice_iban_decide,
--      C01b), con el aviso en rojo.
--
-- Medido en producción el 28/10 (solo lectura): supplier no tiene ninguna
-- columna para el origen de sus datos; Foodint, 1 proveedor de 71 con IBAN y 0
-- facturas con IBAN leído. No está en el camino del pedido.
--
-- Vuelta atrás: supabase/vuelta-atras/20261028T1304_s01b_ficha_desde_factura.down.sql

alter table public.supplier add column if not exists data_from_invoice jsonb;
comment on column public.supplier.data_from_invoice is
  'S01b · De qué factura sale cada dato de la ficha tomado de una factura: { campo: { factura, facturaId, fecha, quien } } (nif, nombreFiscal, direccion, web, iban).';

create or replace function public.conta_proveedor_iban_de_factura(p_supplier uuid, p_invoice uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_s public.supplier; v_f public.supplier_invoice;
  v_quien text := coalesce(public.conta_nombre_actor(), 'Sumied');
  v_iban text;
begin
  select * into v_s from public.supplier where id = p_supplier for update;
  if v_s.id is null or not public.current_user_is_admin_or_manager_of(v_s.account_id) then
    raise exception 'Ese proveedor no está, o no puedes cambiar su ficha.' using errcode = 'P0002';
  end if;
  select * into v_f from public.supplier_invoice where id = p_invoice and account_id = v_s.account_id;
  if v_f.id is null then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  if v_f.supplier_id is distinct from v_s.id then
    raise exception 'Esa factura no es de %: elige primero su proveedor y guarda.', v_s.name using errcode = '23514';
  end if;
  -- El IBAN que trae la factura: el que guardó el lector (read_iban) o, si no, el de su lectura.
  v_iban := public._pc01e2_iban(regexp_replace(coalesce(v_f.read_iban, v_f.reading->'factura'->>'iban', ''), '[-.]', '', 'g'));
  if v_iban is null then raise exception 'Esta factura no trae IBAN.' using errcode = '22023'; end if;
  if public._pc01e2_iban(v_s.iban) is not null then
    if public._pc01e2_iban(v_s.iban) = v_iban then
      return jsonb_build_object('iban4', right(v_iban, 4), 'frase', format('%s ya tiene este IBAN (···· %s) en su ficha.', v_s.name, right(v_iban, 4)));
    end if;
    raise exception '% ya tiene otro IBAN (···· %): si esta factura trae el nuevo, decídelo en ella.', v_s.name, right(public._pc01e2_iban(v_s.iban), 4) using errcode = '23514';
  end if;
  if not public._pc01e2b_iban_valido(v_iban) then raise exception 'El IBAN de esta factura no es correcto: puede estar mal leído. Compruébalo en el papel.' using errcode = '22023'; end if;
  if exists (select 1 from public.treasury_account t where t.account_id = v_s.account_id and public._pc01e2_iban(t.iban) = v_iban) then
    raise exception 'Ese IBAN es de una cuenta vuestra, no de %.', v_s.name using errcode = '23514';
  end if;
  update public.supplier
     set iban = v_iban, iban_set_at = now(), iban_set_by = auth.uid(), iban_set_by_name = v_quien, iban_unconfirmed_invoice_id = null,
         data_from_invoice = coalesce(data_from_invoice, '{}'::jsonb) || jsonb_build_object('iban', jsonb_build_object(
           'factura', v_f.invoice_number, 'facturaId', v_f.id, 'fecha', to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM-DD'), 'quien', v_quien)),
         updated_at = now()
   where id = v_s.id;
  insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, actor_name, action, text, detail)
  values (v_f.account_id, v_f.company_id, v_f.inbox_id, v_f.id, 'persona', v_quien, 'corregida',
          format('%s guarda en la ficha de %s el IBAN de esta factura (···· %s).', v_quien, v_s.name, right(v_iban, 4)),
          jsonb_build_object('iban_puesto', true, 'iban4', right(v_iban, 4), 'supplier_id', v_s.id));
  return jsonb_build_object('iban4', right(v_iban, 4),
    'frase', format('IBAN de %s guardado en su ficha (···· %s), de la factura %s. Queda apuntado: %s, el %s a las %s.', v_s.name, right(v_iban, 4),
                    coalesce(v_f.invoice_number, 'sin número'), v_quien,
                    to_char(now() at time zone 'Europe/Madrid', 'DD/MM'), to_char(now() at time zone 'Europe/Madrid', 'HH24:MI')));
end $$;
revoke all on function public.conta_proveedor_iban_de_factura(uuid, uuid) from public, anon;
grant execute on function public.conta_proveedor_iban_de_factura(uuid, uuid) to authenticated;
comment on function public.conta_proveedor_iban_de_factura(uuid, uuid) is
  'S01b · «Guardar este IBAN» en Revisar factura: a un proveedor sin IBAN, el de su factura, comprobado y con quién, cuándo y de qué factura. Nunca pisa otro.';
