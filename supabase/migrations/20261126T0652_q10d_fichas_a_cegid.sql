-- supabase/migrations/20261126T0652_q10d_fichas_a_cegid.sql
--
-- Q10 · respuesta 4 (26/11) · LAS 19 FICHAS DE QBO CON COBROS Y SIN CÓDIGO DE CEGID, atadas a su cliente de Cegid
-- (la tabla de la respuesta 4: las encontró Claude en Cegid el 26/11; 1264 y 1265, altas nuevas de Julio). Se pone el
-- código en la ficha a la que va cada cobro (conta_cobro_cliente.codigo_cliente), con _conta_cegid_atar, que lo apunta.
-- Sin nombres ni NIF (T11): solo el id de cada ficha y su código.
--   · La 502 va en la ficha a la que va el cobro de 96,80 € del 04/11 (la atada por correo): se factura al 502, como
--     siempre; el enlace de GoCardless no se toca.
--   · Ningún NIF cambia: el de Cegid lo tiene ya otra ficha (la del 430), y la base no admite dos iguales en una cuenta.
-- Solo en la cuenta de QBO; en otra base (staging, local) no hace nada. Para si una ficha no está como se midió el 26/11
-- (sin su fila en conta_cobro_cliente o con otro código ya puesto).
-- Vuelta atrás: supabase/vuelta-atras/20261126T0652_q10d_fichas_a_cegid.down.sql.

do $fichas$
declare
  v_empresa constant uuid := '58e574ec-012a-4483-9f5b-3501cc023ba4';
  v_quien constant text := 'Julio (respuesta Q10 · 4, 26/11)';
  -- Cada ficha (la de los cobros) con su código de Cegid.
  v_l constant jsonb := '[
    {"party": "96025548-97bb-40bc-90d9-b36e42a34875", "codigo": 85}, {"party": "eeb15bbe-be18-438c-b83c-337dc45f52a7", "codigo": 144},
    {"party": "59ce9d72-384c-4d4d-b68c-3dc9dc68232c", "codigo": 146}, {"party": "30f60cca-8cf4-4c0e-a279-c698978d5acc", "codigo": 220},
    {"party": "7751a906-2663-4156-96c3-4f133f6ab428", "codigo": 263}, {"party": "941915a8-1ba4-4fdb-841b-580aa7fbd881", "codigo": 271},
    {"party": "088e1d51-3c32-47ca-9986-12689918232e", "codigo": 359}, {"party": "f29014b2-61cd-4886-8c38-81dfb0242e60", "codigo": 418},
    {"party": "a9403c35-26d9-48e7-b693-bec52a223231", "codigo": 470}, {"party": "e89f74ef-98ff-4b1d-a4e1-783048fb7a37", "codigo": 502},
    {"party": "6bec7adc-6d7b-4698-be24-b5aa73e31756", "codigo": 521}, {"party": "1cdcdf48-ee29-439c-bf26-141dc7b704ea", "codigo": 630},
    {"party": "982629d9-7adf-43b1-a9af-3aacf2d1b1f6", "codigo": 697}, {"party": "06af3c1f-5a21-4ad4-bec7-cf69de4e3d46", "codigo": 701},
    {"party": "dffb7f63-f8e4-49e7-96b9-43e8cd121a33", "codigo": 724}, {"party": "2ddab084-df2d-469e-9725-c3c507175c86", "codigo": 742},
    {"party": "abf422e5-a0ff-4b76-869c-a8a2b50e3c6f", "codigo": 1013}, {"party": "c823f64f-6713-4082-a3aa-a53aa11b4c25", "codigo": 1264},
    {"party": "814ff88d-5a6c-41e0-b8ef-0a98a20694c8", "codigo": 1265}
  ]';
  r record; v_mal text[] := '{}';
begin
  if not exists (select 1 from public.company where id = v_empresa) then
    raise notice 'Q10 · 0652: esta base no tiene la empresa de QBO; no se ata nada.';
    return;
  end if;
  for r in select q.party, q.codigo, c.party_id is not null tiene_fila, c.codigo_cliente
             from jsonb_to_recordset(v_l) q(party uuid, codigo int) left join public.conta_cobro_cliente c on c.company_id = v_empresa and c.party_id = q.party loop
    if not r.tiene_fila then v_mal := v_mal || format('%s sin su fila', r.codigo); end if;
    if r.codigo_cliente is not null and r.codigo_cliente <> r.codigo then v_mal := v_mal || format('%s ya tiene el %s', r.codigo, r.codigo_cliente); end if;
  end loop;
  if cardinality(v_mal) > 0 then
    raise exception 'Q10 · 0652: las fichas no están como se midieron el 26/11 (%). No se ata ninguna.', array_to_string(v_mal, '; ');
  end if;
  for r in select q.party, q.codigo from jsonb_to_recordset(v_l) q(party uuid, codigo int) join public.conta_cobro_cliente c on c.company_id = v_empresa and c.party_id = q.party
            where c.codigo_cliente is null order by q.codigo loop
    perform public._conta_cegid_atar(v_empresa, r.party, r.codigo, 'a_mano', v_quien);
  end loop;
  raise notice 'Q10 · 0652: % fichas atadas a su cliente de Cegid.', (select count(*) from public.conta_cegid_atado where company_id = v_empresa and quien = v_quien);
end $fichas$;
