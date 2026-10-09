# DLL ONE Panel Cloud V5.1.0 — Conversaciones reales

## Objetivo

Esta versión NO reemplaza el bot actual ni el Panel V4.1.7.

Es la primera etapa de migración del Panel Central a:

**Navegador → Railway → PostgreSQL**

El Panel V5 lee desde PostgreSQL y por eso deja de esperar a Google Sheets en cada pantalla.

## Qué incluye esta Alpha

- Login propio.
- Multiempresa.
- Dashboard.
- Conversaciones / Chats.
- Pedidos.
- Delivery por cotizar.
- Clientes.
- PostgreSQL.
- Sincronización desde el Apps Script actual.
- Diseño DLL ONE verde.
- Preparado para agregar ONE Salud / Turnos después.

## Qué NO hace todavía

V5.0.0 es **shadow/read-only**.

Las acciones críticas siguen haciéndose desde el Panel V4:
- tomar una conversación,
- responder manualmente,
- cambiar estados de pedidos,
- cotizar delivery,
- verificar comprobantes.

Esto es intencional. Primero comprobamos velocidad/estabilidad de la nueva arquitectura sin arriesgar el bot que hoy funciona.

La próxima etapa será V5.1:
**acciones del panel → Railway → backend**, moviendo operaciones una a una.

---

# Instalación en Railway

## 1. GitHub

Crear un repositorio nuevo, por ejemplo:

`dll-one-panel-v5`

Subir a la raíz TODO el contenido de la carpeta `dll_one_panel_v5`.

## 2. Railway

Crear un nuevo servicio desde ese repositorio.

NO reemplazar el servicio actual `dll-one-v4-motor`.

Este Panel debe ser un servicio aparte.

## 3. Agregar PostgreSQL

Dentro del mismo proyecto Railway:

**Add / New → Database → PostgreSQL**

Después conectar la variable `DATABASE_URL` al servicio `dll-one-panel-v5`.

## 4. Variables del servicio

Cargar:

```text
NODE_ENV=production
PANEL_ADMIN_USER=tu-correo
PANEL_ADMIN_PASSWORD=una-clave-fuerte
JWT_SECRET=una-clave-muy-larga-y-aleatoria
PANEL_SYNC_KEY=TU_DLL_ONE_BRIDGE_KEY
```

`PANEL_SYNC_KEY` tiene que ser EXACTAMENTE el mismo valor de `DLL_ONE_BRIDGE_KEY` del Apps Script actual.

Railway define `PORT` automáticamente. El código también acepta 8080.

## 5. Verificar Railway

Abrir:

`https://TU-DOMINIO-RAILWAY/health`

Esperado:

```json
{
  "ok": true,
  "service": "DLL ONE Panel Cloud",
  "version": "5.0.0",
  "mode": "POSTGRES_SHADOW"
}
```

Al principio `companies` va a estar en 0.

---

# Conectar Apps Script

## 1. Agregar archivo

En el proyecto Apps Script ACTUAL de DLL ONE:

**+ → Secuencia de comandos**

Nombre:

`PanelV5Sync`

Pegar el contenido de:

`PANEL_V5_SYNC_V500.gs`

NO reemplazar `Código.gs`.
NO reemplazar `panel.html`.

## 2. Script Property

Apps Script → Configuración del proyecto → Propiedades del script.

Agregar:

```text
PANEL_V5_URL
```

Valor:

```text
https://TU-DOMINIO-RAILWAY
```

Sin barra `/` al final.

## 3. Diagnóstico

Ejecutar:

```javascript
diagnosticoPanelCloudV500()
```

Tiene que mostrar:

- panelUrl con tu Railway.
- bridgeKeyConfigurada = true.
- empresasActivas >= 1.

## 4. Primera copia

Ejecutar:

```javascript
sincronizarPanelCloudV500()
```

Después volver a `/health`.

Ahora debería decir:

```json
"companies": 1
```

o más, según empresas activas.

## 5. Abrir Panel V5

Abrir directamente el dominio Railway del Panel.

Entrar con:

- `PANEL_ADMIN_USER`
- `PANEL_ADMIN_PASSWORD`

El Dashboard y las pestañas deben abrir desde PostgreSQL.

---

# Sincronización automática

Cuando la primera prueba funcione, ejecutar:

```javascript
instalarTriggerPanelCloudV500()
```

Esto crea una copia cada 1 minuto.

**Importante:** este trigger es temporal durante la migración.

En V5.1/V5.2 el objetivo es que el bot y el panel escriban directamente en PostgreSQL y eliminar esta espera de hasta 1 minuto.

Para quitarlo:

```javascript
quitarTriggerPanelCloudV500()
```

---

# Arquitectura de migración

## Hoy

```text
WhatsApp
   ↓
Railway V4
   ↓
Apps Script / Sheets

Panel V4
   ↓
Apps Script / Sheets
```

## V5.0 Shadow

```text
Bot actual ───────────────► sigue igual

Sheets
   ↓ cada minuto
PanelV5Sync
   ↓
Railway Panel V5
   ↓
PostgreSQL
   ↓
Panel Cloud
```

## Meta final

```text
WhatsApp ──► Railway
                │
Panel Web ──────┤
                ↓
            PostgreSQL
                │
          Sheets = backup/export
```

---

# Hospital / ONE Salud

No conectar datos reales del hospital a esta Alpha.

V5.0 prepara la base técnica.

Cuando el hospital confirme qué sistema de turnos usa, se crea el módulo:

**DLL ONE Salud / Turnos**

con su propia estructura de:
- pacientes administrativos,
- especialidades,
- profesionales,
- agendas,
- turnos,
- recordatorios,
- auditoría,
- derivación humana.

No se debe mezclar información clínica con el módulo Gastro.


## V5.0.2 Mobile First

- Barra inferior fija para navegar con una mano en celular.
- Inicio, Chats, Pedidos, Delivery y Clientes siempre accesibles.
- Tablas convertidas automáticamente en tarjetas verticales en pantallas chicas.
- Selector de empresa compacto y fijo arriba.
- Botón actualizar accesible.
- Mejor tamaño de botones y campos táctiles.
- Soporte básico PWA para agregar el Panel a la pantalla de inicio.
- No cambia el motor, PostgreSQL, credenciales ni sincronización.


## V5.1 — Conversaciones reales

El Panel Cloud ya puede operar la bandeja de WhatsApp:

- Ver conversaciones en vivo.
- Buscar y filtrar BOT / HUMANO.
- Abrir historial.
- Tomar conversación: pausa la IA para ese cliente.
- Responder desde el Panel Cloud usando el WhatsApp del negocio.
- Devolver al bot.
- Respeta la ventana de 24 horas de WhatsApp.

La seguridad de las acciones usa el mismo `DLL_ONE_BRIDGE_KEY` / `PANEL_SYNC_KEY`.
La clave nunca se entrega al navegador; Railway llama al Bridge de Apps Script.

### Todavía en V4

Pedidos, cocina, delivery, comprobantes y configuración continúan operándose en V4.
Eso se migra en V5.2.


## Hotfix V5.1.2 — Bridge URL probada

El Panel V5 ahora da prioridad a la variable Railway:

APPS_SCRIPT_BRIDGE_URL

Debe copiarse EXACTAMENTE desde el servicio Railway `dll-one-v4-motor`,
donde ya está funcionando el bridge con Apps Script.

Esto evita depender de `ScriptApp.getService().getUrl()`, que puede devolver
una URL /dev o una implementación que pide login de Google.
