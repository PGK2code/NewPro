import express from "express";
import { queryRows } from "../dbconnect";

export const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    const rows = await queryRows("SELECT food_id, name, price FROM foods ORDER BY food_id");
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database operation failed" });
  }
});
