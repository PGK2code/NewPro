export interface Customer {
  customer_id: number;
  first_name: string;
  last_name: string;
  address: string | null;
  phone_number: string;
  latitude: number;
  longitude: number;
}

export type CustomerInput = Omit<Customer, "customer_id">;
