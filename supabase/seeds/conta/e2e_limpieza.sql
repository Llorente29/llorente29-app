-- ============================================================================
-- Lo que dejaron las e2e cortadas a mitad. SOLO STAGING. Lo corre el workflow
-- de las e2e al empezar, antes de las pruebas.
-- ----------------------------------------------------------------------------
-- Cada prueba borra al acabar lo que crea. Un run cortado (tiempo agotado,
-- cancelado, el navegador que se cae) se queda sin ese final, y lo que deja
-- puede tumbar al siguiente: las facturas E2E-001 de un proveedor «E2E C01b …»
-- que nadie borró tumbaban c01b/flujos (Julio, C06 respuesta 2).
--
-- Qué quita, solo en las cuentas de prueba (las tres de siempre y la C de cada
-- frente) y solo si tiene MÁS DE 30 MINUTOS:
--   · proveedores con «e2e» en el nombre (todas las pruebas los llaman así:
--     «E2E C01b …», «E2E Completo …», «Fusion e2e …», «Proveedor C03 e2e …»),
--     con sus facturas y sus documentos;
--   · empresas sin terminar «Alta e2e …» de la cuenta A, y cualquier empresa
--     de las cuentas C (viven sin ninguna).
--
-- Por qué la edad y no el frente: una prueba crea y borra lo suyo en un par de
-- minutos, así que nada de más de 30 minutos está en uso por ninguna ejecución
-- en marcha, sea del frente que sea. Con dos frentes a la vez, ninguno le
-- quita al otro lo que está usando.
--
-- Lo que no se puede borrar (otra tabla lo sujeta) se dice y se deja: no para
-- las pruebas, que dirán ellas si les estorba.
-- ============================================================================

do $$
declare
  cuentas constant uuid[] := array[
    'c01a0000-0000-4000-8000-00000000000a', 'c01b0000-0000-4000-8000-00000000000b', 'c01c0000-0000-4000-8000-00000000000c',
    'e2e0000a-0000-4000-8000-00000000000c', 'e2e0000b-0000-4000-8000-00000000000c', 'e2e0000c-0000-4000-8000-00000000000c']::uuid[];
  r record;
  proveedores int := 0;
  empresas int := 0;
  sujetos int := 0;
begin
  if exists (select 1 from accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Limpieza e2e ABORTADA: al otro lado hay cuentas de producción.';
  end if;

  for r in
    select s.id, s.name from supplier s
     where s.account_id = any (cuentas) and s.name ~* '\me2e\M' and s.created_at < now() - interval '30 minutes'
  loop
    begin
      delete from supplier_invoice where supplier_id = r.id;
      delete from compliance_document where supplier_id = r.id;
      delete from supplier where id = r.id;
      proveedores := proveedores + 1;
    exception when foreign_key_violation then
      sujetos := sujetos + 1;
      raise notice 'No se puede quitar el proveedor «%» (%): %', r.name, r.id, sqlerrm;
    end;
  end loop;

  for r in
    select c.id, c.legal_name from company c
     where c.created_at < now() - interval '30 minutes'
       and ((c.account_id = 'c01a0000-0000-4000-8000-00000000000a' and c.setup_completed_at is null and c.legal_name like 'Alta e2e%')
            or c.account_id = any (array['c01c0000-0000-4000-8000-00000000000c', 'e2e0000a-0000-4000-8000-00000000000c',
                                         'e2e0000b-0000-4000-8000-00000000000c', 'e2e0000c-0000-4000-8000-00000000000c']::uuid[])
            or c.account_id in (select a.id from accounts a where a.name like 'Recorrido de Prueba C06 %' and a.product_brand = 'contabilidad'))
  loop
    begin
      delete from company where id = r.id;
      empresas := empresas + 1;
    exception when foreign_key_violation then
      sujetos := sujetos + 1;
      raise notice 'No se puede quitar la empresa «%» (%): %', r.legal_name, r.id, sqlerrm;
    end;
  end loop;

  raise notice 'Limpieza e2e: % proveedores y % empresas de runs cortados quitados; % sujetos por otra tabla.', proveedores, empresas, sujetos;
end $$;
