import http from "http";
import { app } from "./app";
import { conn } from "./dbconnect";

const port = Number(process.env.PORT || 3000);
async function start() {
  await conn.execute("SELECT 1");
  http.createServer(app).listen(port, "0.0.0.0", () => {
    console.log(`Lunch Delivery API is listening on port ${port}`);
  });
}

void start().catch(error => {
  console.error("Could not connect to Turso. Check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.", error);
  process.exitCode = 1;
});
