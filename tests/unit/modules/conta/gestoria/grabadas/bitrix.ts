// G01 · Respuestas GRABADAS e INVENTADAS de la API REST de Bitrix24 (T11: ningún
// dato real). La forma es la de la documentación oficial
// (https://apidocs.bitrix24.com): crm.company.fields devuelve cada campo con
// su etiqueta y sus opciones; crm.company.list, de 50 en 50 con «next».
export const URL_PRUEBA = 'https://portal-de-prueba.bitrix24.es/rest/1/clavedeprueba/'

export const CAMPOS = {
  ID: { type: 'integer', title: 'ID' },
  TITLE: { type: 'string', title: 'Nombre de la empresa' },
  EMAIL: { type: 'crm_multifield', title: 'E-mail' },
  PHONE: { type: 'crm_multifield', title: 'Teléfono' },
  UF_CRM_100: { type: 'string', formLabel: 'NIF', listLabel: 'NIF' },
  UF_CRM_101: { type: 'enumeration', formLabel: 'Situación', items: [{ ID: '1', VALUE: 'Activo' }, { ID: '2', VALUE: 'Baja' }, { ID: '3', VALUE: 'Moroso' }, { ID: '4', VALUE: 'Solo renta' }] },
  UF_CRM_102: { type: 'enumeration', isMultiple: true, formLabel: 'Servicios', items: [{ ID: '11', VALUE: 'C' }, { ID: '12', VALUE: 'L' }, { ID: '13', VALUE: 'S' }] },
  UF_CRM_103: { type: 'enumeration', formLabel: 'Forma de pago', items: [{ ID: '21', VALUE: 'Emisor Prueba Alfa' }, { ID: '22', VALUE: 'Emisor Prueba Alfa Nuevo' }, { ID: '23', VALUE: 'Persona Prueba Gomez' }] },
  UF_CRM_104: { type: 'money', formLabel: 'Cuota Mensual' },
  UF_CRM_105: { type: 'string', formLabel: 'Comercial' },
}

const empresa = (i: number) => ({
  ID: String(i), TITLE: `CLIENTE PRUEBA ${i}`, EMAIL: [{ VALUE: `cliente${i}@prueba.test`, VALUE_TYPE: 'WORK' }], PHONE: [],
  UF_CRM_100: i === 1 ? 'B00000001' : null, UF_CRM_101: i % 10 === 0 ? '2' : '1', UF_CRM_102: ['11', '12'],
  UF_CRM_103: i % 3 === 0 ? '23' : '22', UF_CRM_104: '90,75|EUR',
})
/** 60 empresas: una página de 50 y otra de 10. */
export const LISTA = (start: number) => ({ result: Array.from({ length: start === 0 ? 50 : 10 }, (_, k) => empresa(start + k + 1)), ...(start === 0 ? { next: 50 } : {}), total: 60 })

export function fetchGrabado(pedidas: { metodo: string; cuerpo: Record<string, unknown> }[] = []) {
  return async (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => {
    const cuerpo = JSON.parse(init.body) as Record<string, unknown>
    if (!url.startsWith(URL_PRUEBA)) return { ok: true, status: 200, json: async () => ({ error: 'NO_AUTH_FOUND', error_description: 'Wrong authorization data' }) }
    const metodo = url.slice(URL_PRUEBA.length).replace(/\.json$/, '')
    pedidas.push({ metodo, cuerpo })
    if (metodo === 'crm.company.fields') return { ok: true, status: 200, json: async () => ({ result: CAMPOS }) }
    if (metodo === 'crm.company.list') return { ok: true, status: 200, json: async () => LISTA(Number(cuerpo.start ?? 0)) }
    return { ok: false, status: 404, json: async () => ({ error: 'ERROR_METHOD_NOT_FOUND' }) }
  }
}
