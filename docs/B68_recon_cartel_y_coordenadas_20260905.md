# B68 · RECON antes de tocar el cartel — y por qué me paro

**05/09/2026, 01:30 Madrid.** El §0 del encargo pide decirlo si el cartel sale de un
sitio compartido. Sale de uno, y es peor que compartido.

## 1 · El cartel NO está en la web

Lo escribe **`resolve_dispatch`**, una función `SECURITY DEFINER` de Postgres. El propio
`ordersFeedService.ts` lo dice en su comentario:

> «El motivo lo escribe el resolutor, no esta función: si algún día cambia la regla, el
> mensaje cambia con ella y no hay dos textos que mantener.»

Así que la restricción «es la web, no toca base» **no se sostiene para el §1**. Arreglar
la frase es cambiar una función de la base.

## 2 · Y esa función escribe OCHO motivos, no uno

```
'venta no encontrada'
'marca sin reparto propio (interruptor apagado)'
'sin dirección: este pedido no lo repartimos nosotros'   ← el que hay que cambiar
'sin regla -> broker por defecto (X)'
'regla N sin cadena -> broker por defecto'
'regla N -> propio (N en turno, X km)'
'regla N -> X (cadena)'
'regla N -> cadena agotada; broker por defecto (X)'
```

Es exactamente el «no quiero arreglar una frase y cambiar cinco» del encargo.

## 3 · Y no es sólo un cartel: es la guarda del despacho automático

Quién la llama:

| quién | qué es | cada cuánto |
|---|---|---|
| `tg_auto_dispatch` | **trigger** sobre `sale` | en cada pedido |
| `dispatch_watchdog_scan` | cron `dispatch-watchdog` | **cada 3 minutos** |
| `resolveDispatch` / `dispatchOrder` | la web | al pulsar |

O sea: **tocar el texto es tocar el camino vivo de pedidos**, no la web. Con Alcalá
repartiendo. Por eso paro aquí y no lo cambio por mi cuenta.

### Lo que propongo, para que sea un sí o un no

Cambiar **sólo la rama de la dirección**, dejando las otras siete intactas y sin mover
ni una línea de la lógica de despacho:

```sql
-- lo único que cambia dentro del IF que ya existe
RETURN QUERY SELECT NULL::text,
  ('sin dirección de entrega: ' || coalesce(canal, 'la plataforma') ||
   ' no la ha enviado')::text;
```

La red de seguridad se queda igual: sin dirección sigue sin haber despacho automático.
Lo que se cae es **la afirmación sobre quién reparte**, que es lo que este pedido tumba.

## 4 · La mina que apareció al mirar, y que no estaba en el encargo

`resolve_dispatch` saca las coordenadas de `raw_tab->'delivery'->>'latitude'`. Medido a
30 días en Foodint:

| pasarela | pedidos | coords en `delivery` | coords en `customer` |
|---|---|---|---|
| Last.app | 265 | **265** | 0 |
| HubRise | 148 | **0** | 138 |

**Para ningún pedido de HubRise se calcula la distancia.** Hoy no rompe nada, porque no
hay ni una `dispatch_rule` activa con `max_distance_km` (comprobado: 0). Pero el día que
alguien ponga un límite de kilómetros, se aplicará a Last.app y **se saltará en silencio
en los 148 de HubRise**. Es la misma raíz que el §2: las coordenadas están donde nadie
las busca.

No lo he tocado. Es una decisión aparte y merece su propio encargo.

## 5 · La métrica del §3 — hecha, y tu número era el bueno

`metrica_direcciones_de_reparto(p_account_id, p_dias)`. Sólo lee, sin aviso ni umbral.

| pasarela | canal | reparto propio | sin dirección | % | coords `delivery` | coords `customer` |
|---|---|---|---|---|---|---|
| hubrise | Glovo | 148 | 24 | **16,2 %** | 0 | 125 |
| hubrise | Just Eat | 13 | 2 | 15,4 % | 0 | 13 |
| lastapp | glovo | 247 | 1 | **0,4 %** | 247 | 0 |
| lastapp | justeat | 18 | 0 | 0 % | 18 | 0 |
| folvy_shop | — | 1 | 0 | 0 % | 0 | 0 |

**HubRise: 161 · 26 · 3.** Clavado a lo que decía el encargo.

Mi primer recuento dio 427 / 27 / 4 y **ninguno de los dos estaba mal**: yo contaba todo
el reparto propio y tú sólo lo que entra por pasarela. Los «uno de más» son G569, que
entró a las 00:44 — después de que tú contaras.

El corte va por `source` y no sólo por canal **porque el mismo canal entra por dos
puertas**: 0,4 % contra 16,2 % en el mismo Glovo. Esa diferencia es el caso contra
HubRise, y ya se ve sin esperar a la serie.

### Un fallo mío por el camino

La primera versión filtraba por `belongs_to_account(s.account_id)` y devolvía **cero
filas** a cualquiera sin sesión de navegador: ni un informe, ni un cron, ni yo podíamos
leerla. Una métrica que sólo se ve desde el navegador no sirve para decidir si se abre un
ticket. Ahora la cuenta se pasa explícita y se comprueba el permiso, como
`sales_mapping_reliability`. DROP + CREATE, no REPLACE, porque cambia la firma (regla 2).

## 6 · Lo que queda parado, esperando tu palabra

- **§1** el texto del cartel — bloqueado por el punto 3.
- **§1** el botón «Abrir en el portal» — es web pura, no depende del resolutor.
- **§2** enseñar el punto etiquetado como aproximado — web pura.
- **§2** despacho manual sólo con el punto — **depende del resolutor**: `dispatchOrder`
  pregunta primero a `resolve_dispatch` y aborta si dice que no. Sin tocarlo, no hay
  despacho manual con coordenadas.

Con un «adelante» hago los cuatro en un commit de web y uno de base, separados.
