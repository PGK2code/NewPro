-- Initialize the Turso database with `npm run db:init`.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS riders (
  rider_id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone_number TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS customers (
  customer_id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  address TEXT,
  phone_number TEXT NOT NULL UNIQUE,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_coordinates ON customers(latitude, longitude);

CREATE TABLE IF NOT EXISTS foods (
  food_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  price REAL NOT NULL CHECK (price >= 0)
);

CREATE TABLE IF NOT EXISTS works (
  work_id INTEGER PRIMARY KEY AUTOINCREMENT,
  rider_id INTEGER NOT NULL,
  route_color TEXT NOT NULL,
  total_distance REAL NOT NULL DEFAULT 0,
  total_boxes INTEGER NOT NULL DEFAULT 0,
  profit REAL NOT NULL DEFAULT 0,
  total_sales REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivery_cost REAL NOT NULL DEFAULT 0,
  CONSTRAINT fk_works_rider FOREIGN KEY (rider_id) REFERENCES riders(rider_id)
);

CREATE TABLE IF NOT EXISTS orders (
  order_id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  work_id INTEGER,
  order_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_boxes INTEGER NOT NULL DEFAULT 0,
  delivery_queue INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
  CONSTRAINT fk_orders_work FOREIGN KEY (work_id) REFERENCES works(work_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_work ON orders(work_id);

CREATE TABLE IF NOT EXISTS order_details (
  order_detail_id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  food_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 3),
  CONSTRAINT fk_details_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
  CONSTRAINT fk_details_food FOREIGN KEY (food_id) REFERENCES foods(food_id)
);
CREATE INDEX IF NOT EXISTS idx_details_order ON order_details(order_id);

INSERT INTO customers (first_name,last_name,address,phone_number,latitude,longitude) VALUES
('Narin','Sukjai','ใกล้มหาวิทยาลัยมหาสารคาม','0810000001',16.2458,103.2508),
('Mali','Jaiyen','เขตชุมชนใกล้มหาวิทยาลัยมหาสารคาม','0810000002',16.2472,103.2540),
('Krit','Wongsa','บริเวณท่าขอนยาง','0810000003',16.2430,103.2560),
('Pim','Srisuk','บริเวณขามเรียง','0810000004',16.2385,103.2470),
('Arthit','Meesuk','ใกล้มหาวิทยาลัยมหาสารคาม','0810000005',16.2500,103.2460),
('Dao','Prasert','บริเวณท่าขอนยาง','0810000006',16.2510,103.2580),
('Beam','Chaiyo','บริเวณขามเรียง','0810000007',16.2365,103.2540),
('Fon','Thongdee','ใกล้มหาวิทยาลัยมหาสารคาม','0810000008',16.2410,103.2430),
('Non','Kham','บริเวณท่าขอนยาง','0810000009',16.2480,103.2600),
('May','Rattanakul','บริเวณขามเรียง','0810000010',16.2345,103.2480)
ON CONFLICT(phone_number) DO UPDATE SET
  first_name=excluded.first_name,
  last_name=excluded.last_name,
  address=excluded.address,
  latitude=excluded.latitude,
  longitude=excluded.longitude;

INSERT INTO foods (name,price) VALUES
('ข้าวกะเพราไก่',65.00),
('ข้าวไก่กระเทียม',65.00),
('ข้าวผัดหมู',65.00),
('ข้าวผัดกุ้ง',65.00),
('ข้าวไข่เจียวหมูสับ',65.00)
ON CONFLICT(name) DO UPDATE SET price=excluded.price;
