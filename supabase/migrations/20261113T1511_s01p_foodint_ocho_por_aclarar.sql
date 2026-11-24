-- supabase/migrations/20261113T1511_s01p_foodint_ocho_por_aclarar.sql
--
-- S01p·20 · 1 · Foodint · Los 8 correos «Just-eat invoice» de junio a septiembre que el
-- lector del 01/11 no entendió (saldo negativo, antes del #428), a «Por aclarar» (Julio,
-- 13/11: «que entren por la pantalla como cualquier otro, sin tocar la base a mano»).
--
-- No crea ninguna liquidación ni ninguna factura: deja a cada uno su fila en Documentos ›
-- «Por aclarar», con la misma función que usa la entrada (conta_entrada_sin_factura, la
-- 1504), y desde ahí se pulsa «Volver a leer». Lo que entre, entra por la función de
-- entrada como cualquier otro correo.
--
-- Los 3 de octubre (4126341, 4126364 y 4126424) NO: los crea D por tanda (DL1_24).
--
-- Solo los que siguen como «sin_facturas» en el registro de entrada de Foodint, y una vez:
-- si ya tienen su fila, la función la devuelve. En staging no hay ninguno: no hace nada.

do $$
declare
  v_emp constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';  -- Foodint
  v_correos constant text[] := array[
    '36ccc167-ad37-44d1-97fa-37af5473b673',  -- Just-eat invoice: 3972671
    '855e42e1-a7dd-4f9d-aa3f-ace64f0219b9',  -- 3985628
    '95d4117e-1938-4d84-9eef-63e386a7b0d8',  -- 3994650
    'a5364aee-8f47-41a2-bd34-e05fc211a93b',  -- 3994688
    '398151b2-ac78-4f70-a9e5-620fcaab9649',  -- 4018942
    '6026529c-f1f4-46e5-91c5-1383674e3b6c',  -- 4019492
    'f9bc4e4d-95df-4115-92fe-c5e128a2d61f',  -- 4040922
    'e4e99e89-d808-434c-81ed-cdb996c1b4e8'   -- 4060895
  ];
  v_c text; v_r jsonb; v_n integer := 0; v_ya integer := 0;
begin
  if not exists (select 1 from public.company where id = v_emp) then
    raise notice 'S01p·20 · 1 · Foodint no está en esta base: no hay nada que hacer.';
    return;
  end if;
  foreach v_c in array v_correos loop
    if not exists (select 1 from public.inbound_email_log
                    where company_id = v_emp and email_id = v_c and outcome = 'sin_facturas' and subject ~* 'just-?eat invoice') then
      raise exception 'S01p·20 · 1 · el correo % ya no está como «sin_facturas» de Just Eat en Foodint: no sigo.', v_c;
    end if;
    v_r := public.conta_entrada_sin_factura(jsonb_build_object('company_id', v_emp, 'email_id', v_c));
    if (v_r->>'ya_estaba')::boolean then v_ya := v_ya + 1; else v_n := v_n + 1; end if;
  end loop;
  raise notice 'S01p·20 · 1 · Foodint: % a «Por aclarar» (% ya estaban).', v_n, v_ya;
end $$;
