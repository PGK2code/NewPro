export interface OrderSummary {
  order_id: number;
  customer_id: number;
  work_id: number | null;
  customer_name: string;
  phone_number: string;
  latitude: number;
  longitude: number;
  order_date: string;
  total_boxes: number;
  delivery_queue: number | null;
  status: string;
  total_sales: number;
  items: Array<{ order_detail_id: number; food_id: number; food_name: string; quantity: number; unit_price: number }>;
}
