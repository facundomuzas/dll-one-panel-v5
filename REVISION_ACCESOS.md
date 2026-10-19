# Primer bloque de migración: controles de acceso

Base revisada: `00e6d66040101cd5e63cda654df565104751ca68` (panel 5.8.7).

Este cambio corrige tres problemas confirmados antes de continuar la migración:

- Un bootstrap sin variables de administrador podía aceptar usuario y contraseña vacíos. Ahora se exige una configuración completa y credenciales no vacías.
- Un JWT seguía siendo válido al desactivar al usuario o cambiar su rol. Ahora cada petición autenticada consulta el usuario vigente; las identidades de bootstrap se validan por separado. Si la base no responde, el acceso se bloquea.
- Las operaciones de pedidos, cotización de delivery y control/envío de conversaciones no comprobaban el permiso `operate`. Ahora lo requieren. El acceso general a empresas también respeta `view` y el estado activo del usuario, y elimina el acceso implícito por ID cero con rol común.

Se mantiene la semántica anterior de permisos omitidos: la asignación existente permite la operación salvo prohibición explícita. La pertenencia a la empresa sigue siendo obligatoria. SUPERADMIN conserva su acceso, sujeto a los controles existentes de estado de la empresa.

Los archivos ejecutados son los de `src/`, según `npm start`. Las copias antiguas en la raíz del repositorio no se modificaron ni se usan como punto de entrada.

## Validación

- `npm run check`: aprobado.
- `npm test`: 20 pruebas aprobadas, incluidas 13 nuevas de acceso y las 7 existentes de fechas/conversaciones.
- Las pruebas usan JWT y bcrypt reales, peticiones HTTP locales y una base simulada. No sustituyen una prueba contra PostgreSQL y Railway reales.
- No se modificaron datos, esquema, motor, activadores de Google ni configuración de producción.

## Antes de publicar

Probar en un entorno de revisión: login normal y bootstrap, desactivación de usuario con sesión abierta, cambio de rol, usuario de consulta sin permiso de operar, empresa ajena y operación autorizada. Verificar que Railway ejecuta `npm start` y no un archivo antiguo de la raíz.

La autenticación añade una lectura de usuario por petición. El middleware repetido dentro de la misma petición reutiliza la verificación. Una petición que ya pasó el control puede finalizar si el usuario se desactiva durante su ejecución; las siguientes se bloquean.

Este bloque no completa la migración ni resuelve todavía la limitación de intentos de login, CSP, sucursales, logos, preferencias avanzadas, seguimiento comercial o históricos. Se verificó el acceso al motor: sus 26 archivos de src/, test/ y paquetes coinciden por hash con la V588 revisada. No se modifica el motor en este bloque.
