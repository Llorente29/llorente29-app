-- ============================================================================
-- C04 R4 · HISTORIAL DE PRODUCCIÓN DADO DE ALTA
-- ----------------------------------------------------------------------------
-- Registra en supabase_migrations.schema_migrations los 58 ficheros que el
-- workflow aplicar-produccion-conta.yml aplicó en producción ANTES del W01
-- (C00 y C01, R02, C01b, C02, el interruptor de Foodint, C02c, C03 y C04),
-- con la huella md5 de cada fichero tal como está en main. Sin esto, la regla
-- «parece aplicado» del analizador para cualquier tanda que los vuelva a
-- nombrar, y el historial no dice qué hay en producción.
--
-- De dónde sale la lista: el supabase/produccion/aplicar.txt del commit de
-- cada ejecución REAL en verde del workflow (11 ejecuciones, 07/10–08/10;
-- el run y el commit van en created_by de cada fila). Comparado el md5 del
-- fichero en ese commit con el de main: 58 de 58 iguales en su ÚLTIMA
-- aplicación. El único que cambió entre medias es la 0130 del C00 (valores de
-- serie): el C00 aplicó una versión anterior y el C04 la volvió a aplicar ya
-- con la de main; se registra con el run del C04.
--
-- No crea, cambia ni borra nada fuera del registro. Guarda: si una versión ya
-- está registrada con OTRA huella, para (no se pisa un registro que diga otra
-- cosa); si está con la misma, la deja.
-- Vuelta atrás: supabase/vuelta-atras/20261012T0100_c04r_historial.down.sql
-- ============================================================================

