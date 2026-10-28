# Lunch Delivery API

TypeScript + Express API using Turso Cloud via the official JavaScript clients. The connection selects `@libsql/client` for `libsql://` URLs and `@tursodatabase/serverless` for `turso://` URLs. SQL uses SQLite/Turso syntax. Routes cover the customer and order parts of HW-5.

## Frontend

The Angular app for เก้าแว่น is in [`frontend`](./frontend/README.md). Start the API with `npm run dev`, then run `npm install` and `npm start` from `frontend`. The frontend uses `http://localhost:3000` by default; see its README for setup details.

## Connect to the Turso database

This project expects a Turso Cloud database that has already been created.

1. Get the database URL and create an auth token. With the Turso CLI:

   ```cmd
   turso db show --url YOUR_DATABASE_NAME
   turso db tokens create YOUR_DATABASE_NAME
   ```

   The URL and token are also available from the database's connection details in the Turso dashboard.
2. Open the local `.env` file and set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to the URL and token for the same database. `.env.example` shows the required names. Keep `.env` private; it is excluded from source control.
3. Use Node.js 20.6 or later and run:

   ```cmd
   npm install
   npm run db:init
   npm run dev
   ```

`npm run db:init` creates the ER tables and seeds ten example customers and five food items at 65 baht each. It is safe to run again; it does not delete orders. It does not copy records from the old Aiven/MySQL database. The old database remains unchanged. Create 20–30 example orders with `POST /orders/simulate` after starting the API.

## Deploy the API to Render

1. Create a GitHub repository for this project and upload the contents of the `lunch-delivery-api` folder. Do not upload `node_modules` or `.env`.
2. In Render, choose **New → Web Service** and connect the GitHub repository.
3. Set **Build Command** to `npm ci && npm run build` and **Start Command** to `npm start`.
4. In the service's **Environment** settings, add:
   - `TURSO_DATABASE_URL`: the URL from Turso
   - `TURSO_AUTH_TOKEN`: the token from Turso
   - `NODE_VERSION`: `24`
5. Deploy. Render sets `PORT`; this server binds to `0.0.0.0` and checks the Turso connection before it starts listening.
6. Check `https://YOUR-SERVICE.onrender.com/` for `{ "status": "ok" }`, then test routes such as `/customers` and `/foods` using Talend API Tester.

The database needs to be initialized once with `npm run db:init` from a machine whose `.env` contains the Turso credentials. Render's free web services may sleep after inactivity; the first request after a sleep can take longer.

## API routes

Base URL locally: `http://localhost:3000`. In production, replace it with the Render URL. There is no `/api` prefix.

All successful responses use JSON. Nearby search uses straight-line Haversine distance in kilometers.

### Customers

| Method | Path | Description |
| --- | --- | --- |
| GET | `/customers` | List all customers |
| GET | `/customers/:id` | Get one customer |
| GET | `/customers/search?first_name=...&last_name=...` | Partial name search; either parameter can be omitted |
| GET | `/customers/nearby?latitude=16.2458&longitude=103.2508&radiusKm=1` | Customers within 1 km by default |
| POST | `/customers` | Add a customer |
| PUT | `/customers/:id` | Replace customer fields |
| DELETE | `/customers/:id` | Delete a customer with no existing orders |

Customer JSON body:

```json
{
  "first_name": "Narin",
  "last_name": "Sukjai",
  "address": "ใกล้มหาวิทยาลัยมหาสารคาม",
  "phone_number": "0812345678",
  "latitude": 16.2458,
  "longitude": 103.2508
}
```

### Orders

| Method | Path | Description |
| --- | --- | --- |
| GET | `/orders` | List orders and food lines |
| GET | `/orders/:id` | Get one order and its food lines |
| GET | `/orders/nearby?latitude=16.2458&longitude=103.2508&radiusKm=2` | Orders within 2 km of the customer coordinates by default |
| POST | `/orders` | Create one order |
| POST | `/orders/simulate` | Create 20–30 simulated orders (default 25) |
| PUT | `/orders/:id/quantity` | Change an order line quantity |
| DELETE | `/orders/:id` | Delete one order |
| DELETE | `/orders/simulated` | Delete simulated orders |

### Worksheets

| Method | Path | Description |
| --- | --- | --- |
| GET | `/works` | List saved worksheets, rider details, orders, food items, and each order status |
| GET | `/works/:id` | Get one worksheet by its database-generated `work_id` |
| POST | `/works/generate` | Create worksheet records and attach unassigned orders to an auto-generated `work_id` |

### Food lookup

| Method | Path | Description |
| --- | --- | --- |
| GET | `/foods` | List food IDs and prices |

Create order body:

```json
{ "customer_id": 1, "food_id": 1, "quantity": 2 }
```

Simulation body (optional; defaults to 25):

```json
{ "count": 25 }
```

Change quantity body:

```json
{ "quantity": 3 }
```

Quantities are limited to one to three boxes per food line. Simulated orders use the existing `status` field with value `simulated`; clearing them preserves other orders. Opening `/sheets` automatically groups unassigned queued/simulated orders and creates one `works` row per delivery group. SQLite/Turso generates each `work_id`, and the selected orders are updated with that ID. The API creates clearly marked placeholder rider records only when there are not enough riders in the database.

For POST/PUT requests, set `Content-Type: application/json`. Validation errors return status 400; missing records return 404; duplicate phone numbers return 409.
