# La vara de ANTES del Pase · tomada el 14/09/2026, con `pase_activo` en `false`

**Para qué es esto.** El día que el Pase se encienda, ésta es la cifra contra la
que se compara. Una vara tomada después de encender no vale para nada
(regla 33: la misma vara a los dos lados). Tomada con los tres locales
**apagados**, ocho semanas completas, sin la semana en curso — que está a medias
y estropearía el promedio.

---

## 🔴 LO PRIMERO: son DOS números, y juntarlos engaña

La primera versión de este documento medía uno solo: «% de reparto propio con
`delivered_at`». Ese número mezcla dos cosas que no tienen nada que ver, y
**sólo una de las dos la puede mover el Pase**:

| | qué mide | dónde está hoy | ¿lo mueve el Pase? |
|---|---|---|---|
| **1 · cierre de la flota** | de los pedidos que un repartidor COGIÓ, cuántos acaban con hora de entrega | **97–100 %** desde el 27/07 | **NO.** Ya va bien. Se mide como guardia: si baja, el Pase ha roto algo |
| **2 · pedidos que nadie coge** | reparto propio que nunca llega a un repartidor | **4 %** la última semana, **25 % la del 24/08** | **SÍ.** Es la zona «Nuestro, y todavía no lo ha cogido nadie» |

**Si se usa el número agregado, dentro de un mes el Pase se apuntará una mejora
del 75 % al 99 % que no ha hecho** — sería el Pase cobrándose que a Carabanchel
le enchufaron la flota el 24/08. **No se reconstruya ese número.**

## La definición de «lo cogió alguien», y por qué ésta

`sale.has_courier`. Se comprobó contra las otras dos candidatas, semana a semana:

- `has_courier` y `rider_name is not null` dan **el mismo número en las ocho
  semanas**, sin una excepción.
- `carrier_code is not null` **NO**: coincide en seis de ocho y se separa justo
  en la semana del sello (20/07), donde da **82** frente a **73**. Son nueve
  pedidos con transportista nombrado y **nadie que los cogiera**.

Un transportista nombrado no es un repartidor que se lo lleva. La pregunta que
contesta esta vara es «de lo que alguien cogió, cuánto se cierra», así que el
denominador es quien lo coge. *(Con `carrier_code` la semana del 20/07 sale
39,0 % en vez de 43,8 %: la misma semana, dos poblaciones, dos cifras.)*

---

## Las dos consultas, para repetirlas idénticas en octubre

```sql
-- Las dos salen de aquí: `pct_cierre_flota` es el número 1 y `pct_sin_coger` el 2.
select date_trunc('week', s.sold_at at time zone 'Europe/Madrid')::date as semana,
       l.name                                                          as local,
       count(*)                                                        as propios,
       count(*) filter (where s.has_courier)                           as cogidos,
       count(*) filter (where s.has_courier and s.delivered_at is not null) as cerrados,
       case when count(*) filter (where s.has_courier) = 0 then null
            else round(100.0 * count(*) filter (where s.has_courier and s.delivered_at is not null)
                             / count(*) filter (where s.has_courier), 1) end as pct_cierre_flota,
       count(*) filter (where not coalesce(s.has_courier, false))      as nadie_los_cogio,
       round(100.0 * count(*) filter (where not coalesce(s.has_courier, false))
                   / count(*), 1)                                      as pct_sin_coger
  from sale s join locations l on l.id = s.location_id
 where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and s.service_type = 'own_delivery'
   and s.sold_at >= (date_trunc('week', now() at time zone 'Europe/Madrid') - interval '8 weeks')
   and s.sold_at <  date_trunc('week', now() at time zone 'Europe/Madrid')
 group by 1, 2 order by 2, 1;
```

`sold_at` está en UTC y se convierte a `Europe/Madrid` ANTES de agrupar por
semana (regla 4). Sin la conversión, los pedidos de 00:00 a 02:00 del lunes caen
en la semana anterior.

---

## Número 1 · cierre de la flota — **la guardia**

| semana | Alcalá | Carabanchel |
|---|---|---|
| 20/07 | 32 de 73 · 43,8 % *(la semana del sello)* | — *(sin flota)* |
| 27/07 | 87 de 87 · **100 %** | — |
| 03/08 | 60 de 60 · **100 %** | — |
| 10/08 | 80 de 81 · **98,8 %** | — |
| 17/08 | 73 de 74 · **98,6 %** | — |
| 24/08 | 63 de 65 · **96,9 %** | 8 de 8 · **100 %** |
| 31/08 | 89 de 90 · **98,9 %** | 18 de 18 · **100 %** |
| 07/09 | 97 de 98 · **99,0 %** | 25 de 27 · 92,6 % |

**Desde el 27/07 la flota cierra entre el 96,9 % y el 100 % de lo que coge.**
El Pase no tiene nada que mejorar aquí. Si en octubre esto baja, el Pase ha roto
algo — para eso se mide.

## Número 2 · pedidos que nadie coge — **la promesa del Pase**

| semana | Alcalá | Carabanchel |
|---|---|---|
| 20/07 | 14 de 87 · 16,1 % | 24 de 24 · **100 %** |
| 27/07 | 1 de 88 · 1,1 % | 2 de 2 · **100 %** |
| 03/08 | 1 de 61 · 1,6 % | 13 de 13 · **100 %** |
| 10/08 | 3 de 84 · 3,6 % | 29 de 29 · **100 %** |
| 17/08 | 4 de 78 · 5,1 % | 16 de 16 · **100 %** |
| **24/08** | 🔴 **22 de 87 · 25,3 %** | 2 de 10 · 20,0 % |
| 31/08 | 9 de 99 · 9,1 % | 2 de 20 · 10,0 % |
| 07/09 | 4 de 102 · **3,9 %** | 2 de 29 · 6,9 % |

**Carabanchel no tenía flota hasta el 24/08.** 84 pedidos marcados como reparto
propio entre el 20/07 y el 17/08, **cero con repartidor**. Alguien los llevó; la
flota no. El 24/08 aparecen a la vez carrier, repartidor, estado, handoff y
entrega: de cero a ocho. **No es que «empezara a escribir la entrega»: es que se
enchufó la flota.**

**Y la caída de Alcalá del 24/08 tampoco era de cierre.** De 87 propios, sólo 65
llegaron a un repartidor; de esos 65 cerraron 63 — el 96,9 %, en línea con el
resto. **Los 22 que faltaban nunca tuvieron a nadie.** Sin explicación de por qué
esa semana; no se inventa.

---

## Lo que esta vara NO dice

- **No explica la mejora de septiembre.** Coincide con que Carabanchel estrena
  flota. Coincidir no es explicar.
- **No mide la otra mitad del encargo** —los 185 clientes que vieron «entregado»
  sin mapa—, que se mide con `order_status = 'completed'` antes de
  `delivered_at`, no con esto.
- **Es de Foodint y sólo de Foodint.** Con el cliente 2 dentro habrá que decir de
  qué cuentas es cada cifra (regla 9).
- **No dice cuántos de los «sin coger» acabaron bien.** Alguien los llevó. Lo que
  no hay es rastro de quién ni de cuándo llegaron.
