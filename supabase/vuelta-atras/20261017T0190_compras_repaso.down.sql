-- ============================================================================
-- Vuelta atrás de Compras · 10 · el repaso. PARA si alguna factura se apuntó
-- sin descontar el IVA (quitar la marca cambiaría su asiento): antes se
-- deshace a mano. Si no, quita las dos funciones nuevas, la columna y devuelve
-- _compras_destinatario como lo dejó la 0120 (sin el caso de los genéricos).
-- ============================================================================
do $$
begin
  if exists (select 1 from public.supplier_invoice where vat_non_deductible) then
    raise exception 'Hay facturas apuntadas sin descontar el IVA: deshazlas antes a mano.';
  end if;
end $$;
drop function if exists public.compras_liquidacion_recepciones(uuid);
drop function if exists public.compras_sin_iva(uuid, uuid);
alter table public.supplier_invoice drop column if exists vat_non_deductible;

create or replace function public._compras_destinatario(p_cuenta uuid, p_nombre text, p_nif text)
returns table (kind text, company_id uuid, supplier_id uuid, how text)
language plpgsql stable security definer set search_path = public as $$
declare v_nif text := public.compras_nif_norm(p_nif); v_nom text := public.compras_nombre_norm(p_nombre);
        v_ids uuid[]; r purchase_bill_to;
begin
  if v_nif is not null then
    v_ids := array(select c.id from company c where c.account_id = p_cuenta and c.is_active and public.compras_nif_norm(c.tax_id) = v_nif);
    if cardinality(v_ids) = 1 then return query select 'empresa'::text, v_ids[1], null::uuid, 'nif'::text; return; end if;
    v_ids := array(select s.id from supplier s where s.account_id = p_cuenta and s.archived_at is null and public.compras_nif_norm(s.tax_id) = v_nif);
    if cardinality(v_ids) = 1 then return query select 'proveedor'::text, null::uuid, v_ids[1], 'nif'::text; return; end if;
  end if;
  if v_nom is null then
    return query select (case when v_nif is null then 'sin_dato' else 'desconocido' end)::text, null::uuid, null::uuid,
                        (case when v_nif is null then 'sin_dato' else 'desconocido' end)::text;
    return;
  end if;
  select * into r from purchase_bill_to b where b.account_id = p_cuenta and b.name_norm = v_nom;
  if r.id is not null then
    return query select (case when r.company_id is not null then 'empresa' when r.supplier_id is not null then 'proveedor' else 'otro' end)::text,
                        r.company_id, r.supplier_id, 'recordado'::text;
    return;
  end if;
  v_ids := array(select c.id from company c where c.account_id = p_cuenta and c.is_active
                   and v_nom in (public.compras_nombre_norm(c.legal_name), public.compras_nombre_norm(c.trade_name)));
  if cardinality(v_ids) = 1 then return query select 'empresa'::text, v_ids[1], null::uuid, 'nombre'::text; return; end if;
  if cardinality(v_ids) = 0 then
    v_ids := array(select s.id from supplier s where s.account_id = p_cuenta and s.archived_at is null
                     and v_nom in (public.compras_nombre_norm(s.name), public.compras_nombre_norm(s.legal_name)));
    if cardinality(v_ids) = 1 then return query select 'proveedor'::text, null::uuid, v_ids[1], 'nombre'::text; return; end if;
  end if;
  return query select 'desconocido'::text, null::uuid, null::uuid, 'desconocido'::text;
end $$;
revoke all on function public._compras_destinatario(uuid, text, text) from public, anon, authenticated;
drop function if exists public.compras_nombre_generico(text);
