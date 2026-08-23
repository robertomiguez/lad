// Run this in the browser DevTools Console while the damage-reporting app is open.
// Enter the stale report UUID when prompted. The script removes its local report
// and photos, then reloads the page.

const reportId = prompt("Report UUID to remove from this browser:")?.trim();
if (!reportId) throw new Error("A report UUID is required.");
const databaseRequest = indexedDB.open("damage-reporting-poc", 3);

databaseRequest.onerror = () => console.error("Could not open IndexedDB:", databaseRequest.error);
databaseRequest.onsuccess = () => {
  const database = databaseRequest.result;
  const transaction = database.transaction(["reports", "photos"], "readwrite");

  transaction.objectStore("reports").delete(reportId);

  const cursorRequest = transaction.objectStore("photos").openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    if (cursor.value.reportId === reportId) cursor.delete();
    cursor.continue();
  };

  transaction.onerror = () => console.error("Could not remove the local report:", transaction.error);
  transaction.oncomplete = () => {
    database.close();
    location.reload();
  };
};
