# One Salud: WhatsApp y operación institucional

Referencia funcional: propuesta aportada por el usuario del Hospital Teodoro J. Schestakow V2. Se usa como referencia de requisitos, sin copiar su implementación ni presentar afiliación con el hospital.

## Canales

El paciente solicita, consulta y cancela turnos por WhatsApp. Recepción y profesionales gestionan su trabajo en el panel autenticado. El motor ya deriva las empresas con módulo Salud al servicio de agenda del panel. Actualmente el flujo sigue siendo una demostración con datos ficticios y selección numerada.

## Primera entrega: circuito de atención

Reservado → En sala → En consulta → Atendido. Desde Reservado se permite marcar ausencia o cancelar; desde En sala se permite cancelar. Los estados finales no se reabren desde el selector. Una repetición del mismo estado no genera eventos duplicados. Los turnos ya existentes conservan sus datos; los tiempos históricos desconocidos quedan vacíos.

Cada cambio registra fecha, estado anterior, estado nuevo y usuario. El estado, el horario y el evento se guardan en una transacción. La cancelación por chat verifica el contacto y no cancela consultas iniciadas o terminadas. El historial operativo en PostgreSQL no constituye una historia clínica inmutable ni una certificación legal.

Validación: node --test test/health_workflow.test.js. Usa PostgreSQL embebido PGlite; no verifica el envío real de WhatsApp ni concurrencia distribuida de producción.

## Siguientes entregas

1. Interpretación por IA con especialidades, profesionales, fechas relativas e historial de conversación; la agenda valida disponibilidad y confirma la reserva de forma transaccional. Una indisponibilidad de IA no modifica el turno.
2. Reprogramación sin perder el turno original si el nuevo cupo deja de estar disponible; confirmación explícita y atención humana.
3. Sala de espera y métricas calculadas sobre los horarios registrados; no estimar datos históricos inexistentes.
4. Roles separados de recepción, profesional y dirección, con permisos por institución y profesional. El control actual por empresa no sustituye estos roles.
5. Recordatorios y contingencias con registro de entrega, recuperación y prevención de duplicados.
6. Historia clínica como alcance independiente: acceso autorizado, registro de autoría, enmiendas y revisión institucional antes de usar datos reales. No enviar evoluciones ni diagnósticos al chat de turnos.

## Orden del dashboard propuesto

Navegación global: Inicio, Empresas, Conversaciones y Configuración.
Para Salud: Agenda, Recepción, Profesionales e Indicadores. Consultorio e Historia clínica aparecerán cuando sus permisos y funciones estén implementados. Las pantallas de productos, carrito y delivery corresponden a Gastro, no a Salud.

El diseño visual final queda pendiente de las referencias que enviará el usuario. La demo no debe presentarse como sistema hospitalario completo ni como habilitado para pacientes reales.
