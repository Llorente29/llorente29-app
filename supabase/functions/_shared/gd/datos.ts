// supabase/functions/_shared/gd/datos.ts
//
// GD · «Gestoría Demo»: los clientes de la demo, tal como tienen que quedar en
// el Bitrix24 de pruebas y en el sandbox de GoCardless (Julio, nº27: mandan
// ellos; Sumied los lee). Puro: lo usan el guion que siembra
// (sembrarPruebas.ts) y sus pruebas (tests/unit/modules/conta/gd/datos.test.ts).
//
// Todo inventado (T11): nombres de negocios y personas de ficción, NIF de
// ceros delante con su dígito de control bien (B00001…, 000010…), correos en
// example.com y cuentas del banco 2100 con sus controles bien hechos, solo
// para el sandbox. Ningún dato de QBO ni de sus clientes.

export type Situacion = 'Activo' | 'Moroso' | 'Baja' | 'Solo renta'
export type Servicio = 'Contabilidad' | 'Laboral'
/**
 * El escenario del sandbox: va en el given_name del cliente de GoCardless (Successful activa y cobra; Penniless falla;
 * Fickle cobra y se retrocede). «normal» se siembra como Successful (mandato firmado al momento); «por_firmar», con su
 * nombre de verdad: el sandbox deja su mandato en «pending_submission» y Sumied lo enseña «por firmar» (Julio, nº62:
 * dos, para que el aviso salga sin dominar).
 */
export type Escenario = 'normal' | 'por_firmar' | 'Successful' | 'Penniless' | 'Fickle'

/** Las dos empresas emisoras de la demo. «Forma de pago» en Bitrix24 dice de cuál es cada cliente. */
export const EMISORES = {
  sociedad: { nombre: 'Gestoría Demo, S.L.', nifBase: '0000100', formaDePago: 'Gestoría Demo' },
  autonomo: { nombre: 'Elena Campos Ortiz', nifBase: '00001000', formaDePago: 'Elena Campos' },
} as const

export interface Cliente {
  clave: string
  nombre: string
  tipo: 'sociedad' | 'autonomo'
  nif: string
  situacion: Situacion
  servicios: Servicio[]
  emisor: keyof typeof EMISORES
  /** La cuota de referencia que dice el CRM (solo referencia: Sumied no calcula con ella). */
  cuota: number
  ciudad: string
  /** La persona de contacto (en una sociedad) o el propio autónomo. */
  contacto: { nombre: string; apellidos: string }
  /** En GoCardless (solo los del emisor sociedad, que es el que tiene el sandbox). */
  gc: null | {
    escenario: Escenario
    /** La gestoría mensual: Básica 90, Estándar 120, Premium 150. */
    mensual: 90 | 120 | 150 | null
    /** Laboral: un trabajador por nombre, 25 € al mes cada uno. */
    trabajadores: string[]
    /** Una anual (impuesto de sociedades), 300 €. */
    anual: boolean
    /**
     * Un cobro suelto ahora, SOLO si nunca se paga (escenario Penniless: sale devuelto y deja algo en «Te deben»). nº94:
     * uno que se paga (Successful o Fickle) deja una liquidación en el sandbox sin recibo ni factura en Sumied, con el
     * mandato vivo, y descuadra la 57200002 (los 58,96 € y 78,68 € de cada «Volver a empezar» que midió Code 1).
     */
    suelto: number | null
  }
}

/** Dígito de control de un CIF (letra + 7 cifras): el de las sociedades (B, numérico). */
export function cifConControl(siete: string): string {
  const d = [...siete].map(Number)
  const pares = d[1] + d[3] + d[5]
  const impares = [d[0], d[2], d[4], d[6]].reduce((s, x) => { const y = x * 2; return s + Math.floor(y / 10) + (y % 10) }, 0)
  return `B${siete}${(10 - ((pares + impares) % 10)) % 10}`
}

/** DNI: 8 cifras y su letra. */
export function dniConLetra(ocho: string): string {
  return `${ocho}${'TRWAGMYFPDXBNJZSQVHLCKE'[Number(ocho) % 23]}`
}

/** Un IBAN español del banco 2100, con sus dos controles bien hechos (para el sandbox). */
export function ibanDePrueba(n: number): string {
  const entidad = '2100', oficina = '0418'
  const cuenta = String(4500000000 + n).padStart(10, '0')
  const dc = (cifras: string) => {
    const pesos = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6]
    const s = [...cifras.padStart(10, '0')].reduce((a, c, i) => a + Number(c) * pesos[i], 0)
    const r = 11 - (s % 11)
    return r === 11 ? 0 : r === 10 ? 1 : r
  }
  const ccc = `${entidad}${oficina}${dc(`00${entidad}${oficina}`)}${dc(cuenta)}${cuenta}`
  const resto = BigInt(`${ccc}142800`) % 97n // «ES» = 14 28, y «00»
  return `ES${String(98n - resto).padStart(2, '0')}${ccc}`
}

