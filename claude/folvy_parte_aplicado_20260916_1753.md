# Parte — las cuatro aplicadas, con el antes y el después pegados

**16/09/2026, 17:53–18:01 (hora de la base).** Ventana nueva de Julio: miércoles,
las dos tiendas cerradas entre comida y cena, 0 pedidos en la última hora. La
regla de «desde las 23:45» queda anulada por él mismo.

**`list_migrations` antes de empezar:** la última era `20260916085716`, la mía de
esta mañana. La sesión 1 no había aplicado nada.

---

## Lo aplicado, con la versión que registró la base

| | versión | qué |
|---|---|---|
| 1 | `20260916155323` | `indice_sale_line_parent` |
| 2 | `20260916155554` | `parte_del_dia_descuadres_en_dos` |
| 3 | `20260916155658` | `parte_plataformas_tabla` |
| 4 | `20260916155814` | `parte_plataformas_pasada` |
| 4b | `20260916155908` | `parte_plataformas_propias_null_no_es_false` |
| 4c | `20260916160031` | `parte_plataformas_solo_escribe_si_algo_cambia` |

Los seis ficheros del repositorio llevan ya **esa** versión en el nombre
(regla 17). Las dos últimas salieron de probar contra el día de verdad, y están
contadas abajo.

---

## 1 · El índice — el antes y el después, misma vara

| lo medido | antes (17:56) | después (17:58) | |
|---|---|---|---|
| la consulta por `parent_sale_line_id` | **9,205 ms** | **0,181 ms** | ×51 |
| el cuadre entero del 15/09 | **5,154 s** | **0,261 s** | ×20 |
| `generate_sale_consumption` sobre G190 (27 movimientos) | **0,208 s** | **0,077 s** | ×2,7 |

El plan pasa de

```
Seq Scan on sale_line c (actual time=9.141..9.142 rows=0 loops=1)
  Rows Removed by Filter: 31615
```

a

```
Index Scan using idx_sale_line_parent on sale_line c (actual time=0.121..0.121 rows=0 loops=1)
  Index Cond: (parent_sale_line_id = '…')
```

Y **las cifras no se mueven**: 94 pedidos, 992 bien, 0 faltan, 5 retenidos, antes
y después. Solo cambia lo que tarda.

**La comprobación 6 del §5 queda CUMPLIDA:** 0,261 s contra un techo de 2 s.

*La medida de `generate_sale_consumption` se tomó sobre una venta real dentro de
una transacción revertida. Comprobado después: G190 sigue con sus 27
movimientos y el último escrito sigue siendo el del 15/09 a las 23:10. No se
escribió nada.*

---

## 2 · El parte con los descuadres en dos

Función y método **en la misma sentencia**, el 15/09: **trece de trece IGUAL.**

94 · 2.093,07 € · 2 anulados · 992 bien · 0 faltan · 5 retenidos · 0 · 0 · 0 ·
259 uds · 258 descuentan · 0 recuperables · 0 averías.

Y el 14/09: **37 se pueden recuperar, 0 averías**, en nueve pedidos (G120, G183,
G199, G616, G957, U968, U970, U973, U984). El primero por dinero, U973, enseña
qué se tocó después:

> Korean Fried Chicken and Fries 2.0 (KDB) · ficha (16/09 09:47) · Cebollino ·
> artículo (15/09 14:51) · Patatas Bastón · artículo (15/09 14:57) · Salsa
> Coreana · artículo (15/09 14:57) · Solomillo de Pollo Prefrito Piri-piri ·
> artículo (15/09 14:57)

---

## 3 · La tabla del cruce

Creada, con RLS encendida (`relrowsecurity = true`) y la política de lectura por
cuenta.

---

## 4 · La pasada — y las dos cosas que encontró la prueba

**Primera pasada** sobre el 15/09 y el 14/09: **145 filas, 145 claves
distintas**. Cedidas 72 + 44, propias 24 + 5.

Y el cruce ve lo que tiene que ver: **U977 del 14/09 sale como anulado en Last y
vivo en Folvy**. Es el que Julio dijo que estaba cayendo esta semana.

### 4b · Un NULL que no era false (`20260916155908`)

La primera pasada **abortó**:

```
ERROR: 23502: null value in column "anulado_plataforma" violates not-null constraint
Failing row: (…, hubrise, 3qq6pj3, …, G800, t, t, null, f, …)
```

Un pedido de HubRise **sin ningún aviso de estado** dejaba `anulado_plataforma`
en NULL, porque `null in ('cancelled','rejected')` es **NULL**, no false.

Dos cosas que decir de esto:

- **Lo cazó la población real.** Con ejemplos inventados habría pasado en verde
  y habría salido a producción (regla 31). El día de verdad tenía el caso.
- **El NOT NULL hizo su trabajo:** la pasada abortó **entera**. Comprobado
  después del fallo: la tabla estaba a **0 filas**, no a medias.

### 4c · «Pasada dos veces» ahora es literal (`20260916160031`)

La segunda pasada no duplicaba nada —145 filas, 145 claves— pero **reescribía
las 145** para dejarlas exactamente igual, porque el `on conflict do update`
siempre tocaba `updated_at`. Eso no es lo que pide la comprobación, y además
hace que el número que devuelve la pasada no signifique nada.

Ahora solo escribe si algo cambia de verdad. **Medido: tercera pasada = 0 y 0.**
A partir de ahora, un número distinto de cero en una pasada posterior quiere
decir que ha cambiado algo (regla 8).

---

## Lo que queda

- **HubRise:** `orders.read` commiteado y **sin desplegar**. Los pasos de persona
  para mañana de 09:00 a 11:30 están en
  `claude/folvy_parte_paso3_hubrise_y_la_noche_20260916.md` §3.
- **El aviso de las 08:30** (§3.4) y **la foto histórica** (§3.5): sin empezar.
- **El reproceso ampliado** (§3.2): sin empezar, y ya tiene con qué ensayarse —
  los 37 del 14/09.
- **La pantalla** (§4): espera a la maqueta.
