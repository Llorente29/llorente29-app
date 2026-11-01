// src/modules/conta/compras/CorreoFacturas.tsx
//
// S01c · Ajustes › Correo de facturas (encargo de Julio, 29/10). Una tarjeta
// con la dirección de facturas de la empresa, grande y con «Copiar», y el
// estado: «Recibiendo · último correo hoy a las 10:12» o «Aún no ha llegado
// ningún correo». Debajo, cómo hacer que las facturas lleguen solas, en tres
// pasos (el reenvío de Gmail y su filtro), y la confirmación del reenvío que
// manda Gmail, con su código y su enlace, para confirmarlo sin salir de aquí.
// Y cada correo que ha llegado, con lo que se hizo con él (LlegadasPorCorreo,
// que también sale en Compras).
//
// Todo en palabras de oficina: ni «sesión», ni «OCR», ni «match».

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rutaAjustes, rutaLiquidacionFicha, rutaRevisarFactura } from '@/config/navegacion'
import { Boton, Tarjeta } from '@/modules/conta/diseno'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { crearCorreoFacturas, leerCorreoFacturas, leerLineasFactura, releerCorreos, type ComparacionLineas, type LlegadaCorreo } from '@/modules/conta/services/comprasService'
import { accionesDeLlegada, cuandoEnPalabras, lineaEnPalabras, nombrePlataforma, queSalio, resumenLineas } from '@/modules/conta/lib/correoFacturas'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function CorreoFacturasAjustes() {
  const { activa } = useEmpresas()
  const { userName } = useCuentaConta()
  const [vuelta, setVuelta] = useState(0)
  const datos = useLeer(activa ? () => leerCorreoFacturas(activa.id) : null, `${activa?.id}:${vuelta}:correo-facturas`)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  // S01j·2 · Lo que dijo «volver a leer»: aquí, porque al recargar la lista se desmonta y se perdería.
  const [releido, setReleido] = useState<{ ok: boolean; texto: string } | null>(null)
  const d = datos.datos
  if (!activa) return null
  if (!d && !datos.error) return <Tarjeta titulo="Correo de facturas"><p className="cx-ayuda">Leyendo…</p></Tarjeta>
  if (datos.error) return <Tarjeta titulo="Correo de facturas"><p className="cx-error" role="alert">No se ha podido leer: {datos.error}</p></Tarjeta>

  if (!d?.direccion) {
    return (
      <Tarjeta titulo="Correo de facturas">
        <p className="cx-ayuda" style={{ marginTop: 0 }}>Tu empresa aún no tiene dirección de facturas. Con ella, las facturas de tus proveedores entran solas en Compras, se leen y se casan con sus albaranes.</p>
        <Boton onClick={async () => {
          try { const dir = await crearCorreoFacturas(activa.id, userName ?? null); setAviso({ ok: true, texto: `Creada: ${dir}.` }); setVuelta((v) => v + 1) }
          catch (e) { setAviso({ ok: false, texto: `No se ha creado: ${msg(e)}` }) }
        }}>Crear la dirección</Boton>
        {aviso && <p className={aviso.ok ? 'cx-guardado' : 'cx-error'} role={aviso.ok ? 'status' : 'alert'}>{aviso.texto}</p>}
      </Tarjeta>
    )
  }

  const hoy = new Date()
  return (
    <div className="cx-columna" data-prueba="correo-facturas">
      <Tarjeta titulo="Tu dirección de facturas">
        <div className="cxc-correo-dir">
          <span className="cxc-correo-direccion" data-prueba="direccion">{d.direccion}</span>
          <Boton variante="secundario" onClick={async () => {
            try { await navigator.clipboard.writeText(d.direccion!); setAviso({ ok: true, texto: `Copiada: ${d.direccion}.` }) }
            catch { setAviso({ ok: false, texto: 'No se ha podido copiar: selecciónala y cópiala a mano.' }) }
          }}>Copiar</Boton>
        </div>
        <p className="cx-ayuda" data-prueba="estado">
          {d.activa === false ? 'Apagada: lo que llegue no se lee.'
            : d.ultimo ? `Recibiendo · último correo ${cuandoEnPalabras(d.ultimo, hoy)}.` : 'Aún no ha llegado ningún correo.'}
        </p>
        {aviso && <p className={aviso.ok ? 'cx-guardado' : 'cx-error'} role={aviso.ok ? 'status' : 'alert'}>{aviso.texto}</p>}
      </Tarjeta>

      {d.confirmacion && (
        <Tarjeta titulo="Gmail pide confirmar el reenvío">
          <div data-prueba="confirmacion">
            <p style={{ marginTop: 0 }}>Llegó {cuandoEnPalabras(d.confirmacion.fecha, hoy)}. Confírmalo de una de estas dos formas:</p>
            {d.confirmacion.codigo && <p>Escribe este código en Gmail, donde añadiste la dirección: <strong className="cx-cifra cxc-correo-codigo">{d.confirmacion.codigo}</strong></p>}
            {d.confirmacion.enlace && <p><a className="cx-boton" href={d.confirmacion.enlace} target="_blank" rel="noreferrer noopener">Abrir el enlace de confirmación</a></p>}
            {!d.confirmacion.codigo && !d.confirmacion.enlace && <p className="cx-ayuda">El correo no traía ni código ni enlace: mira el correo de confirmación en el buzón de Gmail.</p>}
          </div>
        </Tarjeta>
      )}

      <Tarjeta titulo="Cómo hacer que te lleguen solas">
        <ol className="cxc-correo-pasos">
          <li><strong>Añade la dirección en Gmail.</strong> En Gmail, Ajustes › Ver todos los ajustes › Reenvío y correo POP/IMAP › «Añadir una dirección de reenvío», y pega <strong>{d.direccion}</strong>.</li>
          <li><strong>Confírmala.</strong> Gmail manda un correo de confirmación a esa dirección. Sale aquí arriba en cuanto llega, con su código y su enlace.</li>
          <li><strong>Crea el filtro.</strong> En la búsqueda de Gmail, «Mostrar opciones de búsqueda»: en «De», el correo de tu proveedor (o «tiene archivos adjuntos» y la palabra «factura»). «Crear filtro» › «Reenviarlo a» › {d.direccion}.</li>
        </ol>
        <p className="cx-ayuda">También puedes reenviar a mano cualquier correo con una factura: entra igual.</p>
      </Tarjeta>

      <Tarjeta titulo="Lo que ha llegado">
        <LlegadasPorCorreo llegadas={d.llegadas ?? []} companyId={activa.id} releido={releido}
          alReleer={(r) => { setReleido(r); setVuelta((v) => v + 1) }} />
      </Tarjeta>
    </div>
  )
}