/** ¿Este IBAN cuadra (mod 97)? Para las pruebas. */
export function ibanValido(iban: string): boolean {
  const t = iban.slice(4) + iban.slice(0, 4)
  const num = [...t].map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join('')
  return BigInt(num) % 97n === 1n
}

type Fila = [nombre: string, tipo: 'sociedad' | 'autonomo', situacion: Situacion, servicios: Servicio[], emisor: keyof typeof EMISORES,
  ciudad: string, contacto: [string, string], gc: Cliente['gc']]

const C: Servicio[] = ['Contabilidad']
const CL: Servicio[] = ['Contabilidad', 'Laboral']
const L: Servicio[] = ['Laboral']
const gc = (mensual: 90 | 120 | 150 | null, trabajadores: string[] = [], o: { anual?: boolean; escenario?: Escenario; suelto?: number } = {}): Cliente['gc'] =>
  ({ escenario: o.escenario ?? 'normal', mensual, trabajadores, anual: !!o.anual, suelto: o.suelto ?? null })

// 40 clientes: 30 sociedades y 10 autónomos; 31 activos, 4 morosos, 3 de baja y 2 solo renta.
const FILAS: Fila[] = [
  ['Panadería La Espiga, S.L.', 'sociedad', 'Activo', CL, 'sociedad', 'Madrid', ['Rosa', 'Alcántara Vidal'], gc(120, ['Iván Serrano Gil', 'Nuria Peña Lozano'], { anual: true })],
  ['Talleres Ruiz, S.L.', 'sociedad', 'Activo', CL, 'sociedad', 'Getafe', ['Tomás', 'Ruiz Herrero'], gc(150, ['Adrián Molina Castro', 'Sergio Vela Ramos', 'Raúl Ibarra Soto'], { anual: true })],
  ['Clínica Dental Sonrisas, S.L.', 'sociedad', 'Activo', CL, 'sociedad', 'Alcobendas', ['Beatriz', 'Lanza Prieto'], gc(150, ['Carla Núñez Bravo', 'Paula Esteban Ruiz'], { anual: true, escenario: 'Successful' })],
  ['Frutas Hermanos Ortega, S.L.', 'sociedad', 'Activo', CL, 'sociedad', 'Madrid', ['Julián', 'Ortega Sanz'], gc(120, ['Marcos Pardo León'])],
  ['Librería El Faro, S.L.', 'sociedad', 'Activo', C, 'sociedad', 'Toledo', ['Inés', 'Carrasco Mora'], gc(90)],
  ['Reformas Atalaya, S.L.', 'sociedad', 'Activo', CL, 'sociedad', 'Móstoles', ['Andrés', 'Fuentes Calvo'], gc(150, ['Hugo Rivas Marín', 'Óscar Benítez Gallego', 'Diego Cano Ferrer', 'Jaime Solís Vega'], { anual: true })],
  ['Óptica Mirada Clara, S.L.', 'sociedad', 'Activo', CL, 'sociedad', 'Alcalá de Henares', ['Lucía', 'Barrios Gómez'], gc(120, ['Elena Arias Pastor'])],
  ['Bodegas Viña Alta, S.L.', 'sociedad', 'Activo', CL, 'sociedad', 'Aranjuez', ['Fernando', 'Quintana Reyes'], gc(150, ['Pablo Marcos Hidalgo', 'Ana Robles Durán'], { anual: true })],
  ['Floristería Las Camelias, S.L.', 'sociedad', 'Activo', C, 'sociedad', 'Madrid', ['Carmen', 'Pizarro Luna'], gc(90)],
  ['Transportes Meseta, S.L.', 'sociedad', 'Activo', CL, 'sociedad', 'Leganés', ['Ramón', 'Gallardo Ruiz'], gc(150, ['Luis Ortiz Sáez', 'Víctor Navas Prado', 'Álvaro Cid Montes'])],
  ['Academia Idiomas Puente, S.L.', 'sociedad', 'Activo', CL, 'sociedad', 'Madrid', ['Sofía', 'Medina Rojas'], gc(120, ['Clara Vidal Rey'])],
  ['Ferretería El Clavo, S.L.', 'sociedad', 'Activo', CL, 'sociedad', 'Fuenlabrada', ['Ernesto', 'Lorenzo Marín'], gc(120, ['Daniel Ríos Mateo'], { escenario: 'por_firmar' })],
  ['Estudio Arquitectura Trazo, S.L.', 'sociedad', 'Activo', C, 'sociedad', 'Madrid', ['Patricia', 'Calvo Méndez'], gc(150, [], { anual: true })],
  ['Cafetería La Glorieta, S.L.', 'sociedad', 'Activo', CL, 'sociedad', 'Madrid', ['Javier', 'Toledo Rubio'], gc(120, ['Marta Gil Herranz', 'Irene Sastre Ponce'])],
  ['Gimnasio Fuerza Viva, S.L.', 'sociedad', 'Activo', CL, 'sociedad', 'Pozuelo de Alarcón', ['Alberto', 'Rey Cuesta'], gc(150, ['Rubén Lago Aguilar', 'Alba Mora Castillo'])],
  ['Peluquería Tijeras de Oro, S.L.', 'sociedad', 'Activo', CL, 'sociedad', 'Getafe', ['Silvia', 'Ramos Bueno'], gc(90, ['Noelia Cruz Pascual'])],
  ['Imprenta Rápida Sol, S.L.', 'sociedad', 'Activo', C, 'sociedad', 'Madrid', ['Gonzalo', 'Sierra Márquez'], gc(90)],
  ['Distribuciones Norte, S.L.', 'sociedad', 'Activo', CL, 'sociedad', 'Alcobendas', ['Mónica', 'Vázquez Ibáñez'], gc(150, ['Iker Santos Rojo', 'Eva Lozano Cabrera'], { anual: true })],
  ['Veterinaria Cuatro Patas, S.L.', 'sociedad', 'Activo', CL, 'sociedad', 'Las Rozas', ['Natalia', 'Domínguez Cano'], gc(120, ['Laura Méndez Vidal'], { escenario: 'Fickle' })],
  ['Carpintería Roble, S.L.', 'sociedad', 'Activo', CL, 'sociedad', 'Valdemoro', ['Emilio', 'Garrido Nieto'], gc(120, ['Samuel Otero Paz'])],
  ['Joyería Brillante, S.L.', 'sociedad', 'Activo', C, 'sociedad', 'Madrid', ['Teresa', 'Aguirre Soler'], null], // mandato por firmar: paga con GoCardless y no tiene mandato
  ['Consultora Horizonte, S.L.', 'sociedad', 'Activo', C, 'sociedad', 'Madrid', ['Ricardo', 'Montero Plaza'], gc(null)], // activo sin cuota: mandato y ninguna suscripción
  ['Electricidad Voltio, S.L.', 'sociedad', 'Moroso', CL, 'sociedad', 'Parla', ['Felipe', 'Herrera Campos'], gc(120, ['Mario Cortés Blanco'], { escenario: 'Penniless', suelto: 120 })],
  ['Restaurante El Puchero, S.L.', 'sociedad', 'Moroso', CL, 'sociedad', 'Madrid', ['Antonio', 'Sanz Morales'], gc(150, ['Lidia Rueda Carmona', 'Pedro Gómez Ávila'])],
  ['Moda Urbana Trece, S.L.', 'sociedad', 'Moroso', C, 'sociedad', 'Alcorcón', ['Verónica', 'Peña Salas'], gc(90)],
  ['Autoescuela Semáforo, S.L.', 'sociedad', 'Baja', CL, 'sociedad', 'Torrejón de Ardoz', ['Manuel', 'Serrano Díez'], null],
  ['Pinturas Arcoíris, S.L.', 'sociedad', 'Baja', C, 'sociedad', 'Coslada', ['Rocío', 'Benito Arroyo'], null],
  ['Agencia Viajes Rumbo, S.L.', 'sociedad', 'Activo', C, 'sociedad', 'Madrid', ['Cristina', 'Cabello Ferrer'], gc(90)],
  ['Lavandería Espuma, S.L.', 'sociedad', 'Activo', L, 'sociedad', 'Getafe', ['Joaquín', 'Rincón Gil'], gc(null, ['Sara Iglesias Prado', 'Lorena Rivas Toro'])],
  ['Pastelería Dulce Hogar, S.L.', 'sociedad', 'Activo', CL, 'sociedad', 'Majadahonda', ['Elisa', 'Montes Lara'], gc(120, ['Alicia Paredes Mena'], { escenario: 'por_firmar' })],
  // Autónomos: los lleva Elena Campos (emisor autónomo), que cobra por transferencia.
  ['Lucía Fernández Prado', 'autonomo', 'Activo', C, 'autonomo', 'Madrid', ['Lucía', 'Fernández Prado'], null],
  ['Miguel Ángel Torres Vela', 'autonomo', 'Activo', C, 'autonomo', 'Getafe', ['Miguel Ángel', 'Torres Vela'], null],
  ['Carmen Rubio Salinas', 'autonomo', 'Activo', CL, 'autonomo', 'Madrid', ['Carmen', 'Rubio Salinas'], null],
  ['David Ortega Luque', 'autonomo', 'Activo', C, 'autonomo', 'Leganés', ['David', 'Ortega Luque'], null],
  ['Raquel Martín Esteve', 'autonomo', 'Activo', C, 'autonomo', 'Alcalá de Henares', ['Raquel', 'Martín Esteve'], null],
  ['Jorge Navarro Pinto', 'autonomo', 'Moroso', C, 'autonomo', 'Madrid', ['Jorge', 'Navarro Pinto'], null],
  ['Pilar Delgado Ríos', 'autonomo', 'Baja', C, 'autonomo', 'Móstoles', ['Pilar', 'Delgado Ríos'], null],
  ['Sergio Campos Lara', 'autonomo', 'Solo renta', [], 'autonomo', 'Madrid', ['Sergio', 'Campos Lara'], null],
  ['Ana Belén Ruiz Mota', 'autonomo', 'Solo renta', [], 'autonomo', 'Pinto', ['Ana Belén', 'Ruiz Mota'], null],
  ['Óscar Prieto Lamas', 'autonomo', 'Activo', CL, 'autonomo', 'Fuenlabrada', ['Óscar', 'Prieto Lamas'], null],
]

