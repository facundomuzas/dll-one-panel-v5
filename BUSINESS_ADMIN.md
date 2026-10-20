# Administración del negocio

Este bloque agrega locales, logo y estilo comercial en **Mi negocio**. No completa por sí solo la migración de Apps Script.

## Despliegue coordinado

1. Desplegar el panel. Al iniciar crea `panel_business_admin` de forma aditiva, sin alterar datos anteriores.
2. Desplegar el motor con soporte para `pickup.branchesNative` y `businessStyle` (rama `feat/business-administration` del repositorio del motor).
3. Con ambos servicios actualizados, verificar una empresa de prueba antes de guardar sucursales reales. El motor anterior ignora los campos nuevos y seguirá usando la dirección general.

No se importan ni activan locales automáticamente. «Conservar locales sincronizados» persiste la lista visible de la última sincronización; no garantiza que Apps Script haya exportado todos sus locales. Guardar un local también conserva esa lista. Revisarla antes de guardar.

Una vez guardada la lista nativa, sólo sus locales activos con retiro habilitado se informan al bot. Desactivar todos **no** restaura la dirección general ni el snapshot. La dirección general continúa disponible para empresas sin locales nativos.

El logo se muestra en Mi negocio; no modifica PDFs, cartas ni mensajes de WhatsApp. El estilo se aplica al prompt de IA del agente comercial, no a mensajes deterministas, reglas de pago o módulos con agentes separados. La selección de sucursal por pedido todavía requiere coordinación con el equipo; este bloque no registra una sucursal en el pedido.

## Verificación

- `npm ci` y `npm test`: permisos, PostgreSQL embebido real, revisiones, aislamiento por empresa, logo, estilo y borradores en DOM.
- `npm run check`: sintaxis del servidor.
- En una empresa de prueba: cargar dos locales, preguntar ubicaciones por WhatsApp, desactivar uno y volver a preguntar en el mismo chat. Luego desactivar ambos y comprobar que no reaparece la dirección antigua.
- Probar un usuario de consulta, un usuario editor y el cambio de empresa con un borrador sin guardar.

No borrar la tabla al revertir una versión: contiene datos del usuario. Volver a un motor anterior vuelve a usar la dirección general, por lo que requiere revisar el comportamiento de retiro. Los triggers de Apps Script y la migración histórica quedan fuera de este cambio.
