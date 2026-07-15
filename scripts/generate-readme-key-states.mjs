import { createCanvas, loadImage } from "canvas";
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

// Keep these definitions aligned with src/rendering.ts
const ICON_CHECK = [{ d: "M5 11l6 6l10-10" }];
const ICON_ARROW_DOWN = [{ d: "M12 5v12" }, { d: "M7 13l5 5l5-5" }];

const CANVAS_SIZE = 144;
const TITLE_Y = 16;
const INIT_STATUS_LABEL = "NOT SET";

// 分段進度條幾何（對齊 src/rendering.ts）
const BAR_MARGIN_X = 8;
const BAR_WIDTH = CANVAS_SIZE - BAR_MARGIN_X * 2;
const BAR_Y = 56;
const BAR_HEIGHT = 17;
const BAR_LABEL_Y = 86;
const FOOTER_TEXT_Y = 124;

const BORDER_WIDTH = 6;
const BORDER_RADIUS = 22;
const CONTENT_INSET = 12;

// 外框顏色代號 → hex（對齊 src/settings.ts BORDER_COLORS）
const BORDER_COLORS = {
  red: "#ef4444",
  orange: "#fb923c",
  yellow: "#facc15",
  green: "#4ade80",
  blue: "#38bdf8",
  indigo: "#6366f1",
  violet: "#d946ef"
};

const iconImageCache = new Map();

const formatTime = () => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
};

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
  ctx.font = "24px sans-serif bold";
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

const getStatusColor = (status) => {
  if (status === "Succeeded") return "#4ade80";
  if (status === "Failed") return "#f87171";
  if (status === "") return "rgba(255, 255, 255, 0.28)";
  return "#60a5fa";
};

const isLoadingStatus = (status) => status !== "Succeeded" && status !== "Failed";

const fillRoundedRect = (ctx, x, y, width, height, radius) => {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
  ctx.fill();
};

const drawStatusBar = (ctx, statuses, loadingAngleDeg) => {
  const count = statuses.length;
  if (count === 0) {
    return;
  }

  const gap = count > 8 ? 2 : 4;
  const segmentWidth = (BAR_WIDTH - gap * (count - 1)) / count;
  const wave = Math.sin((loadingAngleDeg * Math.PI) / 180);
  const pulseAlpha = 0.45 + 0.55 * ((wave + 1) / 2);

  let x = BAR_MARGIN_X;
  for (const status of statuses) {
    ctx.save();
    if (status !== "" && isLoadingStatus(status)) {
      ctx.globalAlpha = pulseAlpha;
    }
    ctx.fillStyle = getStatusColor(status);
    fillRoundedRect(ctx, x, BAR_Y, segmentWidth, BAR_HEIGHT, 5);
    ctx.restore();
    x += segmentWidth + gap;
  }

  const succeededCount = statuses.filter((status) => status === "Succeeded").length;
  ctx.fillStyle = "white";
  ctx.font = "24px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${succeededCount}/${count}`, CANVAS_SIZE / 2, BAR_LABEL_Y);
};

const drawFooter = async (ctx, isAllSucceeded, isRefreshing, loadingAngleDeg) => {
  // 時間靠左、footer 狀態圖示靠右（縮小字級與 icon，對齊 src/rendering.ts）
  ctx.fillStyle = "white";
  ctx.font = "18px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(formatTime(), 8, FOOTER_TEXT_Y);
  if (isAllSucceeded) {
    await drawIcon(ctx, ICON_CHECK, "#4ade80", 120, FOOTER_TEXT_Y, 16);
  } else if (isRefreshing) {
    await drawBreathingIcon(ctx, ICON_ARROW_DOWN, "white", 120, FOOTER_TEXT_Y, 16, loadingAngleDeg);
  } else {
    await drawIcon(ctx, ICON_ARROW_DOWN, "white", 120, FOOTER_TEXT_Y, 16);
  }
};