const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '')
const correoDe = (nombre: string) => `${sinTildes(nombre).toLowerCase().replace(/,?\s*s\.l\.?$/i, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')}@example.com`
const cuotaDe = (g: Cliente['gc'], servicios: Servicio[]) =>
  g ? (g.mensual ?? 0) + g.trabajadores.length * 25 : servicios.length === 0 ? 0 : servicios.includes('Laboral') ? 110 : 75

export const CLIENTES: Cliente[] = FILAS.map(([nombre, tipo, situacion, servicios, emisor, ciudad, [cn, ca], g], i) => ({
  clave: `gd-${String(i + 1).padStart(2, '0')}`,
  nombre, tipo, situacion, servicios, emisor, ciudad,
  nif: tipo === 'sociedad' ? cifConControl(String(110 + i).padStart(7, '0')) : dniConLetra(String(1010 + i).padStart(8, '0')),
  cuota: cuotaDe(g, servicios),
  contacto: { nombre: cn, apellidos: ca },
  gc: g,
}))

/** Un cliente que está en GoCardless y no en el CRM: el «cobro de GoCardless sin cliente». */
export const SOLO_EN_GOCARDLESS = {
  nombre: 'Centro de Estudios Alba, S.L.', nif: cifConControl('0000099'), correo: 'centro.de.estudios.alba@example.com',
  mensual: 90 as const,
}

