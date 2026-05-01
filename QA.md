# Checklist de pruebas manuales

Usa esta lista antes de subir cambios grandes o antes de mezclar a `master`.

## Preparacion

- Abrir la app en `http://localhost:5180/index.html`.
- Probar en Chrome de escritorio.
- Probar tambien en celular o con vista responsive.
- Usar al menos dos cuentas reales para validar amigos y canjes.

## Autenticacion

- Crear una cuenta nueva desde `register.html`.
- Entrar con una cuenta existente.
- Verificar que cerrar sesion vuelve a la pantalla de login.
- Intentar entrar con clave incorrecta y confirmar que aparece un mensaje claro.

## Album

- Abrir un equipo desde la home.
- Agregar una lamina.
- Quitar una lamina.
- Agregar la misma lamina dos veces y confirmar que cuenta como repetida.
- Verificar que las estadisticas de la home cambian al instante.
- Recargar la pagina y confirmar que el estado se conserva.

## Notificaciones internas

- Abrir la campana de notificaciones desde la home.
- Confirmar que se muestra la lista o el estado vacio.
- Agregar una lamina repetida y confirmar que aparece una notificacion.
- Agregar un sobre y confirmar que aparece una notificacion.
- Crear un grupo y confirmar que aparece una notificacion.
- Probar `Marcar leidas` y `Limpiar`.

## Canjes cerca

- Abrir `Canjes Cerca`.
- Activar ubicacion y aceptar el permiso del navegador.
- Confirmar que aparece el mapa con tu zona aproximada.
- Con otra cuenta, activar ubicacion cerca y tener laminas repetidas/faltantes compatibles.
- Confirmar que aparece en el ranking con distancia aproximada y cantidad de canjes.
- Enviar solicitud desde el ranking cercano.
- Aceptar con la otra cuenta y probar el chat interno.

## Resumen

- Abrir `Ver Resumen Detallado`.
- Revisar pestanas `Tengo`, `Repet.` y `Faltan`.
- Confirmar que los conteos coinciden con las laminas marcadas.

## Paquetes

- Abrir `Agregar Paquete`.
- Pegar varios codigos validos, por ejemplo:

```text
ARG 1
BRA 5
COL 3
FWC 8
```

- Confirmar que se agregan al album.
- Probar un codigo invalido y confirmar que no rompe la app.

## Intercambio manual

- Tener al menos una repetida.
- Abrir `Intercambio Rapido`.
- Cambiar una repetida por una faltante.
- Confirmar que baja la repetida y sube la nueva lamina.

## Amigos y canjes

- Con dos cuentas, agregar el correo de la otra cuenta como amigo.
- Confirmar que aparece en la lista.
- Confirmar que el ranking muestra ambos usuarios.
- Crear un grupo llamado `Familia`.
- Elegir `Familia` en el selector y agregar un correo.
- Confirmar que la pestana `Familia` muestra solo los miembros de ese grupo.
- Crear otro grupo llamado `Amigos` y confirmar que cada grupo mantiene su propio ranking.
- Crear una repetida en una cuenta y una faltante en la otra.
- Abrir los canjes del amigo y verificar la sugerencia.
- Enviar una solicitud interna de canje.
- Entrar con la otra cuenta y aceptar la solicitud.
- Abrir el chat interno y enviar mensajes desde ambas cuentas.
- Probar `Enviar propuesta inteligente` y confirmar que abre WhatsApp con el mensaje.

## Compartir y exportar

- Abrir `Compartir y PDF`.
- Probar compartir repetidas por WhatsApp.
- Generar PDF de faltantes.
- Generar PDF de repetidas.
- Generar imagen y confirmar que se abre correctamente.

## Scanner

- Abrir el scanner en celular o navegador con permisos de camara.
- Capturar una lamina/codigo visible.
- Confirmar que la app pregunta antes de guardar.
- Cancelar una lectura y verificar que no cambia el album.

## PWA y cache

- Recargar la app despues de cambios.
- Si ves una version vieja, cerrar la pestana y abrir de nuevo.
- En caso extremo, limpiar cache del navegador o desregistrar el service worker.

## Criterio para aprobar

- No hay errores visibles en consola.
- La app conserva datos despues de recargar.
- Las cuentas reales pueden agregarse como amigos.
- Ninguna vista queda en blanco.
- La app funciona en pantalla pequena.
