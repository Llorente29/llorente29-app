// src/modules/conta/gestoria/CamposDeBitrix.tsx
//
// G01c · «Qué es cada campo», con dos pestañas: Empresas (la de siempre,
// QueEsCadaCampo) y Contactos. La de Contactos dice primero qué es cada
// contacto en Sumied y cuántos hay de cada (Julio, 07/11):
//   · con empresa → persona de contacto de su empresa (de todas);
//   · sin empresa y con alguna señal (NIF, Tarifa Recurrente, una negociación,
//     un cliente de GoCardless) → cliente; con solo una negociación, además a
//     «Pendiente de revisar»;
//   · sin empresa y sin ninguna señal → no entra, y se dice cuántos;
//   · con el NIF de una empresa → se une a ese cliente.
// Y el mapa: NIF, dirección, cuota de referencia y «Tipo de cliente» (de
// referencia, no situación). Sin códigos: cada campo por su etiqueta y su tipo.

import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ElegirCampo } from './ElegirCampo'
import { QueEsCadaCampo } from './QueEsCadaCampo'
import {
  camposParaElegir, etiquetaDe, loQueFaltaContactos, mapaContactosDe, propuestaContactos,
  type CampoMedido, type EleccionContactos, type MapaBitrix, type ResumenContactos,
} from './queEsCadaCampo'
import type { MapaContactos } from '../../../../supabase/functions/conta-bitrix-leer/contactosClientes'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const miles = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const fechaHora = (iso: string) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' })} a las ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}`
}


function Fila({ sumied, apoyo, children }: { sumied: string; apoyo?: string; children: ReactNode }) {
  return (
    <div className="cxg-mapa-fila">
      <div className="cxg-mapa-sumied"><strong>{sumied}</strong>{apoyo && <span className="cxg-apoyo">{apoyo}</span>}</div>
      <div className="cxg-mapa-bitrix">{children}</div>
    </div>
  )
}


