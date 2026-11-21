# Origen

- FABRICADO a partir del registro del run 44198365426 (K03, 18/11): el artefacto
  no se puede bajar desde la sesión (el almacén de GitHub da 403).
- El «Error details» es el del registro, copiado tal cual.
- El árbol de la pantalla está escrito a mano con el formato de Playwright 1.63
  (el del error-context.md real de playwright-1.63.error-context.md) y con lo que
  dijo la causa del 18/11: el plan contable abría con un grupo que esa empresa
  no tiene, la pastilla del grupo 5 sin marcar, y «Ninguna cuenta encaja con lo
  que buscas».

# Test info

- Name: conta/k03/pestanas.spec.ts >> pestañas vivas a 1456 × 816: volver sin perder, F5, cerrar con cambios y recargar
- Location: tests/e2e/conta/k03/pestanas.spec.ts:38:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.k-zona[data-activa="si"]').locator('[role="row"]').filter({ has: locator('a[href*="/conta/plan/"]') }).first()
Expected: visible
Timeout: 30000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('.k-zona[data-activa="si"]').locator('[role="row"]').filter({ has: locator('a[href*="/conta/plan/"]') }).first() with timeout 30000ms
  - waiting for locator('.k-zona[data-activa="si"]').locator('[role="row"]').filter({ has: locator('a[href*="/conta/plan/"]') }).first()

```

```yaml
- navigation "Menú de contabilidad":
  - link "Inicio"
  - link "Plan contable" [active]
- tablist "Pestañas abiertas":
  - tab "Inicio"
  - tab "Plan contable" [selected]
- heading "Plan contable" [level=1]
- group "Grupos del plan":
  - button "1 · Financiación básica"
  - button "5 · Cuentas financieras"
  - button "8 · Gastos imputados al patrimonio neto" [pressed]
- searchbox "Buscar cuenta"
- paragraph: Ninguna cuenta encaja con lo que buscas.
```

# Test source

```ts
> 94 |     await expect(conCuenta.first()).toBeVisible({ timeout: 30_000 })
```
