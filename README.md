# Academia Coquín — Demo de Reservas (Fase 1)
## Qué hace este demo

- Registro/login de usuarios (Supabase Auth)
- Muestra el plan activo del usuario y las clases restantes
- Lista las próximas clases con cupos disponibles calculados en vivo (poles de la sala menos reservas confirmadas)
- Botón "Reservar" que descuenta un cupo y una clase del plan
- Botón "Cancelar" que solo se habilita si faltan 48 horas o más para la clase — la regla real
  la aplica la base de datos (función `cancelar_reserva`), este botón deshabilitado es solo
  para que el usuario no intente algo que de todas formas la base de datos va a rechazar.
