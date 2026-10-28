-- scripts/conta/produccion/cuentas/s01b2-lectura-releida.sql
--
-- S01b2 (28/10) · LO QUE CUENTA LA TANDA DE LA RELECTURA (1555), antes y
-- después. SOLO LEE.
--   · La 1555 solo añade conta_lectura_proveedor_releida (no existe antes ni al
--     deshacerla).
--   · Lo que la tanda NO toca, igual a los dos lados: las lecturas guardadas con
--     el sello «releida» (solo lo escribe la función nueva, al pulsar «Dar de
--     alta a …» o al validar; la tanda no la llama). No se cuentan las que
--     tienen las claves del teléfono y la web: esas las deja también una
--     lectura nueva, y una factura puede entrar por correo a mitad del ensayo.
-- Del catálogo, o de filas que solo escribe lo que la tanda añade: nada que
-- otro proceso escriba a mitad del ensayo (W06).
select clave, valor from (
  select 1 o, '1555: conta_lectura_proveedor_releida existe' clave,
    (to_regprocedure('public.conta_lectura_proveedor_releida(uuid,uuid)') is not null)::text valor union all
  select 2, 'lecturas de factura con el sello «releida» (tabla entera)',
    -- quieta: solo lo escribe la función que añade la 1555, al pulsar; la tanda no la llama. 0 el 28/10
    (select count(*) from public.supplier_invoice where reading ? 'releida')::text
) x order by o;
