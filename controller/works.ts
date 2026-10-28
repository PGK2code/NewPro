import express from "express";
import { conn, queryRows } from "../dbconnect";

export const router = express.Router();

type WorkInput = { order_ids: number[]; route_color: string };

type WorkRow = {
  work_id: number;
  rider_id: number;
  rider_name: string | null;
  route_color: string;
  total_distance: number;
  total_boxes: number;
  profit: number;
  total_sales: number;
  created_at: string;
  delivery_cost: number;
};

type WorkOrderRow = {
  order_id: number;
  customer_id: number;
  work_id: number;
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
};

type WorkOrderItemRow = {
  order_detail_id: number;
  order_id: number;
  food_id: number;
  food_name: string;
  quantity: number;
  unit_price: number;
};

/** Return persisted worksheets, including each order's current status and items. */
async function listWorks(workId?: number) {
  const where = workId === undefined ? "" : "WHERE w.work_id = ?";
  const args = workId === undefined ? [] : [workId];
  const works = await queryRows<WorkRow>(
    `SELECT w.work_id,w.rider_id,r.first_name || ' ' || r.last_name AS rider_name,w.route_color,w.total_distance,w.total_boxes,w.profit,w.total_sales,w.created_at,w.delivery_cost FROM works w LEFT JOIN riders r ON r.rider_id=w.rider_id ${where} ORDER BY w.created_at DESC,w.work_id DESC`,
    args,
  );
  if (!works.length) return [];

  const workIds = works.map((work) => Number(work.work_id));
  const workMarks = workIds.map(() => "?").join(",");
  const orders = await queryRows<WorkOrderRow>(
    `SELECT o.order_id,o.customer_id,o.work_id,c.first_name || ' ' || c.last_name AS customer_name,c.phone_number,c.address,c.latitude,c.longitude,o.order_date,o.total_boxes,o.delivery_queue,o.status,COALESCE((SELECT SUM(od.quantity*f.price) FROM order_details od JOIN foods f ON f.food_id=od.food_id WHERE od.order_id=o.order_id),0) AS total_sales FROM orders o JOIN customers c ON c.customer_id=o.customer_id WHERE o.work_id IN (${workMarks}) ORDER BY o.work_id,o.delivery_queue,o.order_id`,
    workIds,
  );
  const orderIds = orders.map((order) => Number(order.order_id));
  const items = orderIds.length
    ? await queryRows<WorkOrderItemRow>(
        `SELECT od.order_detail_id,od.order_id,od.food_id,f.name AS food_name,od.quantity,f.price AS unit_price FROM order_details od JOIN foods f ON f.food_id=od.food_id WHERE od.order_id IN (${orderIds.map(() => "?").join(",")}) ORDER BY od.order_detail_id`,
        orderIds,
      )
    : [];

  const itemsByOrder = new Map<number, WorkOrderItemRow[]>();
  for (const item of items) {
    const key = Number(item.order_id);
    itemsByOrder.set(key, [...(itemsByOrder.get(key) ?? []), item]);
  }
  const ordersByWork = new Map<number, Array<WorkOrderRow & { items: WorkOrderItemRow[] }>>();
  for (const order of orders) {
    const key = Number(order.work_id);
    ordersByWork.set(key, [
      ...(ordersByWork.get(key) ?? []),
      { ...order, items: itemsByOrder.get(Number(order.order_id)) ?? [] },
    ]);
  }

  return works.map((work) => ({
    ...work,
    orders: ordersByWork.get(Number(work.work_id)) ?? [],
  }));
}

router.get("/", async (_req, res) => {
  try {
    res.json(await listWorks());
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load worksheets" });
  }
});

