# V02d · Paso 1 · Los 17 avisos de Foodint, uno a uno (25/10/2026)

Solo lectura en producción. Las fuentes salen de `conta_puerta_fuentes`
(Foodint, empresa `658728c0…`). Los avisos son los de la pantalla:
`loQueFalta` del front con fecha 25/10. Da **17 en rojo** y 5 «aún a tiempo».
Todas las cifras llevan `account_id` de Foodint (regla 9).

## Lo que hay en la base, medido

- **Libro de recibidas traído de Diez** (`source_type = migrated`): 1.212
  apuntes, del 01/06 al **30/09**. **Ninguno de octubre.**
- **Lo que ha entrado en Sumied desde el 01/10**: 83 facturas de riders (lote
  de Catcher del 15/10) y 11 leídas por OCR (Coheldi, Europastry, Olimpo).
  Ninguna factura de alquiler, suministros, plataformas ni software.
- **Fecha de corte de la empresa** (`bank_settings.cutover_date`): **01/10/2026**.
  Lo de antes lo lleva Diez.

## La tabla

| # | Quién · qué espera | Por qué cree que falta | Qué hay de verdad en la base | ¿Verdadero? · causa |
|---|---|---|---|---|
| 1 | Tspoonlab · Factura de septiembre · «54 días tarde» | Espera el día 1 de cada mes. Toma el 30/09 como la llegada de octubre, y la de septiembre (01/09) se queda sin pareja. | Facturas de 217,80 € el día 1 de cada mes, de enero a agosto. **No hay factura de septiembre.** El 30/09 hay **tres abonos de −217,80 €** (CN260340, 41 y 42). | **Falso.** Cuenta los abonos como si fueran facturas, y pide un periodo de antes del corte, que es de Diez. **Pregunta para Julio:** ¿Tspoonlab sigue? Tres abonos que devuelven tres meses parecen una baja. |
| 2 | Alquiler de Camichi 4 · octubre · «24 días tarde» | Espera el día 1; la última llegó el 01/09. | El alquiler de octubre no está en Sumied. Desde el 01/10 no ha entrado ninguna factura de alquiler. | **Verdadero.** No ha llegado a Sumied. |
| 3 | Alquiler de Cañaveral 75 · octubre · «faltan 3 de 3» · 24 días | Lo mismo, para las tres propietarias. | Igual: las de septiembre están (01/09) y las de octubre no. El local está marcado inactivo en Sumied, pero facturó hasta septiembre. | **Verdadero.** No ha llegado. |
| 4 | Uber · semana del 28/09 al 04/10 · «21 días tarde» | Semanal, cierra el domingo. | Del 10/08 al 04/10 no hay **ninguna** liquidación semanal de Uber, salvo una de Scandal Burgers que junta del 07/09 al 18/10 (1 pedido). Las semanas del 05–11/10 y del 12–18/10 sí están. | **Verdadero.** No ha llegado, y esa semana lleva ventas del 1 al 4 de octubre. |
| 5 | Last Systems · Factura de octubre · «20 días tarde» | Espera el día 5. | La última es la del 05/08 (423,50 €). La de octubre no está en Sumied, y **la de septiembre tampoco está en el libro de Diez**. | **Verdadero.** Y además le falta a Diez la de septiembre. |
| 6 | Nóminas de QBO · septiembre · «20 días tarde» | Espera el día 5. | Las últimas llegaron el 04/08 (6) y el 09/07 (7). | **Verdadero.** El reenvío está roto (respuesta 2 del V02, «Laboral»). |
| 7 | Glovo (facturas de comisión) · «la siguiente factura» · 15 días | Aprendida como «varias al mes, cada 10 días»: la última del 30/09 + 10 = 10/10. | Glovo factura los días **15 y fin de mes** (de 10 a 20 facturas cada vez, del 31/07 al 30/09). La del 15/10 no está en Sumied. | **Verdadero en el fondo, mal contado.** Falta la del 15/10 (10 días), no «15 días». Causa: cadencia mal aprendida. |
| 8 | Just Eat (facturas de comisión) · «la siguiente factura» · 15 días | Lo mismo. | También días 15 y fin de mes. La del 15/10 no está. | **Verdadero, mal contado.** La misma causa. |
| 9 | Nobleza Vacuna · «la siguiente factura» · 15 días | «Varias al mes, cada 10»: el 31/07 llegaron tres a la vez. | Factura **a fin de mes** (31/07, 31/08, 30/09). La de octubre toca el 31/10. | **Falso.** Cadencia mal aprendida: tres facturas del mismo día contaron como «varias al mes». |
| 10 | Portier · «la siguiente factura» · 15 días | «Varias, cada 10». | Factura casi cada martes. La última es del 30/09 y no hay ninguna de octubre en Sumied. | **Verdadero.** «Cada 10» es aproximado; es semanal. |
| 11 | Cloudtown · «la siguiente factura» · 12 días | «Varias, cada 10». | Factura a **primeros de mes** (3–6/07, 4–5/08, 3/09). La de octubre no está en Sumied. | **Verdadero, mal fechado.** Falta desde el ~04/10 (21 días), no desde el 13/10. Causa: cadencia. |
| 12 | Glovo · liquidación del 1 al 15 de octubre · 10 días | Quincenal. | La última liquidación de Glovo en Sumied es del **30/06**. Julio, agosto, septiembre y octubre no están. | **Verdadero.** Es la entrega 2 (liquidaciones). |
| 13 | Just Eat · liquidación del 1 al 15 de octubre · 10 días | Quincenal. | Igual: la última es del 30/06. | **Verdadero.** Entrega 2. |
| 14 | Extracto BBVA ···0133 · del 13 al 19 de octubre · 6 días | Un extracto cada semana. Mira **el día en que se subió** (15/10 y 23/10), y los dos quedan a más de 3 días del 19. | El subido el 23/10 cubre **del 29/07 al 21/10**. | **Falso.** Mira cuándo se subió, no qué fechas cubre. |
| 15 | Extracto BBVA ···4525 · del 13 al 19 · 6 días | Lo mismo. | El del 23/10 cubre del 15/10 al **20/10**. | **Falso.** La misma causa. |
| 16 | Extracto · Cuenta principal · del 13 al 19 · 6 días | Lo mismo. | El del 23/10 cubre del 15/10 al **22/10**. | **Falso.** La misma causa. |
| 17 | Iberdrola · «la siguiente factura» · 6 días | «Varias, cada 10» (varios suministros). | La última es del 29/09. Ninguna de octubre en Sumied. | **Verdadero.** |