/** Los NIF de las dos emisoras (las crea la tanda de la cuenta en Sumied). */
export const NIF_EMISORES = { sociedad: cifConControl(EMISORES.sociedad.nifBase), autonomo: dniConLetra(EMISORES.autonomo.nifBase) }

export const correoDelCliente = (c: Cliente) => correoDe(c.nombre)

/** Lo que tiene que salir, contado: lo usan las pruebas y el resumen del guion. */
export function resumen() {
  const por = <K extends string>(f: (c: Cliente) => K) => CLIENTES.reduce((m, c) => ({ ...m, [f(c)]: (m[f(c)] ?? 0) + 1 }), {} as Record<string, number>)
  const enGc = CLIENTES.filter((c) => c.gc)
  return {
    clientes: CLIENTES.length,
    porTipo: por((c) => c.tipo),
    porSituacion: por((c) => c.situacion),
    enGoCardless: enGc.length + 1,
    trabajadores: enGc.reduce((s, c) => s + c.gc!.trabajadores.length, 0),
    alMes: enGc.reduce((s, c) => s + (c.gc!.mensual ?? 0) + c.gc!.trabajadores.length * 25, 0) + SOLO_EN_GOCARDLESS.mensual,
    escenarios: enGc.filter((c) => !['normal', 'por_firmar'].includes(c.gc!.escenario)).map((c) => `${c.gc!.escenario}: ${c.nombre}`),
    porFirmar: enGc.filter((c) => c.gc!.escenario === 'por_firmar').map((c) => c.nombre),
  }
}
