# Pendiente · e2e rojas en `main`

Pruebas que están en rojo en `main` y no son de ningún PR abierto. Cada una con desde cuándo, la ejecución donde se ve y lo
que hay que hacer cuando se arregle.

## `tests/e2e/conta/c04/libro.spec.ts`

- **56** · «A · libro diario (N11) en el marco: vistas que existen, el mes, estados, Diez y lo que he hecho yo», a
  ordenador y a móvil. Esperaba en la fila «Alquiler Norte Mercado · octubre» el texto «También en Compras y gastos ›
  Facturas recibidas»: la fila no está.
- **304** · «A · cambiar una cuenta de una propuesta: lo dice y lo aprende; y se deja como estaba». Esperaba la línea
  «El alquiler del local» con la cuenta 62100000: no está (el asiento sale con «Falta la cuenta del proveedor»).

Rojas en `main` desde la e2e de la noche del 24/11 (run 45390645186). Salieron también en la e2e del #808 (run
45574888302), que las corrió porque cambiaba el fichero.

**Cuando se arreglen** (X14 · 2, Julio, 25/11): recuperar en la 399 («A · Ajustes › Ejercicio: desde cuándo asienta
Folvy») el ajuste del #808, que se devolvió a como estaba en `main` para no arrastrar estas dos rojas:

- «Cambiar» se ve siempre (ya no hay «corte-fijo»);
- con asientos traídos, `corte-traido` dice «Hay N asientos traídos de …, el último del dd/mm/aaaa. Traerlos no fija el
  día de inicio: lo fijas tú, y como pronto el dd/mm/aaaa.».

El ajuste está en el commit 30ef0c5c7 de `conta/x14c-dia-de-inicio-a-mano` (`git show 30ef0c5c7 -- tests/e2e/conta/c04/libro.spec.ts`).
