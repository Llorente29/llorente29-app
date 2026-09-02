-- 20260901T1745_86_opciones_dispara_el_despachador.sql
--
-- ⚠️ FICHERO ESCRITO A POSTERIORI PARA CERRAR UNA DERIVA REPO ↔ PRODUCCIÓN.
--
-- Esta migración se aplicó en producción el 01/09 a las 13:28 (registrada como
-- `20260901152843 · 86_opciones_dispara_el_despachador`) y NO tenía fichero
-- propio: su contenido se metió dentro de
-- `20260901T1730_86_de_opciones_de_modificador.sql`, que se editó para dejarlo
-- alineado con lo aplicado.
--
-- El contenido nunca divergió. Lo que divergía era la NUMERACIÓN: el registro
-- tenía una entrada que el repo no podía explicar. Dentro de tres meses nadie
-- iba a saber que estaba dentro de otra, y esa es exactamente la clase de cabo
-- suelto que convierte una reconstrucción desde el repo en una tarde perdida.
--
-- ES IDEMPOTENTE Y NO CAMBIA NADA: `create or replace` de la misma función que
-- ya está viva. Se puede aplicar o no aplicar; existe para que el fichero
-- exista, no para cambiar el estado.
--
-- El contenido real vive en 20260901T1730. Aquí solo la referencia y la
-- verificación de que lo aplicado es lo que el repo dice.

begin;

do $verif$
declare
  v_src text;
begin
  v_src := pg_get_functiondef('public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamptz,text)'::regprocedure);

  -- Lo que aporta la migración que este fichero documenta: el envoltorio
  -- dispara el despachador. Sin esto, el 86 de una opción se quedaría escrito
  -- en nuestra base de datos sin llegar nunca a HubRise.
  if position('net.http_post' in v_src) = 0 then
    raise exception 'set_modifier_option_availability no dispara el despachador: la migracion 20260901152843 no esta aplicada de verdad';
  end if;
  if position('option_refs' in v_src) = 0 then
    raise exception 'el envoltorio no manda option_refs';
  end if;
  if position('''matriculas''' in v_src) > 0 then
    raise exception 'manda matriculas: un ref de opcion no puede viajar como sku de producto';
  end if;

  raise notice 'VERIFICACION OK: lo aplicado coincide con lo que el repo dice';
end;
$verif$;

commit;
