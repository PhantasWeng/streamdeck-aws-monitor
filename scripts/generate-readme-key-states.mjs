import { createCanvas, loadImage } from "canvas";
import dayjs from "dayjs";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outputDir = path.resolve(rootDir, "docs/images/key-states");
const actionKeyIconPath = path.resolve(
  rootDir,
  "com.phantas-weng.aws-monitor.sdPlugin/imgs/actions/codepipeline/key@2x.png"
);

// Keep these definitions aligned with src/actions/codepipeline.ts
const ICON_CONFIRM_CIRCLE = [
  { d: "M3 12c0-4.97 4.03-9 9-9c4.97 0 9 4.03 9 9c0 4.97-4.03 9-9 9c-4.97 0-9-4.03-9-9Z" },
  { d: "M8 12l3 3l5-5" }
];

const ICON_CLOSE_CIRCLE = [
  { d: "M3 12c0-4.97 4.03-9 9-9c4.97 0 9 4.03 9 9c0 4.97-4.03 9-9 9c-4.97 0-9-4.03-9-9Z" },
  { d: "M12 12l4 4M12 12l-4-4M12 12l-4 4M12 12l4-4" }
];

const ICON_LOADING = [
  { d: "M12 3c4.97 0 9 4.03 9 9" },
  { d: "M12 3c4.97 0 9 4.03 9 9c0 4.97-4.03 9-9 9c-4.97 0-9-4.03-9-9c0-4.97 4.03-9 9-9Z", opacity: 0.3 }
];

const ICON_CHECK = [{ d: "M5 11l6 6l10-10" }];
const ICON_ARROW_DOWN = [{ d: "M12 5v12" }, { d: "M7 13l5 5l5-5" }];

const CANVAS_SIZE = 144;
const TITLE_Y = 12;
const STATUS_ICON_Y = 50;

const iconImageCache = new Map();

const createIconSvg = (paths, color) => {
  const pathElements = paths
    .map(({ d, opacity }) => `<path d="${d}"${opacity !== undefined ? ` opacity="${opacity}"` : ""}/>`)
    .join("");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
      `<g fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">` +
      `${pathElements}</g></svg>`
  );
};

const getIconImage = async (paths, color) => {
  const key = `${color}|${paths.map(({ d, opacity }) => `${d}:${opacity ?? ""}`).join("|")}`;
  const cached = iconImageCache.get(key);
  if (cached) {
    return cached;
  }

  const imagePromise = loadImage(createIconSvg(paths, color));
  iconImageCache.set(key, imagePromise);
  return imagePromise;
};

const createButtonCanvas = () => {
  const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "top";
  return { canvas, ctx };
};

const drawTitle = (ctx, title) => {
  ctx.fillStyle = "white";
  ctx.font = "20px sans-serif bold";
  ctx.textAlign = "center";
  ctx.fillText(title, 72, TITLE_Y, 134);
};

const drawIcon = async (ctx, paths, color, x, y, size, rotationDeg = 0) => {
  const img = await getIconImage(paths, color);
  if (rotationDeg === 0) {
    ctx.drawImage(img, x, y, size, size);
    return;
  }

  const centerX = x + size / 2;
  const centerY = y + size / 2;
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
};

const drawBreathingIcon = async (ctx, paths, color, x, y, size, phaseDeg) => {
  const img = await getIconImage(paths, color);
  const wave = Math.sin((phaseDeg * Math.PI) / 180);
  const downwardWave = (wave + 1) / 2;
  const yOffset = 4 * downwardWave;
  const alpha = 0.78 + 0.22 * (1 - downwardWave);
  const centerX = x + size / 2;
  const centerY = y + size / 2;

  ctx.save();
  ctx.translate(centerX, centerY + yOffset);
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
};

const getStatusIcon = (status) => {
  if (status === "Succeeded") return { icon: ICON_CONFIRM_CIRCLE, color: "#4ade80" };
  if (status === "Failed") return { icon: ICON_CLOSE_CIRCLE, color: "#f87171" };
  return { icon: ICON_LOADING, color: "#60a5fa" };
};

const isLoadingStatus = (status) => status !== "Succeeded" && status !== "Failed";

const drawStatusSymbols = async (ctx, statuses, loadingAngleDeg) => {
  const iconSize = 40;
  const gap = 4;
  const totalWidth = statuses.length * iconSize + (statuses.length - 1) * gap;
  let x = (CANVAS_SIZE - totalWidth) / 2;
  const y = STATUS_ICON_Y;

  for (const status of statuses) {
    const { icon, color } = getStatusIcon(status);
    const rotationDeg = isLoadingStatus(status) ? loadingAngleDeg : 0;
    await drawIcon(ctx, icon, color, x, y, iconSize, rotationDeg);
    x += iconSize + gap;
  }
};

const drawFooter = async (ctx, isAllSucceeded, isRefreshing, loadingAngleDeg) => {
  ctx.fillStyle = "white";
  ctx.font = "22px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(dayjs().format("HH:mm"), 52, 110);
  if (isAllSucceeded) {
    await drawIcon(ctx, ICON_CHECK, "#4ade80", 96, 108, 22);
  } else if (isRefreshing) {
    await drawBreathingIcon(ctx, ICON_ARROW_DOWN, "white", 96, 108, 22, loadingAngleDeg);
  } else {
    await drawIcon(ctx, ICON_ARROW_DOWN, "white", 96, 108, 22);
  }
};

