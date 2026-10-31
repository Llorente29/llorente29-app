// tests/unit/demo/puerta.test.ts
//
// DM1 · PR 2a (31/10/2026) · La máquina que vigila la puerta (respuesta 1 al
// DM1: «una prueba que lo compruebe sola, que liste lo que sale fuera y falle
// si alguno no pasa por la función, nombrándolo»).
//
// Cada función del servidor que habla con fuera (tests/unit/demo/salidas.ts lo
// lee del código) tiene que estar en UNA de estas tres listas:
//   · CON_PUERTA: importa _shared/puerta.ts (pregunta cuenta_puede_salir antes
//     de salir). Se comprueba que de verdad la importa.
//   · NO_SALEN_POR_UNA_CUENTA: hablan con fuera, pero no mandan nada en
//     nombre de una cuenta. Cada una con su porqué.
//   · AUN_SIN_PUERTA: las que aún hay que cerrar (PR 2a, en marcha). Se
//     comprueba que de verdad no la importan: la que se cierra sale de aquí.
// Una función nueva que salga fuera y no esté en ninguna, en rojo, con su
// nombre. Y mientras AUN_SIN_PUERTA no esté vacía, NADA del repositorio puede
// marcar una cuenta como demo (is_demo = true): una demo con una sola salida
// abierta mandaría cosas de verdad.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { RAIZ, salidas, llamadasDesdeLaBase } from './salidas'

/** Hablan con fuera, pero no en nombre de una cuenta. */
const NO_SALEN_POR_UNA_CUENTA: Record<string, string> = {
  // La IA: leen o proponen; no mandan nada a nadie.
  'enrich-ingredient': 'la IA propone datos de un ingrediente; no envía nada a nadie',
  'extract-recipe': 'la IA lee una receta; no envía nada a nadie',
  'folvy-ai': 'la IA contesta en la pantalla; no envía nada a nadie',
  'map-products': 'la IA empareja productos; no envía nada a nadie',
  'ocr-albaran': 'la IA lee un albarán o una factura; no envía nada a nadie',
  'ocr-compliance-doc': 'la IA lee un documento; no envía nada a nadie',
  'payroll-extract': 'la IA lee una nómina; no envía nada a nadie',
  'propose-count-reasons': 'la IA propone motivos de un recuento; no envía nada a nadie',
  'propose-modifier-impacts': 'la IA propone impactos de un extra; no envía nada a nadie',
  'suggest-course-hook': 'la IA propone un texto de formación; no envía nada a nadie',
  'suggest-item': 'la IA propone un artículo; no envía nada a nadie',
  'social-dress': 'la IA prepara una imagen; publicarla es social-publish, que sí lleva puerta',
  // Consultas a datos públicos: leen, no mandan nada en nombre de la cuenta.
  'conta-vies-check': 'consulta pública del NIF europeo (VIES); no envía nada en nombre de la cuenta',
  'sports-events': 'consulta pública de partidos; no envía nada',
  'weather-events': 'consulta pública del tiempo; no envía nada',
  'conta-justificante-csv': 'lee el justificante público de Hacienda por su CSV; no presenta nada',
  'conta-redsys': 'guarda los datos del TPV de la empresa y firma con su clave; no habla con el banco (cobrar es conta-pago, que lleva puerta)',
  'conta-redsys-aviso': 'RECIBE el aviso del banco cuando un cliente paga; no manda nada',
  'conta-stripe-webhook': 'RECIBE los avisos de Stripe y solo lee el estado de un alta que ya existe (una demo no puede darse de alta: conta-stripe lleva puerta)',
  'conta-facturas-entrada': 'recoge los correos con facturas que LLEGAN a la cuenta (lee lo recibido en Resend); no manda nada',
  // De la plataforma, no de una cuenta.
  'create-platform-admin': 'da de alta a un superadministrador: es de la plataforma, no de una cuenta',
  // El acceso de la propia persona: también en una demo hace falta entrar.
  'invitar-persona': 'el correo para entrar a la persona invitada: en una demo también se invita (la asesoría a Casa Lola)',
  'conta-contrasena': 'el correo de la contraseña a la propia persona: en una demo también se entra',
  'create-account': 'el alta de una cuenta nueva, a quien la crea: una cuenta nueva no es de demo',
  'conta-crear-cuenta': 'el alta de una cuenta nueva de Sumied, a quien la crea: una cuenta nueva no es de demo',
  'shop-customer-auth': 'el código de entrada de un cliente a la tienda, a la propia persona',
  // El cartero: no sabe de qué cuenta es el correo. La puerta va en quien lo llama.
  'send-email': 'el cartero: lo llaman las demás, y la puerta va en cada una de ellas (las que dicen «correo (send-email)»)',
}

