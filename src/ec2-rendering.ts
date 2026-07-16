import streamDeck from '@elgato/streamdeck';
import { type Canvas, type CanvasRenderingContext2D, createCanvas, type Image, loadImage } from 'canvas';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableMetrics, classifyInstanceState, type Ec2Footer, type Ec2Metrics } from './ec2-metrics';

// Iconify line-md 靜態圖示路徑定義
type IconPathDef = { d: string; opacity?: number };

const ICON_CHECK: IconPathDef[] = [{ d: 'M5 11l6 6l10-10' }];
const ICON_ARROW_DOWN: IconPathDef[] = [{ d: 'M12 5v12' }, { d: 'M7 13l5 5l5-5' }];
const ICON_CLOSE: IconPathDef[] = [{ d: 'M6 6l12 12' }, { d: 'M18 6l-12 12' }];
const ICON_PAUSE: IconPathDef[] = [{ d: 'M9 6v12' }, { d: 'M15 6v12' }];

const CANVAS_SIZE = 144;
const INIT_STATUS_LABEL = 'NOT SET';
const TITLE_Y = 16;

// 指標列排版：在標題與 footer 之間的縱向區帶內依列數均分
const ROWS_TOP = 44;
const ROWS_BOTTOM = 112;
const METRIC_LABEL_X = 6;
const METRIC_BAR_X = 46; // 與 label 留小間隔
const METRIC_BAR_RIGHT = 98;
const METRIC_PERCENT_X = 104; // 緊接進度條右側（左對齊，固定小間隔，10%/100% 一致）
const METRIC_BAR_HEIGHT = 12;

// Footer（時間 + 狀態圖示）
const FOOTER_TEXT_Y = 124;

// 外框（與 CodePipeline 一致）
const BORDER_WIDTH = 6;
const BORDER_RADIUS = 22;
const CONTENT_INSET = 12;

const iconImageCache = new Map<string, Promise<Image>>();
const actionKeyIconPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../imgs/actions/ec2/key@2x.png');
const actionKeyIconPromise = loadImage(actionKeyIconPath);

const formatTime = (): string => {
	const now = new Date();
	return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

const createButtonCanvas = (): { canvas: Canvas; ctx: CanvasRenderingContext2D } => {
	const canvas = createCanvas(CANVAS_SIZE, CANVAS_SIZE);
	const ctx = canvas.getContext('2d');
	ctx.textBaseline = 'top';
	return { canvas, ctx };
};

const TITLE_DOT_RADIUS = 5;
const TITLE_DOT_GAP = 8; // 狀態點與名稱之間的間隔
const TITLE_MAX_TEXT_WIDTH = 106; // 名稱最大寬度（扣掉狀態點與間隔後仍留邊距）

/**
 * 繪製「狀態點 + 名稱」整組並水平置中：
 * 狀態點在名稱前方，量測文字寬度後把整組置中。
 */
const drawTitleWithState = (ctx: CanvasRenderingContext2D, title: string, state: string): void => {
	ctx.font = '24px sans-serif bold';
	ctx.textAlign = 'left';
	const textWidth = Math.min(ctx.measureText(title).width, TITLE_MAX_TEXT_WIDTH);
	const dotDiameter = TITLE_DOT_RADIUS * 2;
	const groupWidth = dotDiameter + TITLE_DOT_GAP + textWidth;
	const groupLeft = (CANVAS_SIZE - groupWidth) / 2;

	// 狀態點（垂直對齊文字中心）
	ctx.fillStyle = getStateColor(state);
	ctx.beginPath();
	ctx.arc(groupLeft + TITLE_DOT_RADIUS, TITLE_Y + 9, TITLE_DOT_RADIUS, 0, Math.PI * 2);
	ctx.fill();

	// 名稱
	ctx.fillStyle = 'white';
	ctx.fillText(title, groupLeft + dotDiameter + TITLE_DOT_GAP, TITLE_Y, TITLE_MAX_TEXT_WIDTH);
};

const createIconSvg = (paths: IconPathDef[], color: string): Buffer => {
	const pathElements = paths
		.map(({ d, opacity }) => `<path d="${d}"${opacity !== undefined ? ` opacity="${opacity}"` : ''}/>`)
		.join('');
	return Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
			`<g fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">` +
			`${pathElements}</g></svg>`
	);
};

const getIconImage = async (paths: IconPathDef[], color: string): Promise<Image> => {
	const key = `${color}|${paths.map(({ d, opacity }) => `${d}:${opacity ?? ''}`).join('|')}`;
	const cached = iconImageCache.get(key);
	if (cached) {
		return cached;
	}
	const imagePromise = loadImage(createIconSvg(paths, color));
	iconImageCache.set(key, imagePromise);
	return imagePromise;
};

const drawIcon = async (
	ctx: CanvasRenderingContext2D,
	paths: IconPathDef[],
	color: string,
	x: number,
	y: number,
	size: number
): Promise<void> => {
	const img = await getIconImage(paths, color);
	ctx.drawImage(img, x, y, size, size);
};

