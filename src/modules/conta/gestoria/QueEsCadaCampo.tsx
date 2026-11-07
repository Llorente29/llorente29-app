// src/modules/conta/gestoria/QueEsCadaCampo.tsx
//
// G01b · Parte 2 (07/11/2026) · «Qué es cada campo», dentro de la tarjeta de
// Bitrix24 en Ajustes › Cobros. Cada cosa de Sumied, al lado del campo de
// Bitrix24 del que sale (con su etiqueta del portal); lo que falta, en rojo;
// y «Confirmar el mapa y leer», que dice antes lo que va a pasar y después lo
// que ha hecho (regla 8). Sin confirmar, no se guarda la situación de nadie
// (Julio, 07/11). Las dudas se deciden aquí, nunca en una nota que no ve nadie.
// No lee nada: el mapa y lo medido llegan de fuera (ver paginas.tsx).

import { useMemo, useState } from 'react'
import { Selector } from '@/modules/conta/diseno'
import { ElegirCampo } from './ElegirCampo'
import {
  FUENTES, SITUACIONES_SUMIED, camposParaElegir, eleccionInicial, etiquetaDe, loQueFalta, mapaParaConfirmar, opcionesDeSituacion, resumenDeOpciones, sePuedeConfirmar,
  type CampoMedido, type Eleccion, type MapaBitrix, type Situacion,
} from './queEsCadaCampo'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const fechaHora = (iso: string) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' })} a las ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}`
}

function Fila({ sumied, apoyo, children }: { sumied: string; apoyo?: string; children: React.ReactNode }) {
  return (
    <div className="cxg-mapa-fila">
      <div className="cxg-mapa-sumied"><strong>{sumied}</strong>{apoyo && <span className="cxg-apoyo">{apoyo}</span>}</div>
      <div className="cxg-mapa-bitrix">{children}</div>
    </div>
  )
}

