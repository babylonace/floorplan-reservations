# floorplan-reservations

Reservas de mesa para restaurantes: el local dibuja su propio plano y el motor de reservas trabaja a partir de ese plano.

[Read in English](README.md)

> **Estado: muy al principio.** Esto es la fase 0: el esqueleto del proyecto, el primer esquema de base de datos, un motor pequeño y la CI. Todavía no se puede reservar. Mira la [hoja de ruta](#hoja-de-ruta).

## Por qué

Muchas herramientas de reservas de código abierto tratan las mesas como una lista: "mesa 4, 4 personas". Pero un comedor no es una lista. Dos mesas pequeñas que están juntas se pueden unir para un grupo de cuatro, y al hacerlo se pierde algún asiento. La mesa de la puerta quizá solo sirve para quien llega sin reserva.

Así que la idea es:

- **El plano manda.** Cada local coloca sus mesas (posición, tamaño, forma, giro, zona, aspecto) y el motor lee esos mismos datos. Si en el plano dos mesas se tocan, el motor puede juntarlas.
- **Cero reservas dobles, y lo garantiza la base de datos.** No un "if" en el código que dos peticiones a la vez pueden saltarse, sino una restricción de PostgreSQL, con tests que lanzan reservas a la vez contra ella. (Llega en la fase 1.)
- **Varios idiomas desde el principio.** Quien reserva lo hace en su idioma y recibe los mensajes en ese idioma. El panel del local está en español por defecto, con inglés disponible.
- **Lo instalas tú.** Un `docker compose up` y funciona. Sin comisiones por cubierto.

Fuera de alcance: comandas, pantallas de cocina, TPV.

## Qué hay hoy

- `packages/engine`: las reglas de reserva, sin base de datos ni red, así que se prueban rápido.
  - `validateZone` revisa el plano: mesas que se pisan, que se salen de la sala o con un número de asientos imposible. Tiene en cuenta el giro.
  - `durationFor` dice cuánto tiempo ocupa la mesa un grupo, según su tamaño.
- `apps/api`: una API con [Fastify](https://fastify.dev/) en TypeScript.
  - `GET /venues/:slug/floor-plan` devuelve las zonas y las mesas, más los problemas que el motor encuentra en el plano.
  - `GET /health` comprueba que la API llega a la base de datos.
  - `GET /openapi.json` describe la API (OpenAPI 3.1).
- `db/migrations`: el esquema, en archivos SQL normales. Un pequeño programa los aplica en orden, cada uno en su transacción y con un bloqueo para que dos copias de la app no migren a la vez.
- `db/seed/sample.sql`: un local inventado para probar.

## Cómo arrancarlo

### Con Docker

Necesitas Docker con Compose.

```bash
docker compose up --build
```

Después carga el local de ejemplo y pide su plano:

```bash
docker compose exec api node apps/api/dist/seed-cli.js
curl http://127.0.0.1:3000/venues/sample-bistro/floor-plan
```

### Con Node y tu propio PostgreSQL

Necesitas Node 24 o más reciente y PostgreSQL. La CI prueba con PostgreSQL 18; versiones anteriores quizá funcionen, pero no están probadas.

```bash
cp .env.example .env    # y cambia las dos URL de la base de datos
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

## Tests y comprobaciones

```bash
npm run check
```

Pasa Prettier, ESLint, el compilador de TypeScript y los tests. Los tests de la API necesitan un PostgreSQL de verdad: pon `TEST_DATABASE_URL` en `.env`. **Los tests borran esa base de datos**, así que se niegan a arrancar si su nombre no acaba en `_test`. Con Docker Compose, la base `floorplan_test` se crea la primera vez que se crea el volumen de datos. Si tu volumen es anterior, créala con `docker compose exec db createdb -U floorplan -O floorplan floorplan_test`.

La CI pasa las mismas comprobaciones en cada pull request contra PostgreSQL 18, y además construye la imagen de Docker, la arranca con Compose y llama a la API.

## Cómo se guarda el plano

- Las medidas van en centímetros.
- `x` e `y` de una mesa son la posición de su **centro** dentro de la zona, contando desde la esquina de arriba a la izquierda. El giro va en grados, en el sentido de las agujas del reloj.
- `style` es JSON libre para el editor del plano (colores y similares). El motor de reservas nunca lo lee.
- Una reserva puede ocupar varias mesas (`reservation_tables`), para grupos en mesas juntas.

## Hoja de ruta

1. **Motor de reservas sin reservas dobles.** Una restricción de exclusión de PostgreSQL sobre mesa y franja horaria, con tests de concurrencia.
2. **Editor del plano.** Dibujar zonas y mesas; las mesas que se tocan se pueden juntar.
3. **Página pública de reserva.** Varios idiomas (también de derecha a izquierda), propone horas cercanas cuando la pedida está llena, pensada para cumplir el RGPD.
4. **Panel del local.** El servicio del día, confirmar, cancelar, sentar, avisos por email.
5. **Guía de despliegue.** Copias de seguridad y uso en un local de verdad.

## Tecnología

Node 24, TypeScript, Fastify, PostgreSQL 18, Vitest, ESLint, Prettier, Docker Compose, GitHub Actions.

## Licencia

[MIT](LICENSE)

Hecho por [babylonace](https://github.com/babylonace). AI-assisted.
