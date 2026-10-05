#!/usr/bin/env node
// tests/conta/fixtures/importar/diez/generar.mjs
//
// C02c · Fixture INVENTADA con la misma FORMA que el Cegid Diez de un cliente
// real (encargo §3): mismos recuentos y mismos casos, nombres y NIF falsos.
// Ningún dato sale del fichero real: los recuentos son los del encargo.
//
//   node tests/conta/fixtures/importar/diez/generar.mjs
//
// Escribe, junto a este fichero:
//   plan.csv          codigo;nombre — grupos, subgrupos, cuentas y subcuentas
//                     (las de serie de pymes rellenadas a 8 y las 96 «tuyas»).
//   proveedores.csv   codigo;nif;nombre;direccion;cp;poblacion;provincia (55; 41 con NIF)
//   clientes.csv      igual (7; 3 con NIF)
//   folvy.json        lo que hay en Folvy en la cuenta A de staging para casar:
//                     proveedores (con y sin NIF) y bancos (uno con el IBAN de Diez).
//
// Los NIF son CIF de letra B con su dígito de control bien calculado, en la
// serie B99xxxxx (inventada). Los IBAN, españoles válidos (mod 97) con la
// entidad 9999, que no existe.

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const aqui = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const serie = require('../../../../../supabase/conta/pgc/serie.json')

const D = 8

// ── NIF (CIF B) e IBAN inventados, válidos ──────────────────────────────────
function controlCif(siete) {
  let a = 0, b = 0
  for (let i = 0; i < 7; i++) {
    const d = Number(siete[i])
    if (i % 2 === 1) a += d
    else { const x = d * 2; b += Math.floor(x / 10) + (x % 10) }
  }
  return (10 - ((a + b) % 10)) % 10
}
const cif = (n) => { const siete = String(9900000 + n); return `B${siete}${controlCif(siete)}` }

function iban(cuenta20) {
  const num = (cuenta20 + 'ES00').replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let r = 0
  for (let i = 0; i < num.length; i += 7) r = Number(String(r) + num.slice(i, i + 7)) % 97
  return `ES${String(98 - r).padStart(2, '0')}${cuenta20}`
}
const grupos4 = (s) => s.replace(/(.{4})/g, '$1 ').trim()

// ── Las 96 tuyas (encargo §3, con nombres inventados) ───────────────────────
const tuyas = []
const proveedores = []
const clientes = []
let nifN = 1
const conNif = () => cif(nifN++)

// 400: 40000001–18, 40000099 «Facturas por localizar», 40000200–201. NIF en 15 de las 20 con tercero.
const nombres400 = [
  'DISTRIBUCIONES ALBA ORIENTE', 'CARNICAS VALLE ALTO', 'NORTE SOCIOS, S.L.', 'PANIFICADORA LUNA NUEVA', 'FRUTAS HERMANOS SOTO',
  'BEBIDAS SOL DE TARDE', 'CONGELADOS PUERTO GRIS', 'LACTEOS PRADERA FRIA', 'ENVASES RIO CLARO', 'ACEITES CAMPO VIEJO',
  'MAYORISTA ESTE CENTRO', 'PESCADOS LONJA AZUL', 'ESPECIAS RUTA LARGA', 'SALSAS TIERRA ROJA', 'QUESOS MONTE BAJO',
  'HUEVOS GRANJA PINAR', 'PATATAS SURCO FINO', 'VERDURAS HUERTA OESTE',
]
nombres400.forEach((n, i) => {
  const code = `4000${String(i + 1).padStart(4, '0')}`
  tuyas.push([code, n])
  // Sin NIF: 3 de 18 (los 6, 11 y 17).
  proveedores.push({ code, nombre: n, nif: [5, 10, 16].includes(i) ? '' : conNif() })
})
tuyas.push(['40000099', 'FACTURAS POR LOCALIZAR']); proveedores.push({ code: '40000099', nombre: 'FACTURAS POR LOCALIZAR', nif: '' })
tuyas.push(['40000200', 'COMPRAS VARIAS SUPERMERCADO']); proveedores.push({ code: '40000200', nombre: 'COMPRAS VARIAS SUPERMERCADO', nif: '' })
tuyas.push(['40000201', 'GRAN SUPERFICIE OESTE']); proveedores.push({ code: '40000201', nombre: 'GRAN SUPERFICIE OESTE', nif: conNif() })

