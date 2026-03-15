const MAX_BLUEPRINT_IMAGE_WIDTH = 800;
const MAX_BLUEPRINT_IMAGE_HEIGHT = 500;

export function blueprintImageUrl(blueprintId: string, revision = 0): string {
  return `api/blueprints/${encodeURIComponent(blueprintId)}/image?v=${revision}`;
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = src;
  return new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Blueprint image could not be loaded"));
  });
}

export function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Image could not be read"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Image could not be read"));
    reader.readAsDataURL(blob);
  });
}

export function fitImageInside(width: number, height: number): { height: number; width: number } {
  if (width <= 0 || height <= 0) {
    throw new Error("Image dimensions are invalid");
  }
  const scale = Math.min(1, MAX_BLUEPRINT_IMAGE_WIDTH / width, MAX_BLUEPRINT_IMAGE_HEIGHT / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

export async function convertToPng(blob: Blob): Promise<Blob> {
  const supportedMimeTypes = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/svg+xml"
  ]);
  if (blob.type && !supportedMimeTypes.has(blob.type)) {
    throw new Error("Use PNG, JPG, WEBP, GIF, or SVG images.");
  }

  const image = await loadImageElement(await readBlobAsDataUrl(blob));
  const naturalWidth = (image as HTMLImageElement & { naturalWidth: number }).naturalWidth || image.width;
  const naturalHeight = (image as HTMLImageElement & { naturalHeight: number }).naturalHeight || image.height;
  const size = fitImageInside(naturalWidth, naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas context is unavailable");
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const result = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((nextBlob) => resolve(nextBlob), "image/png");
  });
  if (!result) {
    throw new Error("Image conversion failed");
  }
  return result;
}