do $$
declare v_mal text;
begin
  select string_agg(s.version, ', ' order by s.version) into v_mal
    from supabase_migrations.schema_migrations s
    join (values
  ('20261002T0100_c01_ficha_proveedor_estructura', '219f9eb110ad0d20cebbb9b09abe0f1f', 'run 37177886270 · e17049157e'),
  ('20261002T0110_c01_ficha_proveedor_datos', 'b36d2267cb34326646979d0477b5e91e', 'run 37177886270 · e17049157e'),
  ('20261003T0100_c00_catalogos_oficiales', 'f4aff68eb88156b9ccee472577926cad', 'run 37177886270 · e17049157e'),
  ('20261003T0110_c00_empresa', '1187b684a11bc3af3ac8629ed37c5119', 'run 37177886270 · e17049157e'),
  ('20261003T0120_c00_tablas_generales', '6b657c7524b72c17655366c4c5bca8b8', 'run 37177886270 · e17049157e'),
  ('20261003T0130_c00_valores_de_serie', '73c918cd29181337db2115ead84c40fd', 'run 37697073290 · ca715e1c3d'),
  ('20261003T0140_c00_vat_rate_lee_de_impuestos', 'a566166ed73aec9e3edb4b76b76c8485', 'run 37177886270 · e17049157e'),
  ('20261003T0150_c00_actividad_principal', 'c704f6e7fa42de05a446f300e3d04445', 'run 37177886270 · e17049157e'),
  ('20261003T0160_c00_ia_base', '5e5ff2465ab92eeb6ebfa1553276fcc6', 'run 37177886270 · e17049157e'),
  ('20261003T0170_c00_basicos_4t2024', 'c76e9b26ccb42cfffb2dfd51758b924e', 'run 37177886270 · e17049157e'),
  ('20261003T0180_c00_iva_de_ventas', '1dbe300219b38206a0ad5add376c5970', 'run 37177886270 · e17049157e'),
  ('20261003T0190_c00_modelos_anuales', 'dbd41a95f957e483e3598935a3bf7762', 'run 37177886270 · e17049157e'),
  ('20261003T0200_c00_ficha_para_presentar', '7fea8753794f03220e8d5e22601710f7', 'run 37177886270 · e17049157e'),
  ('20261003T0210_c00_codigo_postal', 'c3e71203f8e20ee2f7b053d1bebb1d8c', 'run 37177886270 · e17049157e'),
  ('20261005T0100_r02_brand_delivery_policy', 'e76c7367845c073d7a120ed920b77cc9', 'run 37188513776 · 3a87eb41a1'),
  ('20261005T0110_r02_filas_migradas', '9ccd884d159a763ee067f37d55f4e5ea', 'run 37188513776 · 3a87eb41a1'),
  ('20261005T0120_r02_lectores_de_la_resolucion', '8c2a47b9a0e571875880e95b80ecbba2', 'run 37188513776 · 3a87eb41a1'),
  ('20261005T0130_r02_guardar_celdas', 'c4a04c62f8b54c067675df65ca683841', 'run 37188513776 · 3a87eb41a1'),
  ('20261005T0140_r02_sugerencia_ia', 'd05e966ce36ae887dd3292590ce90120', 'run 37188513776 · 3a87eb41a1'),
  ('20261005T0200_r02_elimina_interruptor_antiguo', 'fb02248ba991aac5fbf398679350800b', 'run 37189758080 · 7470dc78b1'),
  ('20261005T0210_r02_saneado_pedidos_abiertos', '2dd325c4f23b810d9a08a4ab5296389a', 'run 37188513776 · 3a87eb41a1'),
  ('20261006T0100_c01b_estructura', 'f92b070603f683a494ef466d629d9176', 'run 37219796909 · 78000726ca'),
  ('20261006T0110_c01b_datos', 'f3b4c836a730c21cbcdd978e395f42a5', 'run 37219796909 · 78000726ca'),
  ('20261006T0120_c01b_lectores', 'f4160809168273cc7af8f1efcc3b9d76', 'run 37219796909 · 78000726ca'),
  ('20261006T0130_c01b_aprendizaje', '52b7daa12f2351f3fedbd8dd2613f86f', 'run 37219796909 · 78000726ca'),
  ('20261006T0135_c01b_iban_factura', '89daffa9d2cba14ea741f9cb00a660de', 'run 37219796909 · 78000726ca'),
  ('20261006T0140_c01b_elimina', 'bf3da856d732e8a0227bda6077e67cfd', 'run 37224003636 · a6d95f35e5'),
  ('20261006T1300_conta_interruptor_foodint_datos', 'a8994f73249cdf5a1541fd6e63c8fe84', 'run 37432334442 · 302247a870'),
  ('20261007T0100_c02_pgc_account', '93dec4d966379e2fe422666d24b1c22e', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0110_c02_pgc_serie', 'f032764bad3524fd1da212f28281153e', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0115_c02_pgc_definicion', 'cd1d80595279d47b1abadec77eae3a02', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0120_c02_plan_empresa', '6de158521d3b4c9c45b91ed175011505', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0130_c02_proveedor_400_410', '2c6d195b402336624ca5d14af1bb4f3d', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0140_c02_duplicadas_cerrar_palabras', 'abd620e15658de9e363b84d64d016275', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0150_c02_deshacer_cambio_plan', '3314b82eac0d2f62b96599f45641628a', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0160_c02_cuentas_del_proveedor', '84301109f45ee46ab6baf72e98bd0d3e', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0170_c02_elimina', '9a5b9071aec047b91ca74725c7e67ebb', 'run 37359889253 · 833b8ce1b8'),
  ('20261007T0180_c02_propuestas_plan', 'b3be4ee584d95447eb98a9be1aac21f2', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0185_c02_lectura', 'c21f16ae477ae0341b3515fb21faf08b', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0187_c02_enlaces_sin_dueno', 'e6ab372c475f0428f952b1a9d7a3c441', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0189_c02_renombrar_subcuenta', '7b7594cd617abaf85672950cab1295b6', 'run 37350280770 · b37d78a8e5'),
  ('20261008T0100_c02c_traer_plan', '6fc61e7809bd6c3bcfd18363f665348b', 'run 37435249372 · 6a1ae9fd36'),
  ('20261008T0110_c02c_activar_espera', '313ff592d52e2f4e9185af5636df6813', 'run 37435249372 · 6a1ae9fd36'),
  ('20261008T0120_c02c_lectura', 'e796991911249c8e21e36171a263fc81', 'run 37435249372 · 6a1ae9fd36'),
  ('20261008T0130_c02c_genericas', 'c74d0088f70f389a4c04cf607061aa7f', 'run 37435249372 · 6a1ae9fd36'),
  ('20261009T0100_c03_terceros', '2007c0745c5a5ef83f379441b30deaef', 'run 37503035245 · fe68036d2f'),
  ('20261009T0110_c03_terceros_datos', '219fb335d4095584f5aa2e11890dd418', 'run 37503035245 · fe68036d2f'),
  ('20261009T0120_c03_liquidaciones', 'c9a02508862fef50bd91e63fee12a3e4', 'run 37503035245 · fe68036d2f'),
  ('20261009T0130_c03_periodos_propuestos', 'a74b149dc5305624c2e977f462cacb17', 'run 37503035245 · fe68036d2f'),
  ('20261009T0140_c03_funciones', 'ce9fb4611053e2054f5500ec647dbe9a', 'run 37503035245 · fe68036d2f'),
  ('20261009T0150_c03_lectura', '4cbcbfa064166a704020bfa813e8bf36', 'run 37503035245 · fe68036d2f'),
  ('20261009T0160_c03_deshacer_importacion', 'eb9867b7a2c82c2126a0f48a46bfa3bd', 'run 37503035245 · fe68036d2f'),
  ('20261009T0170_c03_borrar_proveedor', '2c227aec4838d2a27396504ca956a449', 'run 37503035245 · fe68036d2f'),
  ('20261009T0180_c03_modelo_plataforma', '35e87de761aa89e4ce971edfd7f63a7f', 'run 37503035245 · fe68036d2f'),
  ('20261010T0100_c04_libro', '21be622f591302bbab83c100b48087b8', 'run 37697073290 · ca715e1c3d'),
  ('20261010T0110_c04_enlaces', '9a92b94c0a3bcdcd15fcfc49ea1084a0', 'run 37697073290 · ca715e1c3d'),
  ('20261010T0120_c04_funciones', 'b7266afd099fd798b19389325feda363', 'run 37697073290 · ca715e1c3d'),
  ('20261010T0130_c04_lectura', '470b6eab3db876c6a6da527db456adb7', 'run 37697073290 · ca715e1c3d')
    ) h(version, huella, origen) on h.version = s.version
   where s.statements is distinct from array['-- huella md5:' || h.huella];
  if v_mal is not null then
    raise exception 'historial: ya registradas con otra huella: %', v_mal;
  end if;
end $$;

insert into supabase_migrations.schema_migrations (version, name, statements, created_by)
select h.version, regexp_replace(h.version, '^[^_]*_', ''), array['-- huella md5:' || h.huella], 'historial C04 R4 · ' || h.origen
  from (values
  ('20261002T0100_c01_ficha_proveedor_estructura', '219f9eb110ad0d20cebbb9b09abe0f1f', 'run 37177886270 · e17049157e'),
  ('20261002T0110_c01_ficha_proveedor_datos', 'b36d2267cb34326646979d0477b5e91e', 'run 37177886270 · e17049157e'),
  ('20261003T0100_c00_catalogos_oficiales', 'f4aff68eb88156b9ccee472577926cad', 'run 37177886270 · e17049157e'),
  ('20261003T0110_c00_empresa', '1187b684a11bc3af3ac8629ed37c5119', 'run 37177886270 · e17049157e'),
  ('20261003T0120_c00_tablas_generales', '6b657c7524b72c17655366c4c5bca8b8', 'run 37177886270 · e17049157e'),
  ('20261003T0130_c00_valores_de_serie', '73c918cd29181337db2115ead84c40fd', 'run 37697073290 · ca715e1c3d'),
  ('20261003T0140_c00_vat_rate_lee_de_impuestos', 'a566166ed73aec9e3edb4b76b76c8485', 'run 37177886270 · e17049157e'),
  ('20261003T0150_c00_actividad_principal', 'c704f6e7fa42de05a446f300e3d04445', 'run 37177886270 · e17049157e'),
  ('20261003T0160_c00_ia_base', '5e5ff2465ab92eeb6ebfa1553276fcc6', 'run 37177886270 · e17049157e'),
  ('20261003T0170_c00_basicos_4t2024', 'c76e9b26ccb42cfffb2dfd51758b924e', 'run 37177886270 · e17049157e'),
  ('20261003T0180_c00_iva_de_ventas', '1dbe300219b38206a0ad5add376c5970', 'run 37177886270 · e17049157e'),
  ('20261003T0190_c00_modelos_anuales', 'dbd41a95f957e483e3598935a3bf7762', 'run 37177886270 · e17049157e'),
  ('20261003T0200_c00_ficha_para_presentar', '7fea8753794f03220e8d5e22601710f7', 'run 37177886270 · e17049157e'),
  ('20261003T0210_c00_codigo_postal', 'c3e71203f8e20ee2f7b053d1bebb1d8c', 'run 37177886270 · e17049157e'),
  ('20261005T0100_r02_brand_delivery_policy', 'e76c7367845c073d7a120ed920b77cc9', 'run 37188513776 · 3a87eb41a1'),
  ('20261005T0110_r02_filas_migradas', '9ccd884d159a763ee067f37d55f4e5ea', 'run 37188513776 · 3a87eb41a1'),
  ('20261005T0120_r02_lectores_de_la_resolucion', '8c2a47b9a0e571875880e95b80ecbba2', 'run 37188513776 · 3a87eb41a1'),
  ('20261005T0130_r02_guardar_celdas', 'c4a04c62f8b54c067675df65ca683841', 'run 37188513776 · 3a87eb41a1'),
  ('20261005T0140_r02_sugerencia_ia', 'd05e966ce36ae887dd3292590ce90120', 'run 37188513776 · 3a87eb41a1'),
  ('20261005T0200_r02_elimina_interruptor_antiguo', 'fb02248ba991aac5fbf398679350800b', 'run 37189758080 · 7470dc78b1'),
  ('20261005T0210_r02_saneado_pedidos_abiertos', '2dd325c4f23b810d9a08a4ab5296389a', 'run 37188513776 · 3a87eb41a1'),
  ('20261006T0100_c01b_estructura', 'f92b070603f683a494ef466d629d9176', 'run 37219796909 · 78000726ca'),
  ('20261006T0110_c01b_datos', 'f3b4c836a730c21cbcdd978e395f42a5', 'run 37219796909 · 78000726ca'),
  ('20261006T0120_c01b_lectores', 'f4160809168273cc7af8f1efcc3b9d76', 'run 37219796909 · 78000726ca'),
  ('20261006T0130_c01b_aprendizaje', '52b7daa12f2351f3fedbd8dd2613f86f', 'run 37219796909 · 78000726ca'),
  ('20261006T0135_c01b_iban_factura', '89daffa9d2cba14ea741f9cb00a660de', 'run 37219796909 · 78000726ca'),
  ('20261006T0140_c01b_elimina', 'bf3da856d732e8a0227bda6077e67cfd', 'run 37224003636 · a6d95f35e5'),
  ('20261006T1300_conta_interruptor_foodint_datos', 'a8994f73249cdf5a1541fd6e63c8fe84', 'run 37432334442 · 302247a870'),
  ('20261007T0100_c02_pgc_account', '93dec4d966379e2fe422666d24b1c22e', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0110_c02_pgc_serie', 'f032764bad3524fd1da212f28281153e', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0115_c02_pgc_definicion', 'cd1d80595279d47b1abadec77eae3a02', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0120_c02_plan_empresa', '6de158521d3b4c9c45b91ed175011505', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0130_c02_proveedor_400_410', '2c6d195b402336624ca5d14af1bb4f3d', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0140_c02_duplicadas_cerrar_palabras', 'abd620e15658de9e363b84d64d016275', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0150_c02_deshacer_cambio_plan', '3314b82eac0d2f62b96599f45641628a', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0160_c02_cuentas_del_proveedor', '84301109f45ee46ab6baf72e98bd0d3e', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0170_c02_elimina', '9a5b9071aec047b91ca74725c7e67ebb', 'run 37359889253 · 833b8ce1b8'),
  ('20261007T0180_c02_propuestas_plan', 'b3be4ee584d95447eb98a9be1aac21f2', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0185_c02_lectura', 'c21f16ae477ae0341b3515fb21faf08b', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0187_c02_enlaces_sin_dueno', 'e6ab372c475f0428f952b1a9d7a3c441', 'run 37350280770 · b37d78a8e5'),
  ('20261007T0189_c02_renombrar_subcuenta', '7b7594cd617abaf85672950cab1295b6', 'run 37350280770 · b37d78a8e5'),
  ('20261008T0100_c02c_traer_plan', '6fc61e7809bd6c3bcfd18363f665348b', 'run 37435249372 · 6a1ae9fd36'),
  ('20261008T0110_c02c_activar_espera', '313ff592d52e2f4e9185af5636df6813', 'run 37435249372 · 6a1ae9fd36'),
  ('20261008T0120_c02c_lectura', 'e796991911249c8e21e36171a263fc81', 'run 37435249372 · 6a1ae9fd36'),
  ('20261008T0130_c02c_genericas', 'c74d0088f70f389a4c04cf607061aa7f', 'run 37435249372 · 6a1ae9fd36'),
  ('20261009T0100_c03_terceros', '2007c0745c5a5ef83f379441b30deaef', 'run 37503035245 · fe68036d2f'),
  ('20261009T0110_c03_terceros_datos', '219fb335d4095584f5aa2e11890dd418', 'run 37503035245 · fe68036d2f'),
  ('20261009T0120_c03_liquidaciones', 'c9a02508862fef50bd91e63fee12a3e4', 'run 37503035245 · fe68036d2f'),
  ('20261009T0130_c03_periodos_propuestos', 'a74b149dc5305624c2e977f462cacb17', 'run 37503035245 · fe68036d2f'),
  ('20261009T0140_c03_funciones', 'ce9fb4611053e2054f5500ec647dbe9a', 'run 37503035245 · fe68036d2f'),
  ('20261009T0150_c03_lectura', '4cbcbfa064166a704020bfa813e8bf36', 'run 37503035245 · fe68036d2f'),
  ('20261009T0160_c03_deshacer_importacion', 'eb9867b7a2c82c2126a0f48a46bfa3bd', 'run 37503035245 · fe68036d2f'),
  ('20261009T0170_c03_borrar_proveedor', '2c227aec4838d2a27396504ca956a449', 'run 37503035245 · fe68036d2f'),
  ('20261009T0180_c03_modelo_plataforma', '35e87de761aa89e4ce971edfd7f63a7f', 'run 37503035245 · fe68036d2f'),
  ('20261010T0100_c04_libro', '21be622f591302bbab83c100b48087b8', 'run 37697073290 · ca715e1c3d'),
  ('20261010T0110_c04_enlaces', '9a92b94c0a3bcdcd15fcfc49ea1084a0', 'run 37697073290 · ca715e1c3d'),
  ('20261010T0120_c04_funciones', 'b7266afd099fd798b19389325feda363', 'run 37697073290 · ca715e1c3d'),
  ('20261010T0130_c04_lectura', '470b6eab3db876c6a6da527db456adb7', 'run 37697073290 · ca715e1c3d')
  ) h(version, huella, origen)
 where not exists (select 1 from supabase_migrations.schema_migrations s where s.version = h.version);
