-- supabase/migrations/20261118T0746_x07_asientos_por_salir.sql
--
-- X07 · Los asientos que salen a ERP10, con lo que necesita su fichero (encargo X07,
-- 18/11). SOLO AÑADE: una función nueva, que solo lee. No cambia ninguna otra.
--
-- conta_erp10_asientos_por_salir(empresa, mes): de cada asiento que sale ese mes (los
-- que conta_erp10_por_salir da como «asiento» y que salen: sin libro de I.V.A.), lo que
-- necesita prepararAsientos (src/modules/conta/erp10/ficheros.ts): serie, número,
-- fecha, concepto y cada apunte con su cuenta, su plantilla, su nombre (la
-- «denominación» que pide ERP10), su concepto y su debe o su haber. Y, de cada cuenta
-- que usan, lo que lleva su fila de subcuentas (el NIF de su proveedor o de su
-- cliente, si lo tiene), con las ya salidas para ver las que chocan.
--
-- Vuelta atrás: supabase/vuelta-atras/20261118T0746_x07_asientos_por_salir.down.sql

create or replace function public.conta_erp10_asientos_por_salir(p_company uuid, p_mes date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c public.company;
  v_ps jsonb;
  v_ids uuid[];
  v_r jsonb;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.belongs_to_account(v_c.account_id) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  -- Las mismas reglas que enseña la pantalla: solo los asientos que salen.
  v_ps := public.conta_erp10_por_salir(v_c.id, p_mes);
  select coalesce(array_agg((p ->> 'entry_id')::uuid), '{}') into v_ids
    from jsonb_array_elements(v_ps -> 'partidas') p
   where p ->> 'clase' = 'asiento' and (p ->> 'sale')::boolean;

  with e as (
    select e.* from public.journal_entry e
     where e.id = any (v_ids) and e.company_id = v_c.id and e.account_id = v_c.account_id
  ),
  lineas as (
    select l.entry_id, l.position, a.id as cuenta_id, a.code, a.template_code, a.name, l.concept, l.debit, l.credit
      from public.journal_line l
      join e on e.id = l.entry_id
      join public.company_account a on a.id = l.company_account_id and a.account_id = l.account_id
     where l.account_id = v_c.account_id
  ),
  cuentas as (
    select distinct l.cuenta_id as id, l.code, l.template_code, l.name from lineas l
  ),
  terceros as (
    -- El proveedor o el cliente enlazado a la cuenta: su NIF.
    select distinct on (c.id) c.id,
           coalesce((select s.tax_id from public.supplier s where s.id::text = k.entity_id and s.account_id = v_c.account_id and k.entity = 'supplier'),
                    (select p.tax_id from public.party p where p.id::text = k.entity_id and p.account_id = v_c.account_id and k.entity = 'customer')) as nif
      from cuentas c
      join public.company_account_link k on k.company_account_id = c.id and k.company_id = v_c.id and k.account_id = v_c.account_id
                                        and k.entity in ('supplier', 'customer') and k.role = 'principal'
     order by c.id, k.created_at
  )
  select jsonb_build_object(
    'mes', v_ps -> 'mes', 'codigo', v_ps -> 'codigo', 'largo', v_ps -> 'largo',
    'asientos', coalesce((select jsonb_agg(jsonb_build_object(
        'entryId', e.id, 'serie', e.series, 'numero', e.number, 'fecha', e.entry_date, 'concepto', e.concept, 'origen', e.source_type,
        'lineas', (select jsonb_agg(jsonb_build_object('cuenta', l.code, 'plantilla', l.template_code, 'nombre', l.name, 'concepto', l.concept,
                      'debe', l.debit, 'haber', l.credit) order by l.position) from lineas l where l.entry_id = e.id))
        order by e.entry_date, e.series, e.number) from e), '[]'::jsonb),
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object('codigo', c.code, 'plantilla', c.template_code, 'nombre', c.name,
        'nif', t.nif, 'gastoHabitual', null) order by c.code)
      from cuentas c left join terceros t on t.id = c.id), '[]'::jsonb),
    'yaSalidas', coalesce((select jsonb_object_agg(s.codigo_erp10, s.codigo)
      from public.conta_erp10_subcuenta_salida s where s.company_id = v_c.id and s.account_id = v_c.account_id), '{}'::jsonb)
  ) into v_r;
  return v_r;
end $$;
comment on function public.conta_erp10_asientos_por_salir(uuid, date) is
  'X07 · De cada asiento que sale a ERP10 ese mes (los de conta_erp10_por_salir de clase «asiento» que salen: sin libro de I.V.A.), lo que necesita su fichero: serie, número, fecha, concepto y cada apunte con su cuenta, plantilla, nombre, concepto, debe y haber; las cuentas que usan con su NIF; y las ya salidas. Solo lee.';
revoke all on function public.conta_erp10_asientos_por_salir(uuid, date) from public, anon;
grant execute on function public.conta_erp10_asientos_por_salir(uuid, date) to authenticated, service_role;
