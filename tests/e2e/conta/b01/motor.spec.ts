/// <reference lib="dom" />
// tests/e2e/conta/b01/motor.spec.ts
//
// B01 · El motor de conciliación funcionando en staging-conta, ANTES de las
// pantallas (respuesta 1: «para en la 5 con capturas de staging del motor
// funcionando sobre un Norma 43 inventado de las tres cuentas»).
//
// Como el administrador de A, con su sesión (la misma RLS que la pantalla) y
// el MISMO código que usará la app (services/bancosNucleo.ts sobre la base):
//   1. escribe un Norma 43 inventado de los tres bancos de la semilla B01
//      (supabase/seeds/conta/seed_b01_staging.sql), lo lee y lo cuadra;
//   2. empareja cada cuenta por su IBAN e importa (la segunda vez: «ya se subió»);
//   3. concilia: lo seguro se casa solo, lo demás queda propuesto o por aclarar;
//   4. hace la captura de lo que ha quedado (docs/conta/capturas/b01/);
//   5. DESHACE todo: el libro de A queda con los mismos asientos que antes
//      (mismo recuento, tomado igual, antes y después: regla 31).
// Solo en «ordenador»: el motor no tiene lado móvil y no se importa dos veces.

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { CUENTA_A, enCarril } from '../sesion'
import { eurosCent } from '@/modules/conta/lib/extractoBanco'
import { crearBancos, emparejar, leerYCuadrar } from '@/modules/conta/services/bancosNucleo'
import { BANCOS_B01, EMPRESA_A, FICHERO, baseDeA } from './datos'

const DIR = 'docs/conta/capturas/b01'

type Fila = Record<string, unknown>

