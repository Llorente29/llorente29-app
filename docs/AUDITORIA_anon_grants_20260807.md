# Auditoría de seguridad — grants de escritura a `anon` (07/08/2026)

## Objetivo
Verificar en cuántas tablas `anon` (el rol público) tiene INSERT/UPDATE/DELETE, y si esa escritura está
realmente frenada (por RLS) o hay algún agujero.

## Resultado por categoría (tablas públicas)
| Categoría | Tablas | Veredicto |
|---|---|---|
| Sin DML a anon | 10 | OK |
| anon DML + RLS OFF | 1 (`spatial_ref_sys`) | PostGIS, ver abajo |
| anon DML + RLS deny-all (grant redundante) | 11 (`_backup_*`) | Seguras; pendientes de borrado (inventario #5) |
| anon DML + RLS con políticas, ninguna para anon | 93 | Tapado por RLS |
| anon DML + política que "incluye" anon/public | 157 | **Gateado por condición** — ver abajo |

## Las 157 "que incluyen a public/anon": FALSA ALARMA
Están escritas `to public` (que sintácticamente incluye a anon), pero **toda** tiene condición real:
`current_user_is_admin_or_manager_of(account_id)`, `belongs_to_account(account_id)`, `auth.uid()`…
Para `anon` esas condiciones son **falsas** (no tiene `auth.uid()` ni pertenece a ninguna cuenta), así que
**anon no puede escribir en ninguna**. El "(sin USING)" en INSERT y "(sin CHECK)" en DELETE es normal
(cada comando usa la mitad que le corresponde). Conclusión: la escritura de anon está bien frenada por RLS
en todas las tablas de cliente. Sin agujeros.

## `spatial_ref_sys` (la única con RLS OFF)
Tabla de sistema de **PostGIS** (definiciones de sistemas de coordenadas). No contiene datos de cliente.
- No se puede endurecer desde aquí: es propiedad de un superusuario; `REVOKE` falla por privilegios.
- Riesgo: mínimo y no-tenencia (a lo sumo, corromper definiciones SRID → afectaría cálculos geográficos).
- **Aceptado como aviso conocido de PostGIS.** (Mismo motivo por el que F0.2 excluyó las 3 funciones PostGIS.)

## Endurecimiento opcional (baja prioridad, NO necesario ahora)
Migrar las políticas `to public` → `to authenticated` sería defensa en profundidad (que anon ni se
considere), pero son ~100 políticas, es reescritura de riesgo, y hoy ya están seguras por condición.
No se hace: coste/riesgo alto para ganancia marginal. Se deja anotado por si algún día se quiere.

## Conclusión
La superficie de escritura de `anon` es **segura** (RLS la frena en todo lo de cliente). No se requiere
ninguna migración. Punto cerrado del inventario de seguridad.
