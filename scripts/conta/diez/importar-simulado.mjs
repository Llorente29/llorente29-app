// scripts/conta/diez/importar-simulado.mjs
//
// C04b · T3 · Datos INVENTADOS para ensayar la tanda del histórico en
// staging con el Diez de mentira (falso.mjs). Tienen la FORMA de lo medido en
// la C0008 (T1, T2 §10), ni un dato de verdad:
//   · dos ejercicios, 2023 (desde octubre) y 2024, de la empresa de la cuenta A
//     de pruebas (en staging, 2025 está cerrado y 2026 es de Folvy);
//   · regularización (tipo 4) y cierre (5) el 31/12/2023 y apertura (3) el
//     01/01/2024: el testigo se mide sin los dos primeros;
//   · facturas de las series 1 y 2 (una de plataforma, que espera el
//     documento de su portal), banco en la 3 y general en la 4;
//   · un negativo de Diez, un asiento con las líneas a cero (no se convierte, como los 4 de 2023),
//     uno posterior al corte y una subcuenta que el plan no tiene.
// Las subcuentas son de las que ya tiene la empresa A, salvo 40000901 y
// 43000901 (inventadas, cuelgan de 4000 y 4300).

const L = (Cuenta, Debe = 0, Haber = 0) => ({ Cuenta, Debe, Haber })
const A = (Ejercicio, Serie, Documento, Fecha, TipoAsiento, Descripcion, lineas) => ({
  Ejercicio, Serie, Documento, Fecha, TipoAsiento, Descripcion,
  Detalles: lineas.map((l, i) => ({ Linea: i + 1, Contrapartida: '', ...l })),
})

export function datosSimulados() {
  const apuntes = [
    // 2023, desde octubre
    A('2023', '1', 1, 20231031, 1, 'Ventas plataforma inventada', [L('43000901', 110), L('70000000', 0, 100), L('47700000', 0, 10)]),
    A('2023', '2', 1, 20231105, 2, 'Compra inventada', [L('60000000', 200), L('47200000', 21), L('40000901', 0, 221)]),
    A('2023', '3', 1, 20231110, 0, 'Pago inventado', [L('40000901', 221), L('57200001', 0, 221)]),
    A('2023', '4', 1, 20231115, 0, 'Abono con negativo', [L('70000000', -5), L('57000000', 0, -5)]),
    A('2023', '4', 2, 20231120, 0, 'Líneas a cero', [L('57000000', 0, 0), L('55100000', 0, 0)]),
    A('2023', '4', 3, 20231231, 4, 'Regularización inventada', [L('70000000', 95), L('60000000', 0, 200), L('12900000', 105)]),
    A('2023', '4', 4, 20231231, 5, 'Cierre inventado', [L('12900000', 0, 105), L('43000901', 0, 110), L('57000000', 5), L('57200001', 221), L('47200000', 0, 21), L('47700000', 10)]),
    // 2024
    A('2024', '4', 1, 20240101, 3, 'Apertura inventada', [L('12900000', 105), L('43000901', 110), L('57000000', 0, 5), L('57200001', 0, 221), L('47200000', 21), L('47700000', 0, 10)]),
    A('2024', '2', 1, 20240210, 2, 'Compra inventada 2', [L('60000000', 50), L('47200000', 10.5), L('40000901', 0, 60.5)]),
    A('2024', '1', 1, 20240229, 1, 'Ventas inventadas', [L('43000901', 220), L('70000000', 0, 200), L('47700000', 0, 20)]),
    A('2024', '4', 2, 20241231, 0, 'Posterior al corte', [L('57000000', 1), L('55100000', 0, 1)]),
  ]
  const subcuentas = [
    { Codigo: '40000901', Descripcion: 'PROVEEDOR INVENTADO' },
    { Codigo: '43000901', Descripcion: 'GLOVO INVENTADO' },
    { Codigo: '57000000', Descripcion: 'CAJA' },
  ]
  // [ejercicio, hasta]: el testigo de cada uno, como los Excel (2024, hasta el corte).
  return { apuntes, subcuentas, ejercicios: [['2023', '2023-12-31'], ['2024', '2024-12-30']], desde: '202310', hasta: '202412', corte: '2024-12-30' }
}
