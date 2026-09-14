# La vara de ANTES del Pase · tomada el 14/09/2026, con `pase_activo` en `false`

**Para qué es esto.** El Pase existe para que la entrega se cierre de verdad. El
día que se encienda, esta es la cifra contra la que se compara — y **una vara
tomada después de encender no vale para nada** (regla 33: la misma vara a los
dos lados).

Tomada con los tres locales **apagados**. Ocho semanas completas, sin la semana
en curso, que está a medias y estropearía el promedio.

## La consulta, para repetirla idéntica en octubre

```sql
select date_trunc('week', s.sold_at at time zone 'Europe/Madrid')::date as semana,
       l.name as local,
       count(*)                                                    as propios,
       count(*) filter (where s.delivered_at is not null)          as con_entrega,
       round(100.0 * count(*) filter (where s.delivered_at is not null) / count(*), 1) as pct,
       count(*) filter (where s.ready_at is not null)               as con_sello
  from sale s join locations l on l.id = s.location_id
 where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and s.service_type = 'own_delivery'
   and s.sold_at >= (date_trunc('week', now() at time zone 'Europe/Madrid') - interval '8 weeks')
   and s.sold_at <  date_trunc('week', now() at time zone 'Europe/Madrid')
 group by 1, 2 order by 1, 2;
```

`sold_at` está en UTC y se convierte a `Europe/Madrid` antes de agrupar por
semana (regla 4). Sin la conversión, los pedidos de 00:00 a 02:00 del lunes caen
en la semana anterior: es la explicación más probable de las diferencias de ±1
con las cifras del parte del PM, que no cuadraban en dos semanas de quince.

## El resultado · reparto propio con `delivered_at`

| semana | **Alcalá** | **Carabanchel** |
|---|---|---|
| 20/07 | 32 de 87 · **36,8 %** | 0 de 24 · **0 %** |
| 27/07 | 87 de 88 · **98,9 %** | 0 de 2 · 0 % |
| 03/08 | 60 de 61 · **98,4 %** | 0 de 13 · 0 % |
| 10/08 | 80 de 84 · **95,2 %** | 0 de 29 · 0 % |
| 17/08 | 73 de 78 · **93,6 %** | 0 de 16 · 0 % |
| **24/08** | 63 de 87 · 🔴 **72,4 %** | 8 de 10 · 80,0 % |
| 31/08 | 89 de 99 · **89,9 %** | 18 de 20 · 90,0 % |
| 07/09 | 97 de 102 · **95,1 %** | 25 de 29 · 86,2 % |

## 🔴 Dos cosas que el total escondía, y son distintas

El agregado de los dos locales daba «se pierde una de cada cuatro entregas en
agosto». **Ese número no es de nadie** (regla 9, en su versión por local).
Partido, son dos fenómenos que no tienen nada que ver:

**1 · Carabanchel no escribía la entrega, en absoluto.** Cero de 84 pedidos
propios entre el 20/07 y el 17/08 — y no es que fallara a veces: es un cero
limpio durante cinco semanas. **Y el sello sí funcionaba**: 8 de 13, luego 28 de
29, luego 16 de 16. O sea que la cocina marcaba y la entrega no se cerraba
nunca. Empieza a escribirla la semana del 24/08.

Casi toda la «pérdida de agosto» del total era esto.

**2 · Alcalá tuvo una caída de verdad la semana del 24/08**: del 93,6 % al
**72,4 %**, 24 pedidos sin cerrar en una semana. No es Carabanchel: Alcalá tenía
el sello al 96,6 % esa misma semana, así que se marcó listo y no se cerró la
entrega. Se recupera al 89,9 % y al 95,1 %. **Sin explicación; no la invento.**

## Lo que NO dice esta vara

- No dice por qué mejora en septiembre. Coincide con que Carabanchel empieza a
  escribir, pero coincidir no es explicar.
- No mide la otra mitad del encargo —los 185 clientes que vieron «entregado» sin
  mapa— que se mide con `order_status='completed'` antes de `delivered_at`, no
  con esto.
- Es de Foodint y sólo de Foodint. Con el cliente 2 dentro habrá que decir de
  qué cuentas es cada cifra (regla 9).
