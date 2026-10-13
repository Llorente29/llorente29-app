# C04b · Guía de lanzamiento: el histórico de Diez en producción

Para Julio. Cinco pasos, en este orden. **No se fusiona la rama del
encargo**: todo se lanza desde `conta/c04b-diez`. Entre un ensayo y su real
no se empuja nada a la rama: el real exige un ensayo en verde **del mismo
commit**.

En todos los pasos: GitHub › **Actions** › el workflow › **Run workflow** ›
en **Use workflow from**, la rama **`conta/c04b-diez`**.

---

## Paso 0 · El botón del workflow nuevo (una vez)

- Fusionar el **PR #177** (un solo fichero: `.github/workflows/diez-importar.yml`).
  Sin él, «Diez · tanda del histórico (C04b)» no enseña «Run workflow».
- Comprobar en Vercel que el despliegue de producción de esa fusión dice
  **READY** (el front es el mismo de `main`; la fusión lo dispara igual).

## Paso 1 · Migraciones 0100–0160 · ENSAYO

Workflow: **Aplicar SQL en PRODUCCIÓN (contabilidad)**

| Campo | Valor |
|---|---|
| Use workflow from | `conta/c04b-diez` |
| `confirmo` | `produccion` |
| `modo` | `ensayo` |
| `autorizo` | *(vacío)* — las siete «sigue»; ninguna lo pide |

En verde: siete ficheros, todos **sigue**, y el ensayo deshecho.

## Paso 2 · Migraciones 0100–0160 · REAL

Mismo workflow, **mismo commit** que el ensayo del paso 1.

| Campo | Valor |
|---|---|
| Use workflow from | `conta/c04b-diez` |
| `confirmo` | `produccion` |
| `modo` | `real` |
| `autorizo` | *(vacío)* |

En verde: los siete en el historial de producción con su huella y la
comprobación de después (salud del pedido de todas las cuentas) en verde.

Desde aquí, en 2026 no se valida nada de Folvy hasta el paso 4: «Primero hay
que traer el histórico de Diez de 2026». Es la regla de la 0160.

## Paso 3 · Histórico de Diez · ENSAYO

Workflow: **Diez · tanda del histórico (C04b)**

| Campo | Valor |
|---|---|
| Use workflow from | `conta/c04b-diez` |
| `modo` | `ensayo` |
| `confirmo` | `produccion` |
| `autorizo` | *(vacío)* |

Lee de Diez de octubre de 2023 a septiembre de 2026 (solo GET) y escribe
dentro de una transacción que se deshace. En verde, el informe dice:

- asientos en la carga, traídos, ya estaban, rechazados (0), cambiados en
  Diez (0);
- **fuera, sin importe en Diez**: los 4 de 2023, con su clave (no es un
  rechazo y no impide cerrar 2023);
- por ejercicio (2023, 2024, 2025 y 2026): traídos por serie, líneas «En Diez
  iba en negativo», facturas que esperan documento y de dónde, y el testigo:
  **cuadra al céntimo** (45, 82, 102 y 149 subcuentas);
- 2023, 2024 y 2025 cerrados; el histórico de los cuatro marcado;
- **«Ensayo: deshecho, no queda nada escrito»**, con antes = después.

Si algo sale en rojo, se para aquí: no se lanza el real.

## Paso 4 · Histórico de Diez · REAL

Mismo workflow, **mismo commit** que el ensayo del paso 3 (si no, el real ni
empieza).

| Campo | Valor |
|---|---|
| Use workflow from | `conta/c04b-diez` |
| `modo` | `real` |
| `confirmo` | `produccion` |
| `autorizo` | `historico-diez` |

En verde: **«REAL: escrito»** y el «después» igual al «antes» más los traídos que dio el ensayo del paso 3.
Si no cuadrara, se deshace solo y sale en rojo.

## Paso 5 · Comprobación en solo lectura (Claude)

Con el real en verde, Claude comprueba en producción, solo leyendo, y pega
los resultados:

- asientos traídos por ejercicio y serie, contra el informe;
- 2023–2025 cerrados, los cuatro con el histórico marcado;
- la cadena de huellas entera;
- el testigo, otra vez, con la misma vara;
- el último número traído por serie de 2026 y que los 22 propuestos de
  octubre siguen sin número.

Después se validan los 22 de octubre: salen con su número detrás del último
de Diez.

---

**Vuelta atrás.** Las migraciones: «Aplicar SQL en PRODUCCIÓN» con `modo`
`vuelta_atras` (`supabase/produccion/vuelta-atras.txt`). Con el histórico ya
traído, **no** sin hablarlo antes: las columnas nuevas llevan datos y el libro
traído no se borra.
