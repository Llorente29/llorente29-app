// supabase/functions/_shared/secretoConRelevo.ts
//
// W10 (Julio, 28/10) · Cambiar un secreto interno sin cortar el servicio.
//
// Los secretos internos los manda la BASE (leídos del Vault, en net.http_post)
// y los comprueba la FUNCIÓN (en sus secretos, Deno.env). Las dos cosas no se
// pueden cambiar en el mismo instante: si se cambia antes el de la función, la
// base sigue mandando el viejo y todo sale 401 hasta que se cambie el Vault; y
// al revés igual. Por eso, durante el cambio, la función acepta los dos:
//   · <NOMBRE>       el vigente (el nuevo, cuando se está cambiando);
//   · <NOMBRE>_PREV  el anterior, solo mientras dura el cambio.
// Si entra una llamada con el anterior, se dice en el registro: mientras salga
// ese aviso, el cambio no ha terminado y <NOMBRE>_PREV no se puede quitar.
// Sin <NOMBRE>_PREV, esto es exactamente la comprobación de antes.
//
// Es el mismo relevo que ya tenía order-advance (ORDER_ADVANCE_SECRET_PREV) y
// catcher-dispatch (catcher_dispatch_secret_anterior, en el Vault).

export type ComoEntra = "vigente" | "anterior" | null;

/** Con qué secreto entra la llamada, o null si con ninguno (401). */
export function comprobarSecreto(
  recibido: string,
  nombre: string,
  leer: (k: string) => string | undefined = (k) => Deno.env.get(k),
): ComoEntra {
  const vigente = leer(nombre) ?? "";
  const anterior = leer(`${nombre}_PREV`) ?? "";
  if (vigente !== "" && recibido === vigente) return "vigente";
  if (anterior !== "" && recibido === anterior) {
    console.warn(
      `${nombre}: petición aceptada con el secreto ANTERIOR (${nombre}_PREV). ` +
        "El cambio del secreto no ha terminado: falta que el Vault mande el nuevo. " +
        `No quitar ${nombre}_PREV mientras salga este aviso.`,
    );
    return "anterior";
  }
  return null;
}
