# Migración: bloques y límites

## Ya integrados en main antes de este bloque

- PR #1: bootstrap configurado, revocación de sesiones y permisos operativos.
- PR #2 + motor PR #1: sucursales nativas, logo visible en Mi negocio y estilo del agente comercial. Ver BUSINESS_ADMIN.md para alcance y despliegue coordinado.

No se comprobó desde este entorno que Railway haya desplegado esos cambios ni se enviaron mensajes reales por WhatsApp.

## Bloque actual: herramientas de ONE Ventas

- Exportación CSV completa del catálogo nativo en una única revisión, incluidos inactivos, con escape de comillas y protección contra fórmulas. No equivale a la exportación paginada del legado. No cambia datos.
- Aumento/disminución por porcentaje, todos los items elegibles o coincidencia exacta de categoría/marca, sin distinguir mayúsculas. Sólo activos con precio fijo. No modifica Gastro.
- Redondeo al más cercano: centavos, 1, 10, 100 o 1000. Hasta 1000% de aumento o 100% de disminución, precio máximo 10.000.000.000.
- Vista previa de hasta 20 filas, cantidad total y cantidad que cambia. Confirmación explícita en la interfaz.
- Revisión y huella del cálculo ligadas a la empresa; transacción con bloqueo. Un segundo intento con la misma revisión no vuelve a aumentar precios.
- Registro transaccional en panel_sales_price_changes: actor, fecha, revisiones, configuración y precios anteriores/nuevos. Si falla el registro, se revierten los precios. No hay botón de deshacer automático.
- Requiere permiso editCatalog; el acceso global valida sesión, pertenencia y módulo. Usuarios de consulta pueden exportar el catálogo al que ya tienen acceso.

### Despliegue y validación

Sólo requiere actualizar el panel; el motor existente obtiene los precios del catálogo nativo. La tabla de auditoría se crea al iniciar, sin modificar registros existentes. No se ejecutó ningún ajuste en producción.

Ejecutar `npm ci`, `npm test`, `npm run check`. En una empresa de prueba ONE Ventas: exportar, generar un ajuste por categoría, revisar antes/después, aplicar una vez y comprobar los precios del bot. Cambiar un producto desde otra sesión entre vista previa y aplicación debe impedir el guardado y exigir recalcular. Verificar usuario de consulta y cambio de empresa durante una petición.

El CSV es de consulta/respaldo; **no reimportarlo como restauración automática**. El importador actual tiene límite de 1000 filas, empareja por código y no preserva todos los estados/IDs. Los textos con apariencia de fórmula se exportan con apóstrofo de seguridad; esto cambia su representación. No se eliminan datos ni tablas al revertir la versión.

## Pendientes de la migración completa

- Importación por lotes con vista previa, confirmación/cancelación y reanudación; paginación/filtros de catálogo.
- Preferencias administrativas restantes, logos en documentos y selección persistida de sucursal por pedido.
- Oportunidades, presupuestos, agenda, plantillas y reemplazo del resumen diario.
- Edición administrativa de pedidos, avisos y métricas operativas.
- Conciliar históricos completos, archivos de Drive y referencias; los snapshots recortados no equivalen a migración histórica.
- Chat web/páginas públicas y editor visual del menú.
- Validar despliegues, recuperación sin Apps Script y colas; recién después revisar los activadores y el corte. No apagar Apps Script con estos bloques solamente.
