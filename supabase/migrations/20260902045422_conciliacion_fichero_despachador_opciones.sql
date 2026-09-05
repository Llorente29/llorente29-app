-- Conciliacion: la migracion 20260901152843 ya tiene fichero en el repo
-- (20260901T1745_86_opciones_dispara_el_despachador.sql). No cambia nada;
-- verifica que lo aplicado coincide con lo que el repo dice.
do $verif$
declare
  v_src text;
begin
  v_src := pg_get_functiondef('public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamptz,text)'::regprocedure);

  if position('net.http_post' in v_src) = 0 then
    raise exception 'set_modifier_option_availability no dispara el despachador';
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