const drawBorder = (ctx, color) => {
  const offset = BORDER_WIDTH / 2;
  const x = offset;
  const y = offset;
  const w = CANVAS_SIZE - BORDER_WIDTH;
  const h = CANVAS_SIZE - BORDER_WIDTH;
  const r = BORDER_RADIUS;

  ctx.strokeStyle = color;
  ctx.lineWidth = BORDER_WIDTH;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.stroke();
};

// 內容一律等比內縮（對齊 src/rendering.ts），框線僅額外疊加
const renderDebugLikeFrame = async (
  title,
  statuses,
  { isRefreshing = true, loadingAngleDeg = 0, borderColor = null } = {}
) => {
  const { canvas, ctx } = createButtonCanvas();

  const scale = (CANVAS_SIZE - CONTENT_INSET * 2) / CANVAS_SIZE;
  ctx.save();
  ctx.translate(CONTENT_INSET, CONTENT_INSET);
  ctx.scale(scale, scale);

  drawTitle(ctx, title);
  drawStatusBar(ctx, statuses, loadingAngleDeg);
  await drawFooter(
    ctx,
    statuses.every((status) => status === "Succeeded"),
    isRefreshing,
    loadingAngleDeg
  );

  ctx.restore();

  if (borderColor) {
    drawBorder(ctx, borderColor);
  }

  return canvas.toBuffer("image/png");
};

