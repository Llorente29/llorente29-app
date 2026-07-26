// tests/unit/passCode.test.ts
//
// CÓDIGO DE PASE — el número que el repartidor canta al llegar.
//
// Este test existe por una razón concreta: el bug que cerró la release del
// 26/07/2026 no fue una regla mal escrita, sino DOS reglas. La tarjeta de
// /orders usaba passCode.ts y el ticket de bolsa (ticketImage.ts, el papel de
// verdad) llevaba una copia propia que ponía el código corto también en Uber →
// pantalla y papel cantaban números distintos justo en el momento de más prisa.
//
// Por eso aquí hay dos bloques:
//   1) la regla, contra datos REALES de los cuatro canales;
//   2) un guardarraíl de arquitectura: ningún renderizador puede volver a
//      deducir el código por su cuenta. Si alguien reintroduce la lógica en un
//      renderer, este test se pone rojo antes de que llegue a una impresora.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { passCode } from '@/modules/orders/lib/passCode'

// Muestras reales de producción (BBDD, 26/07/2026).
const GLOVO = { channel: 'Glovo', pos_short_code: 'G357', platform_order_code: '101724410105' }
const UBER = { channel: 'Uber', pos_short_code: 'U666', platform_order_code: '30340' }
const JUSTEAT = { channel: 'JustEat', pos_short_code: 'J063', platform_order_code: '188965489' }
const SHOP = { channel: 'Shop', pos_short_code: null, platform_order_code: 'FS39838' }

describe('passCode · la regla', () => {
  it('Glovo canta los dígitos del código corto, con la letra pequeña', () => {
    const pc = passCode(GLOVO)
    expect(pc.source).toBe('short')
    expect(pc.full).toBe('G357')
    expect(pc.lead).toBe('G')
    expect(pc.emph).toBe('357')          // lo que canta el rider
    expect(pc.secondary).toBe('101724410105')
  })

  it('Uber canta el código de plataforma completo, con los últimos 4 destacados', () => {
    const pc = passCode(UBER)
    expect(pc.source).toBe('platform')
    expect(pc.full).toBe('30340')
    expect(pc.emph).toBe('0340')
    expect(pc.lead).toBe('3')
    expect(pc.secondary).toBe('U666')
  })

  it('JustEat usa el corto (cobertura 100%)', () => {
    const pc = passCode(JUSTEAT)
    expect(pc.full).toBe('J063')
    expect(pc.emph).toBe('063')
  })

  it('Shop sin código corto cae al de plataforma (el FS… que ve el cliente)', () => {
    const pc = passCode(SHOP)
    expect(pc.source).toBe('platform')
    expect(pc.full).toBe('FS39838')
  })

  it('sin ninguno de los dos códigos cae al tab, y sin nada devuelve —', () => {
    const conTab = passCode({ channel: 'Glovo', external_tab_ref: '7bdc6fe0-4386-4c8f-88fd-4cd2e4e32562' })
    expect(conTab.source).toBe('tab')
    expect(conTab.full.startsWith('#')).toBe(true)

    const vacio = passCode({ channel: 'Uber' })
    expect(vacio.full).toBe('—')          // nunca inventar un código
    expect(vacio.secondary).toBeNull()
  })

  it('los dos códigos quedan siempre disponibles cuando existen', () => {
    for (const o of [GLOVO, UBER, JUSTEAT]) {
      const pc = passCode(o)
      const ambos = [pc.full, pc.secondary].filter(Boolean).map(String)
      expect(ambos).toContain(String(o.pos_short_code).toUpperCase())
      expect(ambos).toContain(String(o.platform_order_code).toUpperCase())
    }
  })
})

describe('passCode · una sola regla (guardarraíl anti-regresión)', () => {
  // Todo lo que pinta un código de pase para un humano: pantalla, papel de
  // bolsa/cocina y previsualización. Ninguno puede tener criterio propio.
  const RENDERIZADORES = [
    'src/native/print/ticketImage.ts',      // el papel de verdad (APK)
    'src/native/print/ticketRenderer.ts',   // texto / pegatinas
    'src/modules/orders/lib/ticketRenderer.ts', // previsualización web
    'src/modules/orders/components/OrderCard.tsx',
  ]

  it.each(RENDERIZADORES)('%s importa la regla en vez de reimplementarla', (rel) => {
    const src = readFileSync(resolve(__dirname, '../..', rel), 'utf8')
    expect(src).toMatch(/import\s*\{[^}]*passCode[^}]*\}\s*from\s*['"][^'"]*passCode['"]/)
  })

  it.each(RENDERIZADORES)('%s no decide el código de pase por su cuenta', (rel) => {
    const src = readFileSync(resolve(__dirname, '../..', rel), 'utf8')
    // Un renderer puede LEER platform_order_code (para etiquetarlo como "el otro
    // código"), pero no puede elegir entre los dos: eso es la regla. La señal de
    // que alguien la reimplementó es un fallback encadenado entre ambos campos.
    const fallbackCasero = /pos_short_code[^\n]{0,80}(\?\?|\|\|)[^\n]{0,40}platform_order_code/
    expect(src).not.toMatch(fallbackCasero)
    const inverso = /platform_order_code[^\n]{0,80}(\?\?|\|\|)[^\n]{0,40}pos_short_code/
    expect(src).not.toMatch(inverso)
  })
})