test.describe('B01 · motor de conciliación en staging', () => {
  test.skip(({ isMobile }) => isMobile, 'El motor se prueba una vez, en ordenador.')

  test('Norma 43 de tres cuentas: leer, importar, conciliar, capturar y deshacer', async ({ page }) => {
    test.setTimeout(180_000)
    const { cliente, bd, contarAsientosA, deshacerTodo } = await baseDeA()
    const bancos = crearBancos(bd)

    // 0 · Como estaba: sin casados vivos de la demostración anterior.
    await deshacerTodo('Limpieza antes de la demostración B01')
    const asientosAntes = await contarAsientosA()

    // 1 · Leer y cuadrar, como «Subir extracto».
    const abierto = { nombre: 'b01-tres-cuentas.n43', sha256: createHash('sha256').update(FICHERO).digest('hex'), contenido: { texto: FICHERO } }
    const { extracto, cuadre, resumen } = leerYCuadrar(abierto)
    expect(cuadre.ok).toBe(true)
    expect(resumen).toBe('He leído 3 cuentas, 15 movimientos, del 02/10 al 13/10; cuadra con el saldo del banco.')

    // 2 · Cada cuenta con su banco por IBAN, e importar.
    const mios = await bancos.bancosDeLaEmpresa(CUENTA_A.id, EMPRESA_A)
    const asignacion = emparejar(extracto, mios)
    expect(asignacion).toEqual(BANCOS_B01)
    const imp = await bancos.importar(abierto, extracto, cuadre, asignacion)
    const importacion = imp.map((x) => x.repetido ? `${mios.find((b) => b.id === x.banco)?.nombre}: ${x.mensaje}` : `${mios.find((b) => b.id === x.banco)?.nombre}: ${x.nuevos} nuevos, continuidad ${x.continuidad}`)
    // Solo los de ESTE fichero (por la huella de su extracto): b01/conciliar importa además
    // b02-recargas.n43 (3 movimientos en Mercado) y, si va antes en el mismo carril, la
    // cuenta de todos los de los bancos daba 18 (#334, 26/10).
    const { count: nMovs } = await cliente.from('bank_movement').select('id, bank_statement!inner(file_sha256)', { count: 'exact', head: true })
      .in('treasury_account_id', BANCOS_B01).eq('bank_statement.file_sha256', abierto.sha256)
    expect(nMovs).toBe(15)

    // 3 · Conciliar.
    const r = await bancos.conciliarPendientes(CUENTA_A.id, EMPRESA_A, '2026-10-13')
    expect(r.fallos).toEqual([])

    // 4 · Lo que ha quedado, leído de la base.
    const { data: movs } = await cliente.from('bank_movement')
      .select('id, treasury_account_id, op_date, amount, clean_concept, status, confidence, reason, proposal')
      .in('treasury_account_id', BANCOS_B01).order('op_date').order('created_at')
    const filas = (movs ?? []) as Fila[]
    const { data: casados } = await cliente.from('bank_match').select('movement_id, kind, entry_created, reason, journal_entry_id').eq('status', 'vivo')
      .in('movement_id', filas.map((f) => f.id as string))
    const casadoDe = new Map(((casados ?? []) as Fila[]).map((c) => [String(c.movement_id), c]))
    const seguro = filas.filter((f) => f.status === 'casado')
    // Los tres casos seguros del extracto: la factura con referencia, el traspaso (dos lados) y la liquidación.
    expect(seguro.map((f) => String(f.clean_concept)).sort()).toEqual([
      'Recibo SUMINISTROS B01 DEL NORTE FRA B01-0477', 'Transferencia de GLOVO liquidacion 1-7 oct', 'Traspaso a cuenta B01 SUR', 'Traspaso de cuenta B01 NORTE',
    ].sort())
    expect(filas.filter((f) => f.status === 'propuesto').length + filas.filter((f) => f.status === 'por_aclarar').length).toBe(11)
    const factura = await cliente.from('supplier_invoice').select('status, paid_at, paid_method').eq('id', enCarril('b0100000-0000-4000-8000-000000000f77')).single()
    expect(factura.data).toMatchObject({ status: 'pagada', paid_at: '2026-10-02', paid_method: 'direct_debit' })

    // La captura: la tabla como la verá N17 (fecha, lo que dice el banco, importe, punto, lo que Folvy cree que es).
    const nombreBanco = new Map(mios.map((b) => [b.id, b.nombre]))
    const punto = (f: Fila) => (f.status === 'casado' ? '#16a34a' : f.status === 'propuesto' ? '#f59e0b' : '#9ca3af')
    const que = (f: Fila) => {
      const c = casadoDe.get(String(f.id))
      if (c) return `Casado solo · ${c.kind === 'traspaso' ? 'traspaso entre tus cuentas' : c.kind === 'liquidacion' ? 'cobro de su liquidación' : c.kind === 'factura_recibida' ? 'pago de la factura' : String(c.kind)}`
      return String((f.proposal as Fila | null)?.que ?? '')
    }
    const html = `<!doctype html><meta charset="utf-8"><style>
      body{font-family:Geist,Inter,system-ui,sans-serif;margin:24px;color:#0f172a;background:#f8fafc}
      h1{font-size:22px;margin:0 0 4px} p{margin:4px 0 14px;color:#334155}
      .banda{background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:12px 16px;margin-bottom:14px}
      table{border-collapse:collapse;width:100%;background:#fff;border-radius:12px;overflow:hidden}
      th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#475569;text-align:left;padding:10px;border-bottom:1px solid #e2e8f0}
      td{padding:9px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;vertical-align:top}
      .imp{font-family:'Geist Mono',ui-monospace,monospace;text-align:right;white-space:nowrap}.entra{color:#15803d}
      .dot{display:inline-block;width:10px;height:10px;border-radius:50%} .por{color:#475569;font-size:12px}</style>
      <h1>Bancos › Movimientos · staging-conta (empresa A) · motor del B01</h1>
      <div class="banda"><b>He casado yo ${seguro.length} de ${filas.length} movimientos de octubre. Te quedan ${filas.filter((f) => f.status === 'propuesto').length} por confirmar y ${filas.filter((f) => f.status === 'por_aclarar').length} por aclarar.</b></div>
      <p>${resumen} ${importacion.join(' · ')}.</p>
      <table><tr><th>Banco</th><th>Fecha</th><th>Lo que dice el banco</th><th>Importe</th><th></th><th>Lo que Folvy cree que es</th></tr>
      ${filas.map((f) => `<tr><td>${nombreBanco.get(String(f.treasury_account_id)) ?? ''}</td><td>${String(f.op_date).slice(8, 10)}/${String(f.op_date).slice(5, 7)}</td>
        <td>${f.clean_concept}</td><td class="imp ${Number(f.amount) > 0 ? 'entra' : ''}">${Number(f.amount) > 0 ? '+' : ''}${eurosCent(Math.round(Number(f.amount) * 100))}</td>
        <td><span class="dot" style="background:${punto(f)}"></span></td>
        <td><b>${que(f)}</b><div class="por">${f.reason ?? ''}</div></td></tr>`).join('')}
      </table>`
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.setContent(html)
    mkdirSync(DIR, { recursive: true })
    await page.screenshot({ path: `${DIR}/motor-ordenador.png`, fullPage: true })
    writeFileSync(`${DIR}/motor.md`, [
      '# B01 · El motor en staging-conta (empresa A, datos inventados)', '',
      `Generado por \`tests/e2e/conta/b01/motor.spec.ts\`. ${resumen}`, '',
      `Importación: ${importacion.join(' · ')}.`, '',
      '| Banco | Fecha | Lo que dice el banco | Importe | Estado | Lo que Folvy cree que es | Porqué |', '|---|---|---|---:|---|---|---|',
      ...filas.map((f) => `| ${nombreBanco.get(String(f.treasury_account_id)) ?? ''} | ${f.op_date} | ${f.clean_concept} | ${eurosCent(Math.round(Number(f.amount) * 100))} | ${f.status === 'casado' ? 'casado solo' : f.status === 'propuesto' ? 'para confirmar' : 'por aclarar'} | ${que(f)} | ${String(f.reason ?? '').replace(/\|/g, '/')} |`),
      '', `Asientos de la empresa A antes: ${asientosAntes}.`,
    ].join('\n') + '\n')

    // 5 · Deshacer todo: el libro de A, como estaba (mismo recuento, misma vara).
    await deshacerTodo('Limpieza después de la demostración B01')
    const asientosDespues = await contarAsientosA()
    expect(asientosDespues).toBe(asientosAntes)
    const otra = await cliente.from('supplier_invoice').select('status').eq('id', enCarril('b0100000-0000-4000-8000-000000000f77')).single()
    expect(otra.data).toMatchObject({ status: 'aprobada' })
    writeFileSync(`${DIR}/motor.md`, `Asientos de la empresa A después de deshacer: ${asientosDespues} (antes ${asientosAntes}).\n`, { flag: 'a' })
  })
})