/**
 * Cada correo que llegó y qué salió de él (S01j·2, maquetas 1, 2 y 4): la
 * factura y la liquidación, el Excel que se quedó sin leer o el que no venía,
 * con su estado. Con la empresa, cada uno lleva su ⋯ («Volver a leer este
 * correo», «Volver a leer todo lo de Glovo», «Ver la factura», «Ver la
 * liquidación») y arriba se vuelve a leer todo lo de una plataforma. Lo que
 * pasa al volver a leer se dice en pantalla (regla 8).
 */
export function LlegadasPorCorreo({ llegadas, max, companyId, releido = null, alReleer }: {
  llegadas: readonly LlegadaCorreo[]; max?: number; companyId?: string
  /** Lo que dijo la última vez que se volvió a leer (lo guarda quien la pinta: la lista se recarga). */
  releido?: { ok: boolean; texto: string } | null
  alReleer?: (r: { ok: boolean; texto: string }) => void
}) {
  const [abierto, setAbierto] = useState<number | null>(null)
  const [leyendo, setLeyendo] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const aviso = fallo ? { ok: false, texto: fallo } : releido
  const lista = max ? llegadas.slice(0, max) : llegadas
  if (lista.length === 0) return <p className="cx-ayuda" style={{ margin: 0 }}>Aún no ha llegado ningún correo a la dirección de facturas.</p>
  const hoy = new Date()
  const plataformas = companyId ? (['glovo', 'justeat'] as const).filter((p) => llegadas.some((l) => l.plataforma === p)) : []
  const releer = async (clave: string, que: Parameters<typeof releerCorreos>[1]) => {
    if (!companyId) return
    setAbierto(null); setLeyendo(clave); setFallo(null)
    try {
      const r = await releerCorreos(companyId, que)
      const fuera = r.correos.some((c) => c.estado === 'ya_no_esta')
      alReleer?.({ ok: !r.correos.some((c) => c.estado === 'error') && !fuera, texto: r.texto })
    } catch (e) { setFallo(`No se ha vuelto a leer: ${msg(e)}`) }
    finally { setLeyendo(null) }
  }
  return (
    <>
      {plataformas.length > 0 && (
        <div className="cxc-correo-releer">
          {plataformas.map((p) => (
            <Boton key={p} variante="secundario" disabled={leyendo !== null} onClick={() => void releer(p, { remitente: p })}>
              {leyendo === p ? 'Leyendo otra vez…' : `Volver a leer todo lo de ${nombrePlataforma(p)}`}
            </Boton>
          ))}
        </div>
      )}
      {aviso && <p className={aviso.ok ? 'cx-guardado' : 'cx-error'} role={aviso.ok ? 'status' : 'alert'} data-prueba="releer-aviso">{aviso.texto}</p>}
      <ul className="cxc-correo-llegadas" aria-label="Lo que ha llegado por correo" data-prueba="llegadas">
        {lista.map((l, i) => {
          const q = queSalio(l)
          const acciones = companyId ? accionesDeLlegada(l) : []
          const fac = l.factura?.id ?? l.factura_comision?.id ?? null
          const liq = l.liquidaciones?.[0]?.id ?? null
          const plat = l.plataforma ?? null
          return (
            <li key={`${l.fecha}-${i}`} data-tono={q.chip.tono} data-prueba="llegada">
              <div className="cxc-llegada">
                <span className="cxc-llegada-cuando">{cuandoEnPalabras(l.fecha, hoy)}</span>
                <span className="cxc-llegada-que">
                  <strong className="cxc-correo-que">{q.titulo}{!l.liquidaciones?.length && l.factura?.total != null ? <span className="cx-cifra"> · {eurosExactos(l.factura.total)}</span> : null}</strong>
                  {q.texto && <span className="cxc-cosa-apoyo" data-prueba="llegada-texto">{q.texto}</span>}
                  <span className="cxc-cosa-apoyo">de {l.de ?? 'alguien'}{l.asunto ? ` · «${l.asunto}»` : ''}</span>
                </span>
                <span className="cxc-llegada-chip" data-tono={q.chip.tono} data-prueba="llegada-estado">{q.chip.texto}</span>
                {acciones.length > 0 ? (
                  <span className="cxc-llegada-mas">
                    <button type="button" aria-label="Más acciones de esta llegada" aria-expanded={abierto === i} aria-haspopup="menu"
                      onClick={() => setAbierto(abierto === i ? null : i)} disabled={leyendo !== null}>⋯</button>
                    {abierto === i && (
                      <span className="cxc-llegada-menu" role="menu" aria-label={`Acciones de la llegada ${cuandoEnPalabras(l.fecha, hoy)}`}>
                        {acciones.includes('releer') && <button type="button" role="menuitem" onClick={() => void releer(`c${i}`, { emailIds: [l.email_id!] })}><strong>Volver a leer este correo</strong></button>}
                        {acciones.includes('releer_plataforma') && plat && <button type="button" role="menuitem" onClick={() => void releer(plat, { remitente: plat })}>Volver a leer todo lo de {nombrePlataforma(plat)}</button>}
                        {acciones.includes('factura') && fac && <Link role="menuitem" to={rutaRevisarFactura(fac)}>Ver la factura</Link>}
                        {acciones.includes('liquidacion') && liq && <Link role="menuitem" to={rutaLiquidacionFicha(liq)}>Ver la liquidación</Link>}
                      </span>
                    )}
                  </span>
                ) : <span />}
              </div>
              {leyendo === `c${i}` && <span className="cxc-cosa-apoyo" role="status">Leyendo otra vez…</span>}
              {l.factura?.casada && <LineaALinea facturaId={l.factura.id} />}
            </li>
          )
        })}
      </ul>
      {!max && <p className="cx-ayuda">Los 30 últimos correos. Volver a leer no duplica nada: la factura con el mismo PDF y la liquidación de la misma tienda y quincena se reconocen y se actualizan.</p>}
    </>
  )
}