const drawBreathingIcon = async (
	ctx: CanvasRenderingContext2D,
	paths: IconPathDef[],
	color: string,
	x: number,
	y: number,
	size: number,
	phaseDeg: number
): Promise<void> => {
	const img = await getIconImage(paths, color);
	const wave = Math.sin((phaseDeg * Math.PI) / 180);
	const downwardWave = (wave + 1) / 2;
	const yOffset = 4 * downwardWave;
	const alpha = 0.78 + 0.22 * (1 - downwardWave);
	ctx.save();
	ctx.translate(x + size / 2, y + size / 2 + yOffset);
	ctx.globalAlpha = alpha;
	ctx.drawImage(img, -size / 2, -size / 2, size, size);
	ctx.restore();
};

const fillRoundedRect = (
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number
): void => {
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

const drawBorder = (ctx: CanvasRenderingContext2D, color: string): void => {
	const offset = BORDER_WIDTH / 2;
	const w = CANVAS_SIZE - BORDER_WIDTH;
	const h = CANVAS_SIZE - BORDER_WIDTH;
	const r = BORDER_RADIUS;
	ctx.strokeStyle = color;
	ctx.lineWidth = BORDER_WIDTH;
	ctx.beginPath();
	ctx.moveTo(offset + r, offset);
	ctx.arcTo(offset + w, offset, offset + w, offset + h, r);
	ctx.arcTo(offset + w, offset + h, offset, offset + h, r);
	ctx.arcTo(offset, offset + h, offset, offset, r);
	ctx.arcTo(offset, offset, offset + w, offset, r);
	ctx.closePath();
	ctx.stroke();
};

/**
 * 依 instance 狀態分類取得代表色（狀態燈與大字狀態共用）
 */
const getStateColor = (state: string): string => {
	switch (classifyInstanceState(state)) {
		case 'running':
			return '#4ade80';
		case 'transitioning':
			return '#60a5fa';
		case 'stopped':
			return '#9ca3af';
		case 'terminated':
			return '#f87171';
		default:
			return '#9ca3af';
	}
};

/**
 * 依使用率門檻取得指標條顏色：<70 綠、<90 琥珀、>=90 紅
 */
const getUsageColor = (pct: number): string => {
	if (pct >= 90) {
		return '#f87171';
	}
	if (pct >= 70) {
		return '#fbbf24';
	}
	return '#4ade80';
};

/**
 * 繪製指標列：label（左）＋使用率條（中）＋百分比（右）。
 * 依列數在縱向區帶內均分置中。
 */
const drawMetricRows = (ctx: CanvasRenderingContext2D, metrics: Ec2Metrics): void => {
	const rows = availableMetrics(metrics);
	if (rows.length === 0) {
		return;
	}

	const slot = (ROWS_BOTTOM - ROWS_TOP) / rows.length;
	const barWidth = METRIC_BAR_RIGHT - METRIC_BAR_X;

	rows.forEach((row, index) => {
		const cy = ROWS_TOP + slot * (index + 0.5);
		const textY = cy - 9;

		ctx.fillStyle = 'white';
		ctx.font = '17px sans-serif bold';
		ctx.textAlign = 'left';
		ctx.fillText(row.label, METRIC_LABEL_X, textY);

		// 底軌
		const barTop = cy - METRIC_BAR_HEIGHT / 2;
		ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
		fillRoundedRect(ctx, METRIC_BAR_X, barTop, barWidth, METRIC_BAR_HEIGHT, 4);
		// 使用率填色
		const fillWidth = Math.max(0, Math.min(1, row.value / 100)) * barWidth;
		if (fillWidth > 0) {
			ctx.fillStyle = getUsageColor(row.value);
			fillRoundedRect(ctx, METRIC_BAR_X, barTop, Math.max(fillWidth, 4), METRIC_BAR_HEIGHT, 4);
		}

		ctx.fillStyle = 'white';
		ctx.font = '17px sans-serif';
		ctx.textAlign = 'left';
		ctx.fillText(`${row.value}%`, METRIC_PERCENT_X, textY);
	});
};

/**
 * 無指標時（stopped/pending/terminated…）在中央顯示大字狀態，
 * 過渡狀態以 rotationDeg 為相位做透明度脈動。
 */
const drawStateLabel = (ctx: CanvasRenderingContext2D, state: string, rotationDeg: number): void => {
	const cls = classifyInstanceState(state);
	ctx.save();
	if (cls === 'transitioning') {
		const wave = Math.sin((rotationDeg * Math.PI) / 180);
		ctx.globalAlpha = 0.5 + 0.5 * ((wave + 1) / 2);
	}
	ctx.fillStyle = getStateColor(state);
	ctx.font = '26px sans-serif bold';
	ctx.textAlign = 'center';
	ctx.fillText(state.toUpperCase(), 72, 66, 132);
	ctx.restore();
};

const drawFooter = async (
	ctx: CanvasRenderingContext2D,
	footer: Ec2Footer,
	timeText: string,
	phaseDeg: number
): Promise<void> => {
	ctx.fillStyle = 'white';
	ctx.font = '18px sans-serif';
	ctx.textAlign = 'left';
	ctx.fillText(timeText, 8, FOOTER_TEXT_Y);
	switch (footer) {
		case 'healthy':
			await drawIcon(ctx, ICON_CHECK, '#4ade80', 120, FOOTER_TEXT_Y, 16);
			break;
		case 'impaired':
			await drawIcon(ctx, ICON_CLOSE, '#f87171', 118, FOOTER_TEXT_Y - 1, 18);
			break;
		case 'terminated':
			await drawIcon(ctx, ICON_CLOSE, '#f87171', 118, FOOTER_TEXT_Y - 1, 18);
			break;
		case 'stopped':
			await drawIcon(ctx, ICON_PAUSE, '#9ca3af', 120, FOOTER_TEXT_Y, 16);
			break;
		case 'transitioning':
			await drawBreathingIcon(ctx, ICON_ARROW_DOWN, 'white', 120, FOOTER_TEXT_Y, 16, phaseDeg);
			break;
		default:
			await drawIcon(ctx, ICON_ARROW_DOWN, '#9ca3af', 120, FOOTER_TEXT_Y, 16);
			break;
	}
};

export type Ec2FrameSpec = {
	title: string;
	state: string;
	metrics: Ec2Metrics;
	footer: Ec2Footer;
	rotationDeg: number;
	borderColor?: string | null;
};

// 幀快取：與 CodePipeline 相同策略，唯一隨時間變動的是 HH:mm，
// 以「分鐘 + 完整參數」為 key 快取整張 data URL。
let frameCacheTime = '';
const frameCache = new Map<string, string>();

const getCachedFrame = (key: string): string | undefined => {
	const timeText = formatTime();
	if (timeText !== frameCacheTime) {
		frameCache.clear();
		frameCacheTime = timeText;
	}
	return frameCache.get(key);
};

const metricsKey = (metrics: Ec2Metrics): string => `${metrics.cpu ?? ''},${metrics.mem ?? ''},${metrics.disk ?? ''}`;

/**
 * 繪製 EC2 狀態畫面，回傳 base64 data URL（有快取）。
 * running 且有指標 → 畫指標列；其餘 → 畫大字狀態。
 */
export const renderFrame = async (spec: Ec2FrameSpec): Promise<string> => {
	const hasMetrics = availableMetrics(spec.metrics).length > 0;
	const key = `${spec.title}|${spec.state}|${metricsKey(spec.metrics)}|${spec.footer}|${spec.rotationDeg}|${spec.borderColor ?? ''}`;
	const cached = getCachedFrame(key);
	if (cached) {
		return cached;
	}

	const { canvas, ctx } = createButtonCanvas();
	const scale = (CANVAS_SIZE - CONTENT_INSET * 2) / CANVAS_SIZE;
	ctx.save();
	ctx.translate(CONTENT_INSET, CONTENT_INSET);
	ctx.scale(scale, scale);

	drawTitleWithState(ctx, spec.title, spec.state);
	if (hasMetrics) {
		drawMetricRows(ctx, spec.metrics);
	} else {
		drawStateLabel(ctx, spec.state, spec.rotationDeg);
	}
	await drawFooter(ctx, spec.footer, frameCacheTime, spec.rotationDeg);

	ctx.restore();

	if (spec.borderColor) {
		drawBorder(ctx, spec.borderColor);
	}

	const dataUrl = canvas.toDataURL();
	frameCache.set(key, dataUrl);
	return dataUrl;
};

/**
 * 繪製「尚未設定」畫面，回傳 base64 data URL（有快取）
 */
export const renderInitFrame = async (title: string): Promise<string> => {
	const key = `init|${title}`;
	const cached = getCachedFrame(key);
	if (cached) {
		return cached;
	}

	const { canvas, ctx } = createButtonCanvas();
	const scale = (CANVAS_SIZE - CONTENT_INSET * 2) / CANVAS_SIZE;
	ctx.save();
	ctx.translate(CONTENT_INSET, CONTENT_INSET);
	ctx.scale(scale, scale);

	try {
		const iconImg = await actionKeyIconPromise;
		const logoSize = 40;
		ctx.drawImage(iconImg, (CANVAS_SIZE - logoSize) / 2, TITLE_Y - 4, logoSize, logoSize);
	} catch (error) {
		streamDeck.logger.error('Failed to load EC2 action key icon', error);
	}

	ctx.fillStyle = 'white';
	ctx.font = '22px sans-serif bold';
	ctx.textAlign = 'center';
	ctx.fillText(title, 72, 67, 134);

	ctx.fillStyle = '#f59e0b';
	ctx.font = '20px sans-serif bold';
	ctx.textAlign = 'center';
	ctx.fillText(INIT_STATUS_LABEL, 72, 116, 132);

	ctx.restore();

	const dataUrl = canvas.toDataURL();
	frameCache.set(key, dataUrl);
	return dataUrl;
};
