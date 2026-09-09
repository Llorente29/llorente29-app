# Deuda · funciones vivas cuyo cuerpo actual no está en el repositorio

**09/09/2026 · abierta · regla 1**

Julio, tras aplicar `20260909145156`:

> «Anota como deuda lo que dijiste: el cuerpo vivo de `db_health_watchdog` no
> está en el repo. Hay al menos una función de producción cuya única copia está
> en la base. Eso es regla 1 y hoy no ha mordido de milagro.»

Queda anotada. Y con una corrección importante sobre cómo se mide.

---

## El caso concreto

`public.db_health_watchdog()` es el segundo emisor de la cola de alertas y corre
por `pg_cron`. Su cuerpo ha ido cambiando por **reemplazo por ancla** —una
técnica que reescribe un trozo del cuerpo vivo sin transcribir el resto— y por
ediciones a mano. Ninguna de esas pasadas dejó en el repositorio un `CREATE`
completo con el cuerpo resultante.

Consecuencia práctica: si hoy se pierde la base, o alguien aplica encima un
fichero antiguo del repo, **el cuerpo vivo no se puede reconstruir**. Cada
migración de ancla del repo describe un DELTA, no el estado.

Hoy no ha mordido porque nadie ha reaplicado nada viejo encima. Eso es suerte,
no diseño.

## Y aquí está lo que hay que decir, porque cambia cómo se busca

**Buscar el NOMBRE en el repositorio no detecta este problema.** Medido:

```
funciones vivas en `public` (sin las de extensiones) .............. 690
nombres con al menos un `CREATE FUNCTION` en supabase/migrations/ . 656
```

Tentador concluir «faltan 34». Es una conclusión falsa, y el contraejemplo es
justo el caso que abre esta deuda:

```
db_health_watchdog  →  aparece en CUATRO migraciones del repo
                       20260811092549, 20260811095407,
                       20260811151719, 20260816T0902
```

Pasa el barrido por nombre con nota alta, y aun así su cuerpo vivo no está en
ninguna de las cuatro: las cuatro son anteriores a los avisos 4, 5 y 6 tal como
existen hoy. **El barrido por nombre mide si la función nació en el repo, no si
lo que corre hoy está en él.** Son dos preguntas distintas y sólo la segunda
importa.

Así que los «34» de arriba son un **suelo**, no la deuda: son las que no
aparecen ni una vez. La deuda real es ≥ 34 y no se sabe cuánto más.

## La medición que sí valdría, y lo que cuesta

Para cada función viva: coger la ÚLTIMA migración del repo que la define
entera, extraer el cuerpo entre sus delimitadores, normalizar igual a los dos
lados (comentarios fuera, espacios colapsados) y comparar `md5` contra
`pg_proc.prosrc`. Tres resultados posibles:

| resultado | significa |
|---|---|
| md5 idéntico | el repo tiene lo que corre |
| md5 distinto | el repo tiene una versión vieja — **deuda** |
| sin `CREATE` completo | sólo hay deltas o nada — **deuda** |

Es la misma vara a los dos lados (regla 31), y es exactamente lo que se hizo a
mano con `20260909145156`: predecir la huella antes y medirla después. Lo que
falta es hacerlo para las 690 en vez de para una.

No es trabajo de una tarde: hay que resolver qué migración es «la última que la
define entera» cuando el mismo nombre aparece en cuatro ficheros con firmas
distintas, y hay que normalizar los `$tag$` y los `\r\n` (hay funciones vivas
con saltos de Windows dentro — `is_brand_open` es una).

**No se empieza sin que Julio lo pida.** Va aquí escrito para que exista el
número el día que se decida, y para que nadie mientras tanto dé por buena la
resta 690 − 656.

## Mientras tanto, lo que sí se puede hacer sin proyecto

1. **Toda migración de ancla deja escrito el md5 y la longitud del cuerpo
   resultante** — ya se hace desde `20260909145156`. No devuelve el cuerpo al
   repo, pero convierte «no sé qué corre» en «sé exactamente qué corre».
2. **Cuando una función de ancla se vuelva a tocar, sacarla del ciclo**:
   escribir su `CREATE OR REPLACE` completo una vez, con el cuerpo vivo entero,
   y a partir de ahí ya vive en el repo. Para `db_health_watchdog` son 10.907
   caracteres — se paga una vez.
3. **El vigía de deriva de edge functions (`edge-drift-watchdog`) no cubre esto.**
   Compara lo desplegado contra el repo para *edge functions*; las funciones SQL
   no tienen equivalente. Que exista uno es la misma deuda vista de perfil.

---

**Estado:** abierta. Sin fecha. No bloquea nada hoy.