const renderDebugLikeFrame = async (title, statuses, { isRefreshing = true, loadingAngleDeg = 0 } = {}) => {
  const { canvas, ctx } = createButtonCanvas();
  drawTitle(ctx, title);
  await drawStatusSymbols(ctx, statuses, loadingAngleDeg);
  await drawFooter(
    ctx,
    statuses.every((status) => status === "Succeeded"),
    isRefreshing,
    loadingAngleDeg
  );
  return canvas.toBuffer("image/png");
};

const renderNotConfiguredFrame = async (title) => {
  const { canvas, ctx } = createButtonCanvas();
  drawTitle(ctx, title);
  const iconImg = await loadImage(actionKeyIconPath);
  ctx.drawImage(iconImg, 36, 37, 72, 72);
  ctx.fillStyle = "#f59e0b";
  ctx.font = "15px sans-serif bold";
  ctx.textAlign = "center";
  ctx.fillText("NOT CONFIGURED", 72, 110, 132);
  return canvas.toBuffer("image/png");
};

const writePng = (filename, data) => {
  writeFileSync(path.resolve(outputDir, filename), data);
};

const roundedRectPath = (ctx, x, y, width, height, radius) => {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};

const drawRoundedRect = (ctx, x, y, width, height, radius) => {
  roundedRectPath(ctx, x, y, width, height, radius);
  ctx.fill();
};

const strokeRoundedRect = (ctx, x, y, width, height, radius) => {
  roundedRectPath(ctx, x, y, width, height, radius);
  ctx.stroke();
};

const buildOverview = async () => {
  const cardW = 1140;
  const cardH = 390;
  const canvas = createCanvas(cardW, cardH);
  const ctx = canvas.getContext("2d");

  // Panel background
  const panelGradient = ctx.createLinearGradient(0, 0, 0, cardH);
  panelGradient.addColorStop(0, "#202127");
  panelGradient.addColorStop(1, "#12131a");
  ctx.fillStyle = panelGradient;
  drawRoundedRect(ctx, 0, 0, cardW, cardH, 24);

  // Top gloss
  const glossGradient = ctx.createLinearGradient(0, 0, 0, cardH * 0.45);
  glossGradient.addColorStop(0, "rgba(255,255,255,0.12)");
  glossGradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glossGradient;
  drawRoundedRect(ctx, 0, 0, cardW, cardH * 0.45, 24);

  // Panel border
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 2;
  strokeRoundedRect(ctx, 1, 1, cardW - 2, cardH - 2, 23);

  const labels = ["Not Configured", "Loading", "Partially Complete", "Fully Complete"];
  const files = ["not-configured.png", "loading.png", "partial-checked.png", "all-checked.png"];
  const startX = 28;
  const gap = 20;
  const slotW = 261;
  const slotH = 300;
  const imageInset = 13;
  const imageW = slotW - imageInset * 2;
  const imageH = imageW;
  const topY = 28;

  for (let i = 0; i < 4; i += 1) {
    const x = startX + i * (slotW + gap);
    const y = topY;

    // label
    ctx.fillStyle = "#dadce5";
    ctx.textAlign = "center";
    ctx.font = "600 32px sans-serif";
    ctx.fillText(labels[i], x + slotW / 2, y + 4);

    // key shell
    const shellY = y + 48;
    const shellGradient = ctx.createLinearGradient(0, shellY, 0, shellY + slotH - 52);
    shellGradient.addColorStop(0, "#101116");
    shellGradient.addColorStop(1, "#05060a");
    ctx.fillStyle = shellGradient;
    drawRoundedRect(ctx, x, shellY, slotW, slotH - 52, 24);

    // shell edge
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 2;
    strokeRoundedRect(ctx, x + 1, shellY + 1, slotW - 2, slotH - 54, 22);
    ctx.strokeStyle = "rgba(0,0,0,0.92)";
    ctx.lineWidth = 2;
    strokeRoundedRect(ctx, x + 3, shellY + 3, slotW - 6, slotH - 58, 20);

    // image
    const img = await loadImage(path.resolve(outputDir, files[i]));
    ctx.drawImage(img, x + imageInset, shellY + imageInset, imageW, imageH);

    // image glass border
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1.5;
    strokeRoundedRect(ctx, x + imageInset + 0.75, shellY + imageInset + 0.75, imageW - 1.5, imageH - 1.5, 15);
  }

  return canvas.toBuffer("image/png");
};

const main = async () => {
  mkdirSync(outputDir, { recursive: true });

  writePng(
    "loading.png",
    await renderDebugLikeFrame("debug", ["InProgress", "InProgress", "InProgress"], {
      isRefreshing: true,
      loadingAngleDeg: 0
    })
  );

  writePng(
    "partial-checked.png",
    await renderDebugLikeFrame("debug", ["Succeeded", "Succeeded", "Failed"], {
      isRefreshing: true,
      loadingAngleDeg: 0
    })
  );

  writePng(
    "all-checked.png",
    await renderDebugLikeFrame("debug", ["Succeeded", "Succeeded", "Succeeded"], {
      isRefreshing: false,
      loadingAngleDeg: 0
    })
  );

  writePng("not-configured.png", await renderNotConfiguredFrame("AWS CodePipeline"));
  writePng("overview.png", await buildOverview());
};

await main();
