-- 20260821T0900_precios_duplicados_local_y_cuenta.sql
-- ENCARGO CODE (21/08) «El gestor de precios pide cinco decisiones» — §5.
--
-- ── Qué se limpia ────────────────────────────────────────────────────────
-- 9 precios por canal de ÁMBITO LOCAL que tienen un gemelo de ámbito CUENTA
-- para el mismo producto y canal. Son las 9 únicas veces que alguien ha usado
-- el ámbito local en toda la cuenta, y las 9 acabaron en duplicado:
--
--   Meraki Pita · Foodint Alcalá · {Glovo, Uber, JustEat} ×
--     Crispy Falafel & Greek Dip (7,90)
--     Pita BOWL Mixto (16,30)
--     The Mixed Master (15,90)
--
--   local escrito el 19/08 06:11-06:28 · cuenta escrito el 21/08 07:44
--
-- ── Por qué esto NO cambia ningún precio publicado ───────────────────────
-- effective_price() resuelve (canal+local) > (local) > (canal) > base, así que
-- HOY manda el de ámbito local. Comprobado uno a uno: los 9 pares tienen el
-- MISMO precio, así que al quitar el local pasa a mandar el de cuenta y el
-- número no se mueve. Eso no se afirma: se COMPRUEBA dentro de la propia
-- transacción, comparando effective_price antes y después para cada uno de
-- los 9. Si alguno se moviera, la migración revienta y revierte entera.
--
-- ── Por qué se quita el LOCAL y no el de cuenta ──────────────────────────
-- Los tres precios son iguales en los dos locales de la marca; no hay ninguna
-- excepción real de Alcalá que preservar. Y el de cuenta es el más reciente
-- (21/08), o sea la última intención de Julio. Quitar el local deja UNA fila
-- por producto y canal, que es lo que la pantalla nueva escribe.
--
-- ── Rastro ───────────────────────────────────────────────────────────────
-- El trigger trg_menu_item_override_history registra cada DELETE en
-- menu_item_override_history con op='delete' y el precio que había. No hace
-- falta un backup aparte: el reverso está en esa tabla.

do $$
declare
  v_account uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';  -- Foodint (PRODUCCIÓN)
  v_antes   jsonb;
  v_despues jsonb;
  v_borradas int;
  v_esperadas int;
begin
  if not exists (select 1 from public.accounts where id = v_account and name = 'Foodint') then
    raise exception 'La cuenta % no es Foodint. Abortado.', v_account;
  end if;

  -- Las filas candidatas: ámbito local CON gemelo de cuenta al MISMO precio.
  -- La igualdad de precio es parte del filtro, no una comprobación aparte: una
  -- fila con precio distinto es una excepción de verdad y no se toca nunca.
  create temp table _dup on commit drop as
  select loc.id,
         loc.menu_item_id,
         loc.channel_id,
         loc.location_id,
         loc.price
  from public.menu_item_override loc
  where loc.account_id = v_account
    and loc.location_id is not null
    and loc.channel_id is not null
    and loc.price is not null
    and exists (
      select 1 from public.menu_item_override cta
      where cta.account_id     = v_account
        and cta.menu_item_id   = loc.menu_item_id
        and cta.channel_id     = loc.channel_id
        and cta.location_id is null
        and cta.price is not null
        and cta.price = loc.price          -- ← si difieren, NO entra
    );

  select count(*) into v_esperadas from _dup;
  if v_esperadas <> 9 then
    raise exception 'Se esperaban 9 duplicados y hay %. Abortado: los datos no son los medidos el 21/08.', v_esperadas;
  end if;

  -- FOTO ANTES: el precio que de verdad se publica hoy en cada uno.
  select jsonb_agg(jsonb_build_object(
           'k', d.menu_item_id::text || '|' || d.channel_id::text || '|' || d.location_id::text,
           'p', public.effective_price(d.menu_item_id, d.channel_id, d.location_id)) order by 1)
    into v_antes from _dup d;

  delete from public.menu_item_override o using _dup d where o.id = d.id;
  get diagnostics v_borradas = row_count;
  if v_borradas <> 9 then
    raise exception 'Se borraron % filas y se esperaban 9. Abortado.', v_borradas;
  end if;

  -- FOTO DESPUÉS, con la misma función y las mismas claves.
  select jsonb_agg(jsonb_build_object(
           'k', d.menu_item_id::text || '|' || d.channel_id::text || '|' || d.location_id::text,
           'p', public.effective_price(d.menu_item_id, d.channel_id, d.location_id)) order by 1)
    into v_despues from _dup d;

  -- LA COMPROBACIÓN QUE IMPORTA: ni un céntimo se ha movido en ningún canal
  -- de ningún local. Si se hubiera movido, revienta y revierte entera.
  if v_antes is distinct from v_despues then
    raise exception 'Un precio publicado ha cambiado. ANTES=% DESPUES=%. Abortado.', v_antes, v_despues;
  end if;

  -- Y que no quede ni un duplicado más en toda la cuenta.
  if exists (
    select 1 from public.menu_item_override loc
    where loc.account_id = v_account and loc.location_id is not null
      and loc.channel_id is not null and loc.price is not null
      and exists (
        select 1 from public.menu_item_override cta
        where cta.account_id = v_account and cta.menu_item_id = loc.menu_item_id
          and cta.channel_id = loc.channel_id and cta.location_id is null
          and cta.price is not null)
  ) then
    raise exception 'Queda algún precio de local con gemelo de cuenta. Abortado.';
  end if;

  raise notice 'OK: 9 duplicados quitados, 0 precios publicados movidos.';
end $$;
