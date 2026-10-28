-- supabase/migrations/20261028T1103_s01_retencion_trabajo.sql
--
-- S01 · PR 3 · Respuesta 9, punto 1: el tipo de retención de los RENDIMIENTOS
-- DEL TRABAJO (las nóminas), modelo 111, en las tablas de serie.
--
-- Medido en producción el 28/10, solo lectura: withholding_rate tiene 5 filas,
-- las 5 de serie y ninguna de trabajo (111: profesional 15 %, profesional_inicio
-- 7 % y administradores 35 %; 115: alquiler 19 %; 123: capital 19 %). Sin ella,
-- la regla de nóminas (0800), que la busca por su clave (code = 'trabajo',
-- filed_in = '111'), no puede poner el tipo en la línea de la 4751 en ninguna
-- empresa: lo dice en «Lo que no he podido proponer». El navegador cogía «el
-- primero» de la tabla, sin orden.
--
-- Solo añade una fila de serie, si no está (se puede pasar dos veces).
--   · El porcentaje es 0: en una nómina el tipo es el de cada trabajador
--     (RD 439/2007, arts. 80.1.1.º, 82 y 86), y el importe retenido viene de
--     la nómina, no de multiplicar la base por un tipo de la tabla.
--   · Clave A del modelo 190: «Rendimientos del trabajo: Empleados por cuenta
--     ajena en general», con el procedimiento general del artículo 82.
--   · Vigente desde el 01/04/2007, la entrada en vigor del RD 439/2007
--     (fuente rd-439-2007: «vigente desde 2007-04-01 · BOE-A-2007-6820»).
-- No se ofrece al elegir la retención de un proveedor, un cliente o una
-- factura de venta: ni un proveedor ni un cliente son trabajadores (lo
-- filtran sus pantallas).
--
-- Vuelta atrás: supabase/vuelta-atras/20261028T1103_s01_retencion_trabajo.down.sql

insert into public.withholding_rate (is_system, code, name, example, rate, model_190_key, model_190_subkey, filed_in, valid_from, valid_to, pgc_hint, legal_ref, verified_at, source_key, sort_order)
select true, 'trabajo', 'Rendimientos del trabajo', 'Las nóminas de tus trabajadores: el tipo es el de cada nómina', 0, 'A', null, '111', '2007-04-01', null, '4751',
       'RD 439/2007, arts. 80.1.1.º, 82 y 86; Orden EHA/3127/2009 (modelo 190), clave A', '2026-10-28', 'rd-439-2007', 5
where not exists (select 1 from public.withholding_rate where is_system and code = 'trabajo' and valid_from = '2007-04-01');

do $$ begin
  if (select count(*) from public.withholding_rate where is_system and code = 'trabajo' and filed_in = '111') <> 1 then
    raise exception 'S01 retención del trabajo: tiene que quedar exactamente una de serie.';
  end if;
end $$;
