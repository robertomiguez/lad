import { normalizeSku, productCodeMatches } from "../barcode.js";

const cameraScanFormats = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"];

export const resolveBarcode = (input) => {
  const item = input.closest(".line-item");
  if (!item) return;
  const result = item.querySelector("[data-barcode-result]");
  const product = item.querySelector("[name=product_id]");
  const sku = normalizeSku(input.value);
  if (!result || !(product instanceof HTMLSelectElement)) return;
  if (!sku) {
    result.textContent = "";
    delete result.dataset.state;
    return;
  }
  const match = [...product.options].find(
    (option) => productCodeMatches(option.dataset.sku, sku) || productCodeMatches(option.dataset.barcode, sku),
  );
  if (!match) {
    result.textContent = "No matching product. Use the picker instead.";
    result.dataset.state = "error";
    return;
  }
  product.value = match.value;
  result.textContent = `Selected ${match.textContent}`;
  result.dataset.state = "success";
};

export const stopCameraScan = (item) => {
  const scanner = item?.querySelector("[data-barcode-scanner]");
  if (!scanner) return;
  cancelAnimationFrame(scanner.scanFrame || 0);
  const video = scanner.querySelector("[data-barcode-video]");
  const stream = video?.srcObject;
  if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
  if (video) video.srcObject = null;
  scanner.hidden = true;
  delete scanner.scanFrame;
};

export const startCameraScan = async (button) => {
  const item = button.closest(".line-item");
  const input = item?.querySelector("[data-barcode-input]");
  const result = item?.querySelector("[data-barcode-result]");
  const scanner = item?.querySelector("[data-barcode-scanner]");
  const video = scanner?.querySelector("[data-barcode-video]");
  const Detector = globalThis.BarcodeDetector;
  if (!item || !(input instanceof HTMLInputElement) || !result || !scanner || !(video instanceof HTMLVideoElement)) {
    return;
  }
  if (!Detector || !navigator.mediaDevices?.getUserMedia) {
    result.textContent = "Camera scanning is unavailable here. Scan with a hardware scanner or type the SKU.";
    result.dataset.state = "error";
    return;
  }
  document.querySelectorAll(".line-item").forEach(stopCameraScan);
  scanner.hidden = false;
  try {
    const supported = (await Detector.getSupportedFormats?.()) || cameraScanFormats;
    const formats = cameraScanFormats.filter((format) => supported.includes(format));
    const detector = new Detector(formats.length ? { formats } : undefined);
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    });
    await video.play();
    const detect = async () => {
      try {
        const barcode = (await detector.detect(video))[0];
        if (barcode?.rawValue) {
          input.value = barcode.rawValue;
          resolveBarcode(input);
          stopCameraScan(item);
          return;
        }
      } catch {}
      scanner.scanFrame = requestAnimationFrame(detect);
    };
    scanner.scanFrame = requestAnimationFrame(detect);
  } catch {
    stopCameraScan(item);
    result.textContent = "Camera access was unavailable. Scan with a hardware scanner or type the SKU.";
    result.dataset.state = "error";
  }
};