/** La factura contra sus albaranes, línea a línea: se abre a mano y dice qué cuadra y qué no. */
export function LineaALinea({ facturaId }: { facturaId: string }) {
  const [abierta, setAbierta] = useState(false)
  const [c, setC] = useState<ComparacionLineas | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abrir = async () => {
    if (abierta) { setAbierta(false); return }
    setAbierta(true)
    if (c) return
    try { setC(await leerLineasFactura(facturaId)); setError(null) }
    catch (e) { setError(`No se ha podido comparar: ${msg(e)}`) }
  }
  return (
    <div className="cxc-lineas" data-prueba="linea-a-linea">
      <button type="button" className="cx-enlace" onClick={abrir} aria-expanded={abierta}>{abierta ? 'Ocultar línea a línea' : 'Ver línea a línea'}</button>
      {abierta && error && <p className="cx-error" role="alert">{error}</p>}
      {abierta && !error && !c && <p className="cx-ayuda">Comparando…</p>}
      {abierta && c && (
        <>
          <p className="cxc-cosa-apoyo" data-prueba="resumen-lineas"><strong>{resumenLineas(c)}</strong></p>
          {c.lineas.length > 0 && (
            <ul className="cxc-lineas-lista" aria-label="La factura contra el albarán, línea a línea">
              {c.lineas.map((x, i) => {
                const p = lineaEnPalabras(x)
                return <li key={i} data-mira={p.mira ? 'si' : 'no'}><span className="cxc-lineas-que">{p.que}</span><span className="cxc-cosa-apoyo">{p.dice}</span></li>
              })}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

/** En Compras: lo último que ha llegado por correo, con el enlace a Ajustes › Correo de facturas. */
export function LlegadoPorCorreo({ companyId }: { companyId: string }) {
  const datos = useLeer(() => leerCorreoFacturas(companyId), `${companyId}:compras-correo`)
  const d = datos.datos
  if (!d || datos.error) return null
  return (
    <Tarjeta titulo="Llegado por correo">
      {d.direccion
        ? <p className="cx-ayuda" style={{ marginTop: 0 }}>Lo que llega a {d.direccion} entra solo: se lee y se casa con su albarán. <Link to={rutaAjustes('correo-facturas')}>Cómo hacer que te lleguen solas</Link>.</p>
        : <p className="cx-ayuda" style={{ marginTop: 0 }}>Aún no tienes dirección de facturas. <Link to={rutaAjustes('correo-facturas')}>Créala en Ajustes › Correo de facturas</Link>.</p>}
      {d.direccion && <LlegadasPorCorreo llegadas={d.llegadas ?? []} max={6} />}
    </Tarjeta>
  )
}
