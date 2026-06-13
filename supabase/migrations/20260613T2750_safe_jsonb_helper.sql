-- supabase/migrations/20260613T2750_safe_jsonb_helper.sql
-- ============================================================================
-- HELPER · safe_jsonb(text) — cast a jsonb que NUNCA lanza
-- ============================================================================
-- Intenta convertir un texto a jsonb. Si el texto es null, vacío o NO es JSON
-- válido, devuelve NULL en vez de lanzar excepción.
--
-- POR QUÉ: kds_board lee sale.raw_tab (es TEXT, viene de Last). Un raw_tab
-- malformado (truncado, raro) con `raw_tab::jsonb` directo lanzaría y tumbaría
-- el TABLERO ENTERO del local — la cocina se queda sin pantalla en hora punta
-- por el dato sucio de UN pedido. Inaceptable. Con safe_jsonb, ese pedido no
-- muestra nota, pero el tablero sigue vivo. Deuda 0: el board no es frágil al
-- dato externo.
--
-- IMMUTABLE: el resultado solo depende del input (permite uso en índices/CTEs
-- sin recalcular). Reutilizable en cualquier punto de Folvy que parsee texto
-- externo (webhooks, OCR, imports).
-- ============================================================================

create or replace function public.safe_jsonb(p_text text)
returns jsonb
language plpgsql
immutable
parallel safe
set search_path = public
as $$
begin
  if p_text is null or btrim(p_text) = '' then
    return null;
  end if;
  return p_text::jsonb;
exception
  when others then
    return null;   -- texto no es JSON válido → null, no rompe la consulta
end;
$$;
