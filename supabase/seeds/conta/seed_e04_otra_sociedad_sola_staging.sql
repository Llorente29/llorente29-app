-- ============================================================================
-- E04 · La factura de otra sociedad del grupo se pasa sola · Lo que prepara su
-- e2e, en su carril. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Para tests/e2e/conta/e04/pasada-sola.spec.ts. Crea una función que la e2e llama
-- con la sesión de la administradora de A (de su carril) y que prepara allí, cada
-- vez de nuevo, lo de la semilla E03 (e2e_e03_preparar: una recibida a nombre de
-- la segunda sociedad de A, con su llegada, y otra a nombre de alguien de fuera)
-- y pasa la primera SOLA (_conta_pasar_sola, de la 1950), como lo hace el
-- disparador de la 1951 al leerla. Hasta el real del E04, ese disparador solo va
-- en ROLLBACK a staging (cambia en caliente): esto hace en staging lo que hará él.
--
-- Y asegura el perfil fiscal de la segunda sociedad de A (el de la semilla E03),
-- «si no existe»: no cambia nada que esté.
--
-- Guardas: aborta si al otro lado hay cuentas de producción. La función hace lo
-- que e2e_e03_preparar deja (la cuenta A de prueba o la de su carril, y solo su
-- administradora). Se puede aplicar dos veces (W07): «on conflict» y create or replace.
-- ============================================================================

do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla E04 ABORTADA: esta base tiene cuentas de producción. ¿Es staging-conta?';
  end if;
end $$;

insert into public.company_tax_profile (company_id, account_id, tax_territory, vat_period, chart_kind, account_digits, tax_forms, sales_tax_rate_code)
select x.id, x.account_id, 'peninsula_baleares', 'quarterly', 'pymes', 8, array['303', '347', '390'], 'iva_reducido'
  from public.company x where x.account_id = 'c01a0000-0000-4000-8000-00000000000a' and x.tax_id = 'B00000000'
on conflict (company_id) do nothing;

create or replace function public.e2e_e04_preparar(p_lado text)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare r jsonb; s jsonb;
begin
  r := public.e2e_e03_preparar(p_lado);
  -- Lo que hace el disparador de la 1951 al leerla: pasarla sola a la sociedad a cuyo nombre va.
  s := public._conta_pasar_sola((r->'otra'->>'id')::uuid);
  if s is null then raise exception 'E04 e2e: no se ha pasado sola: %', public._conta_de_quien((r->'otra'->>'id')::uuid); end if;
  return r || jsonb_build_object('sola', s);
end $function$;
comment on function public.e2e_e04_preparar(text) is 'SOLO STAGING (semilla E04): lo de e2e_e03_preparar y la recibida a nombre de la segunda sociedad pasada sola, para su e2e.';
revoke all on function public.e2e_e04_preparar(text) from public, anon;
grant execute on function public.e2e_e04_preparar(text) to authenticated;
