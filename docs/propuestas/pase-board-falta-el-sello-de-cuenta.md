# `pase_board` · al bloque del Pase le falta el sello de cuenta

**16/09/2026.** Deuda **abierta**, no arreglada. Pequeña, conocida y con el
remedio escrito abajo para que quien vuelva a esa función no tenga que pensarlo.

## Qué pasa

La migración `20260915225209` mudó el interruptor del Pase a `kitchen_station`.
El bloque que lee el estado dentro de `pase_board` quedó así:

```sql
  select coalesce(bool_or(k.pase_activo), false) into v_activo
    from kitchen_station k
   where k.location_id = v_local
     and k.kind = 'expo';
```

Filtra por **local** y por **papel**, y **no** por `account_id = v_cuenta` —
mientras que las demás consultas de esa misma función sí lo llevan. Es la única
del fichero sin el sello.

## Por qué no es un agujero hoy

`v_local` sale del **token del aparato**, no de lo que mande el llamante, y un
local pertenece a una sola cuenta: no hay forma de que `location_id` apunte a un
local de otra. Medido el 16/09: 7 locales, cada uno con una `expo`, ninguna
compartida.

## Por qué se arregla igual

Porque la regla que nos pusimos para `pase_board` fue **por cuenta, no sólo por
local** (regla 9), y una excepción sin marcar es la que un día deja de ser
excepción. El resto de la función ya lo hace; ésta se quedó fuera porque la
escribí de urgencia corrigiendo otro fallo que paró el primer intento.

Y no justifica una migración por sí sola: **entra en el siguiente cambio que
toque `pase_board`**, sea cual sea.

## El remedio, listo para pegar

Dentro del `do $tableros$` de la migración que toque, el ancla y su sustituto:

```sql
  v_ancla := '  select coalesce(bool_or(k.pase_activo), false) into v_activo' || E'\n'
          || '    from kitchen_station k' || E'\n'
          || '   where k.location_id = v_local' || E'\n'
          || '     and k.kind = ''expo'';';
  v_nuevo := '  select coalesce(bool_or(k.pase_activo), false) into v_activo' || E'\n'
          || '    from kitchen_station k' || E'\n'
          || '   where k.account_id = v_cuenta' || E'\n'
          || '     and k.location_id = v_local' || E'\n'
          || '     and k.kind = ''expo'';';
```

Con su guarda de ocurrencia única, como siempre. Y con el «antes» capturado
arriba del todo: este mismo bloque ya paró un fallo real al primer intento.

**Comprobación de que no cambia nada:** los seis tableros de las tres tablets
activas tienen que salir idénticos byte a byte, igual que en la mudanza.
