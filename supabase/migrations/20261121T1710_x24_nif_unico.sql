-- supabase/migrations/20261121T1710_x24_nif_unico.sql
--
-- X24 · La base no deja dos proveedores con el mismo NIF LIMPIO en la misma cuenta. El índice de hoy,
-- ux_supplier_account_tax_id, es único por (account_id, tax_id) tal como está escrito: «B-12345678» y «B12345678»
-- le parecen distintos. El nuevo, ux_supplier_account_nif_clave, por (account_id, _conta_nif_clave(tax_id)), la misma
-- clave con la que compara el R14 (sin espacios, guiones ni puntos, en mayúsculas, sin «ES» delante de un NIF
-- español). _conta_nif_clave es IMMUTABLE (solo regexp sobre su argumento), así que vale para un índice.
--
-- Destruye (quita un índice): SOLO con «autorizo». Antes de tocar nada, la GUARDA: si en alguna cuenta hay dos o más
-- proveedores con el mismo NIF limpio, PARA y dice cuántas parejas hay en cada cuenta (por account_id, regla 9; sin
-- nombres ni NIF: el registro es público). No se crea el índice ni se toca nada hasta que Julio decida.
-- La vuelta atrás (supabase/vuelta-atras/20261121T1710_x24_nif_unico.down.sql) deja el índice de antes.
-- supplier es pequeña y no está en el camino del pedido. El real lo lanza Julio.

do $guarda$
declare v_lista text; v_n int;
begin
  select count(*), string_agg(format('%s: %s', account_id, parejas), '; ' order by account_id)
    into v_n, v_lista
    from (select account_id, count(*) parejas
            from (select account_id, public._conta_nif_clave(tax_id) clave from public.supplier
                   where public._conta_nif_clave(tax_id) is not null
                   group by 1, 2 having count(*) > 1) g
           group by account_id) c;
  if v_n > 0 then
    raise exception 'X24 · 1710: hay proveedores con el mismo NIF limpio en % cuenta(s) (cuenta: NIF repetidos) → %. PARA: no se crea el índice ni se toca nada hasta que Julio decida.', v_n, v_lista;
  end if;
  raise notice 'X24 · 1710: 0 NIF repetidos (limpios) en ninguna cuenta: se cambia el índice.';
end $guarda$;

drop index if exists public.ux_supplier_account_tax_id;
create unique index if not exists ux_supplier_account_nif_clave on public.supplier (account_id, public._conta_nif_clave(tax_id))
  where public._conta_nif_clave(tax_id) is not null;
comment on index public.ux_supplier_account_nif_clave is
  'X24: un NIF por cuenta, comparado limpio (_conta_nif_clave): «B-12345678» y «B12345678» son el mismo. Sustituye a ux_supplier_account_tax_id.';
