// supabase/functions/_shared/verifactu/pruebasAeat.ts
//
// V03 · E1 · LAS ~25 FACTURAS CONTRA LA AEAT DE PRUEBAS (encargo: «unas 25, con
// una rectificativa y una a un cliente de fuera de la UE»). Solo staging, solo
// con la puerta en «pruebas»: la función conta-verifactu las registra por el
// mismo paso que la emisión (_verifactu_registrar, con su cerrojo y su huella)
// en una empresa de pruebas que lleva el NIF del certificado de pruebas, y las
// manda en un envío.
//
// Lo que se cubre (lo que Sumied emite hoy, y lo que el motor sabe hacer):
//   · 19 F1 a clientes españoles: al 21 %, al 10 %, con dos tipos y con recargo;
//   · 1 F1 a un cliente de Suiza (fuera de la UE), con IVA: IDOtro 04;
//   · 1 F1 a un cliente de Francia (UE), con IVA: IDOtro 02 y su NIF-IVA;
//   · 1 F1 a una persona con NIF (no una empresa);
//   · 1 R4 por diferencias (I) de una de las F1, en negativo;
//   · 1 F2 (tique) sin destinatario;
//   · 1 anulación de otra de las F1.
// Los NIF de los clientes son de los de ejemplo con su letra bien (no de nadie
// en el censo): si la AEAT de pruebas los da por no identificados, lo dirá en
// su código, y eso también es lo que se quiere ver.
//
// Núcleo sin Deno.

export interface Base {
  account_id: string
  company_id: string
  nif_emisor: string
  nombre_emisor: string
  /** Prefijo de los números de esta pasada (que no choquen con los de otra): «PR2610252301». */
  prefijo: string
  /** AAAA-MM-DD de hoy en Madrid. */
  fecha: string
}

export interface Caso {
  /** Lo que recibe _verifactu_registrar. */
  p: Record<string, unknown>
  /** Qué prueba, para el parte. */
  que: string
}

const r2 = (x: number) => Math.round(x * 100) / 100

function linea(tipo: number, base: number, recargo?: number) {
  const l: Record<string, unknown> = { impuesto: '01', clave_regimen: '01', calificacion: 'S1', tipo, base: r2(base), cuota: r2(base * tipo / 100) }
  if (recargo) { l.tipo_recargo = recargo; l.cuota_recargo = r2(base * recargo / 100) }
  return l
}

function totales(desglose: Record<string, unknown>[]) {
  const cuota = desglose.reduce((t, l) => t + Number(l.cuota ?? 0) + Number(l.cuota_recargo ?? 0), 0)
  const base = desglose.reduce((t, l) => t + Number(l.base), 0)
  return { cuota_total: r2(cuota), importe_total: r2(base + cuota) }
}

const CLIENTES_ES = [
  { nombre: 'Colegio de Prueba V03', nif: 'Q1234567D' },
  { nombre: 'Empresa de Prueba V03 SL', nif: 'B12345674' },
  { nombre: 'Sociedad de Prueba V03 SA', nif: 'A12345674' },
]

/** Los 25 casos, en el orden en que se registran (la anulación, al final). */
export function casosPruebas(b: Base): { altas: Caso[]; anular: number } {
  const comun = { account_id: b.account_id, company_id: b.company_id, entorno: 'pruebas', tipo: 'alta', origen: 'factura',
    origen_programa: 'pruebas_v03', nif_emisor: b.nif_emisor, nombre_emisor: b.nombre_emisor, fecha_expedicion: b.fecha, quien: 'Pruebas V03' }
  const num = (i: number) => `${b.prefijo}-${String(i).padStart(2, '0')}`
  const f1 = (i: number, que: string, destinatario: Record<string, unknown>, desglose: Record<string, unknown>[], descripcion: string): Caso => ({
    que, p: { ...comun, num_serie: num(i), tipo_factura: 'F1', descripcion, destinatarios: [destinatario], desglose, ...totales(desglose) },
  })
  const altas: Caso[] = []
  // 1–15: F1 al 21 % y al 10 %, importes distintos.
  for (let i = 1; i <= 15; i++) {
    const tipo = i % 3 === 0 ? 10 : 21
    altas.push(f1(i, `F1 al ${tipo} %`, CLIENTES_ES[i % 3], [linea(tipo, 40 + i * 7.35)], `Menú de empresa · ${i} servicios`))
  }
  altas.push(f1(16, 'F1 con dos tipos (21 % y 10 %)', CLIENTES_ES[0], [linea(21, 120), linea(10, 35.5)], 'Comida y bebida'))
  altas.push(f1(17, 'F1 con recargo de equivalencia (21 % + 5,2 %)', CLIENTES_ES[1], [linea(21, 200, 5.2)], 'Venta a un comercio minorista'))
  altas.push(f1(18, 'F1 a una persona con NIF', { nombre: 'Persona de Prueba V03', nif: '12345678Z' }, [linea(10, 64)], 'Catering de un cumpleaños'))
  altas.push(f1(19, 'F1 a un cliente de Suiza (fuera de la UE), con IVA: IDOtro 04',
    { nombre: 'Alpen Gastro AG (prueba V03)', codigo_pais: 'CH', id_type: '04', id: 'CHE123456789' }, [linea(21, 600)], 'Menú de empresa (evento en Madrid)'))
  altas.push(f1(20, 'F1 a un cliente de Francia (UE), con IVA: IDOtro 02',
    { nombre: 'Bistrot Essai SARL (prueba V03)', codigo_pais: 'FR', id_type: '02', id: 'FR12345678901' }, [linea(10, 150)], 'Comida de grupo en Madrid'))
  for (let i = 21; i <= 22; i++) altas.push(f1(i, 'F1 al 21 %', CLIENTES_ES[i % 3], [linea(21, 99.9 + i)], 'Menú del día'))
  // 23: la rectificativa (R4, por diferencias) de la 2: un servicio de menos.
  const orig = altas[1].p
  const dif = [linea(21, -7.35)]
  altas.push({ que: 'R4 por diferencias (I) de la 2, en negativo', p: { ...comun, num_serie: `${b.prefijo}-R1`, tipo_factura: 'R4', tipo_rectificativa: 'I',
    rectificadas: [{ nif: b.nif_emisor, num_serie: orig.num_serie, fecha: b.fecha }], descripcion: 'Un servicio de menos',
    destinatarios: orig.destinatarios, desglose: dif, ...totales(dif) } })
  // 24: un tique (F2), sin destinatario.
  const t = [linea(10, 18.18)]
  altas.push({ que: 'F2 (tique) sin destinatario', p: { ...comun, origen: 'simplificada', num_serie: `${b.prefijo}-T1`, tipo_factura: 'F2', descripcion: 'Venta en barra', desglose: t, ...totales(t) } })
  // 25: la anulación de la 22 (se registra después de las altas).
  return { altas, anular: 21 }
}
