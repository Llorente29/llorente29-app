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
import { rutaAjustes } from '@/config/navegacion'
import { Boton, Tarjeta } from '@/modules/conta/diseno'
import { useEmpresas } from '@/modules/conta/empresa/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { crearCorreoFacturas, leerCorreoFacturas, type LlegadaCorreo } from '@/modules/conta/services/comprasService'
import { cuandoEnPalabras, queSeHizo } from '@/modules/conta/lib/correoFacturas'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function CorreoFacturasAjustes() {
  const { activa } = useEmpresas()
  const { userName } = useCuentaConta()
  const [vuelta, setVuelta] = useState(0)
  const datos = useLeer(activa ? () => leerCorreoFacturas(activa.id) : null, `${activa?.id}:${vuelta}:correo-facturas`)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
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
        <LlegadasPorCorreo llegadas={d.llegadas ?? []} />
      </Tarjeta>
    </div>
  )
}

/** Cada correo que llegó, con lo que se hizo: factura leída y casada, esperando su albarán, no es una factura, repetida. */
export function LlegadasPorCorreo({ llegadas, max }: { llegadas: readonly LlegadaCorreo[]; max?: number }) {
  const lista = max ? llegadas.slice(0, max) : llegadas
  if (lista.length === 0) return <p className="cx-ayuda" style={{ margin: 0 }}>Aún no ha llegado ningún correo a la dirección de facturas.</p>
  const hoy = new Date()
  return (
    <ul className="cxc-correo-llegadas" aria-label="Lo que ha llegado por correo" data-prueba="llegadas">
      {lista.map((l, i) => {
        const q = queSeHizo(l)
        return (
          <li key={`${l.fecha}-${i}`} data-tono={q.tono}>
            <span className="cxc-correo-que"><strong>{q.titulo}</strong>{l.factura?.total != null ? <span className="cx-cifra"> · {eurosExactos(l.factura.total)}</span> : null}</span>
            {q.texto && <span className="cxc-cosa-apoyo">{q.texto}</span>}
            <span className="cxc-cosa-apoyo">{cuandoEnPalabras(l.fecha, hoy)} · de {l.de ?? 'alguien'}{l.asunto ? ` · «${l.asunto}»` : ''}</span>
          </li>
        )
      })}
    </ul>
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