/** Mark one order as successfully delivered from its worksheet. */
router.post("/:id/orders/:orderId/shipped", async (req, res) => {
  const workId = Number(req.params.id);
  const orderId = Number(req.params.orderId);
  if (!Number.isSafeInteger(workId) || workId < 1 || !Number.isSafeInteger(orderId) || orderId < 1) {
    return res.status(400).json({ error: "work_id and order_id must be positive integers" });
  }

  const tx = await conn.transaction("write");
  try {
    const result = await tx.execute({
      sql: "UPDATE orders SET status='shipped' WHERE work_id=? AND order_id=? AND status IN ('queued','simulated')",
      args: [workId, orderId],
    });
    if (Number(result.rowsAffected ?? 0) !== 1) {
      const existing = await tx.execute({
        sql: "SELECT status FROM orders WHERE work_id=? AND order_id=?",
        args: [workId, orderId],
      });
      await tx.rollback();
      if (!existing.rows.length) return res.status(404).json({ error: "Order not found in this worksheet" });
      return res.status(409).json({ error: "Order is already completed or is not active" });
    }
    await tx.commit();
    return res.json({ work_id: workId, order_id: orderId, status: "shipped", message: "Order marked as delivered" });
  } catch (error) {
    if (!tx.closed) await tx.rollback();
    console.error(error);
    return res.status(500).json({ error: "Could not update delivery status" });
  } finally {
    tx.close();
  }
});

