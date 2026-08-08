-- Aplicada: 2026-08-08 por MCP.
-- Estacionalidad mensual medida sobre 60.000 pedidos reales (feb-2023 -> mar-2026,
-- 36 meses completos) de las 3 cocinas de Madrid, marcas cedidas.
-- METODO: serie de pedidos/dia por mes -> media movil centrada de 12 meses para RETIRAR
-- la tendencia de crecimiento (el negocio paso de ~700 a ~2.500 pedidos/mes; sin
-- desestacionalizar, los meses tardios parecian temporada alta solo por el crecimiento)
-- -> ratio real/tendencia -> media por mes -> normalizado a media 1.
--
-- MEZCLA: no se sustituye en bloque. w = confianza segun nº de observaciones y dispersion.
--   w=0,80 Ago (n=3, consistente)
--   w=0,75 Nov, Jul, Jun, Feb, Ene (n=2, dispersion baja)
--   w=0,60 Abr, Dic (n=2, dispersion media)
--   w=0,40 Mar, May, Sep (n=2, dispersion alta) y Oct (n=1)
-- prior_nuevo = w*medido + (1-w)*prior_anterior
--
-- HALLAZGO PRINCIPAL: el prior anterior situaba el maximo en mar-may; el maximo real es
-- NOVIEMBRE (1,40) y octubre estaba infraestimado un 25%. Noviembre mueve el DOBLE que agosto.
--
-- LIMITE DECLARADO: son cedidas de 3 locales de Madrid. Vale como prior; el dato propio
-- lo desplaza segun se acumula (ponderacion n/(n+6) de team_demand_coefficients).

UPDATE public.demand_prior AS dp SET
  idx = v.nuevo,
  sample_days = v.n_meses,
  updated_at = now()
FROM (VALUES
  (1,  0.854, 0.75, 2), (2,  0.923, 0.75, 2), (3,  1.050, 0.40, 2),
  (4,  1.085, 0.60, 2), (5,  1.062, 0.40, 2), (6,  0.983, 0.75, 2),
  (7,  0.826, 0.75, 2), (8,  0.698, 0.80, 3), (9,  0.813, 0.40, 2),
  (10, 1.148, 0.40, 1), (11, 1.400, 0.75, 2), (12, 1.157, 0.60, 2)
) AS s(mes, medido, w, n_meses)
CROSS JOIN LATERAL (
  SELECT ROUND((s.w * s.medido
              + (1 - s.w) * (SELECT d2.idx FROM public.demand_prior d2
                              WHERE d2.business_type='dark_kitchen'
                                AND d2.dim='month' AND d2.key = s.mes))::numeric, 3) AS nuevo,
         s.n_meses AS n_meses
) v
WHERE dp.business_type = 'dark_kitchen' AND dp.dim = 'month' AND dp.key = s.mes;

DO $g$
DECLARE v_ago numeric; v_nov numeric;
BEGIN
  SELECT idx INTO v_ago FROM public.demand_prior
   WHERE business_type='dark_kitchen' AND dim='month' AND key=8;
  SELECT idx INTO v_nov FROM public.demand_prior
   WHERE business_type='dark_kitchen' AND dim='month' AND key=11;
  IF v_ago IS NULL OR v_nov IS NULL OR v_nov <= v_ago THEN
    RAISE EXCEPTION 'demand_prior no quedo coherente (ago=%, nov=%)', v_ago, v_nov;
  END IF;
END $g$;
