import express from "express";
import { conn, execute, queryRows } from "../dbconnect";

export const router = express.Router();
const validQty = (q: unknown) => Number.isInteger(Number(q)) && Number(q) >= 1 && Number(q) <= 3;
type OrderRow = {
  order_id: number;
  customer_id: number;
  work_id: number | null;
  customer_name: string;
  phone_number: string;
  address: string | null;
  latitude: number;
  longitude: number;
  order_date: string;
  total_boxes: number;
  delivery_queue: number | null;
  status: string;
  total_sales: number;
  [key: string]: unknown;
};
type OrderCenter = { latitude: number; longitude: number; radiusKm: number };

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

async function listOrders(where = "", params: any[] = [], center?: OrderCenter) {
  const orders = await queryRows<OrderRow>(
    `SELECT o.order_id,o.customer_id,o.work_id,w.rider_id,w.route_color,r.first_name || ' ' || r.last_name AS rider_name,c.first_name || ' ' || c.last_name AS customer_name,c.phone_number,c.address,c.latitude,c.longitude,o.order_date,o.total_boxes,o.delivery_queue,o.status,COALESCE(SUM(od.quantity*f.price),0) AS total_sales FROM orders o JOIN customers c ON c.customer_id=o.customer_id LEFT JOIN works w ON w.work_id=o.work_id LEFT JOIN riders r ON r.rider_id=w.rider_id LEFT JOIN order_details od ON od.order_id=o.order_id LEFT JOIN foods f ON f.food_id=od.food_id ${where} GROUP BY o.order_id ORDER BY o.order_date DESC,o.order_id DESC`,
    params
  );
  if (!orders.length) return orders;
  const ids = orders.map(order => order.order_id);
  const marks = ids.map(() => "?").join(",");
  const items = await queryRows(`SELECT od.order_detail_id,od.order_id,od.food_id,f.name AS food_name,od.quantity,f.price AS unit_price FROM order_details od JOIN foods f ON f.food_id=od.food_id WHERE od.order_id IN (${marks}) ORDER BY od.order_detail_id`, ids);
  const byOrder = new Map<number, typeof items>();
  for (const item of items) byOrder.set(Number(item.order_id), [...(byOrder.get(Number(item.order_id)) ?? []), item]);

  const completeOrders = orders.map(order => ({ ...order, items: byOrder.get(order.order_id) ?? [] }));
  if (!center) return completeOrders;
  return completeOrders
    .map(order => ({ ...order, distance_km: Number(haversineKm(center.latitude, center.longitude, Number(order.latitude), Number(order.longitude)).toFixed(3)) }))
    .filter(order => order.distance_km <= center.radiusKm)
    .sort((a, b) => a.distance_km - b.distance_km);
}

function validCenter(latitude: number, longitude: number, radiusKm: number) {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 && Number.isFinite(radiusKm) && radiusKm > 0 && radiusKm <= 100;
}

router.get("/", async (_req, res) => {
  try { res.json(await listOrders()); }
  catch (e) { console.error(e); res.status(500).json({ error: "Database operation failed" }); }
});

router.get("/nearby", async (req, res) => {
  const latitude = Number(req.query.latitude);
  const longitude = Number(req.query.longitude);
  const radiusKm = Number(req.query.radiusKm ?? 2);
  if (!validCenter(latitude, longitude, radiusKm)) return res.status(400).json({ error: "Provide valid latitude, longitude and radiusKm (0-100)" });
  try { res.json(await listOrders("", [], { latitude, longitude, radiusKm })); }
  catch (e) { console.error(e); res.status(500).json({ error: "Database operation failed" }); }
});

router.get("/:id", async (req, res) => {
  try {
    const rows = await listOrders("WHERE o.order_id=?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Order not found" });
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: "Database operation failed" }); }
});

router.post("/", async (req, res) => {
  const { customer_id, food_id, quantity } = req.body ?? {};
  if (!Number.isInteger(Number(customer_id)) || !Number.isInteger(Number(food_id)) || !validQty(quantity)) return res.status(400).json({ error: "Required: integer customer_id, integer food_id, quantity from 1 to 3" });
  const tx = await conn.transaction("write");
  try {
    const customer = await tx.execute({ sql: "SELECT customer_id FROM customers WHERE customer_id=?", args: [customer_id] });
    const food = await tx.execute({ sql: "SELECT food_id FROM foods WHERE food_id=?", args: [food_id] });
    if (!customer.rows.length || !food.rows.length) { await tx.rollback(); return res.status(400).json({ error: "Customer or food not found" }); }
    const order = await tx.execute({ sql: "INSERT INTO orders (customer_id,order_date,total_boxes,status) VALUES (?,CURRENT_TIMESTAMP,?,'queued')", args: [customer_id, Number(quantity)] });
    const orderId = Number(order.lastInsertRowid);
    await tx.execute({ sql: "INSERT INTO order_details (order_id,food_id,quantity) VALUES (?,?,?)", args: [orderId, food_id, Number(quantity)] });
    await tx.commit();
    res.status(201).json({ order_id: orderId, message: "Order created" });
  } catch (e) { if (!tx.closed) await tx.rollback(); console.error(e); res.status(500).json({ error: "Database operation failed" }); }
  finally { tx.close(); }
});

