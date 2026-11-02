#!/usr/bin/env node
// scripts/video/locucion.mjs — V01 · lo que dice la voz (y los subtítulos), momento a momento.
//
//   node scripts/video/locucion.mjs <salida>     deja <salida>/voz/frases.json para voz.py
//
// Cada frase va pegada a un gesto del guion (guion.mjs la llama por su id con
// R.di): el ratón hace lo que la frase cuenta, y el guion espera a que la voz
// acabe antes del gesto siguiente. Tono de vídeo comercial, de tú, sin jerga:
// lo que ve quien lleva un bar o una gestoría.
//
// Lo que se afirma es lo que hace la pantalla: Revolut comprueba el titular de
// cada IBAN (VoP), un IBAN nuevo pide la segunda aprobación, el cargo se casa
// solo con su factura y su asiento. Nada de «ahorra X horas» sin medirlo.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const FRASES = {
  portada: 'De la factura al pago, sin teclear nada.',
  // Paso 1 · la factura que llega
  llega: 'Tu proveedor te manda la factura por correo, como siempre.',
  lee: 'Sumied abre el PDF y lo lee entero: el proveedor, el número, la fecha, cada línea y cada tipo de IVA.',
  igual: 'Y comprueba que lo que ha leído cuadra con el PDF, al céntimo.',
  // Paso 2 · apuntada sola
  apunta: 'Si todo cuadra, la apunta sola en tu contabilidad, con su asiento ya validado.',
  porque: 'Y te enseña por qué: cada requisito de la factura, comprobado. Si algo no encaja, te avisa y te dice qué falta.',
  // Paso 3 · elegir qué pagar
  pagos: 'En Pagos ves lo que debes y cuándo vence. Esta semana vencen tres facturas.',
  marcar: 'Marcas las que toca pagar.',
  desde: 'Eliges pagar desde tu cuenta de Revolut, conectada a Sumied.',
  boton: 'Y un solo botón: pagar las tres.',
  // Paso 4 · Revolut comprueba
  titular: 'Antes de pagar, Revolut comprueba que el titular de cada IBAN es de verdad tu proveedor.',
  segunda: 'Si un proveedor estrena IBAN, Sumied pide una segunda confirmación. Es el engaño más común con facturas falsas.',
  // Paso 5 · una aprobación
  una: 'Una sola aprobación vale para todos los pagos.',
  pin: 'Confirmas con tu PIN de pago, y listo.',
  // Paso 6 · pagado
  enviado: 'Hecho: los tres pagos salen por Revolut, sin entrar en el banco.',
  pagado: 'Y Pagos ya los cuenta como pagados este mes.',
  // Paso 7 · el cargo vuelve
  vuelve: 'Cuando el cargo llega al banco, Sumied lo reconoce solo.',
  casado: 'Cada cargo queda casado con su factura, y su asiento, hecho. Sin conciliar a mano.',
  resumen: 'Tres facturas, del correo al banco, sin teclear un solo dato.',
  cierre: 'Sumied. Contabilidad que se hace sola.',
}

/** Lo que dura una frase si no hay voz (para el ritmo): unas 15 letras por segundo. */
export const estimada = (texto) => 0.5 + texto.length / 15

if (process.argv[1] && process.argv[1].endsWith('locucion.mjs')) {
  const salida = process.argv[2]
  if (!salida) { console.error('uso: locucion.mjs <salida>'); process.exit(2) }
  const dir = join(salida, 'voz')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'frases.json'), JSON.stringify(Object.entries(FRASES).map(([id, texto]) => ({ id, texto, salida: join(dir, `${id}.wav`) })), null, 1))
  console.log(`${Object.keys(FRASES).length} frases en ${join(dir, 'frases.json')}`)
}
