-- scripts/conta/produccion/cuentas/q10d-serie-y-fichas.sql
--
-- Q10 · respuesta 4 (0651 a 0654) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Lo que tiene que cambiar: la tabla de atados (no está → está, con 19 filas), los códigos de cliente de QBO (+19) y
-- los conceptos elegidos (no está → está, con 11 filas). Lo demás, igual: los NIF y los cobros de GoCardless.
-- Lo demás, igual: los NIF de las fichas de la cuenta de QBO (su huella).
select clave, valor from (
  select 1 o, 'fichas de QBO con código de cliente' clave,
    -- quieta: solo la cambia la 0652 o «Clientes y cuotas», que nadie toca durante el real
    (select count(*) from public.conta_cobro_cliente where company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and codigo_cliente is not null)::text valor
  union all
  select 2, 'atados a Cegid',
    -- quieta: la tabla nace con la 0651 y solo la escriben la 0652 y «Atar al N»
    case when to_regclass('public.conta_cegid_atado') is null then '-'
      else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_cegid_atado', false, true, '')))[1]::text end
  union all
  select 3, 'conceptos elegidos',
    -- quieta: la tabla nace con la 0653 y solo la escriben la 0654 y «Confirmar»
    case when to_regclass('public.conta_cegid_concepto_elegido') is null then '-'
      else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_cegid_concepto_elegido', false, true, '')))[1]::text end
  union all
  select 4, 'quietos · cobros de GoCardless de QBO',
    -- quieta: la 0653 solo añade una columna; los cobros los escribe la lectura de GoCardless, que no corre durante el real
    (select count(*) from public.conta_gc_cobro where company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4')::text
  union all
  select 5, 'quietos · huella de los NIF de las fichas de QBO',
    -- quieta: la tanda no toca ningún NIF; solo los cambia la lectura de Bitrix24, que no corre durante el real
    coalesce(md5(string_agg(id::text || '=' || coalesce(tax_id, ''), '|' order by id)), '-') from public.party where account_id = 'f4e8032d-510a-4e57-914c-4b67732d8655'
) t order by o, clave;
