# Academia Coquín — Demo de Reservas (Fase 1)

## Cómo correrlo

1. Instala Node.js (si no lo tienes): https://nodejs.org
2. Abre esta carpeta en una terminal y corre:
   ```
   npm install
   ```
3. Copia `.env.example` a `.env` y pon la URL y la anon key de tu proyecto Supabase
   (las encuentras en *Project Settings → API* del dashboard):
   ```
   cp .env.example .env
   ```
4. Corre el proyecto:
   ```
   npm run dev
   ```
5. Abre la URL que te muestra la terminal (normalmente http://localhost:5173)

## Qué hace este demo

- Registro/login de usuarios (Supabase Auth)
- Muestra el plan activo del usuario y las clases restantes
- Lista las próximas clases con cupos disponibles calculados en vivo (poles de la sala menos reservas confirmadas)
- Botón "Reservar" que descuenta un cupo y una clase del plan
- Botón "Cancelar" que solo se habilita si faltan 48 horas o más para la clase — la regla real
  la aplica la base de datos (función `cancelar_reserva`), este botón deshabilitado es solo
  para que el usuario no intente algo que de todas formas la base de datos va a rechazar

## Antes del lunes

- Crea sesiones reales (fecha/hora de clases de la próxima semana) desde el SQL Editor de Supabase
- Asegúrate de tener al menos un usuario de prueba con un plan activo para mostrar el flujo completo
- Si el pago real (Wompi/ePayco) todavía no está integrado, puedes crear la `compra_plan` manualmente
  desde SQL para el demo, y explicarle a la academia que la integración de pago real es el siguiente paso
