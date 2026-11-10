#!/usr/bin/env node
// scripts/video/gd/locucion.mjs — GD · vídeo para QBO (nº91): lo que dice la voz, gesto a gesto.
//
//   node scripts/video/gd/locucion.mjs <salida>     deja <salida>/voz/frases.json para voz_nube.py
//
// Como scripts/video/locucion.mjs (V01): cada frase va pegada a un gesto del guion
// (scripts/video/gd/qbo.mjs la llama por su id) y el guion espera a que la voz acabe
// antes del gesto siguiente. La voz, la de scripts/video/voz-elevenlabs.txt.
//
// De tú, sin jerga, para alguien de una gestoría. La voz explica más que el rótulo:
// qué se ve, por qué importa y qué ha hecho Sumied sola. Solo se afirma lo que hace la
// pantalla. Ni fechas ni ferias: nada de «de diciembre», «el 10/11» o «llega el…».
// Los datos son de la Gestoría Demo (inventados).

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const FRASES = {
  // 01 · Portada
  '01-portada': 'Esto es Sumied para gestorías, con los datos de una gestoría de demostración.',

  // 02 · Clientes y cuotas
  '02-lista': 'Aquí tienes todos tus clientes y lo que cobras a cada uno: los clientes salen de tu Bitrix24, y las cuotas, de GoCardless.',
  '02-cifras': 'Arriba, las cuotas que cobras al mes, lo que te deben por recibos devueltos y los clientes activos que no tienen cuota: lo que dejas de cobrar.',
  '02-hacer': 'Debajo, lo que tienes que hacer, empezando por lo que más dinero mueve.',
  '02-cliente': 'Abrimos un cliente, Talleres Ruiz: lo que se le cobra, lo que debe y su último cobro, de un vistazo.',

  // 03 · La ficha del cliente
  '03-recibo': 'En su ficha, el próximo recibo explicado línea a línea: qué se le cobra y por qué.',
  '03-trabajadores': 'La gestión laboral se cobra por trabajador, y aquí están, con nombre. El que entra nuevo sale marcado.',
  '03-pestanas': 'También tiene sus cobros y su contacto…',
  '03-crm': '…y los datos que vienen de tu Bitrix24, tal cual están allí.',

  // 04 · Tarifa y paquetes
  '04-tarifa': 'Tu tarifa, como la cobras hoy: cada servicio, con cuántos clientes lo tienen.',
  '04-niveles': 'La gestoría mensual va en tres niveles: Básica, Estándar y Premium.',
  '04-especial': 'Si a un cliente le cobras otro precio, se queda como su precio especial.',
  '04-laboral': 'La gestión laboral, a tanto por trabajador.',
  '04-nominas': 'Las nóminas, por tramos.',
  '04-pack': 'Y los paquetes, con lo que se ahorra el cliente.',

  // 05 · Bitrix24 y Sumied, a la vez (tomas de Julio)
  '05-bitrix': 'Ahora, en tu Bitrix24: cambiamos la situación de un cliente, de Activo a Moroso.',
  '05-sumied': 'Y Sumied se entera en segundos. Sigues trabajando en Bitrix24 como siempre.',

  // 05b · La pestaña de Sumied dentro de Bitrix24 (tomas de Julio)
  '05b-pestana': 'Y sin salir de Bitrix24: en la ficha de cada empresa tienes una pestaña de Sumied.',
  '05b-resumen': 'En Resumen, lo que tienes pendiente con ese cliente.',
  '05b-cuotas': 'En Cuotas y cobros, sus servicios y sus cobros. Y le puedes cambiar el nivel o el precio desde ahí.',
  '05b-laboral': 'En Laboral, sus trabajadores.',
  '05b-portal': 'Y en Portal, quién de ese cliente entra en su portal.',

  // 06 · El cobro del mes
  '06-cobro': 'Toca el cobro del mes. Sumied lo prepara solo, cliente a cliente, con tu tarifa.',
  '06-cambios': 'Y solo te enseña lo que cambia respecto al mes anterior. Cada cambio, con su porqué.',
  '06-fuerte': 'Imprenta Rápida Sol pasa de Básica a Premium y su recibo sube más de un 30 %. Por eso Sumied no te deja aprobarlo sin más: te pide que lo mires.',
  '06-alta': 'Talleres Ruiz paga más porque tiene un trabajador nuevo, con su alta.',
  '06-estemesno': 'A Reformas Atalaya este mes no le cobras: con «Este mes no», se queda fuera de este cobro.',
  '06-aprobar': 'Apruebas los cambios, uno a uno.',
  '06-iguales': 'Y los que no cambian, todos de una vez.',
  '06-noentran': 'Sumied también te dice quién no entra en el cobro, y por qué: por ejemplo, un cliente activo en Bitrix24 sin cuota.',
  '06-enviar': 'Todo revisado. Envías el cobro a GoCardless.',
  '06-confirmar': 'Antes de salir, te dice a cuántos clientes y por cuánto. Confirmas, y sale.',

  // 07 · Cobrado y facturado
  '07-recibos': 'Cuando GoCardless confirma cada cobro, Sumied hace la factura sola. Aquí ves cómo va cada recibo.',
  '07-factura': 'La factura, con la numeración y las cuentas de tu plan.',
  '07-pasado': 'Con todo lo que ha pasado, paso a paso…',
  '07-conta': '…y su asiento en la contabilidad, ya hecho.',
  '07-pdf': 'Y el PDF, con cada trabajador por el que se le cobra.',

  // 07b · El buzón del cliente (toma de Julio)
  '07b-correo': 'Y a tu cliente le llega por correo, con el PDF, sin que nadie la mande.',

  // 07c · En la contabilidad
  '07c-libro': 'En la contabilidad, la factura ya está en el libro de IVA repercutido.',
  '07c-430': 'La cuenta del cliente queda saldada: lo facturado, cobrado.',
  '07c-572': 'En la cuenta de GoCardless solo queda la comisión que GoCardless se queda de esos cobros.',
  '07c-banco': 'Y en el banco, el ingreso de GoCardless, casado con su cobro.',
  '07c-cierre': 'De la cuota al banco, contabilizado solo, sin teclear un asiento.',

  // 08 · El banco
  '08-banco': 'En el banco, Sumied casa sola cada ingreso de GoCardless con sus cobros.',
  '08-casados': 'En «Casados solos» tienes todo lo que ha casado sin ti, y lo puedes deshacer.',
  '08-ingreso': 'Este es el de Talleres Ruiz: el importe neto, exacto, y por qué lo ha casado.',

  // 09 · Cierre
  '09-cierre': 'Sin teclear recibos, sin facturar a mano y sin descuadres. Sumied para gestorías.',

  // 10 · El portal de tus clientes (maquetas)
  '10-portal': 'Y lo siguiente: el portal de tus clientes.',
  '10-recibo': 'Tu cliente ve su próximo recibo explicado, y puede decirte que no está de acuerdo antes del cargo.',
  '10-devuelto': 'Si un recibo se devuelve, lo paga en un clic: desde su banco, con tarjeta o con Bizum.',
  '10-facturas': 'Tiene todas sus facturas en PDF, cuando quiera.',
  '10-documentos': 'Sube sus facturas y tickets con una foto, y ve sus impuestos presentados.',
  '10-trabajadores': 'Te pide altas y bajas de trabajadores, y tú las haces.',
  '10-mensajes': 'Y habla contigo sin correos ni llamadas.',
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
