-- scripts/conta/produccion/cuentas/k14f-codigos-cegid.sql
--
-- K14f · Los códigos de Cegid de 6 fichas de QBO · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 0823 ata 6 fichas a su código de Cegid (conta_cobro_cliente, con su apunte en conta_cegid_atado). Se mide en esas 6
-- fichas cuántas tienen código (0 → 6) y lo apuntado por la K14f (0 → 6); y que Consorcio K sigue con el 1266.
select clave, valor from (
  select 0 o, 'las 6 fichas de la tanda · con código de Cegid' clave,
         -- quieta: solo esas 6 fichas, que solo ata esta tanda
         count(*)::text valor
    from public.conta_cobro_cliente c where c.company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and c.codigo_cliente is not null
     and c.party_id in ('7ea5b89a-924c-4c3a-9426-99a4e606f278','21bc2411-ce14-4fbb-8089-9c0181084958','a91d7dab-a651-4a17-a977-f061d3aa80fc','35182a93-1085-47f4-b890-4c69eb3838d3','bd1170c8-cb8e-4ae1-8083-d903d543d6a0','198dc23e-072a-4257-8c3c-130ea35065a7')
  union all
  select 0, 'las 6 fichas de la tanda · atadas por la K14f',
         -- quieta: solo lo que apunta esta tanda, con su nombre
         count(*)::text from public.conta_cegid_atado a where a.quien = 'K14f · códigos de Cegid del 27/11'
  union all
  select 1, 'la ficha de Consorcio K (K14e) · su código',
         -- quieta: una sola ficha, atada por la K14e; esta tanda no la toca
         coalesce(max(c.codigo_cliente)::text, 'ninguno') from public.conta_cobro_cliente c
   where c.company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and c.party_id = 'f8938378-aad9-4ba8-8806-583ab50fb640'
) t order by o, clave;
