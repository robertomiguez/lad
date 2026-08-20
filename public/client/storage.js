const DATABASE_NAME = "damage-reporting-poc";
const DATABASE_VERSION = 3;

const openDatabase = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("reports")) {
        request.result.createObjectStore("reports", { keyPath: "id" });
      }
      if (!request.result.objectStoreNames.contains("photos")) {
        request.result.createObjectStore("photos", { keyPath: "id" });
      }
      if (!request.result.objectStoreNames.contains("products")) {
        request.result.createObjectStore("products", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const withStore = async (name, mode, action) => {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = action(database.transaction(name, mode).objectStore(name));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const makeId = () => crypto.randomUUID();
export const saveLocalReport = (report) => withStore("reports", "readwrite", (store) => store.put(report));
export const allLocalReports = () => withStore("reports", "readonly", (store) => store.getAll());
export const deleteLocalReport = (id) => withStore("reports", "readwrite", (store) => store.delete(id));
export const saveLocalPhoto = (photo) => withStore("photos", "readwrite", (store) => store.put(photo));
export const allLocalPhotos = () => withStore("photos", "readonly", (store) => store.getAll());
export const deleteLocalPhoto = (id) => withStore("photos", "readwrite", (store) => store.delete(id));
export const saveLocalProduct = (product) => withStore("products", "readwrite", (store) => store.put(product));
export const allLocalProducts = () => withStore("products", "readonly", (store) => store.getAll());
export const clearLocalProducts = () => withStore("products", "readwrite", (store) => store.clear());
