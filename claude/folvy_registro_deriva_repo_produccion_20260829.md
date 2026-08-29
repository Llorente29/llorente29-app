# Registro de deriva repo ↔ producción (29/08/2026)

Funciones donde el repo y producción NO dicen lo mismo. Se mantiene aquí hasta
que cada línea quede cerrada.

## 1. `_set_product_availability_core` — deriva COSMÉTICA, no de comportamiento

Detectada al transcribir el cuerpo vivo para el encargo de la tienda.

| | |
|---|---|
| vivo en producción | 6.654 chars · md5 `9c868db1dfdea77a8df6188568e7dfc6` |
| repo `20260824T1100_availability_verdad_unica.sql` | 6.967 chars · md5 `086786d2cd484450bbb40ff14b174c86` |
| diferencia | 313 chars |

**Qué difiere, exactamente:** nada de código. El `diff -u` del cuerpo vivo
contra el del repo (normalizando fin de línea) da **un solo hunk, cuatro líneas
borradas, cero añadidas** — y las cuatro son el comentario:

```
-  -- ── LO NUEVO: menu_item.is_available deja de quedarse atrás ──────────────
-  -- Se RECALCULA (no se asigna p_is_available a pelo) para que un 86 puesto en
-  -- otro local, o un override que siga vivo, no se pierda al reactivar aquí.
-  -- Solo sobre los afectados, solo si cambia, y nunca sobre un par espejo.
```

313 caracteres = exactamente esas cuatro líneas más sus saltos.

**Consecuencia:** reaplicar `20260824T1100` **no cambiaría el comportamiento del
86**. Devolvería el comentario, nada más. La preocupación de que el repo fuera
por delante en la dirección peligrosa no se confirma: va por delante sólo en
documentación. Producción perdió el comentario en algún camino de aplicación que
lo descarta (editor SQL o MCP), no en un cambio de lógica.

**Acción:** ninguna urgente. Cuando se toque esa función (paso 2 de la tienda),
que quede con el comentario puesto. Se cierra entonces.

## 2. Las tres del 28/08 — siguen sin llegar a `main`

`_availability_panel_core`, `_scope_preview_core` y `kds_recipe` se
transcribieron y commitearon el 28/08, pero **en una rama que nunca se mergeó**:

```
claude/versionar-tres-funciones-produccion-20260828   (commit c8dd992)
```

Verificado hoy: `git branch --contains c8dd992` no incluye `main`. El documento
`claude/folvy_tres_funciones_produccion_por_delante_20260828.md` tampoco existe
en `main` — vive sólo en esa rama. El trabajo está hecho y empujado; falta el
merge.

Otras dos ramas empujadas y sin mergear, del mismo periodo:

- `claude/glovo-direccion-portal-20260827`
- `claude/edge-drift-contenido-legible-20260828` (el vigía que sí sabe comparar
  contenido; sin mergear y sin desplegar)

**Acción:** decidir merges. Ninguna corre prisa, pero mientras no estén en `main`
el repo sigue sin conocer lo que hay en producción, que es la deuda que el vigía
de deriva existe para cazar.

## 3. Regla que esto confirma

La regla 1 de CLAUDE.md («ninguna corrección vive sólo en el desplegado») tiene
una hermana que hoy se paga: **ninguna corrección vive sólo en una rama.** Un
commit sin merge es un arreglo con fecha de caducidad igual que un deploy sin
commit — con la diferencia de que este no borra nada, sólo no llega.