// 410: 34 acreedores. Plataformas de reparto (nombres reales: así lo permite la maqueta), suministros, asesoría, 41000100 «Riders».
const nombres410 = [
  'GLOVOAPP SPAIN PLATFORM', 'UBER EATS SPAIN', 'JUST EAT SPAIN', 'ELECTRICA RED NORTE', 'AGUAS DEL CANAL ESTE',
  'GAS NATURAL OESTE', 'TELEFONIA LINEA UNO', 'MOVILES ONDA CORTA', 'ASESORIA CUENTAS CLARAS', 'GESTORIA PAPEL BLANCO',
  'LIMPIEZAS BRILLO SUR', 'MANTENIMIENTO FRIO TOTAL', 'SEGUROS TEJADO FIRME', 'ALQUILERES NAVE NORTE', 'PUBLICIDAD FAROL ROJO',
  'TRANSPORTES RUEDA LIBRE', 'MENSAJERIA PAQUETE VELOZ', 'IMPRENTA TINTA FRESCA', 'INFORMATICA BIT A BIT', 'PLAGAS CONTROL CERO',
  'EXTINTORES LLAMA FUERA', 'UNIFORMES COSTURA FINA', 'RECOGIDA ACEITE VERDE', 'SOFTWARE CAJA RAPIDA', 'DISENO LETRA GRANDE',
  'FOTOGRAFIA PLATO LLENO', 'ABOGADOS LEY CLARA', 'NOTARIA FIRMA SEGURA', 'PREVENCION RIESGO MINIMO', 'FORMACION AULA ABIERTA',
  'BANCO COMISIONES TPV', 'RENTING COCHE AZUL', 'REPARACIONES CAZO ROTO',
]
nombres410.forEach((n, i) => {
  const code = `4100${String(i + 1).padStart(4, '0')}`
  tuyas.push([code, n])
  // Sin NIF: 8 de 33 (para que salgan 41 con NIF de 55 terceros).
  proveedores.push({ code, nombre: n, nif: [4, 7, 12, 15, 19, 22, 25, 28].includes(i) ? '' : conNif() })
})
tuyas.push(['41000100', 'RIDERS']); proveedores.push({ code: '41000100', nombre: 'RIDERS', nif: '' })

// 430: 7. Glovo cliente sin NIF; Norte Socios también es proveedor (40000003); 43000101 «Glovo Ventas» no es un tercero.
const norteSocios = proveedores.find((p) => p.code === '40000003').nif
const c430 = [
  ['43000001', 'GLOVO', ''],
  ['43000002', 'UBER EATS', ''],
  ['43000003', 'JUST EAT', cif(900)],
  ['43000004', 'NUBE COCINAS COMPARTIDAS', cif(901)],
  ['43000005', 'NORTE SOCIOS, S.L.', norteSocios],
  ['43000006', 'ALDEA CLIENTES DE EVENTOS', ''],
  ['43000101', 'GLOVO VENTAS', ''],
]
for (const [code, nombre, nif] of c430) { tuyas.push([code, nombre]); clientes.push({ code, nombre, nif }) }

// 572: dos bancos con el IBAN en el nombre (el primero está en Folvy).
const ibanUno = iban('99990001510200012345')
const ibanDos = iban('99990001510200067890')
tuyas.push(['57200001', `BANCO PRUEBA ${grupos4(ibanUno)}`])
tuyas.push(['57200002', `BANCO PRUEBA DOS ${grupos4(ibanDos)}`])

// Retenciones: una del local; dos IGUALES (¿cuál es 111 y cuál 115?).
tuyas.push(['47510001', 'H.P. ACREEDORA RET. ALQUILER LOCAL NORTE'])
tuyas.push(['47510015', 'HACIENDA PUBLICA ACREEDORA POR RETENCIONES IRPF'])
tuyas.push(['47510019', 'HACIENDA PUBLICA ACREEDORA POR RETENCIONES IRPF'])

// Gastos, socios, préstamo y demás (sin ficha).
for (const [code, nombre] of [
  ['60000001', 'COMPRAS SUPER'], ['62300001', 'COMISIONES GLOVO'], ['62300002', 'COMISIONES UBER EATS'], ['62300003', 'COMISIONES JUST EAT'],
  ['62400001', 'TRANSPORTE REPARTO'], ['62900001', 'OTROS SERVICIOS UNO'], ['62900002', 'OTROS SERVICIOS DOS'], ['62900003', 'OTROS SERVICIOS TRES'],
  ['62900004', 'OTROS SERVICIOS CUATRO'], ['62900005', 'OTROS SERVICIOS CINCO'], ['62900099', 'OTROS SERVICIOS VARIOS'],
  ['17000001', 'PRESTAMO BANCO PRUEBA'], ['52000001', 'POLIZA CREDITO BANCO PRUEBA'],
  ['52100001', 'DEUDA CORTO PLAZO UNO'], ['52100002', 'DEUDA CORTO PLAZO DOS'], ['52100003', 'DEUDA CORTO PLAZO TRES'], ['52100004', 'DEUDA CORTO PLAZO CUATRO'], ['52100005', 'DEUDA CORTO PLAZO CINCO'],
  ['55100001', 'CUENTA CORRIENTE SOCIO UNO'], ['55100002', 'CUENTA CORRIENTE SOCIO DOS'], ['55500001', 'PARTIDAS PENDIENTES DE APLICACION'],
  ['46500001', 'REMUNERACIONES PENDIENTES UNO'], ['46500002', 'REMUNERACIONES PENDIENTES DOS'], ['47300001', 'H.P. RETENCIONES Y PAGOS A CUENTA'],
  ['62100001', 'ALQUILER LOCAL NORTE'], ['62800001', 'SUMINISTRO LUZ'], ['62800002', 'SUMINISTRO AGUA'], ['62600001', 'SERVICIOS BANCARIOS'], ['64000001', 'SUELDOS Y SALARIOS'],
]) tuyas.push([code, nombre])

