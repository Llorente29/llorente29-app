-- supabase/migrations/20261025T0840_v01b_cuota_por_linea.sql
--
-- V01b · El IVA de cada tipo es un DATO GUARDADO, no un cálculo de pantalla
-- (Julio, 25/10). «Hacer los PDF que faltan» falló en 108 traídas de Diez por
-- un céntimo: el PDF recalculaba el IVA por tipo (base × tipo, redondeado) y la
-- factura lleva el del asiento, el que está en Diez y en los libros de IVA ya
-- declarados. Diez trunca el medio céntimo (18,05 × 10 % = 1,80, no 1,81).
--
--   1. customer_invoice_line.tax_amount (AÑADE, admite nulos): la cuota de la
--      línea. Un borrador no la lleva (se calcula al escribir); una emitida sí.
--   2. _conta_venta_cuotas_de(uuid) (AÑADE, solo lee): la cuota de cada línea
--      de una emitida que aún no la tiene; _conta_venta_cuotas_guardar(uuid)
--      (AÑADE) la guarda.
--        · Una factura (no rectificativa) con su asiento: la cuota de cada tipo
--          es la del LIBRO DE EXPEDIDAS de su asiento (la 477 por tipo), si el
--          libro tiene los mismos tipos con las mismas bases que sus líneas.
--        · Si no (una rectificativa, cuyo libro lleva la diferencia; o una sin
--          asiento): la que se calcula hoy, redondeo por tipo, igual que
--          _conta_venta_cifras.
--        · Dentro de un tipo, cada línea su base × tipo redondeada, y el
--          céntimo que sobre o falte a la línea de más importe: la suma del
--          tipo es exactamente la del tipo.
--        · Una vez guardada no se vuelve a calcular nunca.
--   3. trg_customer_invoice_cuotas (CAMBIA: disparador nuevo en
--      customer_invoice): al pasar de borrador a emitida, por cualquier camino
--      (conta_venta_emitir, conta_cierre_validar, el histórico), guarda la
--      cuota. En conta_venta_emitir es la misma que acaba de ir al asiento.
--   4. customer_invoice_line_inalterable (CAMBIA, misma firma): las líneas de
--      una emitida siguen sin cambiarse, con UNA excepción: poner la cuota
--      donde no la había, sin tocar nada más. Quitarla o cambiarla, no.
--   5. _conta_venta_cifras (CAMBIA, misma firma): el IVA de un tipo es el
--      GUARDADO si todas sus líneas lo llevan; si no (un borrador), el
--      calculado como antes. Así la rectificativa de una traída resta el IVA
--      que se declaró, no uno recalculado (_conta_venta_diferencia la usa
--      para la factura que corrige). Para un borrador devuelve lo mismo que
--      antes, cifra a cifra.
--
-- No toca datos: el relleno de las que ya están emitidas es la 0841, con
-- autorizo. No está en el camino del pedido: es la facturación de venta.
--
-- cambia: public.customer_invoice · prueba: supabase/staging/sql/20261025_v01b_cuotas_prueba.sql
-- cambia: public.customer_invoice_line_inalterable · prueba: supabase/staging/sql/20261025_v01b_cuotas_prueba.sql
-- cambia: public._conta_venta_cifras · prueba: supabase/staging/sql/20261025_v01b_cuotas_prueba.sql
--
-- Vuelta atrás: supabase/vuelta-atras/20261025T0840_v01b_cuota_por_linea.down.sql

alter table public.customer_invoice_line add column if not exists tax_amount numeric(14, 2);
comment on column public.customer_invoice_line.tax_amount is
  'V01b · La cuota de IVA de la línea, guardada al emitir (la del libro de su asiento). Nula en un borrador. El PDF y las cifras de una emitida la leen; nada la recalcula.';

-- 2 · La cuota de cada línea de una emitida (solo lee) y guardarla.
create or replace function public._conta_venta_cuotas_de(p_id uuid)
returns table (line_id uuid, cuota numeric) language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_f public.customer_invoice; v_libro boolean := false; r record;
begin
  select * into v_f from public.customer_invoice where id = p_id;
  if v_f.id is null or v_f.status = 'borrador' then return; end if;
  -- Ya guardada (aunque sea en parte): no se recalcula.
  if exists (select 1 from public.customer_invoice_line where invoice_id = p_id and tax_amount is not null) then return; end if;

  -- ¿Manda el libro? Una factura con su asiento, cuyo libro de expedidas
  -- tiene los mismos tipos con las mismas bases que sus líneas, y un solo
  -- tipo de la tabla por porcentaje.
  if v_f.doc_type = 'factura' and v_f.entry_id is not null
     and exists (select 1 from public.vat_book_entry where entry_id = v_f.entry_id and book = 'issued') then
    select not exists (
             select 1
               from (select tax_pct as pct, sum(amount) as base from public.customer_invoice_line where invoice_id = p_id group by tax_pct) l
               full join (select tax_rate as pct, sum(tax_base) as base from public.vat_book_entry where entry_id = v_f.entry_id and book = 'issued' group by tax_rate) b
                 on b.pct = l.pct
              where l.base is distinct from b.base)
       and not exists (
             select 1 from public.customer_invoice_line where invoice_id = p_id
              group by tax_pct having count(distinct (tax_rate_id, coalesce(surcharge_pct, 0))) > 1)
      into v_libro;
  end if;

  for r in
    select l.tax_rate_id, l.tax_pct, coalesce(l.surcharge_pct, 0) as rec_pct,
           case when v_libro
                then (select sum(v.tax_amount) from public.vat_book_entry v where v.entry_id = v_f.entry_id and v.book = 'issued' and v.tax_rate = l.tax_pct)
                else round(sum(l.amount) * l.tax_pct / 100, 2) end as cuota
      from public.customer_invoice_line l
     where l.invoice_id = p_id
     group by l.tax_rate_id, l.tax_pct, coalesce(l.surcharge_pct, 0)
  loop
    -- Cada línea, su base × tipo; lo que sobre o falte, a la de más importe.
    return query
      select z.id, z.propia + case when z.n = 1 then r.cuota - sum(z.propia) over () else 0 end
        from (select x.id, round(x.amount * x.tax_pct / 100, 2) as propia,
                     row_number() over (order by abs(x.amount) desc, x.position, x.id) as n
                from public.customer_invoice_line x
               where x.invoice_id = p_id and x.tax_rate_id = r.tax_rate_id and x.tax_pct = r.tax_pct and coalesce(x.surcharge_pct, 0) = r.rec_pct) z;
  end loop;
