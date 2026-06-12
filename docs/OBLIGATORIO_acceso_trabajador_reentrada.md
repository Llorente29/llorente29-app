# ⚠️ OBLIGATORIO — Reentrada del trabajador (cierre seguro + PIN)

**Estado:** arreglo MÍNIMO aplicado (12/06/2026). Arreglo COMPLETO pendiente y **obligatorio**.
**Disparador:** antes de dar acceso masivo a trabajadores de Llorente29 / antes de la tablet común.
**Severidad:** alta — afecta a la operativa diaria de cada trabajador.

## El problema (resuelto a medias)

El trabajador entra por **QR de un solo uso** (`AccesoClaimPage` → `verifyOtp` magiclink).
El botón "salir" del worker hacía **`signOut()`** (`App.tsx`: `onExitMode={() => { void signOut() }}`),
que destruye la sesión. Como el QR ya se gastó, **el trabajador no podía volver a entrar**:
la app le pedía email/contraseña (login de gestor) que él no tiene → **atrapado**.

## Arreglo MÍNIMO aplicado (hoy)

En `HomeEmpleado.tsx`: el worker puro (`exitLabel='logout'`) **ya no muestra botón de salir**.
Como cada trabajador usa su propio móvil, la sesión Supabase **persiste**: entra una vez por QR,
instala la PWA y abre siempre el icono estando ya dentro. Sin botón de salir, no queda atrapado.
El encargado dual (`exitLabel='back-to-management'`) mantiene su botón (vuelve a gestión, no se atrapa).

**Limitación:** el mínimo solo evita el atrapamiento. NO cubre:
- Cierre voluntario (prestar el móvil, privacidad).
- Multi-usuario en un mismo dispositivo (tablet común futura).

## Arreglo COMPLETO (OBLIGATORIO — no opcional)

Sustituir la ausencia de "salir" por un **cierre seguro** que NO deje atrapado:

1. El "salir" del worker **NO debe hacer `signOut()` global**. Debe llevar a la pantalla de
   **NOMBRE + PIN** (`LoginEmpleado.tsx`, que YA EXISTE y usa PIN de 4 dígitos), **NUNCA** a la
   de email/contraseña (esa es de gestores).
2. Flujo: worker pulsa "salir" → `LoginEmpleado` (lista de nombres + PIN) → elige su nombre →
   mete su PIN → entra. Puede salir y volver **sin depender del QR**.
3. Habilita el caso **FUTURO de TABLET COMÚN** (recetas, recepciones, pedidos de venta): varios
   trabajadores en un mismo dispositivo, cada uno con su PIN. (Confirmado por Julio: la tablet
   común NO sería para fichar, sino para recetas/recepciones/pedidos.)
4. Requisitos técnicos:
   - Cada empleado debe tener **PIN asignado** (hoy algunos no lo tienen — ver alta de empleado).
   - La sesión Supabase del dispositivo debe permitir "cambiar de trabajador" sin `signOut`
     global, o un `signOut` que vuelva a `LoginEmpleado` y **NO** al login de gestor.
   - Revisar `App.tsx` (gate worker puro) y `TrabajadorApp` (`onExitMode`).

## Por qué es obligatorio

Sin el completo, un trabajador que preste el móvil, o una tablet común, no tiene forma limpia de
cerrar / cambiar de usuario. El mínimo de hoy solo tapa el atrapamiento; no cubre cierre voluntario
ni multi-usuario. Es requisito antes del despliegue masivo a la plantilla.