router.post("/simulate", async (req, res) => {
  const count = Number(req.body?.count ?? 25);
  if (!Number.isInteger(count) || count < 20 || count > 30) return res.status(400).json({ error: "count must be an integer from 20 to 30" });
  const customers = await queryRows<{ customer_id: number }>("SELECT customer_id FROM customers ORDER BY customer_id");
  const foods = await queryRows<{ food_id: number }>("SELECT food_id FROM foods ORDER BY food_id");
  if (!customers.length || !foods.length) return res.status(400).json({ error: "Add at least one customer and one food before simulating" });
  const tx = await conn.transaction("write");
  try {
    const created: number[] = [];
    for (let i = 0; i < count; i++) {
      const customer = customers[Math.floor(Math.random() * customers.length)];
      const food = foods[Math.floor(Math.random() * foods.length)];
      if (!customer || !food) throw new Error("Customer or food list unexpectedly empty");
      const quantity = Math.floor(Math.random() * 3) + 1;
      const order = await tx.execute({ sql: "INSERT INTO orders (customer_id,order_date,total_boxes,status) VALUES (?,CURRENT_TIMESTAMP,?,'simulated')", args: [customer.customer_id, quantity] });
      const orderId = Number(order.lastInsertRowid);
      await tx.execute({ sql: "INSERT INTO order_details (order_id,food_id,quantity) VALUES (?,?,?)", args: [orderId, food.food_id, quantity] });
      created.push(orderId);
    }
    await tx.commit();
    res.status(201).json({ created_count: created.length, order_ids: created, message: "Simulated orders created" });
  } catch (e) { if (!tx.closed) await tx.rollback(); console.error(e); res.status(500).json({ error: "Could not simulate orders" }); }
  finally { tx.close(); }
});

router.put("/:id/quantity", async (req, res) => {
  const quantity = Number(req.body?.quantity);
  if (!validQty(quantity)) return res.status(400).json({ error: "quantity must be an integer from 1 to 3" });
  const tx = await conn.transaction("write");
  try {
    const result = await tx.execute({ sql: "SELECT order_detail_id,food_id FROM order_details WHERE order_id=?", args: [req.params.id] });
    const lines = result.rows as unknown as Array<{ order_detail_id: number; food_id: number }>;
    if (!lines.length) { await tx.rollback(); return res.status(404).json({ error: "Order or order detail not found" }); }
    if (req.body.food_id !== undefined && !Number.isInteger(Number(req.body.food_id))) { await tx.rollback(); return res.status(400).json({ error: "food_id must be an integer" }); }
    const chosen = req.body.food_id === undefined ? (lines.length === 1 ? lines[0] : null) : lines.find(line => Number(line.food_id) === Number(req.body.food_id));
    if (!chosen) { await tx.rollback(); return res.status(400).json({ error: "This order has multiple items; provide a matching food_id" }); }
    await tx.execute({ sql: "UPDATE order_details SET quantity=? WHERE order_detail_id=?", args: [quantity, chosen.order_detail_id] });
    await tx.execute({ sql: "UPDATE orders SET total_boxes=(SELECT COALESCE(SUM(quantity),0) FROM order_details WHERE order_id=?) WHERE order_id=?", args: [req.params.id, req.params.id] });
    await tx.commit();
    res.json({ order_id: Number(req.params.id), food_id: chosen.food_id, quantity, message: "Order quantity updated" });
  } catch (e) { if (!tx.closed) await tx.rollback(); console.error(e); res.status(500).json({ error: "Database operation failed" }); }
  finally { tx.close(); }
});

router.delete("/simulated", async (_req, res) => {
  const tx = await conn.transaction("write");
  try {
    const result = await tx.execute("SELECT order_id FROM orders WHERE status='simulated'");
    const ids = result.rows.map(row => Number(row.order_id));
    if (ids.length) {
      const marks = ids.map(() => "?").join(",");
      await tx.execute({ sql: `DELETE FROM order_details WHERE order_id IN (${marks})`, args: ids });
      await tx.execute({ sql: `DELETE FROM orders WHERE order_id IN (${marks})`, args: ids });
    }
    await tx.commit();
    res.json({ deleted_count: ids.length, message: "Simulated orders cleared" });
  } catch (e) { if (!tx.closed) await tx.rollback(); console.error(e); res.status(500).json({ error: "Could not clear simulated orders" }); }
  finally { tx.close(); }
});

router.delete("/:id", async (req, res) => {
  const tx = await conn.transaction("write");
  try {
    const existing = await tx.execute({ sql: "SELECT order_id FROM orders WHERE order_id=?", args: [req.params.id] });
    if (!existing.rows.length) { await tx.rollback(); return res.status(404).json({ error: "Order not found" }); }
    await tx.execute({ sql: "DELETE FROM order_details WHERE order_id=?", args: [req.params.id] });
    await tx.execute({ sql: "DELETE FROM orders WHERE order_id=?", args: [req.params.id] });
    await tx.commit();
    res.json({ message: "Order deleted" });
  } catch (e) { if (!tx.closed) await tx.rollback(); console.error(e); res.status(500).json({ error: "Database operation failed" }); }
  finally { tx.close(); }
});
