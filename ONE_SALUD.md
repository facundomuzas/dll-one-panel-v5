# One Salud: turnos por WhatsApp y agenda local

## Alcance actual

El paciente escribe una solicitud de turno en lenguaje natural. El panel pide al motor una interpretación con la IA configurada (Gemini por defecto), usando únicamente profesionales y contexto de esa institución. La aplicación consulta disponibilidad, solicita nombre y apellido y DNI faltantes, presenta un resumen y reserva solo ante un mensaje posterior de aceptación. Los cambios en el resumen requieren nueva confirmación.

Cada reserva se guarda en PostgreSQL. Repetir el mismo identificador de mensaje devuelve el resultado anterior; la validación transaccional del cupo impide dos reservas en el mismo lugar. Esto no implica entrega exactamente una vez de mensajes de Meta. Una caída de IA conserva el borrador y no reserva ni cancela.

El comprobante de WhatsApp es un texto completo más una imagen QR: institución, código, paciente, DNI, profesional, especialidad, fecha, hora o franja por llegada, dirección y consultorio configurados. El QR contiene un token aleatorio, sin DNI. La consulta autenticada `GET /api/company/:companyId/health/verify?code=...` solo busca en la institución autorizada. No hay una ficha pública de paciente. El chat permite consultar y recuperar el comprobante, y cancelar con confirmación. Reprogramación atómica queda pendiente; no se ofrece como función implementada.

El panel permite imprimir la agenda por fecha, profesional, especialidad y servicio (filtros de texto por coincidencia exacta, sin distinguir mayúsculas). Incluye paciente, DNI, horario, especialidad, servicio y profesional. Se retiró el selector de circuito clínico; no requiere que el médico use el panel. Se conservan las columnas y eventos históricos para no eliminar datos.

## Puesta en marcha

1. Desplegar primero el motor compatible con `/admin/health/interpret`, luego el panel.
2. Mantener GEMINI_API_KEY y GEMINI_MODEL en el motor, y las claves existentes del puente entre motor y panel. No enviar claves por chat ni almacenarlas en GitHub.
3. Elegir la empresa Salud y cargar profesionales, especialidad, servicio, dirección, consultorio y disponibilidad. Si se usa la empresa de demostración, sigue conteniendo profesionales ficticios: sustituir/configurar la institución antes de atender pacientes.
4. Probar texto → oferta → datos → resumen → aceptación → comprobante/QR → planilla. Después probar consulta, recuperación de QR y cancelación.

La agenda es LOCAL DLL One. No consulta ni sincroniza HSI. Cuando informática entregue la documentación y un entorno autorizado, habrá que integrar HSI como fuente de disponibilidad y confirmación, evitando una doble agenda independiente.

## ElevenLabs, adicional por empresa

Control de empresas ofrece un interruptor y un ID de voz, guardados exclusivamente por SUPERADMIN. La ruta y el servicio comprueban el rol, usan revisión para evitar sobrescrituras y registran los cambios. Desactivado por defecto; la empresa común y el usuario de WhatsApp no pueden habilitarlo.

En el motor configurar ELEVENLABS_API_KEY. Opcionalmente ELEVENLABS_STT_MODEL (predeterminado scribe_v2) y ELEVENLABS_TTS_MODEL (eleven_multilingual_v2). El ID de voz se configura por empresa en el panel. La cuenta y su facturación se gestionan en ElevenLabs: activar el interruptor no contrata ni cobra un plan a la empresa.

Los audios entrantes se transcriben y se procesan por el mismo flujo que el texto. Se aceptan archivos de audio de hasta 5 MB. Se contesta por audio al recibir audio, salvo preferencia explícita de texto; se puede pedir «respondeme por audio» o «respondeme por escrito». La preferencia se guarda por empresa y contacto. Los comprobantes de turnos siempre se envían también escritos. Se usa MP3 como mensaje de audio, sin prometer presentación de nota de voz PTT. Ante fallo de síntesis se responde con texto; ante fallo de transcripción se solicita texto sin modificar reservas/pedidos.

Los envíos administrativos automáticos, imágenes de menú y avisos externos al diálogo siguen en su formato actual. Los audios y el texto sintetizado se envían al proveedor ElevenLabs; este cambio no promete retención cero. La integración no incluye clonación de voces ni historia clínica.

## Validación y límites

Pruebas con PGlite para reservas, aislamiento, correcciones, consentimiento, duplicados, cancelación, filtros, migración y permisos de voz. Pruebas simuladas de ElevenLabs y de UI con jsdom. No sustituyen una prueba con Gemini, ElevenLabs y WhatsApp reales. No se configuraron claves ni se activó voz en ninguna empresa durante el desarrollo.

Fuentes técnicas: https://elevenlabs.io/docs/api-reference/speech-to-text/convert y https://elevenlabs.io/docs/api-reference/text-to-speech/convert. Modelo del PDF hospitalario usado como referencia funcional, no como obligación de implementar circuitos clínicos.
