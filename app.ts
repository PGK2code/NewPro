import express from "express";
import cors from "cors";
import { router as customers } from "./controller/customers";
import { router as orders } from "./controller/orders";
import { router as foods } from "./controller/foods";
import { router as works } from "./controller/works";

export const app = express();

app.use(cors());
app.use(express.json());
app.get("/", (_req, res) => {
  res.json({ name: "Lunch Delivery API", status: "ok", endpoints: ["/customers", "/orders", "/foods", "/works"] });
});
app.use("/customers", customers);
app.use("/orders", orders);
app.use("/foods", foods);
app.use("/works", works);
app.use((_req, res) => res.status(404).json({ error: "Endpoint not found" }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});
