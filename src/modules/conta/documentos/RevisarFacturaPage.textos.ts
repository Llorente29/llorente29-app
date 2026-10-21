// src/modules/conta/documentos/RevisarFacturaPage.textos.ts
//
// S01e · Lo que dice la recibida (Asientos › Recibida) sin contradecirse:
//   · el papel: si se sabe cómo se llama pero el fichero no está, se dice
//     así («Llegó «x.pdf», pero no encuentro el fichero»), no «no tiene papel»
//     debajo de su nombre;
//   · el NIF: el de su ficha y el de la factura son dos cosas, y se dicen las
//     dos; una comprobación del NIF no sale «✓» si no hay NIF en ninguna parte;
//   · la cuenta de sus facturas, en palabras, sin «sin decidir · aún no hay
//     nada aprendido».

export interface ComprobacionVista { id: string; ok: boolean; texto: string }

/** Lo que va en el sitio de la factura cuando no se puede enseñar. */
export function textoSinPapel(o: { archivo: string | null; aMano: boolean; error: string | null }): string {
  if (o.aMano) return 'Sin fichero: apuntada a mano.'
  if (o.error) return `${o.archivo ? `Llegó «${o.archivo}», pero` : 'Tiene fichero, pero'} no se ha podido abrir: ${o.error}`
  return o.archivo
    ? `Llegó «${o.archivo}», pero no encuentro el fichero guardado: no lo puedo enseñar. Pídeselo al proveedor o súbelo otra vez.`
    : 'No encuentro el fichero de esta factura: no lo puedo enseñar. Pídeselo al proveedor o súbelo otra vez.'
}

/** Lo que va debajo del proveedor: el NIF de su ficha y, si no lo tiene, el de la factura. */
export function apoyoProveedor(nifFicha: string | null, nifFactura: string | null): string {
  if (nifFicha) return `NIF ${nifFicha} · está en tus proveedores`
  if (nifFactura) return `está en tus proveedores, pero su ficha no tiene NIF · la factura trae el ${nifFactura}`
  return 'está en tus proveedores · sin NIF: ni su ficha ni la factura lo traen'
}

/**
 * Las comprobaciones de la lectura, sin «✓» en lo que no puede estar bien:
 * una del NIF que diga que vale cuando no hay NIF ni en la ficha ni en la
 * factura pasa a «!», con lo que de verdad pasa.
 */
export function comprobacionesSinContradecir(com: readonly ComprobacionVista[], hayNif: boolean): ComprobacionVista[] {
  return com.map((c) => (c.ok && !hayNif && /nif/i.test(`${c.id} ${c.texto}`)
    ? { id: c.id, ok: false, texto: 'No hay NIF del proveedor: ni la factura ni su ficha lo traen. Sin él no se puede deducir su IVA.' }
    : c))
}

/** «Dónde se apuntan sus facturas», en palabras. */
export function cuentaDeSusFacturas(gasto: { cuenta: string; nombre: string; origen: string } | null): { valor: string; apoyo: string } {
  if (gasto) return { valor: `${gasto.nombre} · ${gasto.cuenta}`, apoyo: gasto.origen }
  return { valor: 'Aún sin cuenta fija', apoyo: 'aún no sé en qué cuenta van las de este proveedor; abajo, en «Cómo se apunta», la que propongo para esta' }
}