/** Las que aún hay que cerrar. Se vacía en el PR 2a; mientras tanto, ninguna cuenta puede ser de demo. */
const AUN_SIN_PUERTA = [
  'account-email', 'catcher-dispatch', 'clockout-reminder', 'compliance-doc-notify', 'customer-notify',
  'dosier-track', 'last-catalog-probe', 'last-catalog-sync', 'lastapp-backfill-sales',
  'lastapp-catalog-import', 'lastapp-set-price', 'order-advance', 'payroll-inbound', 'shop-payment-intent',
  'social-agent', 'social-publish', 'social-token-refresh', 'stripe-connect-onboard', 'system-alert',
  'training-notify', 'uber-promo-push',
]

const lista = salidas()
const porNombre = new Map(lista.map((s) => [s.funcion, s]))

describe('la puerta de las demos: cada función que sale fuera, en su lista', () => {
  it('ninguna función que sale fuera se queda sin lista (con su nombre y por dónde sale)', () => {
    const sinLista = lista
      .filter((s) => !s.puerta && !(s.funcion in NO_SALEN_POR_UNA_CUENTA) && !AUN_SIN_PUERTA.includes(s.funcion))
      .map((s) => `${s.funcion} (sale a ${s.por.join(', ')})`)
    expect(sinLista, `Estas funciones hablan con fuera y no pasan por la puerta. Qué hacer: que llamen a cuentaPuedeSalir (_shared/puerta.ts) antes de salir; o, si no mandan nada en nombre de una cuenta, ponlas en NO_SALEN_POR_UNA_CUENTA con su porqué`).toEqual([])
  })

  it('las que dicen tener la puerta la tienen; las de AUN_SIN_PUERTA de verdad no (la que se cierra, sale de la lista)', () => {
    const yaCerradas = AUN_SIN_PUERTA.filter((n) => porNombre.get(n)?.puerta)
    expect(yaCerradas, 'Ya pasan por la puerta: quítalas de AUN_SIN_PUERTA').toEqual([])
    const noExisten = AUN_SIN_PUERTA.filter((n) => !porNombre.has(n))
    expect(noExisten, 'Ya no salen fuera (o no existen): quítalas de AUN_SIN_PUERTA').toEqual([])
  })

  it('las de NO_SALEN_POR_UNA_CUENTA siguen existiendo y no pasan también por la puerta', () => {
    const sobran = Object.keys(NO_SALEN_POR_UNA_CUENTA).filter((n) => !porNombre.has(n) || porNombre.get(n)!.puerta)
    expect(sobran, 'Ya no salen fuera, o ya tienen la puerta: quítalas de NO_SALEN_POR_UNA_CUENTA').toEqual([])
  })

  it('cada función del servidor a la que llama la base, si sale fuera, tiene su lista', () => {
    const sinLista = llamadasDesdeLaBase().filter((n) => porNombre.has(n) && !porNombre.get(n)!.puerta
      && !(n in NO_SALEN_POR_UNA_CUENTA) && !AUN_SIN_PUERTA.includes(n))
    expect(sinLista).toEqual([])
  })

  it('mientras quede alguna sin puerta, nada del repositorio marca una cuenta como demo', () => {
    if (AUN_SIN_PUERTA.length === 0) return
    const dirs = ['supabase/migrations', 'supabase/seeds', 'scripts/conta/produccion/cuentas']
    const marcan: string[] = []
    const mirar = (d: string): void => {
      for (const n of readdirSync(join(RAIZ, d))) {
        const p = join(d, n)
        if (statSync(join(RAIZ, p)).isDirectory()) { mirar(p); continue }
        if (!n.endsWith('.sql')) continue
        if (/is_demo\s*=\s*true|is_demo\s*\)\s*values[^;]*true/i.test(readFileSync(join(RAIZ, p), 'utf8'))) marcan.push(p)
      }
    }
    dirs.forEach(mirar)
    expect(marcan, `Quedan ${AUN_SIN_PUERTA.length} funciones sin puerta (AUN_SIN_PUERTA): una demo mandaría cosas de verdad por ellas. Qué hacer: ciérralas antes de marcar ninguna cuenta`).toEqual([])
  })
})
