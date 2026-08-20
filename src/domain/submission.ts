export type Submission = {
  id: string;
  storeId: string;
  reporterId: string;
  reportDate: string;
  totalAmountCents: number;
  items: {
    id: string;
    productId: string;
    quantity: number;
    reasonCode: string;
    photoId?: string;
  }[];
};
