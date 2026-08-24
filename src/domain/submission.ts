export type Submission = {
  id: string;
  storeId: string;
  reporterId: string;
  totalAmountCents: number;
  items: {
    id: string;
    productId: string;
    quantity: number;
    reasonCode: string;
    description: string;
    photoId?: string;
  }[];
};
