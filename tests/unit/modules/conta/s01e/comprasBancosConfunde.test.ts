// tests/unit/modules/conta/s01e/comprasBancosConfunde.test.ts
//
// S01e · Lo que confundía en Compras y gastos, Facturas recibidas, Bancos y
// Contactos (auditoría de navegación), en lo que se puede probar sin pantalla:
//   · «Subir una factura» y «Subir varias a la vez» se llaman distinto;
//   · los rótulos de la cinta de Facturas recibidas, en palabras normales y los
//     mismos en la pantalla y en la cinta;
//   · sin «Cegid» en la línea de Diez;
//   · Bancos abre en el banco y el mes con movimientos;
//   · «Lo que he hecho» dice qué cuenta;
//   · el «···» de una fila se abre hacia arriba solo si abajo no cabe.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ordenPorId } from '@/modules/conta/esqueleto/ordenes'
import { barra, lineaDiez, type DatosDocumentos } from '@/modules/conta/documentos/documentos'
import { bancoInicial, mesInicial } from '@/modules/conta/bancos/navegacion'
import { fraseHecho } from '@/modules/conta/bancos/textosBancos'
import { mesesElegibles } from '@/modules/conta/lib/bancosVista'
import { abrirHaciaArriba } from '@/modules/conta/proveedor/useMenuFila'

const datos = (o: Partial<DatosDocumentos> = {}): DatosDocumentos => ({
  desde: '2026-10-01', hasta: '2026-10-31', correo: { activo: false, direccion: null }, recibe_mercancia: false,
  filas: [], esperadas: [], ...o,
  cifras: { llegadas: 0, llegadas_por_canal: {}, apuntadas_solas: 0, apuntadas: 0, para_mirar: 0, por_aclarar: 0, esperadas_no_llegadas: 0 },
})

describe('subir (S02): UN «Subir factura» en Compras, el de Facturas recibidas (regla 1 del patrón)', () => {
  it('el catálogo y la pantalla dicen lo mismo, y lleva a Facturas recibidas', () => {
    const o = ordenPorId('compras.subir')!
    expect(o.etiqueta).toBe('Subir factura')
    expect(o.pestana).toBe('recibidas')
    expect(readFileSync('src/modules/conta/documentos/DocumentosPage.tsx', 'utf8')).toMatch(/>Subir factura<\/Boton>/)
    // La barra de antes de la N22 se queda como dato de la pantalla, sin su «Subir varias a la vez» como botón aparte.
    expect(barra(datos(), { solo: false, producto: 'Folvy' })[0].entradas.find((e) => e.id === 'subir')!.nombre).toBe('Subir varias a la vez')
  })
  it('en Recepciones del local ya no hay un «Subir una factura» suelto: solo el de cada recepción', () => {
    const compras = readFileSync('src/modules/conta/compras/ComprasPage.tsx', 'utf8')
    expect(compras).not.toMatch(/>Subir una factura</)
  })
})


describe('la línea de Diez, sin el nombre del fabricante', () => {
  it('con y sin marca', () => {
    expect(lineaDiez()).not.toMatch(/Cegid/)
    expect(lineaDiez(true)).toBe('Se apunta aquí · a Diez irá sin el PDF, porque Diez aún no guarda documentos')
  })
})

describe('Bancos abre donde hay movimientos', () => {
  const ext = (hasta: string) => ({ hasta })
  const norte = { id: 'norte', ultimoExtracto: ext('2026-09-30') }
  const mercado = { id: 'mercado', ultimoExtracto: ext('2026-10-13') }
  const vacio = { id: 'vacio', ultimoExtracto: null }

  it('el banco con el extracto más reciente, aunque no sea el primero de la lista', () => {
    expect(bancoInicial([vacio, norte, mercado], {})?.id).toBe('mercado')
  })
  it('a igualdad de extracto, el de más dudas', () => {
    expect(bancoInicial([norte, { id: 'sur', ultimoExtracto: ext('2026-09-30') }], { sur: 4, norte: 1 })?.id).toBe('sur')
  })
  it('sin ningún extracto, el primero; sin bancos, ninguno', () => {
    expect(bancoInicial([vacio, { id: 'otro', ultimoExtracto: null }], {})?.id).toBe('vacio')
    expect(bancoInicial([], {})).toBeNull()
  })
  it('el mes, el del último extracto del banco elegido si se puede elegir; si no, el más reciente', () => {
    const meses = mesesElegibles('2026-08-02', '2026-10-18')
    expect(meses[0]).toBe('2026-10')
    expect(mesInicial(meses, norte, '2026-10-18')).toBe('2026-09')
    expect(mesInicial(meses, mercado, '2026-10-18')).toBe('2026-10')
    expect(mesInicial(meses, vacio, '2026-10-18')).toBe('2026-10')
    expect(mesInicial(meses, { ultimoExtracto: ext('2026-06-30') }, '2026-10-18')).toBe('2026-10')
    expect(mesInicial([], null, '2026-10-18')).toBe('2026-10')
  })
})

describe('«Lo que he hecho» dice qué cuenta', () => {
  it('todos los bancos, en el mes; y lo que sigue vivo', () => {
    expect(fraseHecho(0, 0, 'octubre')).toBe('En octubre no he casado nada solo en ninguno de tus bancos.')
    expect(fraseHecho(52, 50, 'octubre')).toBe('En octubre, en todos tus bancos, he casado yo 52 movimientos; 50 siguen como los dejé.')
    expect(fraseHecho(3, 3, 'octubre')).toBe('En octubre, en todos tus bancos, he casado yo 3 movimientos; siguen todos como los dejé.')
    expect(fraseHecho(1, 1, 'octubre')).toBe('En octubre, en todos tus bancos, he casado yo 1 movimiento; sigue como lo dejé.')
    expect(fraseHecho(2, 1, 'octubre')).toBe('En octubre, en todos tus bancos, he casado yo 2 movimientos; 1 sigue como los dejé.')
  })
})

describe('el «···» de una fila', () => {
  it('se abre debajo si cabe; hacia arriba solo si abajo no cabe y arriba sí', () => {
    expect(abrirHaciaArriba({ top: 100, bottom: 160 }, 900)).toBe(false)
    expect(abrirHaciaArriba({ top: 780, bottom: 840 }, 900)).toBe(true)
    expect(abrirHaciaArriba({ top: 40, bottom: 100 }, 150)).toBe(false)
  })
})