if (tuyas.length !== 96) throw new Error(`Salen ${tuyas.length} tuyas, no 96.`)
const conNifTerceros = proveedores.filter((p) => p.nif).length
if (proveedores.length !== 55 || conNifTerceros !== 41) throw new Error(`Proveedores ${proveedores.length} (${conNifTerceros} con NIF), no 55 (41).`)
if (clientes.filter((c) => c.nif).length !== 3) throw new Error('Clientes con NIF: tienen que ser 3.')

// ── El plan: cabeceras (grupo, subgrupo, cuenta) + hojas de serie rellenadas + las tuyas ──
const pymes = serie.cuentas.filter((c) => c.plan === 'pymes' && !c.valid_to)
const filas = []
for (const c of pymes) {
  // Diez escribe el NOMBRE del cuadro en mayúsculas en las cabeceras y las de serie.
  filas.push([c.is_leaf ? c.code.padEnd(D, '0') : c.code, c.name.toUpperCase()])
}
for (const t of tuyas) filas.push(t)
filas.sort((a, b) => (a[0].padEnd(D, ' ') < b[0].padEnd(D, ' ') ? -1 : a[0].padEnd(D, ' ') > b[0].padEnd(D, ' ') ? 1 : a[0].length - b[0].length))

const csv = (cab, rows) => [cab.join(';'), ...rows.map((r) => r.map((x) => (/[;"]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(';'))].join('\n') + '\n'
writeFileSync(join(aqui, 'plan.csv'), csv(['codigo', 'nombre'], filas))
const dir = (i) => [`CALLE INVENTADA ${i + 1}`, String(28000 + ((i * 7) % 90)).padStart(5, '0'), 'MADRID', 'MADRID']
writeFileSync(join(aqui, 'proveedores.csv'), csv(['codigo', 'nif', 'nombre', 'direccion', 'cp', 'poblacion', 'provincia'], proveedores.map((p, i) => [p.code, p.nif, p.nombre, ...dir(i)])))
writeFileSync(join(aqui, 'clientes.csv'), csv(['codigo', 'nif', 'nombre', 'direccion', 'cp', 'poblacion', 'provincia'], clientes.map((p, i) => [p.code, p.nif, p.nombre, ...dir(i + 60)])))

// ── Lo que hay en Folvy (cuenta A de staging) para casar ─────────────────────
// · mismo NIF que en Diez (seguro): 5 proveedores;
// · mismo nombre SIN NIF en la ficha y con NIF en Diez (probable): 2;
// · mismo nombre, sin NIF en ninguno de los dos (probable): 1 (BEBIDAS SOL DE TARDE → «Bebidas Sol de Tarde»);
// · un proveedor de Folvy que no está en Diez (propuesta de la IA: 40000019).
const p = (code) => proveedores.find((x) => x.code === code)
const folvy = {
  proveedores: [
    { name: 'Distribuciones Alba Oriente', nif: p('40000001').nif },
    { name: 'Cárnicas Valle Alto', nif: p('40000002').nif },
    { name: 'Norte Socios, S.L.', nif: p('40000003').nif },
    { name: 'Panificadora Luna Nueva', nif: p('40000004').nif },
    { name: 'Eléctrica Red Norte', nif: p('41000004').nif },
    { name: 'Frutas Hermanos Soto', nif: null },
    { name: 'Asesoría Cuentas Claras', nif: null },
    { name: 'Bebidas Sol de Tarde', nif: null },
    { name: 'Hielo Polar del Barrio', nif: cif(950) },
  ],
  bancos: [{ name: 'Banco Prueba', iban: ibanUno }],
}
writeFileSync(join(aqui, 'folvy.json'), JSON.stringify(folvy, null, 2) + '\n')
console.log(`plan.csv ${filas.length} filas (${tuyas.length} tuyas) · proveedores.csv ${proveedores.length} (${conNifTerceros} con NIF) · clientes.csv ${clientes.length} · folvy.json`)
