-- ============================================================================
-- B01 · LAS FICHAS DE BANCO QUE LE FALTAN A FOODINT (respuesta 5, «sus tres
-- cuentas»)
-- ----------------------------------------------------------------------------
-- Medido en producción el 14/10, solo leyendo: Foodint tiene tres cuentas
-- 572 en su plan (57200001, 57200002, 57200003) pero UNA sola ficha de banco
-- (treasury_account), enlazada a la 57200001 con su IBAN. La 57200002 y la
-- 57200003 no tienen ficha: su IBAN solo está escrito en el NOMBRE de la
-- cuenta, como vino del plan de Diez («<banco> ESnn nnnn …»). Sin ficha,
-- Bancos no las ve: un extracto suyo no encuentra su banco.
--
-- Esto crea las dos fichas que faltan, cada una enlazada a su cuenta como
-- principal, con el IBAN que dice el nombre. NO hay ningún IBAN en este
-- fichero: se lee del nombre al aplicar, en la base (el repositorio es público).
--
-- Guardas (PARA, y no crea nada, si):
--   · Foodint tiene más de una empresa;
--   · el nombre de alguna de las dos cuentas no lleva exactamente un IBAN
--     español, o su control (módulo 97) no da 1;
--   · ese IBAN ya está en otra ficha de cualquier cuenta;
--   · la cuenta ya está enlazada a otra ficha de banco.
-- Ancla por id de cuenta y por código (regla 9), no por nombre.
-- Ids fijos (md5 de la cuenta del plan), para volver a lanzarlo sin repetir y
-- para que la vuelta atrás quite exactamente lo que esto creó.
-- En staging Foodint no existe: el fichero no hace nada y lo dice.
-- Vuelta atrás: supabase/vuelta-atras/20261101T0170_b01_foodint_cuentas.down.sql
-- ============================================================================
do $$
declare
  v_cuenta constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_empresa uuid; n int; r record; v_iban text; v_banco text; v_id uuid; creadas int := 0;
begin
  select count(*) into n from public.company where account_id = v_cuenta;
  if n = 0 then raise notice 'Foodint no está aquí (staging): no se crea ninguna ficha.'; return; end if;
  if n > 1 then raise exception 'Foodint tiene % empresas: di de cuál son estas cuentas.', n; end if;
  select id into v_empresa from public.company where account_id = v_cuenta;

  for r in select a.id, a.code, a.name from public.company_account a
            where a.account_id = v_cuenta and a.company_id = v_empresa and a.code in ('57200002', '57200003') order by a.code loop
    v_id := md5('b01-0170:' || r.id::text)::uuid;
    if exists (select 1 from public.treasury_account where id = v_id) then continue; end if;   -- ya creada
    if (select count(*) from regexp_matches(r.name, 'ES[0-9]{2}(?: ?[0-9]{4}){5}', 'g')) <> 1 then
      raise exception 'La cuenta % no lleva exactamente un IBAN español en su nombre: dímelo y no creo nada.', r.code;
    end if;
    v_iban := replace(substring(r.name from 'ES[0-9]{2}(?: ?[0-9]{4}){5}'), ' ', '');
    if (substr(v_iban, 5) || '1428' || substr(v_iban, 3, 2))::numeric % 97 <> 1 then
      raise exception 'El IBAN del nombre de la cuenta % no pasa el control: no creo nada.', r.code;
    end if;
    if exists (select 1 from public.treasury_account where replace(iban, ' ', '') = v_iban) then
      raise exception 'El IBAN de la cuenta % ya está en otra ficha de banco: no creo nada.', r.code;
    end if;
    if exists (select 1 from public.company_account_link where company_account_id = r.id and entity = 'bank_account') then
      raise exception 'La cuenta % ya está enlazada a una ficha de banco: no creo nada.', r.code;
    end if;
    v_banco := nullif(trim(split_part(r.name, 'ES' || substr(v_iban, 3, 2), 1)), '');
    insert into public.treasury_account (id, account_id, company_id, kind, name, iban, pgc_hint, is_default, is_active)
    values (v_id, v_cuenta, v_empresa, 'bank', coalesce(v_banco, 'Banco') || ' ···' || right(v_iban, 4), v_iban, '572', false, true);
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    values (v_cuenta, v_empresa, r.id, 'bank_account', v_id::text, 'principal', 'migrated');
    creadas := creadas + 1;
  end loop;

  select count(*) into n from public.company_account_link l join public.company_account a on a.id = l.company_account_id
   where l.account_id = v_cuenta and l.entity = 'bank_account' and l.role = 'principal' and a.code in ('57200001', '57200002', '57200003');
  if n <> 3 then raise exception 'Foodint: después de esto, % de sus tres cuentas 572 tienen ficha de banco (espero 3).', n; end if;
  raise notice 'Foodint: % fichas de banco nuevas; sus tres cuentas 572 (57200001–3) tienen ya su ficha con IBAN.', creadas;
end $$;
