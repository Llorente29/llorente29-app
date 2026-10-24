# D01 · El reenvío de Gmail para las facturas de Foodint

> Para Julio. Escrito el 24/10, con la tanda del #216 pasada al sistema del C10
> (carpeta `supabase/produccion/tandas/sumied/conta-d01-facturas-correo`).
> Nada de esto se ha hecho en producción: es el orden en que se hace.

## Qué se consigue

Las facturas que los proveedores mandan al buzón de Foodint en Gmail **se
reenvían solas** a `facturas-foodint@entrada.folvy.app`. Resend las recibe y
llama a `conta-facturas-entrada`, que las sube, las lee y deja cada una en
Compras › Facturas recibidas, por revisar. Si llega otra vez el mismo PDF, lo
dice («ya estaba») y no la apunta dos veces.

## El orden

1. **La tanda, desde la rama y antes de fusionar** (`aplicar-produccion-conta`,
   campo `tanda` vacío): primero el ensayo y luego el real. Las dos «siguen»:
   no hay autorizo.
   - La 0040 añade los remitentes que no mandan facturas y cambia
     `conta_entrada_llegada` con la misma firma, para que la repetida deje
     rastro.
   - La 0041 crea `facturas-foodint@entrada.folvy.app` **encendida**, y el
     remitente de los justificantes de un proveedor, por su huella.
2. **Fusionar el #216.** Eso despliega `conta-facturas-entrada`. El PR la nombra
   en «Funciones a desplegar a mano» por si el despliegue no sale: mírala en lo
   desplegado contra `origin/main`.
3. **Crear el reenvío en Gmail** (ver abajo). Gmail manda un correo de
   confirmación **a la dirección de entrada**, que tiene que estar ya encendida.
   Si no lo está, el correo se apunta como «apagada» y no se lee. Por eso este
   paso va después de la tanda.
4. **Confirmar el reenvío** con el código o con el enlace (ver abajo).
5. **Crear el filtro**, para que solo se reenvíen las facturas.

## En Gmail (el buzón de Foodint)

1. Ajustes → «Ver todos los ajustes» → **Reenvío y correo POP/IMAP** →
   «Añadir una dirección de reenvío».
2. Escribir `facturas-foodint@entrada.folvy.app` → Siguiente → Continuar.
   Gmail envía un correo de confirmación a esa dirección.
3. **El código o el enlace de confirmación:** la función los apunta en el
   registro de entrada (`inbound_email_log`, resultado `confirmacion`). Todavía
   **ninguna pantalla lo enseña**, así que hay que leerlo con una consulta de
   solo lectura:

   ```sql
   select received_at, subject, detail->>'codigo' as codigo, detail->>'enlace' as enlace
     from public.inbound_email_log
    where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and outcome = 'confirmacion'
    order by received_at desc
    limit 3;
   ```

   - En Gmail normal se escribe el **código** en «Verificar».
   - En Google Workspace a veces no hay casilla para el código: se abre el
     **enlace**. Solo se apuntan enlaces de Google (`mail.google.com` o
     `mail-settings.google.com`, con `/mail/vf-`).
4. **No activar «Reenviar una copia del correo entrante» para todo el buzón.**
   Lo que se reenvía lo decide el filtro del paso siguiente.
5. **El filtro:** en la búsqueda, «Mostrar opciones de búsqueda» → en «De»,
   las direcciones de los proveedores que mandan facturas (o
   `has:attachment filename:pdf factura`, si se prefiere por contenido) →
   «Crear filtro» → «Reenviar a» `facturas-foodint@entrada.folvy.app`.
   - Es el **primer cerrojo**: solo reenvía lo que es factura.
   - El **segundo** es la base: un remitente que se sabe que manda
     justificantes y no facturas (el de la 0041, guardado por su huella) se
     apunta y no se lee aunque llegue reenviado.
6. **Probar con una factura de verdad:** reenviarla a mano y comprobar que sale
   en Compras › Facturas recibidas, por revisar, con su PDF.

## Lo que hay que saber

- **Un reenvío automático de Gmail conserva el `To:` original** (el buzón de
  Foodint). La función mira también el sobre, así que la reconoce igual.
- **El mismo PDF dos veces** no crea dos facturas: la actividad de la primera
  dice «Ha vuelto a llegar por correo el … el mismo fichero: ya estaba».
  **Otro PDF de la misma factura** se lee, y la base la reconoce por su número
  como repetida.
- **Si algo no llega,** ningún correo se pierde sin rastro: todo lo que recibe
  Resend queda en `inbound_email_log`, con su resultado y su porqué (sin
  destino, apagada, no es factura, repetido, error…).
- **Pendiente para otro encargo:** una pantalla que enseñe el registro de
  entrada (y el código de confirmación) sin tener que ir a la base.
