# DLL One — matriz de autorización por módulo

Esta revisión diferencia **configuración central de la plataforma**, **gestión del catálogo de cada empresa** y **operación diaria**. Ocultar un control no es suficiente: las escrituras sensibles exigen permisos en el servidor.

| Función | SUPERADMIN | ADMIN_EMPRESA / OPERADOR |
|---|---|---|
| Empresas, usuarios, roles, accesos, conexiones con Meta | Sí | No |
| Datos generales de la empresa, IA, horarios globales y pagos | Sí | No |
| Sucursales, logotipo, estilo de negocio | Sí | No |
| ONE Barberías: servicios, profesionales, horarios y políticas | Sí | No |
| ONE Barberías: atender / cancelar turnos | Sí | Con permiso `operate` |
| ONE Cabañas: reglas generales y políticas de alojamiento | Sí | No |
| ONE Cabañas: solicitudes, bloqueos, confirmación y cancelación | Sí | Con permiso `operate` |
| ONE Cabañas: fichas, precios y fotos de unidades | Sí | Con permiso `editCatalog` |
| ONE Eventos: crear y editar eventos | Sí | Con permiso `editCatalog` |
| ONE Eventos: inscripciones, ingresos y pagos manuales | Sí | Con permiso `operate` |
| ONE Salud: profesionales / horarios base | Sí | No |
| ONE Salud: reservar y cancelar turnos | Sí | Con permiso `operate` |
| ONE Ventas / Gastro: contenido comercial (catálogos) | Sí | Según permiso `editCatalog` |
| ONE Gastro: migrar/copiar datos históricos de Apps Script | Sí | No |
| ONE Gastro: cobro comercial, menú visual y zonas | Sí | Según permiso `editCatalog` |
| ONE Salud: usar la agenda y consultar profesionales | Sí | Con acceso de consulta a la empresa |

La operación diaria sigue sujeta al servicio activo de la empresa. Los usuarios sin asignación a esa empresa no pueden entrar. Los permisos de edición de catálogo no implican permisos operativos, y viceversa.

## Verificación previa a publicación

- Ingresar como SUPERADMIN y modificar una configuración no productiva de prueba.
- Ingresar como editor sin `operate`: no podrá confirmar reservas ni cambiar turnos.
- Ingresar como operador sin `editCatalog`: podrá atender turnos / reservas, pero no modificar fichas ni precios.
- Ingresar como ADMIN_EMPRESA con ambos permisos: no podrá editar configuración central.
- Ingresar con empresa ajena, usuario suspendido y servicio pausado: las escrituras deben bloquearse.
- Probar que los controles de Cabañas se muestran u ocultan según `canOperate` y `canConfigure`.
- Verificar en escritorio y móvil la bandeja de WhatsApp y el modo expandido.

Esta matriz no convierte automáticamente en configuración central todas las opciones internas de Gastro o Eventos; hay ajustes comerciales que siguen siendo operaciones del cliente. Esa separación debe mantenerse explícita al incorporar nuevas funciones.

## Revisión adicional 13 de noviembre de 2026

- Migración de Gastro: `GET` y `POST` de estado/copia protegidos por `requireSuperadmin`; el botón no aparece para clientes y el navegador no intenta consultas administrativas.
- Gastro: la API responde `canEdit` según pertenencia, `view` y `editCatalog`; al no tener permiso, los formularios se deshabilitan y el contenido sigue disponible para consulta. El servidor siempre valida también las escrituras.
- Salud: la API informa `canOperate` teniendo en cuenta el estado del servicio y los permisos; el panel no muestra cancelar ni permite pruebas del bot o reservas para cuentas de consulta. La suspensión bloquea además la cancelación aunque se trate de un superadministrador.
- Eventos: el middleware del módulo rechaza membresías con `view=false` además de verificar edición y operación.
- Se eliminaron ramificaciones antiguas inalcanzables de perfil, horarios e instrucciones, todas protegidas por middleware SUPERADMIN.

## Estado del despliegue

Railway tiene el panel V5 y el motor V4 desplegados en producción desde `main`. Esta propuesta está en una rama de revisión y **no se ha desplegado** a producción. Los proyectos vistos tienen solo entornos `production`; antes de fusionar, probar en un entorno separado o de revisión sin datos reales, especialmente edición de catálogos y cobros.

Verificar `npm run check`, `npm test` y la auditoría de repositorio en GitHub Actions, y realizar un recorrido manual de la interfaz con cuentas SUPERADMIN, ADMIN_EMPRESA (con y sin `operate` / `editCatalog`) y servicio suspendido.


## Administración de contraseñas — 15 de noviembre de 2026

- `SUPERADMIN` puede restablecer la contraseña de **otra** cuenta de la base de datos, incluida otra cuenta `SUPERADMIN`, desde **Usuarios y accesos**. Una cuenta no puede restablecer su propia contraseña por esta vía.
- La interfaz permite ingresar una contraseña nueva y confirmarla; **ninguna contraseña actual es recuperable ni visible**. El servidor valida de 12 caracteres como mínimo a 72 bytes UTF-8 como máximo (límite efectivo de bcrypt), y solo guarda el hash bcrypt.
- Cada restablecimiento incrementa `panel_users.session_version`; las sesiones anteriores quedan invalidadas en la siguiente solicitud. El usuario vuelve a ingresar con la contraseña nueva.
- `panel_user_security_log` registra IDs de usuario actor y destino y la acción; no registra claves ni hashes. La actualización del hash y el registro son transaccionales.
- Un usuario suspendido sigue suspendido después del restablecimiento.
- La cuenta bootstrap/recuperación configurada con `PANEL_ADMIN_USER` y `PANEL_ADMIN_PASSWORD` en Railway (UID 0) no está en el listado de usuarios de PostgreSQL y **no se modifica desde el panel**.
- La pantalla de alta distingue el **Nombre visible** del **Usuario o correo de ingreso**. Los correos de la base se consultan sin distinguir mayúsculas, pero una contraseña errónea debe mostrar `Usuario o contraseña incorrectos.`, no `Sesión vencida`.
- Checklist en entorno aislado: crear SUPERADMIN con correo de prueba, ingresar usando distinto uso de mayúsculas, fallar una clave a propósito y verificar el mensaje correcto; restablecer desde otro SUPERADMIN, confirmar la revocación de cookie anterior, la entrada con clave nueva y que ninguna cuenta no administradora pueda usar el endpoint.