export function QueEsCadaCampo({ mapa, medidos, alConfirmar, sinTitulo }: {
  /** G01c · Dentro de las pestañas (CamposDeBitrix), sin su título: lo pone la pestaña. */
  sinTitulo?: boolean
  mapa: MapaBitrix | null
  medidos: Record<string, CampoMedido> | null
  /** Guarda el mapa confirmado y lee de nuevo: devuelve las frases de las dos cosas. */
  alConfirmar: (mapa: MapaBitrix) => Promise<string>
}) {
  const inicial = useMemo(() => (medidos ? eleccionInicial(mapa, medidos) : null), [mapa, medidos])
  const [e, setE] = useState<Eleccion | null>(inicial)
  const [abierto, setAbierto] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  // G01c · Sin códigos y con búsqueda: cada campo por su etiqueta y su tipo en palabras.
  const todos = useMemo(() => (medidos ? camposParaElegir(medidos) : []), [medidos])
  const listas = useMemo(() => (medidos ? camposParaElegir(medidos, (c) => !!c.items?.length) : []), [medidos])

  if (!medidos || !e) {
    return <p className="s-aviso-lista" data-tono="falta" role="alert">Faltan los campos medidos del portal: vuelve a conectar Bitrix24 para ver qué es cada campo.</p>
  }
  const cambiar = (p: Partial<Eleccion>) => { setE({ ...e, ...p }); setAviso(null) }
  const faltan = loQueFalta(e)
  const confirmado = mapa?.confirmado ?? null
  const otros = (mapa?.campos ?? []).filter((c) => ['nombre', 'correo', 'telefono', 'servicios', 'forma_pago'].includes(c.campo))
  const NOMBRES: Record<string, string> = { nombre: 'Nombre', correo: 'Correo', telefono: 'Teléfono', servicios: 'Servicios contratados', forma_pago: 'Forma de pago (el emisor)' }
  const items = (e.situacion ? medidos[e.situacion]?.items : null) ?? []

  const confirmar = async () => {
    setOcupado(true); setAviso(null)
    try { setAviso({ ok: true, texto: await alConfirmar(mapaParaConfirmar(mapa, e, medidos)) }); setAbierto(false) }
    catch (x) { setAviso({ ok: false, texto: msg(x) }) } finally { setOcupado(false) }
  }

  return (
    <section className="cxg-mapa" aria-label="Qué es cada campo · Empresas" data-prueba="que-es-cada-campo">
      {!sinTitulo && <h3 id="que-es-cada-campo" className="cxg-ficha-sub">Qué es cada campo</h3>}
      {confirmado
        ? <p className="cxg-mapa-estado" data-tono="verde" role="status">Confirmado{confirmado.quien ? ` por ${confirmado.quien}` : ''} el {fechaHora(confirmado.cuando)}. Si cambias algo, vuelve a confirmarlo.</p>
        : <p className="s-aviso-lista" data-tono="falta" role="alert">Sin confirmar: no se guarda la situación de nadie. Revisa cada campo y confírmalo abajo.</p>}
      {faltan.length > 0 && (
        <div className="s-aviso-lista" data-tono="falta" role="alert">
          <strong>Falta:</strong>
          <ul className="cxg-mapa-faltan">{faltan.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      )}

      <div className="cxg-mapa-cabeza" aria-hidden="true"><span>En Sumied</span><span>Sale de este campo de Bitrix24</span></div>

      <Fila sumied="NIF" apoyo="El de la ficha fiscal del cliente.">
        <ElegirCampo etiqueta="NIF: campo de Bitrix24" valor={e.nif} alCambiar={(v) => cambiar({ nif: v })} campos={todos} />
      </Fila>

      <Fila sumied="Situación del cliente" apoyo="Solo «Activo» espera un cobro cada mes.">
        <ElegirCampo etiqueta="Situación del cliente: campo de Bitrix24" valor={e.situacion} campos={listas}
          alCambiar={(s) => {
            const antes = mapa?.campos.find((c) => c.campo === 'situacion' && c.codigo === s)?.opciones
            cambiar({ situacion: s, opciones: opcionesDeSituacion(s, medidos, antes) })
          }} />
        {items.length > 0 && (
          <ul className="cxg-mapa-opciones" aria-label="Cada opción de Bitrix24 y lo que es en Sumied">
            {items.map((it) => {
              const id = String(it.ID)
              return (
                <li key={id}>
                  <span>{it.VALUE}</span>
                  <Selector aria-label={`«${it.VALUE}» en Sumied`} valor={e.opciones[id] ?? 'sin_clasificar'}
                    alCambiar={(v) => cambiar({ opciones: { ...e.opciones, [id]: v as Situacion } })} opciones={SITUACIONES_SUMIED} />
                </li>
              )
            })}
          </ul>
        )}
      </Fila>

      <Fila sumied="Dirección" apoyo="Por este orden: la primera que tenga algo. Calle, código postal y población salen de la misma, nunca de dos. Las demás se guardan de referencia en la ficha.">
        <ol className="cxg-mapa-fuentes">
          {e.direcciones.map((d, i) => (
            <li key={i}>
              <ElegirCampo etiqueta={`Dirección, ${i + 1}.ª fuente`} valor={d.calle} campos={todos}
                alCambiar={(v) => cambiar({ direcciones: e.direcciones.map((x, j) => (j === i ? { ...x, calle: v } : x)) })} />
              {d.calle && (d.cp || d.poblacion || d.provincia) && (
                <span className="cxg-apoyo">Con {[d.cp && `código postal de «${etiquetaDe(medidos, d.cp)}»`, d.poblacion && `población de «${etiquetaDe(medidos, d.poblacion)}»`, d.provincia && `provincia de «${etiquetaDe(medidos, d.provincia)}»`].filter(Boolean).join(', ')}.</span>
              )}
              {d.calle && !d.cp && medidos[d.calle]?.type === 'address' && <span className="cxg-apoyo">El código postal se saca del texto de la dirección.</span>}
            </li>
          ))}
        </ol>
        {e.direcciones.length < FUENTES.length && (
          <button type="button" className="cx-enlace" onClick={() => cambiar({ direcciones: [...e.direcciones, { calle: null, cp: null, poblacion: null, provincia: null }] })}>+ Otra fuente</button>
        )}
      </Fila>

      {e.cuotas.map((c, i) => (
        <Fila key={c.etiqueta} sumied={`Cuota de referencia · ${c.etiqueta}`} apoyo={i === 0 ? 'Solo de referencia: Sumied no calcula nada con ella.' : undefined}>
          <ElegirCampo etiqueta={`Cuota ${c.etiqueta}: campo de Bitrix24`} valor={c.codigo} campos={todos}
            alCambiar={(v) => cambiar({ cuotas: e.cuotas.map((x, j) => (j === i ? { ...x, codigo: v } : x)) })} />
        </Fila>
      ))}

      {otros.map((c) => (
        <Fila key={`${c.campo}-${c.codigo}`} sumied={NOMBRES[c.campo] ?? c.campo}>
          <span className={c.codigo ? undefined : 'cxg-mapa-falta'}>{c.codigo ? etiquetaDe(medidos, c.codigo) : 'Ningún campo'}</span>
        </Fila>
      ))}

      {!abierto ? (
        <div><button type="button" className="cxg-boton cxg-boton-principal" onClick={() => setAbierto(true)} disabled={ocupado || !sePuedeConfirmar(e)}>
          {confirmado ? 'Confirmar los cambios y leer' : 'Confirmar el mapa y leer'}</button></div>
      ) : (
        <div className="cxg-paso" role="group" aria-label="Confirmar el mapa">
          <p className="cxg-paso-aviso">
            Se guarda este mapa con tu nombre y se leen de nuevo las fichas de Bitrix24 (solo se lee: no se cambia nada en Bitrix24).
            Desde ahora se guarda la situación de cada ficha. Las opciones de «{etiquetaDe(medidos, e.situacion!)}»: {resumenDeOpciones(e)}.
            {faltan.length > 0 && ` Se confirma sin: ${faltan.map((f) => f.split(':')[0].toLowerCase()).join(', ')}.`}
          </p>
          <div className="cxg-paso-botones">
            <button type="button" className="cxg-boton cxg-boton-principal" onClick={() => void confirmar()} disabled={ocupado}>{ocupado ? 'Confirmando y leyendo…' : 'Confirmar y leer'}</button>
            <button type="button" className="cx-enlace" onClick={() => setAbierto(false)} disabled={ocupado}>Cancelar</button>
          </div>
        </div>
      )}
      {aviso && <p className="s-aviso-lista" data-tono={aviso.ok ? 'seguro' : 'falta'} role={aviso.ok ? 'status' : 'alert'}>{aviso.texto}</p>}
    </section>
  )
}
