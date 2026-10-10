# DLL ONE Panel Cloud V5.2.0

## Super Admin + Onboarding de empresas

V5.2 agrega al Panel Cloud:

- Super Admin.
- Alta de empresas nuevas.
- Selección de módulos por empresa.
- Usuarios propios por empresa.
- Cada usuario ve solamente las empresas asignadas.
- Edición de datos del negocio.
- Catálogo y precios sin abrir Google Sheets.
- Alta manual de productos y servicios.
- Importación de listas Excel/CSV.
- ONE Gastro: categorías, productos, variantes y extras.
- Conversaciones operativas de V5.1.
- Diseño Mobile First.

## Arquitectura de esta etapa

Los usuarios y permisos nuevos viven en PostgreSQL.

Los datos comerciales que el bot todavía consume desde Google Sheets se escriben a través del Bridge seguro:

Panel V5 -> Railway -> Apps Script -> planilla de la empresa.

Esto mantiene compatible el bot actual mientras seguimos migrando.

## Roles

### SUPERADMIN

- Ve todas las empresas.
- Crea empresas.
- Activa módulos.
- Crea accesos para clientes.
- Puede editar cualquier empresa.

El usuario definido en `PANEL_ADMIN_USER` / `PANEL_ADMIN_PASSWORD` sigue siendo el Super Admin de emergencia.

### ADMIN_EMPRESA

- Solo ve su empresa asignada.
- Puede usar conversaciones.
- Puede editar datos del negocio.
- Puede cargar catálogo/listas de precios.
- Puede administrar ONE Gastro si el módulo está activo.
- No puede activar módulos ni crear otras empresas.

### OPERADOR

En V5.2 tiene acceso a las empresas asignadas y operación básica. Más adelante vamos a separar permisos finos por sección.

## Importación de listas de precios

Formatos:

- `.xlsx`
- `.xls`
- `.csv`

La primera hoja debe tener una columna `NOMBRE` o `PRODUCTO`.

Columnas reconocidas:

- CODIGO / CÓDIGO / SKU
- NOMBRE / PRODUCTO
- DESCRIPCION / DESCRIPCIÓN
- PRECIO
- CATEGORIA / CATEGORÍA
- MARCA
- UNIDAD
- TIPO_ITEM

Hasta 1000 filas por archivo y 6 MB.

## Instalación

1. Hacer backup actual:

```javascript
crearBackupManualV371()
```

2. Apps Script: reemplazar `Código.gs` completo por:

`CODIGO_PANEL_CENTRAL_V520_SUPERADMIN_ONBOARDING.gs`

3. Reemplazar `PanelV5Sync.gs` por:

`PANEL_V5_SYNC_V520.gs`

4. Guardar y ejecutar una vez:

```javascript
actualizarAV520SuperAdminOnboarding()
```

5. Apps Script -> Implementar -> Administrar implementaciones -> Editar -> Nueva versión -> Implementar.

6. Ejecutar:

```javascript
verBridgePublicoV511()
```

Debe terminar en `/exec`.

7. GitHub: subir el contenido de `dll_one_panel_v5` al repo `dll-one-panel-v5`, sobrescribiendo la versión anterior.

8. Commit changes y esperar Railway Online.

9. Revisar:

`/health`

Debe decir:

```json
"version":"5.2.0"
```

10. Abrir Panel -> Ctrl+F5.

## No cambiar en Railway

Se mantienen:

- DATABASE_URL
- PANEL_ADMIN_USER
- PANEL_ADMIN_PASSWORD
- JWT_SECRET
- PANEL_SYNC_KEY
- APPS_SCRIPT_BRIDGE_URL

No hace falta crear otro PostgreSQL ni otro servicio.

## Primer alta recomendada

1. Entrar como Super Admin.
2. Super Admin -> Crear empresa.
3. Elegir módulos.
4. Crear acceso para cliente.
5. Cerrar sesión.
6. Entrar con la cuenta del cliente.
7. Confirmar que solo ve su empresa.
8. Mi negocio -> completar datos.
9. Catálogo / precios -> cargar Excel o agregar items.
10. Si tiene Gastro -> cargar categorías, productos, variantes y extras.

## Todavía pendiente para próximas versiones

- Menú visual por imágenes desde V5.
- Medios de pago desde V5.
- Configuración de delivery desde V5.
- Cambio/restablecimiento de contraseña por el cliente.
- Permisos finos para OPERADOR.
- Pedidos/cocina/comprobantes 100% operativos desde V5.
- Escritura directa del bot en PostgreSQL.


## V5.3.0 — Gastro Autogestión

Agrega al Panel Cloud:
- carga y orden de imágenes del menú,
- activar/desactivar envío automático de menú,
- medios de pago y detalle/alias,
- habilitar efectivo/transferencia,
- habilitar delivery/retiro,
- zonas de delivery con referencias y costo,
- autogestión desde celular o PC sin abrir Google Sheets.

Los cambios se guardan todavía a través del Bridge seguro en las hojas que usa el bot actual. Así el comportamiento productivo no se rompe durante la migración.


## V5.4.0 — ONE Gastro lee desde PostgreSQL

La apertura de ONE Gastro ya NO llama a Apps Script.

`GET /api/company/:companyId/gastro/bundle`
lee `snapshot.data.gastroBundle` directamente desde PostgreSQL.

Apps Script queda temporalmente para:
- escrituras/ediciones;
- sincronización de fondo hacia PostgreSQL.

Esto elimina el timeout al abrir ONE Gastro.


## V5.4.1 — Conversaciones desde PostgreSQL

Las lecturas de:
- bandeja de conversaciones;
- historial de mensajes;

ya no llaman Apps Script.

Se leen desde el snapshot PostgreSQL existente:
- Clientes
- Chats
- Conversaciones
- AtencionHumana

Tomar chat, enviar mensaje y devolver al bot siguen pasando temporalmente
por el Bridge, pero las lecturas frecuentes ya no pueden provocar timeout
de Apps Script.


## V5.5.0 — Conversaciones 100% Railway

Conversaciones deja de usar Apps Script para:
- tomar chat;
- enviar mensaje humano;
- devolver al bot;
- leer bandeja;
- leer historial.

El Panel guarda estado/mensajes en PostgreSQL.
El Motor V4.2 envía WhatsApp directamente por Meta y consulta el modo
BOT/HUMANO al Panel V5.
