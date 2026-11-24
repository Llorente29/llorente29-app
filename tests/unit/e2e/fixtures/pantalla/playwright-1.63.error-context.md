# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: falla.spec.ts >> el plan contable abre con su grupo
- Location: tests/e2e/q03/falla.spec.ts:2:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('6000 Compras')
Expected: visible
Timeout: 2000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('6000 Compras') with timeout 2000ms
  - waiting for getByText('6000 Compras')

```

```yaml
- heading "Plan contable" [level=1]
- group "Grupos":
  - button "Grupo 6" [pressed]
  - button "Grupo 7"
- checkbox "Solo con saldo"
- text: Solo con saldo
- paragraph: Ninguna cuenta encaja con lo que buscas.
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test'
  2  | test('el plan contable abre con su grupo', async ({ page }) => {
  3  |   await page.route('https://base.example/rest/v1/rpc/conta_plan?select=*&apikey=SECRETO123', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"57014","message":"canceling statement due to statement timeout"}' }))
  4  |   await page.route('https://app.example/plan', (r) => r.fulfill({ contentType: 'text/html', body: `<html><body><h1>Plan contable</h1>
  5  |     <div role="group" aria-label="Grupos"><button aria-pressed="true">Grupo 6</button><button aria-pressed="false">Grupo 7</button></div>
  6  |     <label><input type="checkbox"> Solo con saldo</label>
  7  |     <p>Ninguna cuenta encaja con lo que buscas.</p>
  8  |     <script>console.error('conta_plan: 500'); fetch('https://base.example/rest/v1/rpc/conta_plan?select=*&apikey=SECRETO123', {headers:{Authorization:'Bearer TOKENSECRETO'}}).catch(()=>{}); setTimeout(()=>{throw new Error('No se pudo leer el plan')},10)</script></body></html>` }))
  9  |   await page.goto('https://app.example/plan')
  10 |   await page.waitForTimeout(300)
> 11 |   await expect(page.getByText('6000 Compras')).toBeVisible()
     |                                                ^ Error: expect(locator).toBeVisible() failed
  12 | })
  13 | 
```