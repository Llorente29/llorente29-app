-- supabase/migrations/20261105T1510_s01p_iva_redondeo.sql
--
-- S01p·16 · Las facturas de Uber no se podían validar (Julio, 05/11 14:55).
-- Portier Eats Spain redondea el IVA en cada línea y suma: la F1-2081547 tiene
-- 3 líneas al 21 % (17,22 → 3,62; 103,02 → 21,64; 73,45 → 15,43), su IVA es
-- 40,69 € y la base por el 21 % da 40,67 €. Validar decía «la cuota 40.69 no es
-- la base 193.69 × 21.00 % = 40.67».
--
-- La regla (Julio): manda el IVA de la factura. La comprobación acepta una
-- diferencia de hasta 0,01 € por línea de la factura con ese tipo; si no se
-- sabe cuántas hay, 0,02 €. Lo de antes se queda (medio céntimo por documento
-- en lo que junta muchos, como las ventas del día). Con más diferencia, el
-- motivo sigue y no deja validar.
--   · _conta_iva_tolerancia(asiento, tipo): la diferencia que se acepta.
--   · conta_motivos_para_validar: la condición de «la cuota no es la base por
--     el tipo», con reemplazo exacto del trozo y su respaldo.
--
-- Medido en producción (solo lectura, 05/11), con la regla vieja y la nueva:
-- de todas las líneas de IVA de 2026 de las recibidas de Foodint, cambian 3, las
-- 3 de Uber (propuestas: F1-2219877, F1-2167028 y F1-2081547), con 0,02 € como
-- mucho. Fuera de las recibidas, en ninguna cuenta cambia ninguna.
--
-- cambia: public.conta_motivos_para_validar · prueba: supabase/staging/sql/20261105_s01p_iva_redondeo_prueba.sql
--
-- Nada en el camino del pedido.

select public._respaldar_funcion('public.conta_motivos_para_validar(uuid)', '20261105T1510_s01p_iva_redondeo');

create or replace function public._conta_iva_tolerancia(p_entry uuid, p_tipo numeric)
returns numeric language sql stable security definer set search_path = public as $$
  -- Las líneas de la factura con ese tipo: 0,01 € por línea. Sin saberlo, 0,02 €.
  select coalesce((select nullif(count(*), 0) * 0.01
                     from public.journal_entry e
                     join public.supplier_invoice_line x on x.supplier_invoice_id = e.source_id
                    where e.id = p_entry and e.source_type = 'supplier_invoice' and x.vat_pct = p_tipo), 0.02)
$$;
revoke all on function public._conta_iva_tolerancia(uuid, numeric) from public, anon;
grant execute on function public._conta_iva_tolerancia(uuid, numeric) to authenticated, service_role;

do $do$
declare
  v_def text := pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure);
  v_viejo constant text := 'and abs(round(l.tax_base * t.rate / 100, 2) - (l.debit + l.credit)) > greatest(1, floor(l.tax_documents / 2.0)) / 100';
  v_nuevo constant text := 'and abs(round(l.tax_base * t.rate / 100, 2) - (l.debit + l.credit)) > greatest(greatest(1, floor(l.tax_documents / 2.0)) / 100, public._conta_iva_tolerancia(p_entry, t.rate))';
begin
  if strpos(v_def, '_conta_iva_tolerancia') > 0 then return; end if;   -- ya pasada
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'S01p·16: conta_motivos_para_validar no es la medida (la condición de la cuota no está una sola vez): no se toca.';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $do$;
