# floorplan-reservations

Reservas de mesa para restaurantes: el local dibuja su propio plano y el motor de reservas trabaja a partir de ese plano.

[Read in English](README.md)

> **Estado: muy al principio.** La API ya acepta reservas, la base de datos rechaza las reservas dobles y el local puede editar su plano a través de la API. Todavía no hay inicio de sesión, pantalla para dibujar, página de reserva ni panel del local. Mira la [hoja de ruta](#hoja-de-ruta).

## Por qué

Muchas herramientas de reservas de código abierto tratan las mesas como una lista: "mesa 4, 4 personas". Pero un comedor no es una lista. Dos mesas pequeñas que están juntas se pueden unir para un grupo de cuatro, y al hacerlo se pierde algún asiento. La mesa de la puerta quizá solo sirve para quien llega sin reserva.

Así que la idea es:

- **El plano manda.** Cada local coloca sus mesas (posición, tamaño, forma, giro, zona, aspecto) y el motor lee esos mismos datos. Si en el plano dos mesas se tocan, el motor puede juntarlas.
- **Cero reservas dobles, y lo garantiza la base de datos.** No un "if" en el código que dos peticiones a la vez pueden saltarse, sino una restricción de PostgreSQL, con tests que lanzan reservas a la vez contra ella.
- **Varios idiomas desde el principio.** Quien reserva lo hace en su idioma y recibe los mensajes en ese idioma. El panel del local está en español por defecto, con inglés disponible.
- **Lo instalas tú.** Un `docker compose up` y funciona. Sin comisiones por cubierto.

Fuera de alcance: comandas, pantallas de cocina, TPV.

## Qué hay hoy

- `packages/engine`: las reglas de reserva, sin base de datos ni red, así que se prueban rápido.
  - `validateZone` revisa el plano: mesas que se pisan, que se salen de la sala o con un número de asientos imposible. Tiene en cuenta el giro.
  - `durationFor` dice cuánto tiempo ocupa la mesa un grupo, según su tamaño.
  - `seatingOptions` dice dónde podría sentarse un grupo, de mejor a peor: la mesa más pequeña en la que cabe y, si no hay, mesas vecinas juntas.
  - `canStillSeat` dice si las mesas que ya tiene un grupo le siguen dando sitio después de cambiar el plano.
- `apps/api`: una API con [Fastify](https://fastify.dev/) en TypeScript.
  - `GET /venues/:slug/floor-plan` devuelve las zonas y las mesas, más los problemas que el motor encuentra en el plano.
  - `POST /venues/:slug/reservations` reserva mesa. El motor elige la mesa (o mesas) y cuánto tiempo se guarda depende del tamaño del grupo. Responde `409` si no queda nada libre.
  - Edición del plano: `POST /venues/:slug/zones`, `PATCH` y `DELETE /venues/:slug/zones/:zoneId`, `POST /venues/:slug/zones/:zoneId/tables`, `PATCH` y `DELETE /venues/:slug/tables/:tableId`. Mira [editar el plano](#editar-el-plano).
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

## Editar el plano

Las zonas y las mesas se pueden crear, cambiar y quitar con la API: posición, tamaño, forma, giro, estilo, zona y si la mesa se puede reservar por internet.

- Cada cambio se comprueba con `validateZone` contra lo que hay guardado. Si una mesa fuera a pisar otra, salirse de su zona o tener asientos imposibles, se rechaza con `422` y la lista de problemas. Los problemas que el plano ya tenía no bloquean cambios que no tienen que ver.
- Ningún cambio deja sin sitio a una reserva futura. Quitarle asientos que necesita, separar las mesas que tiene juntas, hacer redonda una de ellas o llevar una a otra zona se rechaza con `409`. Una mesa reservada sola sí se puede mover, incluso a otra zona: el grupo la conserva.
- Marcar una mesa como no reservable nunca rompe una reserva: las ya hechas la conservan y las nuevas van a otra mesa.
- Un local puede tener hasta 50 zonas y una zona hasta 200 mesas.
- Una mesa con una reserva futura no se puede quitar. Una mesa que solo tuvo reservas pasadas se **retira** en vez de borrarse: sale del plano y del motor, y las reservas antiguas siguen apuntando a ella. Su nombre queda libre. Quitar una zona funciona igual con todas sus mesas.
- Los cambios en la misma zona esperan su turno (bloquean la zona y luego las mesas). Una reserva que tuvo que esperar a que se editaran sus mesas vuelve a leer el plano antes de guardarse, así que no puede caer en una mesa que acaba de perder asientos o de dejar de ser reservable.

> **Todavía sin inicio de sesión.** Cualquiera que llegue a la API puede usar estas rutas. No la pongas en internet hasta que esté el inicio de sesión del personal.

## Cómo se evitan las reservas dobles

- Cada reserva guarda su hora como un rango, `[inicio, fin)`. Una reserva que acaba a las 21:30 y otra que empieza a las 21:30 no se pisan.
- `reservation_tables` guarda una copia de ese rango y de si la reserva sigue ocupando sus mesas (las canceladas y las de quien no vino, no). La copia forma parte de la clave foránea hacia la reserva con `on update cascade`, así que mover o cancelar una reserva la actualiza en la misma orden.
- Una restricción de exclusión (`btree_gist`) rechaza dos filas de la misma mesa con rangos que se pisan. Se cumple escriba quien escriba en la base de datos.
- La API mira las mesas libres, reserva la mejor opción y, si otra petición llegó antes, vuelve a un punto guardado y lo intenta otra vez. Las peticiones que quieren la misma mesa esperan su turno, así no se bloquean entre ellas.
- Los tests frenan las escrituras hasta que todas las peticiones de una ráfaga han mirado las mesas libres y luego las sueltan a la vez: 25 peticiones por una sola mesa dan exactamente una reserva.

Mesas juntas: solo mesas rectangulares de la misma zona, una al lado de otra (5 cm de hueco como mucho) y sin girar en ángulo. Tres como máximo, y todas tienen que hacer falta.

Todavía sin comprobar: el horario de apertura. Por ahora todos los locales usan las duraciones de ejemplo de `durationFor`.

## Hoja de ruta

1. ~~**Motor de reservas sin reservas dobles.**~~ Hecho.
2. **Editor del plano.** ~~API para editar zonas y mesas, comprobada por el motor.~~ Hecho. La pantalla para dibujarlas llega con el panel del local.
3. **Página pública de reserva.** Varios idiomas (también de derecha a izquierda), propone horas cercanas cuando la pedida está llena, pensada para cumplir el RGPD.
4. **Panel del local.** El servicio del día, confirmar, cancelar, sentar, avisos por email.
5. **Guía de despliegue.** Copias de seguridad y uso en un local de verdad.

## Tecnología

Node 24, TypeScript, Fastify, PostgreSQL 18, Vitest, ESLint, Prettier, Docker Compose, GitHub Actions.

## Licencia

[MIT](LICENSE)

Hecho por [babylonace](https://github.com/babylonace). AI-assisted.
