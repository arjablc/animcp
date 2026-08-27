import { sha256Hex, type ImportAssetInput } from "./importer";

export interface Fixture {
  id: string;
  label: string;
  width: number;
  height: number;
  kind: "line" | "noise";
  description: string;
}

export const fixtures: Fixture[] = [
  {
    id: "pixel",
    label: "1 x 1 handshake",
    width: 1,
    height: 1,
    kind: "line",
    description: "Minimum valid PNG."
  },
  {
    id: "line-64",
    label: "64 x 64 line art",
    width: 64,
    height: 64,
    kind: "line",
    description: "Small transparent alpha image."
  },
  {
    id: "line-256",
    label: "256 x 256 line art",
    width: 256,
    height: 256,
    kind: "line",
    description: "Small useful transparent asset."
  },
  {
    id: "line-512",
    label: "512 x 512 line art",
    width: 512,
    height: 512,
    kind: "line",
    description: "Primary transparent target."
  },
  {
    id: "color-512",
    label: "512 x 512 full color",
    width: 512,
    height: 512,
    kind: "noise",
    description: "Full-color, poorly compressible image."
  },
  {
    id: "line-1024",
    label: "1024 x 1024 line art",
    width: 1024,
    height: 1024,
    kind: "line",
    description: "Upper realistic transparent target."
  }
];

export const payloadFixtures: Fixture[] = [
  { id: "payload-32", label: "< 10 KB payload", width: 32, height: 32, kind: "noise", description: "Payload-envelope probe." },
  { id: "payload-96", label: "~50 KB payload", width: 96, height: 96, kind: "noise", description: "Payload-envelope probe." },
  { id: "payload-144", label: "~100 KB payload", width: 144, height: 144, kind: "noise", description: "Payload-envelope probe." },
  { id: "payload-208", label: "~250 KB payload", width: 208, height: 208, kind: "noise", description: "Payload-envelope probe." },
  { id: "payload-320", label: "~500 KB payload", width: 320, height: 320, kind: "noise", description: "Payload-envelope probe." },
  { id: "payload-480", label: "~1 MB payload", width: 480, height: 480, kind: "noise", description: "Payload-envelope probe." },
  { id: "payload-672", label: "~2 MB payload", width: 672, height: 672, kind: "noise", description: "Payload-envelope probe." },
  { id: "payload-896", label: "~4 MB payload", width: 896, height: 896, kind: "noise", description: "Payload-envelope probe." }
];

export interface InvalidFixture {
  id: string;
  label: string;
  description: string;
  data: string;
}

const transparentPixel =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

export const invalidFixtures: InvalidFixture[] = [
  {
    id: "invalid-base64",
    label: "Malformed base64",
    description: "Must fail before image processing.",
    data: "not-base64"
  },
  {
    id: "not-png",
    label: "Non-PNG bytes",
    description: "Must reject a valid base64 non-image payload.",
    data: "aGVsbG8="
  },
  {
    id: "truncated-png",
    label: "Truncated PNG",
    description: "Must reject data that has a PNG header but cannot decode.",
    data: transparentPixel.slice(0, 32)
  }
];

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8_192));
  }
  return btoa(binary);
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("The browser could not create a PNG fixture."));
      }
    }, "image/png");
  });
}

function drawLineArt(context: CanvasRenderingContext2D, width: number, height: number) {
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "#1d4ed8";
  context.lineWidth = Math.max(1, Math.round(Math.min(width, height) / 24));
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(width * 0.14, height * 0.76);
  context.quadraticCurveTo(width * 0.44, height * 0.18, width * 0.86, height * 0.35);
  context.stroke();
  context.strokeStyle = "#f97316";
  context.lineWidth = Math.max(1, Math.round(Math.min(width, height) / 40));
  context.beginPath();
  context.moveTo(width * 0.2, height * 0.82);
  context.lineTo(width * 0.76, height * 0.22);
  context.stroke();
}

function drawNoise(context: CanvasRenderingContext2D, width: number, height: number) {
  const image = context.createImageData(width, height);
  let seed = 0x6d2b79f5;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      image.data[offset] = seed & 255;
      image.data[offset + 1] = (seed >>> 8) & 255;
      image.data[offset + 2] = (seed >>> 16) & 255;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}

export async function createFixture(fixture: Fixture): Promise<ImportAssetInput> {
  const canvas = document.createElement("canvas");
  canvas.width = fixture.width;
  canvas.height = fixture.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D is unavailable in this browser.");
  }

  if (fixture.kind === "line") {
    drawLineArt(context, fixture.width, fixture.height);
  } else {
    drawNoise(context, fixture.width, fixture.height);
  }

  const bytes = new Uint8Array(await (await canvasToBlob(canvas)).arrayBuffer());
  return {
    transferId: `fixture-${fixture.id}-${crypto.randomUUID()}`,
    name: `${fixture.label}.png`,
    mimeType: "image/png",
    encoding: "base64",
    data: bytesToBase64(bytes),
    expectedBytes: bytes.byteLength,
    sha256: await sha256Hex(bytes)
  };
}