export function QueEsCadaCampoContactos({ mapa, medidos, resumen, alConfirmar }: {
  mapa: MapaContactos | null
  medidos: Record<string, CampoMedido> | null
  resumen: ResumenContactos | null
  alConfirmar: (mapa: MapaContactos) => Promise<string>
}) {
  const [e, setE] = useState<EleccionContactos | null>(() => (medidos ? propuestaContactos(medidos, mapa ? {
    nif: mapa.nif, direccion: mapa.direccion?.calle ?? null, cuota: mapa.cuota, tipoCliente: mapa.tipoCliente } : null) : null))
  const [abierto, setAbierto] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const todos = useMemo(() => (medidos ? camposParaElegir(medidos) : []), [medidos])
  const listas = useMemo(() => (medidos ? camposParaElegir(medidos, (c) => !!c.items?.length || c.type === 'crm_status') : []), [medidos])
  if (!medidos || !e) {
    return <p className="cxg-nota">Aún no se han medido los campos de contacto del portal: la próxima lectura de Bitrix24 los mide y aquí se eligen.</p>
  }
  const cambiar = (p: Partial<EleccionContactos>) => { setE({ ...e, ...p }); setAviso(null) }
  const faltan = loQueFaltaContactos(e)
  const confirmado = mapa?.confirmado ?? null
  const confirmar = async () => {
    setOcupado(true); setAviso(null)
    try { setAviso({ ok: true, texto: await alConfirmar(mapaContactosDe(e, medidos)) }); setAbierto(false) }
    catch (x) { setAviso({ ok: false, texto: msg(x) }) } finally { setOcupado(false) }
  }
  return (
    <section className="cxg-mapa" aria-label="Qué es cada campo · Contactos" data-prueba="que-es-cada-campo-contactos">
      <div className="cxg-contactos-regla">
        <p className="cxg-apoyo"><strong>Qué es cada contacto en Sumied.</strong> Un contacto con empresa es persona de contacto de esa empresa (de todas, si tiene varias). Un contacto sin empresa es cliente si tiene NIF, Tarifa Recurrente, una negociación o un cliente de GoCardless; si su única señal es una negociación, sale también en «Pendiente de revisar». Uno con el NIF de una empresa se une a ese cliente. Los demás no entran.</p>
        {resumen && (
          <dl className="cxg-datos">
            <div><dt>Contactos en Bitrix24</dt><dd className="cxg-cifra">{miles(resumen.contactos)}</dd></div>
            <div><dt>Entran como clientes</dt><dd className="cxg-cifra">{miles(resumen.clientes)}</dd></div>
            <div><dt>Se unen al cliente de una empresa</dt><dd className="cxg-cifra">{miles(resumen.seUnenAEmpresa)}</dd></div>
            <div><dt>Personas de contacto de una empresa</dt><dd className="cxg-cifra">{miles(resumen.personas)}</dd></div>
            <div><dt>Se quedan fuera (sin empresa ni señal)</dt><dd className="cxg-cifra">{miles(resumen.fuera)}</dd></div>
            <div><dt>A «Pendiente de revisar»</dt><dd className="cxg-cifra">{miles(resumen.pendientes)}</dd></div>
          </dl>
        )}
      </div>
      {confirmado
        ? <p className="cxg-mapa-estado" data-tono="verde" role="status">Confirmado{confirmado.quien ? ` por ${confirmado.quien}` : ''} el {fechaHora(confirmado.cuando)}.</p>
        : <p className="s-aviso-lista" data-tono="falta" role="alert">Sin confirmar: no entra ningún contacto en Sumied. Revisa cada campo y confírmalo abajo.</p>}
      {faltan.length > 0 && (
        <div className="s-aviso-lista" data-tono="falta" role="alert"><strong>Falta:</strong><ul className="cxg-mapa-faltan">{faltan.map((f) => <li key={f}>{f}</li>)}</ul></div>
      )}
      <div className="cxg-mapa-cabeza" aria-hidden="true"><span>En Sumied</span><span>Sale de este campo del contacto en Bitrix24</span></div>
      <Fila sumied="NIF" apoyo="Con él se une al cliente de su empresa, si es el mismo.">
        <ElegirCampo etiqueta="NIF de los contactos: campo de Bitrix24" valor={e.nif} campos={todos} alCambiar={(v) => cambiar({ nif: v })} />
      </Fila>
      <Fila sumied="Dirección" apoyo="Con su código postal, población y provincia, si el campo los tiene.">
        <ElegirCampo etiqueta="Dirección de los contactos: campo de Bitrix24" valor={e.direccion} campos={todos} alCambiar={(v) => cambiar({ direccion: v })} />
      </Fila>
      <Fila sumied="Cuota de referencia" apoyo="Solo de referencia: Sumied no calcula nada con ella.">
        <ElegirCampo etiqueta="Cuota de los contactos: campo de Bitrix24" valor={e.cuota} campos={todos} alCambiar={(v) => cambiar({ cuota: v })} />
      </Fila>
      <Fila sumied="Tipo de cliente" apoyo="De referencia, en la ficha. Los contactos no tienen situación.">
        <ElegirCampo etiqueta="Tipo de cliente de los contactos: campo de Bitrix24" valor={e.tipoCliente} campos={listas} alCambiar={(v) => cambiar({ tipoCliente: v })} />
      </Fila>
      {['NAME', 'EMAIL', 'PHONE'].filter((k) => medidos[k]).map((k) => (
        <Fila key={k} sumied={k === 'NAME' ? 'Nombre' : k === 'EMAIL' ? 'Correo' : 'Teléfono'}><span>{etiquetaDe(medidos, k)}{k === 'NAME' ? ', con el segundo nombre y los apellidos' : ''}</span></Fila>
      ))}
      {!abierto ? (
        <div><button type="button" className="cxg-boton cxg-boton-principal" onClick={() => setAbierto(true)} disabled={ocupado}>{confirmado ? 'Confirmar los cambios y leer' : 'Confirmar el mapa de contactos y leer'}</button></div>
      ) : (
        <div className="cxg-paso" role="group" aria-label="Confirmar el mapa de contactos">
          <p className="cxg-paso-aviso">
            Se guarda este mapa con tu nombre y se leen de nuevo las empresas y los contactos de Bitrix24 (solo se lee: no se cambia nada en Bitrix24).
            {resumen ? ` Según la última medida: ${miles(resumen.clientes)} contactos entran como clientes, ${miles(resumen.personas)} como personas de contacto y ${miles(resumen.fuera)} se quedan fuera.` : ''}
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

/** Las dos pestañas, con el mismo aspecto que la de siempre. */
export function CamposDeBitrix({ empresas, contactos, inicial = 'empresas' }: {
  empresas: { mapa: MapaBitrix | null; medidos: Record<string, CampoMedido> | null; alConfirmar: (m: MapaBitrix) => Promise<string> }
  contactos: { mapa: MapaContactos | null; medidos: Record<string, CampoMedido> | null; resumen: ResumenContactos | null; alConfirmar: (m: MapaContactos) => Promise<string> }
  inicial?: 'empresas' | 'contactos'
}) {
  const [pestana, setPestana] = useState<'empresas' | 'contactos'>(inicial)
  const pestanas = [{ id: 'empresas' as const, texto: 'Empresas' }, { id: 'contactos' as const, texto: 'Contactos' }]
  const mover = (ev: KeyboardEvent<HTMLButtonElement>) => {
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return
    ev.preventDefault(); setPestana(pestana === 'empresas' ? 'contactos' : 'empresas')
  }
  return (
    <div className="cxg-campos" data-prueba="campos-de-bitrix">
      <h3 className="cxg-ficha-sub">Qué es cada campo</h3>
      <div className="s-pestanas-estado" role="tablist" aria-label="Qué es cada campo">
        {pestanas.map((p) => (
          <button key={p.id} type="button" role="tab" id={`campos-${p.id}`} aria-selected={pestana === p.id} aria-controls={`panel-${p.id}`}
            tabIndex={pestana === p.id ? 0 : -1} className="s-pestana-estado" onClick={() => setPestana(p.id)} onKeyDown={mover}>
            <span>{p.texto}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${pestana}`} aria-labelledby={`campos-${pestana}`}>
        {pestana === 'empresas'
          ? <QueEsCadaCampo mapa={empresas.mapa} medidos={empresas.medidos} alConfirmar={empresas.alConfirmar} sinTitulo />
          : <QueEsCadaCampoContactos mapa={contactos.mapa} medidos={contactos.medidos} resumen={contactos.resumen} alConfirmar={contactos.alConfirmar} />}
      </div>
    </div>
  )
}
