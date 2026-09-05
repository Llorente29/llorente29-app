# Inventario: qué se aplicó a producción y qué guarda el repo

**05/09/2026.** Auditoría completa de `supabase_migrations.schema_migrations`
contra `supabase/migrations/` en `main`, migración a migración.

---

## Por qué se hizo

El 05/09 dije «876 migraciones en el repo» junto a «373 filas en la base», como
si fueran la misma unidad. **No lo son:** 876 era un conteo de FICHEROS. Julio
no lo dejó pasar — «una diferencia de 500 no se deja sin explicar» — y al
medirlo en serio apareció algo bastante peor que un recuento mal planteado.

Y una acotación que también toca: el 05/09 dije «31 de 31, ninguna migración
viva fuera del repo». Era cierto **solo para las de 02/09 en adelante**, que es
lo que había comprobado. Dicho sin ese alcance, era demasiado ancho.

## Método

Para cada una de las 373 migraciones registradas:

1. **Exacto:** `md5(array_to_string(statements, E'\n'))` contra el md5 de los
   bytes de cada uno de los 877 ficheros de `main`.
2. **Por código:** el mismo md5 quitando líneas de comentario, comentarios de
   cola, el envoltorio `begin;`/`commit;` y todo el espacio en blanco. Esto
   distingue «el fichero es otra cosa» de «el fichero es lo mismo con la
   cabecera que explica por qué».

El segundo pasa importa: sin él salían 182 «sin fichero», y **la mitad era ruido
de mi propio comparador** — comentarios de cola y puntos y coma sueltos.

## El cuadro, antes de tocar nada

| | migraciones | qué significa |
|---|---|---|
| Fichero byte a byte idéntico | **23** | nada que hacer |
| Fichero con el mismo código, distinta documentación | **160** | nada que hacer: la versión documentada es mejor |
| Sin ningún fichero que case | **184** | → 175 sin fichero alguno · 9 con fichero de su versión |
| `statements` **NULL** | **6** | no se puede reconstruir. Ver abajo |
| **Total** | **373** | |

> **Estas cifras corrigen las que di en el chat (46 / 137).** Aquellas comparaban
> el md5 de los bytes exactos de la base contra el md5 de los ficheros **con el
> salto final recortado**: dos reglas distintas a cada lado. Medido con la misma
> regla en los dos, el punto de partida era peor de lo que dije: **23**, no 46.

Las 877 – ~500 de diferencia se explican aparte: el repo empieza el **26/05** y
el registro de migraciones el **12/07**. Todo lo anterior a esa fecha es fichero
sin fila. Eso sí era normal; lo que no lo era es el sentido contrario.

## Lo que hace este commit

**175 ficheros nuevos**, reconstruidos desde `statements`, con el nombre que les
corresponde (`<version>_<name>.sql`) y **byte a byte** lo que se ejecutó.
802.727 bytes. Cada uno verificado con su md5 completo antes de escribirse; 175
de 175 cuadran, cero fallos.

**3 ficheros reemplazados.** De los 9 que tenían fichero de su versión sin
casar, 6 eran diferencias de comentario o de envoltorio y **se dejan como
están** (la versión documentada gana). Los otros 3 son otra cosa:

| fichero | qué guardaba el repo | qué se aplicó |
|---|---|---|
| `20260827163054_hubrise_street_line_glovo_house_number` | volcado de `pg_get_functiondef` (delimitadores `$function$`), **sin el `COMMENT ON FUNCTION`** | `CREATE FUNCTION` + su `COMMENT` |
| `20260827175746_hubrise_street_line_admite_rangos_de_portal` | volcado equivalente | idem |
| `20260827163135_adapt_hubrise_order_usa_hubrise_street_line` | la función **entera** ya editada, 318 líneas | un `DO $do$` de 20 líneas que hace cirugía de fragmento |

Los tres tienen la misma historia: **el repo guardaba el estado final, no la
migración que corrió**. Un directorio de migraciones guarda migraciones; el
volcado se regenera con `pg_get_functiondef` cuando haga falta.

## Después de este commit

| | antes | ahora |
|---|---|---|
| Con fichero byte a byte idéntico | 23 | **201** |
| Con fichero de código equivalente | 160 | **160** |
| Equivalente salvo envoltorio o comentario de cola | — | **6** |
| Sin ningún fichero que case | 184 | **0** |
| Con `statements` NULL, pero con fichero | 6 | 6 |

Los 6 de la tercera fila son los que se dejaron a propósito: sólo difieren en
`begin;`/`commit;` o en comentarios al final de línea, comprobados uno a uno.
**Ninguna migración aplicada se queda sin fichero, y ninguna diferencia se queda
sin explicar.**

## ⚠️ Las seis que la base no sabe qué hicieron

Registradas como aplicadas, con `statements` **NULL**. La base guarda que
corrieron y **no guarda qué ejecutaron**:

| versión | nombre | fichero en el repo |
|---|---|---|
| `20260831163522` | `inicio_p1_datos_y_rls` | `20260831T1835_*.sql` |
| `20260831233552` | `supplier_iva_incluido` | `20260901T0135_*.sql` |
| `20260901045210` | `despacho_clasificacion_y_vigia` | `20260901T0652_*.sql` |
| `20260901051458` | `kiosko_orden_entrada_salida` | `20260830T1905_*.sql` |
| `20260901063742` | `cobertura_consumo_avt` | `20260901T0837_*.sql` |
| `20260901064416` | `cierre_indefinido_declarado` | `20260901T0844_*.sql` |

**Para estas seis el repositorio es el único registro que existe.** No hay nada
que reconstruir y no hay contra qué verificarlo: si el fichero se pierde, se
pierde la única copia. Es el argumento más fuerte que hemos tenido para la
regla 17, y llegó por accidente.

## Lo que este trabajo NO prueba

Que el fichero coincida con `statements` prueba que el repo guarda **el texto
que se ejecutó**. No prueba que ese texto siga describiendo la base de hoy: una
función creada en julio y editada doce veces después sigue teniendo su migración
de julio, correcta e incompleta. Para eso está `pg_get_functiondef`, no esto.

## Cómo repetir la medida

```sql
select version, name, md5(array_to_string(statements, E'\n'))
from supabase_migrations.schema_migrations order by version;
```

y comparar con `md5` de los bytes de cada fichero de `supabase/migrations/`.
Las que no casen exactamente, comparar de nuevo quitando comentarios (de línea
y de cola), `begin;`/`commit;` y espacios: esa segunda pasada es la que separa
un problema de un artefacto del comparador.
