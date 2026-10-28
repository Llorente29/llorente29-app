-- supabase/migrations/20261028T1305_s01b_iban_no_se_pone_solo.sql
--
-- S01b · El IBAN nunca se cambia solo (Julio, 28/10, punto 4). La PC01e2b
-- (26/10) ponía en una ficha SIN IBAN el que traía la factura, «sin
-- confirmar», al elegir su proveedor. Desde aquí, no: se propone en Revisar
-- factura («Esta factura trae el IBAN …: ¿lo guardo en su ficha para
-- pagarle?») y lo guarda quien pulsa «Guardar este IBAN»
-- (conta_proveedor_iban_de_factura, de la 1304). El historial de la factura
-- lo dice. Lo de una ficha CON otro IBAN no cambia: el aviso, y no se paga
-- hasta decidir (C01b).
--
-- cambia: public._pc01e2b_iban_de_la_factura · prueba: supabase/staging/sql/20261028_s01b_ficha_desde_factura_prueba.sql
--   (misma firma; respaldada. Solo cambia la rama «la ficha no tiene IBAN».)
--
-- Medido en producción el 28/10 (solo lectura): lo desplegado es byte a byte
-- lo de la 20261026T1835 (md5 de prosrc d840156236f657fb49d44e7bb221795b, el
-- mismo que el del fichero); 0 facturas con IBAN leído y 0 proveedores con un
-- IBAN «sin confirmar»: el cambio no deja nada atrás. Lo que ya estuviera sin
-- confirmar seguiría parando la remesa hasta confirmarlo, como hoy.
-- No está en el camino del pedido.
--
-- Vuelta atrás: supabase/vuelta-atras/20261028T1305_s01b_iban_no_se_pone_solo.down.sql

select public._respaldar_funcion('public._pc01e2b_iban_de_la_factura()', '20261028T1305_s01b_iban_no_se_pone_solo');

create or replace function public._pc01e2b_iban_de_la_factura()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_s public.supplier; v_leido text := public._pc01e2_iban(new.read_iban); v_ficha text;
begin
  if tg_op = 'UPDATE' and new.supplier_id is not distinct from old.supplier_id and v_leido is not distinct from public._pc01e2_iban(old.read_iban) then return null; end if;
  if new.status in ('anulada', 'descartada', 'pagada') or coalesce(new.payment_method, 'transfer') <> 'transfer' then return null; end if;
  select * into v_s from public.supplier where id = new.supplier_id and account_id = new.account_id;
  if v_s.id is null or v_s.archived_at is not null then return null; end if;
  -- Domiciliado, con tarjeta, al contado o prepago en su ficha, y la factura no dice otra cosa: no se le paga por transferencia.
  if new.payment_method is null and coalesce(v_s.payment_method, 'transfer') <> 'transfer' then return null; end if;
  v_ficha := public._pc01e2_iban(v_s.iban);
  if v_ficha is null then
    -- S01b · No se pone solo: se propone al revisarla y lo guarda quien pulsa.
    insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text, detail)
    values (new.account_id, new.company_id, new.inbox_id, new.id, 'folvy', 'leida',
            format('Esta factura trae un IBAN (···· %s) y %s no tiene en su ficha. No lo pongo solo: al revisarla, «Guardar este IBAN» lo guarda.', right(v_leido, 4), v_s.name),
            jsonb_build_object('iban_propuesto', true, 'iban4', right(v_leido, 4), 'supplier_id', v_s.id));
  elsif v_ficha <> v_leido and new.iban_decision is null then
    insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text, detail)
    values (new.account_id, new.company_id, new.inbox_id, new.id, 'folvy', 'leida',
            format('Esta factura trae otro IBAN (···· %s) que el de la ficha de %s (···· %s). No se paga hasta que alguien decida si es el nuevo.', right(v_leido, 4), v_s.name, right(v_ficha, 4)),
            jsonb_build_object('iban_distinto', true, 'iban4', right(v_leido, 4), 'ficha4', right(v_ficha, 4), 'supplier_id', v_s.id));
  end if;
  return null;
end $$;
revoke all on function public._pc01e2b_iban_de_la_factura() from public, anon, authenticated;
comment on function public._pc01e2b_iban_de_la_factura() is
  'PC01 · E2b, S01b · Con su proveedor: si la ficha no tiene IBAN, lo dice en el historial y no lo pone (se guarda al pulsar); si tiene otro, lo dice y no se paga hasta decidir.';