end $$;
revoke all on function public._conta_venta_cuotas_de(uuid) from public, anon, authenticated;

create or replace function public._conta_venta_cuotas_guardar(p_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  update public.customer_invoice_line l set tax_amount = q.cuota
    from public._conta_venta_cuotas_de(p_id) q where q.line_id = l.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public._conta_venta_cuotas_guardar(uuid) from public, anon, authenticated;

-- 3 · Al emitir, por cualquier camino.
create or replace function public._conta_venta_cuotas_al_emitir()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._conta_venta_cuotas_guardar(new.id);
  return null;
end $$;
revoke all on function public._conta_venta_cuotas_al_emitir() from public, anon, authenticated;

drop trigger if exists trg_customer_invoice_cuotas on public.customer_invoice;
create trigger trg_customer_invoice_cuotas after update of status on public.customer_invoice
  for each row when (old.status = 'borrador' and new.status <> 'borrador')
  execute function public._conta_venta_cuotas_al_emitir();

-- 4 · Las líneas de una emitida no se cambian; su cuota se pone una vez.
create or replace function public.customer_invoice_line_inalterable()
returns trigger language plpgsql set search_path = public as $$
declare v_estado text;
begin
  select status into v_estado from public.customer_invoice where id = coalesce(new.invoice_id, old.invoice_id);
  -- Al borrar un borrador entero (cascada) la factura ya no está: se deja.
  if v_estado is not null and v_estado <> 'borrador' then
    -- V01b: poner la cuota donde no la había, sin tocar nada más, sí.
    if tg_op = 'UPDATE' and old.tax_amount is null and new.tax_amount is not null
       and (to_jsonb(new) - 'tax_amount') = (to_jsonb(old) - 'tax_amount') then
      return new;
    end if;
    raise exception 'Las líneas de una factura emitida no se cambian.' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;

-- 5 · Las cifras: el IVA guardado manda; sin él, el calculado.
create or replace function public._conta_venta_cifras(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_f public.customer_invoice; v_ret numeric := 0; v_base numeric; v_iva numeric; v_rec numeric; v_retencion numeric;
  v_tipos jsonb; v_cuentas jsonb;
begin
  select * into v_f from public.customer_invoice where id = p_id;
  if v_f.withholding_rate_id is not null then select rate into v_ret from public.withholding_rate where id = v_f.withholding_rate_id; end if;
  with l as (
    select tax_rate_id, tax_pct, coalesce(surcharge_pct, 0) as rec_pct, revenue_account_id, amount, tax_amount from public.customer_invoice_line where invoice_id = p_id
  ), t as (
    select tax_rate_id, tax_pct, rec_pct, sum(amount) as base,
           -- V01b: la cuota guardada (la del libro de su asiento), si todas las líneas del tipo la llevan.
           case when count(tax_amount) = count(*) then sum(tax_amount) else round(sum(amount) * tax_pct / 100, 2) end as iva,
           case when v_f.surcharge then round(sum(amount) * rec_pct / 100, 2) else 0 end as rec
      from l group by tax_rate_id, tax_pct, rec_pct
  )
  select coalesce(jsonb_agg(jsonb_build_object('tipo_id', tax_rate_id, 'pct', tax_pct, 'rec_pct', rec_pct, 'base', base, 'iva', iva, 'rec', rec) order by tax_pct desc), '[]'),
         coalesce(sum(base), 0), coalesce(sum(iva), 0), coalesce(sum(rec), 0)
    into v_tipos, v_base, v_iva, v_rec from t;
  select coalesce(jsonb_agg(jsonb_build_object('cuenta_id', revenue_account_id, 'base', s) order by revenue_account_id), '[]') into v_cuentas
    from (select revenue_account_id, sum(amount) s from public.customer_invoice_line where invoice_id = p_id group by revenue_account_id) x;
  v_retencion := round(v_base * coalesce(v_ret, 0) / 100, 2);
  return jsonb_build_object('base', v_base, 'iva', v_iva, 'recargo', v_rec, 'retencion', v_retencion, 'retencion_pct', coalesce(v_ret, 0),
                            'total', v_base + v_iva + v_rec - v_retencion, 'tipos', v_tipos, 'cuentas', v_cuentas);
end $$;
revoke all on function public._conta_venta_cifras(uuid) from public, anon, authenticated;