router.get("/:id", async (req, res) => {
  const workId = Number(req.params.id);
  if (!Number.isSafeInteger(workId) || workId < 1) {
    return res.status(400).json({ error: "work_id must be a positive integer" });
  }
  try {
    const works = await listWorks(workId);
    if (!works.length) return res.status(404).json({ error: "Worksheet not found" });
    res.json(works[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not load worksheet" });
  }
});

const MAX_ACTIVE_ORDERS_PER_RIDER = 3;
const MAX_ASSIGNMENT_DISTANCE_KM = 1;

function distanceBetweenKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type IncomingOrderRow = {
  order_id: number;
  total_boxes: number;
  latitude: number;
  longitude: number;
  total_sales: number;
};

type ActiveStop = {
  order_id: number;
  latitude: number;
  longitude: number;
};

type AssignmentWork = {
  work_id: number;
  rider_id: number;
  route_color: string;
  stops: ActiveStop[];
  order_ids: number[];
  next_queue: number;
};

/**
 * Allocate each unassigned order to an existing active worksheet first.
 * A rider can have at most three active orders and a new order must be within
 * 1 km of at least one stop already on that worksheet. If no worksheet fits,
 * a new worksheet is created for an idle rider (or an automatic placeholder).
 */
router.post("/generate", async (req, res) => {
  const rawWorks = req.body?.works;
  if (!Array.isArray(rawWorks) || rawWorks.length < 1 || rawWorks.length > 100) {
    return res.status(400).json({ error: "works must contain between 1 and 100 delivery groups" });
  }

  const orderIds: number[] = [];
  const routeColorByOrder = new Map<number, string>();
  const seenOrderIds = new Set<number>();

  for (const raw of rawWorks) {
    if (!raw || !Array.isArray(raw.order_ids) || raw.order_ids.length < 1 || raw.order_ids.length > 3) {
      return res.status(400).json({ error: "Each work must contain between 1 and 3 order_ids" });
    }

    const routeColor = typeof raw.route_color === "string" ? raw.route_color : "";
    if (!/^#[0-9a-fA-F]{6}$/.test(routeColor)) {
      return res.status(400).json({ error: "route_color must be a 6-digit hex color" });
    }

    for (const rawOrderId of raw.order_ids) {
      const orderId = Number(rawOrderId);
      if (!Number.isSafeInteger(orderId) || orderId < 1) {
        return res.status(400).json({ error: "order_ids must be positive integers" });
      }
      if (seenOrderIds.has(orderId)) {
        return res.status(400).json({ error: "An order cannot appear in more than one work" });
      }
      seenOrderIds.add(orderId);
      orderIds.push(orderId);
      routeColorByOrder.set(orderId, routeColor);
    }
  }

  const tx = await conn.transaction("write");
  try {
    const marks = orderIds.map(() => "?").join(",");
    const orderResult = await tx.execute({
      sql: `SELECT o.order_id,o.total_boxes,c.latitude,c.longitude,
        COALESCE(SUM(od.quantity*f.price),0) AS total_sales
        FROM orders o
        JOIN customers c ON c.customer_id=o.customer_id
        LEFT JOIN order_details od ON od.order_id=o.order_id
        LEFT JOIN foods f ON f.food_id=od.food_id
        WHERE o.order_id IN (${marks})
          AND o.work_id IS NULL
          AND o.status IN ('queued','simulated')
        GROUP BY o.order_id`,
      args: orderIds,
    });

    if (orderResult.rows.length !== orderIds.length) {
      await tx.rollback();
      return res.status(409).json({ error: "Some orders are no longer available for worksheet assignment" });
    }

    const incomingOrders = orderResult.rows as unknown as IncomingOrderRow[];
    const orderById = new Map<number, IncomingOrderRow>(incomingOrders.map((order) => [Number(order.order_id), order] as const));
    for (const orderId of orderIds) {
      const order = orderById.get(orderId);
      if (
        !order ||
        !Number.isFinite(Number(order.latitude)) ||
        Math.abs(Number(order.latitude)) > 90 ||
        !Number.isFinite(Number(order.longitude)) ||
        Math.abs(Number(order.longitude)) > 180
      ) {
        await tx.rollback();
        return res.status(422).json({ error: `Order ${orderId} has invalid customer coordinates` });
      }
    }

    // Load all currently active delivery stops. Completed/cancelled orders do not
    // consume a rider's three-order capacity and cannot make an old worksheet active.
    const activeResult = await tx.execute(`
      SELECT w.work_id,w.rider_id,w.route_color,o.order_id,o.delivery_queue,
        c.latitude,c.longitude,
        COALESCE((SELECT MAX(o2.delivery_queue) FROM orders o2 WHERE o2.work_id=w.work_id),0) AS max_queue
      FROM works w
      LEFT JOIN orders o ON o.work_id=w.work_id AND o.status IN ('queued','simulated')
      LEFT JOIN customers c ON c.customer_id=o.customer_id
      ORDER BY w.work_id,o.delivery_queue,o.order_id
    `);

    type ActiveWorkDbRow = {
      work_id: number;
      rider_id: number;
      route_color: string;
      order_id: number | null;
      latitude: number | null;
      longitude: number | null;
      max_queue: number | null;
    };
    const activeRows = activeResult.rows as unknown as ActiveWorkDbRow[];
    const assignmentWorks = new Map<number, AssignmentWork>();
    const activeOrderCountByRider = new Map<number, number>();

    for (const row of activeRows) {
      const workId = Number(row.work_id);
      const riderId = Number(row.rider_id);
      let candidate = assignmentWorks.get(workId);
      if (!candidate) {
        candidate = {
          work_id: workId,
          rider_id: riderId,
          route_color: row.route_color || "#cf5a4c",
          stops: [],
          order_ids: [],
          next_queue: Number(row.max_queue ?? 0),
        };
        assignmentWorks.set(workId, candidate);
      }

      if (row.order_id !== null && row.latitude !== null && row.longitude !== null) {
        candidate.stops.push({
          order_id: Number(row.order_id),
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
        });
        candidate.order_ids.push(Number(row.order_id));
        activeOrderCountByRider.set(riderId, (activeOrderCountByRider.get(riderId) ?? 0) + 1);
      }
    }

    const riderResult = await tx.execute("SELECT rider_id FROM riders ORDER BY rider_id");
    const allRiderIds = riderResult.rows.map((row) => Number(row.rider_id));
    const createdWorks: Array<{ work_id: number; rider_id: number; order_ids: number[] }> = [];
    const assignments: Array<{
      order_id: number;
      work_id: number;
      rider_id: number;
      delivery_queue: number;
      appended_to_existing: boolean;
      distance_km: number | null;
    }> = [];

    for (const orderId of orderIds) {
      const order = orderById.get(orderId);
      if (!order) throw new Error(`Order ${orderId} disappeared during worksheet assignment`);

      // A worksheet is eligible only when the rider has fewer than three active
      // orders in total, the worksheet itself has room, and the new stop is close.
      const eligible = [...assignmentWorks.values()]
        .filter((work) =>
          work.stops.length > 0 &&
          work.stops.length < MAX_ACTIVE_ORDERS_PER_RIDER &&
          (activeOrderCountByRider.get(work.rider_id) ?? 0) < MAX_ACTIVE_ORDERS_PER_RIDER,
        )
        .map((work) => ({
          work,
          distance: Math.min(...work.stops.map((stop) =>
            distanceBetweenKm(
              Number(order.latitude),
              Number(order.longitude),
              stop.latitude,
              stop.longitude,
            ),
          )),
        }))
        .filter((candidate) => candidate.distance <= MAX_ASSIGNMENT_DISTANCE_KM)
        .sort((a, b) => a.distance - b.distance || a.work.work_id - b.work.work_id);

      let target = eligible[0]?.work;
      const appendedToExisting = Boolean(target);
      let distanceKm: number | null = eligible[0]?.distance ?? null;

      if (!target) {
        // Do not put a rider on two simultaneously active worksheets. Reuse an
        // idle registered rider first; create a placeholder only if all are busy.
        let riderId = allRiderIds.find((id) => (activeOrderCountByRider.get(id) ?? 0) === 0);
        if (riderId === undefined) {
          const sequence = allRiderIds.length + 1;
          const insertedRider = await tx.execute({
            sql: "INSERT INTO riders (first_name,last_name,phone_number) VALUES (?,?,?)",
            args: ["ไรเดอร์", `อัตโนมัติ ${sequence}`, `AUTO-RIDER-${Date.now()}-${sequence}`],
          });
          riderId = Number(insertedRider.lastInsertRowid);
          allRiderIds.push(riderId);
        }

        const routeColor = routeColorByOrder.get(orderId) ?? "#cf5a4c";
        const insertedWork = await tx.execute({
          sql: "INSERT INTO works (rider_id,route_color,total_boxes,total_sales) VALUES (?,?,0,0)",
          args: [riderId, routeColor],
        });
        const workId = Number(insertedWork.lastInsertRowid);
        target = {
          work_id: workId,
          rider_id: riderId,
          route_color: routeColor,
          stops: [],
          order_ids: [],
          next_queue: 0,
        };
        assignmentWorks.set(workId, target);
        createdWorks.push({ work_id: workId, rider_id: riderId, order_ids: [] });
        distanceKm = null;
      }

      const deliveryQueue = target.next_queue + 1;
      const updateOrder = await tx.execute({
        sql: "UPDATE orders SET work_id=?,delivery_queue=? WHERE order_id=? AND work_id IS NULL",
        args: [target.work_id, deliveryQueue, orderId],
      });
      if (Number(updateOrder.rowsAffected ?? 0) !== 1) {
        throw new Error(`Order ${orderId} was assigned by another request`);
      }

      await tx.execute({
        sql: "UPDATE works SET total_boxes=total_boxes+?,total_sales=total_sales+? WHERE work_id=?",
        args: [Number(order.total_boxes), Number(order.total_sales), target.work_id],
      });

      target.next_queue = deliveryQueue;
      target.order_ids.push(orderId);
      target.stops.push({
        order_id: orderId,
        latitude: Number(order.latitude),
        longitude: Number(order.longitude),
      });
      activeOrderCountByRider.set(
        target.rider_id,
        (activeOrderCountByRider.get(target.rider_id) ?? 0) + 1,
      );

      const created = createdWorks.find((work) => work.work_id === target?.work_id);
      if (created) created.order_ids.push(orderId);

      assignments.push({
        order_id: orderId,
        work_id: target.work_id,
        rider_id: target.rider_id,
        delivery_queue: deliveryQueue,
        appended_to_existing: appendedToExisting,
        distance_km: distanceKm === null ? null : Number(distanceKm.toFixed(3)),
      });
    }

    await tx.commit();
    res.status(201).json({
      created_count: createdWorks.length,
      assigned_count: assignments.length,
      works: createdWorks,
      assignments,
      message: "Orders assigned to nearby available riders",
    });
  } catch (error) {
    if (!tx.closed) await tx.rollback();
    console.error(error);
    res.status(500).json({ error: "Could not assign orders to worksheets" });
  } finally {
    tx.close();
  }
});