**Resumen: 12 verdaderos (3 de ellos mal contados en días) y 5 falsos**
(Tspoonlab, Nobleza Vacuna y los tres extractos).

De los 12 verdaderos, 9 son lo mismo: desde el 01/10, las facturas de
proveedores, alquileres y suministros no se están metiendo en Sumied. Diez
llega hasta el 30/09. Las otras tres son las liquidaciones de Glovo y de Just
Eat (sin ninguna desde junio, entrega 2) y las nóminas (el reenvío roto).

## Las causas, que es lo que se arregla (paso 2)

1. **Los abonos cuentan como llegadas.** Un importe negativo (los CN de
   Tspoonlab, el «-ANUL» de Last) no es la factura del mes. → No cuentan.
2. **Los extractos se miran por el día de subida, no por las fechas que
   cubren.** → Un extracto cubre la semana si su periodo la cubre.
3. **La cadencia se aprende contando facturas, no días.** Varias facturas el
   mismo día son una llegada; «15 y fin de mes» es quincenal; una vez al mes,
   aunque baile entre el 3 y el 6, es mensual. → Se aprende por días, y lo ya
   apuntado que nadie ha tocado se vuelve a aprender.
4. **Se piden periodos de antes del corte.** Lo de antes del 01/10 es de
   Diez. → Sumied no lo pide.

Lo que no se arregla, porque es verdad: lo de octubre que no ha llegado a
Sumied se queda como aviso.
