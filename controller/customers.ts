import express from "express";
import { execute, queryRows } from "../dbconnect";
import { Customer } from "../model/customer";

export const router = express.Router();
const fields = "customer_id, first_name, last_name, address, phone_number, latitude, longitude";
const validCoordinates = (lat: unknown, lon: unknown) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && Number(lat) >= -90 && Number(lat) <= 90 && Number(lon) >= -180 && Number(lon) <= 180;
const validCustomer = (v: any) => v && typeof v.first_name === "string" && v.first_name.trim() && typeof v.last_name === "string" && v.last_name.trim() && typeof v.phone_number === "string" && v.phone_number.trim() && validCoordinates(v.latitude, v.longitude);
const customerValues = (v: any) => [v.first_name.trim(), v.last_name.trim(), v.address ?? null, v.phone_number.trim(), Number(v.latitude), Number(v.longitude)];

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

const handleError = (res: express.Response, error: any) => {
  const message = String(error?.message ?? "");
  if (error?.extendedCode?.includes("UNIQUE") || message.includes("UNIQUE constraint failed")) return res.status(409).json({ error: "Phone number already exists" });
  if (error?.extendedCode?.includes("FOREIGNKEY") || message.includes("FOREIGN KEY constraint failed")) return res.status(409).json({ error: "Customer has orders and cannot be deleted" });
  console.error(error);
  return res.status(500).json({ error: "Database operation failed" });
};

router.get("/", async (_req, res) => {
  try {
    res.json(await queryRows<Customer>(`SELECT ${fields} FROM customers ORDER BY customer_id`));
  } catch (e) { handleError(res, e); }
});

router.get("/search", async (req, res) => {
  const first = String(req.query.first_name ?? "").trim();
  const last = String(req.query.last_name ?? "").trim();
  if (!first && !last) return res.status(400).json({ error: "Provide first_name and/or last_name" });
  try {
    const rows = await queryRows<Customer>(
      `SELECT ${fields} FROM customers WHERE (? = '' OR first_name LIKE ?) AND (? = '' OR last_name LIKE ?) ORDER BY customer_id`,
      [first, `%${first}%`, last, `%${last}%`]
    );
    res.json(rows);
  } catch (e) { handleError(res, e); }
});

router.get("/nearby", async (req, res) => {
  const latitude = Number(req.query.latitude);
  const longitude = Number(req.query.longitude);
  const radiusKm = Number(req.query.radiusKm ?? 1);
  if (!validCoordinates(latitude, longitude) || !Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 100) return res.status(400).json({ error: "Provide valid latitude, longitude and radiusKm (0-100)" });
  try {
    const customers = await queryRows<Customer>(`SELECT ${fields} FROM customers`);
    const nearby = customers
      .map(customer => ({ ...customer, distance_km: Number(haversineKm(latitude, longitude, Number(customer.latitude), Number(customer.longitude)).toFixed(3)) }))
      .filter(customer => customer.distance_km <= radiusKm)
      .sort((a, b) => a.distance_km - b.distance_km);
    res.json(nearby);
  } catch (e) { handleError(res, e); }
});

router.get("/:id", async (req, res) => {
  try {
    const rows = await queryRows<Customer>(`SELECT ${fields} FROM customers WHERE customer_id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Customer not found" });
    res.json(rows[0]);
  } catch (e) { handleError(res, e); }
});

router.post("/", async (req, res) => {
  if (!validCustomer(req.body)) return res.status(400).json({ error: "Required: first_name, last_name, phone_number, valid latitude and longitude; address is optional" });
  try {
    const result = await execute("INSERT INTO customers (first_name,last_name,address,phone_number,latitude,longitude) VALUES (?,?,?,?,?,?)", customerValues(req.body));
    res.status(201).json({ customer_id: Number(result.lastInsertRowid), message: "Customer created" });
  } catch (e) { handleError(res, e); }
});

router.put("/:id", async (req, res) => {
  if (!validCustomer(req.body)) return res.status(400).json({ error: "Required: first_name, last_name, phone_number, valid latitude and longitude; address is optional" });
  try {
    const existing = await queryRows("SELECT customer_id FROM customers WHERE customer_id=?", [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: "Customer not found" });
    await execute("UPDATE customers SET first_name=?,last_name=?,address=?,phone_number=?,latitude=?,longitude=? WHERE customer_id=?", [...customerValues(req.body), req.params.id]);
    res.json({ customer_id: Number(req.params.id), message: "Customer updated" });
  } catch (e) { handleError(res, e); }
});

router.delete("/:id", async (req, res) => {
  try {
    const existingOrders = await queryRows("SELECT order_id FROM orders WHERE customer_id=? LIMIT 1", [req.params.id]);
    if (existingOrders.length) return res.status(409).json({ error: "Customer has orders and cannot be deleted" });
    const result = await execute("DELETE FROM customers WHERE customer_id=?", [req.params.id]);
    if (!result.rowsAffected) return res.status(404).json({ error: "Customer not found" });
    res.json({ message: "Customer deleted" });
  } catch (e) { handleError(res, e); }
});
