export type Submission = {
  id: string;
  storeId: string;
  reporterId: string;
  items: {
    id: string;
    productId: string;
    quantity: number;
    reasonCode: string;
    description: string;
    photoId?: string;
  }[];
};

export type PricedSubmission = Omit<Submission, "items"> & {
  currency: "CHF";
  totalAmountCents: number;
  taxAmountCents: number;
  items: (Submission["items"][number] & {
    sku: string;
    productName: string;
    unitPriceCents: number;
    taxRateBps: number;
    lineTotalAmountCents: number;
  })[];
};