const renderNotConfiguredFrame = async (title) => {
  const { canvas, ctx } = createButtonCanvas();

  const scale = (CANVAS_SIZE - CONTENT_INSET * 2) / CANVAS_SIZE;
  ctx.save();
  ctx.translate(CONTENT_INSET, CONTENT_INSET);
  ctx.scale(scale, scale);

  // 第一行：logo 縮小置頂
  const iconImg = await loadImage(actionKeyIconPath);
  const logoSize = 40;
  ctx.drawImage(iconImg, (CANVAS_SIZE - logoSize) / 2, TITLE_Y - 4, logoSize, logoSize);

  // 第二行：標題
  ctx.fillStyle = "white";
  ctx.font = "22px sans-serif bold";
  ctx.textAlign = "center";
  ctx.fillText(title, 72, 67, 134);

  // 第三行：未設定狀態文字
  ctx.fillStyle = "#f59e0b";
  ctx.font = "20px sans-serif bold";
  ctx.textAlign = "center";
  ctx.fillText(INIT_STATUS_LABEL, 72, 116, 132);

  ctx.restore();

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

// 繪製面板背景（圓角漸層 + 頂部光澤 + 邊框）
const drawPanel = (ctx, cardW, cardH) => {
  const panelGradient = ctx.createLinearGradient(0, 0, 0, cardH);
  panelGradient.addColorStop(0, "#202127");
  panelGradient.addColorStop(1, "#12131a");
  ctx.fillStyle = panelGradient;
  drawRoundedRect(ctx, 0, 0, cardW, cardH, 24);

  const glossGradient = ctx.createLinearGradient(0, 0, 0, cardH * 0.45);
  glossGradient.addColorStop(0, "rgba(255,255,255,0.12)");
  glossGradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glossGradient;
  drawRoundedRect(ctx, 0, 0, cardW, cardH * 0.45, 24);

  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 2;
  strokeRoundedRect(ctx, 1, 1, cardW - 2, cardH - 2, 23);
};

// 繪製單顆按鈕外殼並置入已渲染的按鈕圖
const drawKeyInShell = async (ctx, file, x, shellY, slotW, slotH, imageInset) => {
  const imageW = slotW - imageInset * 2;
  const imageH = imageW;

  const shellGradient = ctx.createLinearGradient(0, shellY, 0, shellY + slotH);
  shellGradient.addColorStop(0, "#101116");
  shellGradient.addColorStop(1, "#05060a");
  ctx.fillStyle = shellGradient;
  drawRoundedRect(ctx, x, shellY, slotW, slotH, 24);

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  strokeRoundedRect(ctx, x + 1, shellY + 1, slotW - 2, slotH - 2, 22);
  ctx.strokeStyle = "rgba(0,0,0,0.92)";
  ctx.lineWidth = 2;
  strokeRoundedRect(ctx, x + 3, shellY + 3, slotW - 6, slotH - 6, 20);

  const img = await loadImage(file);
  ctx.drawImage(img, x + imageInset, shellY + imageInset, imageW, imageH);

  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1.5;
  strokeRoundedRect(ctx, x + imageInset + 0.75, shellY + imageInset + 0.75, imageW - 1.5, imageH - 1.5, 15);
};

const buildOverview = async () => {
  const startX = 28;
  const gap = 20;
  const slotW = 261;
  const slotH = 248;
  const imageInset = 13;
  const topY = 28;
  const labelToKeyGap = 48;
  const cardW = startX * 2 + slotW * 4 + gap * 3;
  const cardH = topY + labelToKeyGap + slotH + 24;
  const canvas = createCanvas(cardW, cardH);
  const ctx = canvas.getContext("2d");
  drawPanel(ctx, cardW, cardH);

  const labels = ["Not Configured", "Loading", "Partially Complete", "Fully Complete"];
  const files = ["not-configured.png", "loading.png", "partial-checked.png", "all-checked.png"];

  for (let i = 0; i < 4; i += 1) {
    const x = startX + i * (slotW + gap);

    ctx.fillStyle = "#dadce5";
    ctx.textAlign = "center";
    ctx.font = "600 32px sans-serif";
    ctx.fillText(labels[i], x + slotW / 2, topY + 4);

    await drawKeyInShell(ctx, path.resolve(outputDir, files[i]), x, topY + labelToKeyGap, slotW, slotH, imageInset);
  }

  return canvas.toBuffer("image/png");
};

// 外框顏色示意：7 色各一顆按鈕，並各自呈現不同 pipeline 狀態
const buildBorderColors = async () => {
  const entries = Object.entries(BORDER_COLORS);
  // 每顆搭配不同狀態，同時展示外框顏色與狀態渲染
  const states = [
    { title: "Prod", statuses: ["Succeeded", "Succeeded", "Succeeded"], isRefreshing: false },
    { title: "Build", statuses: ["Succeeded", "InProgress", "InProgress"], isRefreshing: true },
    { title: "Stage", statuses: ["Succeeded", "Succeeded", "Failed"], isRefreshing: true },
    { title: "Deploy", statuses: ["InProgress", "InProgress", "InProgress"], isRefreshing: true },
    { title: "Release", statuses: ["Succeeded", "Succeeded", "Succeeded"], isRefreshing: false },
    { title: "Sandbox", statuses: ["Succeeded", "Failed", "InProgress"], isRefreshing: true },
    { title: "Test", statuses: ["Succeeded", "Succeeded", "InProgress"], isRefreshing: true }
  ];
  const startX = 24;
  const gap = 16;
  const slotW = 150;
  const imageInset = 10;
  const topY = 24;
  const labelH = 40;
  const slotH = slotW;
  const cardW = startX * 2 + entries.length * slotW + (entries.length - 1) * gap;
  const cardH = topY + slotH + labelH + 20;

  const canvas = createCanvas(cardW, cardH);
  const ctx = canvas.getContext("2d");
  drawPanel(ctx, cardW, cardH);

  for (let i = 0; i < entries.length; i += 1) {
    const [name, hex] = entries[i];
    const state = states[i % states.length];
    const x = startX + i * (slotW + gap);
    const frame = await renderDebugLikeFrame(state.title, state.statuses, {
      isRefreshing: state.isRefreshing,
      borderColor: hex
    });
    const framePath = path.resolve(outputDir, `border-${name}.png`);
    writeFileSync(framePath, frame);
    await drawKeyInShell(ctx, framePath, x, topY, slotW, slotH, imageInset);

    ctx.fillStyle = "#dadce5";
    ctx.textAlign = "center";
    ctx.font = "600 22px sans-serif";
    ctx.fillText(name, x + slotW / 2, topY + slotH + 12);
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

  writePng("not-configured.png", await renderNotConfiguredFrame("CodePipeline"));
  writePng("overview.png", await buildOverview());
  writePng("border-colors.png", await buildBorderColors());
};

await main();
