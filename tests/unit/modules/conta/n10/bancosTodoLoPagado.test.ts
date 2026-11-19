// tests/unit/modules/conta/n10/bancosTodoLoPagado.test.ts
//
// N10 · Parte 2. La 1930 cambia las dos de Bancos buscando su trozo exacto, el que dejó la 0800 del N09
// (ya aplicada en producción). Si no lo encuentra una sola vez, para sin tocar nada: esta prueba comprueba
// antes de subir que el trozo que busca la 1930 es, letra a letra, el que escribe la 0800, y que su
// cabecera declara las dos funciones con su prueba de staging, que las nombra.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const N09 = readFileSync('supabase/migrations/20261119T0800_n09_pagos_lee_lo_traido.sql', 'utf8')
const N10 = readFileSync('supabase/migrations/20261119T1930_n10_bancos_todo_lo_pagado.sql', 'utf8')
const PRUEBA = 'supabase/staging/sql/20261119_n10_bancos_todo_lo_pagado_prueba.sql'
const entre = (s: string, etiqueta: string) => {
  const m = new RegExp(`${etiqueta} text := \\$(\\w)\\$([\\s\\S]*?)\\$\\1\\$;`).exec(s)
  if (!m) throw new Error(`no encuentro ${etiqueta}`)
  return m[2]
}
// La 0800 tiene dos bloques con v_viejo/v_nuevo: el de Bancos es el segundo.
const bloqueBancos = (s: string) => s.slice(s.indexOf('-- 2 y 3'))

describe('N10 · la 1930 sobre lo que dejó la 0800', () => {
  it('el trozo que busca la 1930 es la línea de lo casado más, letra a letra, lo que escribió la 0800', () => {
    const escrito = entre(bloqueBancos(N09), 'v_nuevo')
    const buscado = entre(N10, 'v_viejo')
    expect(buscado.endsWith(escrito), 'la 1930 busca lo que dejó la 0800').toBe(true)
    expect(buscado.slice(0, buscado.length - escrito.length).trim())
      .toBe('coalesce((select sum(i.amount) from public.bank_match_item i join public.bank_match b on b.id = i.match_id')
  })
  it('lo nuevo lee lo pagado de la vista de Pagos, y lleva su marca', () => {
    const nuevo = entre(N10, 'v_nuevo')
    expect(nuevo).toContain('select r.pagado from public.conta_recibida_pago r where r.invoice_id = si.id')
    expect(nuevo).toContain('-- N10 · todo lo pagado, como Pagos')
  })
  it('la cabecera declara las dos con su prueba de staging, y la prueba las nombra', () => {
    for (const f of ['bank_facturas_para_casar', 'bank_facturas_recibidas_pendientes']) {
      expect(N10).toContain(`-- cambia: public.${f} · prueba: ${PRUEBA}`)
      expect(readFileSync(PRUEBA, 'utf8')).toContain(`public.${f}`)
    }
    expect(N10).not.toContain('banco_facturas_recibidas_pendientes(uuid)\'')
  })
})
